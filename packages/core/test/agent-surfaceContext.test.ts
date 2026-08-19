import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ROLE_ARCHETYPES } from '../src/archetypes/roles.js';
import type { AgentReply } from '../src/agent/claude.js';
import { buildSurfaceContext, DEFAULT_SURFACE_BUDGET } from '../src/agent/surfaceContext.js';
import { cartography } from '../src/stages/s2-cartography.js';
import { ingest } from '../src/stages/s1-ingest.js';
import type { Components } from '../src/schemas/components.js';
import type { Ingest } from '../src/schemas/ingest.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/mini-ts-api', import.meta.url));
const RECORDED_S2 = fileURLToPath(new URL('./recorded/s2-mini-ts-api.json', import.meta.url));

let workRoot: string;
let ingested: Ingest;
let components: Components;
let repoDir: string;

beforeEach(async () => {
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-sctx-'));

  const s1 = await ingest({ ref: FIXTURE, workRoot, runId: 'ctx' });
  ingested = s1.ingest;
  repoDir = s1.run.repoDir;

  const reply = await fs.readFile(RECORDED_S2, 'utf8');
  const s2 = await cartography({
    run: s1.run,
    ingest: ingested,
    transport: async (): Promise<AgentReply> => ({ text: reply, costUsd: 0 }),
  });
  components = s2.components;
});

afterEach(async () => {
  await fs.rm(workRoot, { recursive: true, force: true });
});

describe('buildSurfaceContext', () => {
  it('includes source bodies, which is what isolation and richness are judged on', async () => {
    const context = await buildSurfaceContext(
      ROLE_ARCHETYPES.backend,
      components,
      ingested,
      repoDir,
    );

    expect(context.text).toContain('## Component: mini-ts-api');
    expect(context.included).toContain('src/services/inventory.ts');
    // The actual invariant in the body, not just the filename.
    expect(context.text).toContain('below zero');
  });

  it('lists the component files so the agent can cite paths that exist', async () => {
    const context = await buildSurfaceContext(
      ROLE_ARCHETYPES.backend,
      components,
      ingested,
      repoDir,
    );

    expect(context.text).toContain('### Files');
    expect(context.text).toContain('src/routes/items.ts');
  });

  it('returns nothing for a role with no in-lane components', async () => {
    const context = await buildSurfaceContext(
      ROLE_ARCHETYPES.frontend,
      components,
      ingested,
      repoDir,
    );

    expect(context.componentIds).toEqual([]);
    expect(context.included).toEqual([]);
  });

  it('never includes files stripped at S1', async () => {
    const context = await buildSurfaceContext(
      ROLE_ARCHETYPES.backend,
      components,
      ingested,
      repoDir,
    );

    expect(context.text).not.toContain('placeholder-not-a-real-secret');
  });

  it('respects the file-count ceiling', async () => {
    const context = await buildSurfaceContext(
      ROLE_ARCHETYPES.backend,
      components,
      ingested,
      repoDir,
      { ...DEFAULT_SURFACE_BUDGET, maxFiles: 2 },
    );

    expect(context.included).toHaveLength(2);
  });

  it('prefers entrypoints and tests over incidental files', async () => {
    const context = await buildSurfaceContext(
      ROLE_ARCHETYPES.backend,
      components,
      ingested,
      repoDir,
      { ...DEFAULT_SURFACE_BUDGET, maxFiles: 3 },
    );

    // src/index.ts is the recorded component's declared entrypoint.
    expect(context.included[0]).toBe('src/index.ts');
    expect(context.included.some((file) => file.includes('.spec.'))).toBe(true);
  });

  it('stays within the byte budget', async () => {
    const context = await buildSurfaceContext(
      ROLE_ARCHETYPES.backend,
      components,
      ingested,
      repoDir,
      { ...DEFAULT_SURFACE_BUDGET, totalBytes: 4_000 },
    );

    expect(context.bytes).toBeLessThanOrEqual(6_000);
  });
});
