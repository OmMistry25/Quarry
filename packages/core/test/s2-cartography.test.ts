import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import type { AgentInvocation, AgentReply } from '../src/agent/claude.js';
import { QuarryError } from '../src/errors.js';
import { CartographyReply, Components } from '../src/schemas/components.js';
import { cartography } from '../src/stages/s2-cartography.js';
import { ingest } from '../src/stages/s1-ingest.js';
import type { RunDir } from '../src/run.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/mini-ts-api', import.meta.url));
const RECORDED = fileURLToPath(new URL('./recorded/s2-mini-ts-api.json', import.meta.url));
const NOW = new Date('2026-08-19T15:14:01.000Z');

/**
 * Agent stages get two test modes (CLAUDE.md): schema tests against a recorded reply, which
 * is the fast default, and `LIVE=1` against the real agent, run by hand.
 */
const LIVE = process.env.LIVE === '1';

let workRoot: string;
let run: RunDir;

beforeEach(async () => {
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-s2-'));
  const ingested = await ingest({ ref: FIXTURE, workRoot, now: NOW, runId: 'test-run' });
  run = ingested.run;
});

afterEach(async () => {
  await fs.rm(workRoot, { recursive: true, force: true });
});

async function recordedReply(): Promise<string> {
  return fs.readFile(RECORDED, 'utf8');
}

describe('S2 cartography with a recorded reply', () => {
  it('writes a components.json that satisfies its own schema', async () => {
    const reply = await recordedReply();

    const result = await cartography({
      run,
      now: NOW,
      transport: async (): Promise<AgentReply> => ({ text: reply, costUsd: 0.04 }),
    });

    const onDisk: unknown = JSON.parse(await fs.readFile(result.artifactPath, 'utf8'));
    expect(() => Components.parse(onDisk)).not.toThrow();
    expect(result.artifactPath.endsWith(path.join('test-run', 'components.json'))).toBe(true);
  });

  it('records the run id, timestamp and what the agent cost', async () => {
    const reply = await recordedReply();

    const result = await cartography({
      run,
      now: NOW,
      transport: async (): Promise<AgentReply> => ({ text: reply, costUsd: 0.04 }),
    });

    expect(result.components.runId).toBe('test-run');
    expect(result.components.generatedAt).toBe(NOW.toISOString());
    expect(result.components.agent.attempts).toBe(1);
    expect(result.components.agent.costUsd).toBeCloseTo(0.04);
  });

  it('sends curated context, not the raw file tree', async () => {
    const reply = await recordedReply();
    const seen: AgentInvocation[] = [];

    await cartography({
      run,
      now: NOW,
      transport: async (invocation): Promise<AgentReply> => {
        seen.push(invocation);
        return { text: reply, costUsd: 0 };
      },
    });

    const prompt = seen[0]?.prompt ?? '';
    expect(prompt).toContain('## Directory map');
    expect(prompt).toContain('better-sqlite3');
    // The contract itself must reach the agent, not just the context.
    expect(prompt).toContain('"components"');
  });

  it('never leaks stripped secrets into the prompt', async () => {
    const reply = await recordedReply();
    const seen: AgentInvocation[] = [];

    await cartography({
      run,
      now: NOW,
      transport: async (invocation): Promise<AgentReply> => {
        seen.push(invocation);
        return { text: reply, costUsd: 0 };
      },
    });

    expect(seen[0]?.prompt).not.toContain('placeholder-not-a-real-secret');
  });

  it('retries when the agent returns a dangling depends_on, then succeeds', async () => {
    const good = await recordedReply();
    const bad = JSON.stringify({
      components: [
        {
          id: 'api',
          kind: 'backend-api',
          paths: ['**'],
          stack: ['typescript'],
          entrypoints: ['src/index.ts'],
          depends_on: ['does-not-exist'],
          docs: [],
          confidence: 0.8,
          notes: 'x',
        },
      ],
    });

    let call = 0;
    const result = await cartography({
      run,
      now: NOW,
      transport: async (): Promise<AgentReply> => {
        call += 1;
        return { text: call === 1 ? bad : good, costUsd: 0.02 };
      },
    });

    expect(result.components.agent.attempts).toBe(2);
    expect(result.components.agent.costUsd).toBeCloseTo(0.04);
  });

  it('fails loudly when ingest.json is missing rather than mapping nothing', async () => {
    await fs.rm(path.join(run.dir, 'ingest.json'));

    const error = await cartography({
      run,
      now: NOW,
      transport: async (): Promise<AgentReply> => ({ text: '{}', costUsd: 0 }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(QuarryError);
    expect((error as QuarryError).stage).toBe('s2');
    expect((error as QuarryError).message).toMatch(/run ingest first/i);
  });
});

describe('the recorded reply itself', () => {
  it('still satisfies the current schema, so schema drift is caught', async () => {
    const parsed = CartographyReply.safeParse(JSON.parse(await recordedReply()));
    expect(parsed.success).toBe(true);
  });

  it('describes the fixture as a single backend component, not one per layer', async () => {
    const parsed = CartographyReply.parse(JSON.parse(await recordedReply()));

    expect(parsed.components).toHaveLength(1);
    expect(parsed.components[0]?.kind).toBe('backend-api');
  });
});

describe.runIf(LIVE)('S2 cartography against the real agent (LIVE=1)', () => {
  it('maps the fixture to a single backend-api component', async () => {
    const result = await cartography({ run, now: NOW });

    expect(result.components.components).toHaveLength(1);
    expect(result.components.components[0]?.kind).toBe('backend-api');
    expect(result.components.components[0]?.stack).toContain('express');
  }, 300_000);
});
