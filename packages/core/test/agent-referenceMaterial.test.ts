import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentReply } from '../src/agent/claude.js';
import {
  buildReferenceMaterial,
  DEFAULT_REFERENCE_BUDGET,
} from '../src/agent/referenceMaterial.js';
import type { Components } from '../src/schemas/components.js';
import type { Ingest } from '../src/schemas/ingest.js';
import type { Surface } from '../src/schemas/surfaces.js';
import { cartography } from '../src/stages/s2-cartography.js';
import { ingest } from '../src/stages/s1-ingest.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/mini-ts-api', import.meta.url));
const RECORDED_S2 = fileURLToPath(new URL('./recorded/s2-mini-ts-api.json', import.meta.url));
const RECORDED_S4 = fileURLToPath(new URL('./recorded/s4-mini-ts-api.json', import.meta.url));

let workRoot: string;
let ingested: Ingest;
let components: Components;
let repoDir: string;
let surface: Surface;

beforeEach(async () => {
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-ref-'));

  const s1 = await ingest({ ref: FIXTURE, workRoot, runId: 'ref' });
  ingested = s1.ingest;
  repoDir = s1.run.repoDir;

  const reply = await fs.readFile(RECORDED_S2, 'utf8');
  const s2 = await cartography({
    run: s1.run,
    ingest: ingested,
    transport: async (): Promise<AgentReply> => ({ text: reply, costUsd: 0 }),
  });
  components = s2.components;

  const s4 = JSON.parse(await fs.readFile(RECORDED_S4, 'utf8')) as { surfaces: Surface[] };
  const first = s4.surfaces[0];
  if (first === undefined) throw new Error('recorded S4 reply is empty');
  surface = first;
});

afterEach(async () => {
  await fs.rm(workRoot, { recursive: true, force: true });
});

describe('buildReferenceMaterial', () => {
  it("leads with the surface's own files", async () => {
    const material = await buildReferenceMaterial(surface, components, ingested, repoDir);

    expect(material.included[0]).toBe(surface.paths[0]);
  });

  it("includes the component's tests, which teach the conventions to imitate", async () => {
    const material = await buildReferenceMaterial(surface, components, ingested, repoDir);

    expect(material.included.some((file) => file.includes('.spec.'))).toBe(true);
  });

  it('includes the root manifest, which names the stack exactly', async () => {
    const material = await buildReferenceMaterial(surface, components, ingested, repoDir);

    expect(material.included).toContain('package.json');
    expect(material.text).toContain('better-sqlite3');
  });

  it("honours the architecture doc's 40-file cap", async () => {
    expect(DEFAULT_REFERENCE_BUDGET.maxFiles).toBe(40);
    expect(DEFAULT_REFERENCE_BUDGET.maxBytes).toBe(150_000);
  });

  it('stops at the file cap', async () => {
    const material = await buildReferenceMaterial(surface, components, ingested, repoDir, {
      ...DEFAULT_REFERENCE_BUDGET,
      maxFiles: 2,
    });

    expect(material.included).toHaveLength(2);
  });

  it('stays within the byte budget', async () => {
    const material = await buildReferenceMaterial(surface, components, ingested, repoDir, {
      ...DEFAULT_REFERENCE_BUDGET,
      maxBytes: 1_500,
    });

    expect(material.bytes).toBeLessThanOrEqual(1_500);
  });

  it('never includes files stripped at S1', async () => {
    const material = await buildReferenceMaterial(surface, components, ingested, repoDir);

    expect(material.text).not.toContain('placeholder-not-a-real-secret');
    expect(material.included).not.toContain('.env');
  });

  /**
   * A fullstack surface names two components. Before this, reference material was gathered
   * from `componentId` alone, so the generator saw one side of the seam it had been asked to
   * build across — and wrote a package with nothing on the other side.
   */
  describe('a surface that spans a seam', () => {
    const twoComponents = (): Components => ({
      ...components,
      components: [
        {
          ...components.components[0]!,
          id: 'routes',
          paths: ['src/routes/**'],
        },
        {
          ...components.components[0]!,
          id: 'services',
          paths: ['src/services/**'],
        },
      ],
    });

    const seamSurface = (): Surface => ({
      ...surface,
      componentId: 'routes',
      seamComponentId: 'services',
      paths: ['src/routes/items.ts'],
    });

    it('gathers reference material from both sides', async () => {
      const material = await buildReferenceMaterial(
        seamSurface(),
        twoComponents(),
        ingested,
        repoDir,
      );

      expect(material.included).toContain('src/routes/shipments.ts');
      expect(material.included).toContain('src/services/inventory.ts');
    });

    it('takes the two sides in turn, so the larger one cannot spend the whole budget', async () => {
      const material = await buildReferenceMaterial(
        seamSurface(),
        twoComponents(),
        ingested,
        repoDir,
        {
          ...DEFAULT_REFERENCE_BUDGET,
          maxFiles: 4,
        },
      );

      const sides = new Set(
        material.included
          .filter((file) => file.startsWith('src/'))
          .map((file) => file.split('/')[1]),
      );

      expect(sides).toContain('routes');
      expect(sides).toContain('services');
    });

    it('still reads one component when there is no seam', async () => {
      const material = await buildReferenceMaterial(surface, components, ingested, repoDir);

      expect(material.included.length).toBeGreaterThan(0);
    });
  });

  it('lists each file once even when it is both surface path and component file', async () => {
    const material = await buildReferenceMaterial(surface, components, ingested, repoDir);

    expect(new Set(material.included).size).toBe(material.included.length);
  });
});
