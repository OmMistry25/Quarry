import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentInvocation, AgentReply } from '../src/agent/claude.js';
import { QuarryError } from '../src/errors.js';
import { Surfaces, SurfacesReply } from '../src/schemas/surfaces.js';
import { cartography } from '../src/stages/s2-cartography.js';
import { ingest } from '../src/stages/s1-ingest.js';
import { pickSurface, rankSurfaces, surfaceSelection } from '../src/stages/s4-surfaces.js';
import type { Components } from '../src/schemas/components.js';
import type { Ingest } from '../src/schemas/ingest.js';
import type { RunDir } from '../src/run.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/mini-ts-api', import.meta.url));
const RECORDED_S2 = fileURLToPath(new URL('./recorded/s2-mini-ts-api.json', import.meta.url));
const RECORDED_S4 = fileURLToPath(new URL('./recorded/s4-mini-ts-api.json', import.meta.url));
const NOW = new Date('2026-08-19T15:46:19.000Z');

const LIVE = process.env.LIVE === '1';

let workRoot: string;
let run: RunDir;
let ingested: Ingest;
let components: Components;

beforeEach(async () => {
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-s4-'));

  const s1 = await ingest({ ref: FIXTURE, workRoot, now: NOW, runId: 'test-run' });
  run = s1.run;
  ingested = s1.ingest;

  const s2Reply = await fs.readFile(RECORDED_S2, 'utf8');
  const s2 = await cartography({
    run,
    ingest: ingested,
    now: NOW,
    transport: async (): Promise<AgentReply> => ({ text: s2Reply, costUsd: 0 }),
  });
  components = s2.components;
});

afterEach(async () => {
  await fs.rm(workRoot, { recursive: true, force: true });
});

async function recordedReply(): Promise<string> {
  return fs.readFile(RECORDED_S4, 'utf8');
}

/**
 * Fullstack is defined as a vertical slice across the seam, but a surface names one
 * component — so S4 offered three single-component surfaces, S5 faithfully generated one
 * side, and a "fullstack" package shipped with no frontend in it and passed every check.
 */
describe('a fullstack surface has to span the seam', () => {
  const seamComponents = (): Components => ({
    ...components,
    components: [
      { ...components.components[0]!, id: 'web', kind: 'frontend-app', paths: ['src/routes/**'] },
      { ...components.components[0]!, id: 'api', kind: 'backend-api', paths: ['src/services/**'] },
    ],
  });

  const surfacesReply = (extra: Record<string, unknown>): string =>
    JSON.stringify({
      surfaces: [1, 2, 3].map((n) => ({
        id: `slice-${n}`,
        title: `Slice ${n}`,
        componentId: 'web',
        paths: ['src/routes/items.ts', 'src/services/inventory.ts'],
        summary: 'A workflow followed from the screen to the handler serving it.',
        scores: { isolation: 0.8, representativeness: 0.8, richness: 0.8 },
        rationale: 'Both sides lift out together and depend on nothing else.',
        assessmentIdea: 'The rejection the server returns and the screen has to render.',
        ...extra,
      })),
    });

  const select = async (reply: string): Promise<unknown> =>
    surfaceSelection({
      run,
      ingest: ingested,
      components: seamComponents(),
      role: 'fullstack',
      now: NOW,
      transport: async (): Promise<AgentReply> => ({ text: reply, costUsd: 0 }),
    });

  it('accepts a surface naming both sides', async () => {
    await expect(select(surfacesReply({ seamComponentId: 'api' }))).resolves.toBeDefined();
  });

  it('rejects a surface naming only one component', async () => {
    await expect(select(surfacesReply({}))).rejects.toThrow();
  });

  it('rejects a seam whose two sides are the same component', async () => {
    await expect(select(surfacesReply({ seamComponentId: 'web' }))).rejects.toThrow();
  });

  it('rejects a seam pointing at a component that is not in lane', async () => {
    await expect(select(surfacesReply({ seamComponentId: 'nope' }))).rejects.toThrow();
  });

  it('leaves single-component roles alone', async () => {
    const backend = await surfaceSelection({
      run,
      ingest: ingested,
      components,
      role: 'backend',
      now: NOW,
      transport: async (): Promise<AgentReply> => ({ text: await recordedReply(), costUsd: 0 }),
    });

    expect(backend.surfaces.surfaces[0]?.seamComponentId).toBeUndefined();
  });
});

describe('S4 surface selection with a recorded reply', () => {
  it('writes a surfaces.json that satisfies its own schema', async () => {
    const reply = await recordedReply();

    const result = await surfaceSelection({
      run,
      ingest: ingested,
      components,
      role: 'backend',
      now: NOW,
      transport: async (): Promise<AgentReply> => ({ text: reply, costUsd: 0.11 }),
    });

    const onDisk: unknown = JSON.parse(await fs.readFile(result.artifactPath, 'utf8'));
    expect(() => Surfaces.parse(onDisk)).not.toThrow();
    expect(result.surfaces.role).toBe('backend');
  });

  it('ranks surfaces best-first by weighted total', async () => {
    const reply = await recordedReply();

    const result = await surfaceSelection({
      run,
      ingest: ingested,
      components,
      role: 'backend',
      now: NOW,
      transport: async (): Promise<AgentReply> => ({ text: reply, costUsd: 0 }),
    });

    const totals = result.surfaces.surfaces.map((surface) => surface.total);
    expect([...totals]).toEqual([...totals].sort((a, b) => b - a));
  });

  it('sends in-lane source code, not just a directory listing', async () => {
    const reply = await recordedReply();
    const seen: AgentInvocation[] = [];

    await surfaceSelection({
      run,
      ingest: ingested,
      components,
      role: 'backend',
      now: NOW,
      transport: async (invocation): Promise<AgentReply> => {
        seen.push(invocation);
        return { text: reply, costUsd: 0 };
      },
    });

    const prompt = seen[0]?.prompt ?? '';
    // The actual body of the service, which is what isolation and richness are judged on.
    expect(prompt).toContain('would take');
    expect(prompt).toContain('## Component: mini-ts-api');
    expect(prompt).not.toContain('placeholder-not-a-real-secret');
  });

  it('rejects a hallucinated file path and retries with a specific complaint', async () => {
    const good = await recordedReply();
    const bad = JSON.stringify({
      surfaces: JSON.parse(good).surfaces.map((surface: { paths: string[] }, index: number) =>
        index === 0 ? { ...surface, paths: ['src/services/does-not-exist.ts'] } : surface,
      ),
    });

    const seen: AgentInvocation[] = [];
    let call = 0;

    const result = await surfaceSelection({
      run,
      ingest: ingested,
      components,
      role: 'backend',
      now: NOW,
      transport: async (invocation): Promise<AgentReply> => {
        seen.push(invocation);
        call += 1;
        return { text: call === 1 ? bad : good, costUsd: 0.05 };
      },
    });

    expect(result.surfaces.agent.attempts).toBe(2);
    expect(seen[1]?.prompt).toContain('does-not-exist.ts');
    expect(seen[1]?.prompt).toMatch(/not a file in this repository/);
  });

  it('rejects a surface pinned to a component that is not in-lane', async () => {
    const good = await recordedReply();
    const bad = JSON.stringify({
      surfaces: JSON.parse(good).surfaces.map((surface: object, index: number) =>
        index === 0 ? { ...surface, componentId: 'ghost-component' } : surface,
      ),
    });

    const seen: AgentInvocation[] = [];
    let call = 0;

    await surfaceSelection({
      run,
      ingest: ingested,
      components,
      role: 'backend',
      now: NOW,
      transport: async (invocation): Promise<AgentReply> => {
        seen.push(invocation);
        call += 1;
        return { text: call === 1 ? bad : good, costUsd: 0 };
      },
    });

    expect(seen[1]?.prompt).toContain('ghost-component');
    expect(seen[1]?.prompt).toMatch(/not an in-lane component id/);
  });

  it('fails loudly when the role has no in-lane components', async () => {
    const error = await surfaceSelection({
      run,
      ingest: ingested,
      components,
      role: 'frontend',
      now: NOW,
      transport: async (): Promise<AgentReply> => ({ text: '{}', costUsd: 0 }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(QuarryError);
    expect((error as QuarryError).stage).toBe('s4');
    expect((error as QuarryError).message).toMatch(/quarry roles/);
  });

  it('logs every agent attempt to the run directory', async () => {
    const reply = await recordedReply();

    await surfaceSelection({
      run,
      ingest: ingested,
      components,
      role: 'backend',
      now: NOW,
      transport: async (): Promise<AgentReply> => ({ text: reply, costUsd: 0 }),
    });

    const log = await fs.readFile(path.join(run.dir, 'logs', 'agent.log'), 'utf8');
    expect(log).toContain('[s4] attempt 1: ok');
  });
});

describe('pickSurface', () => {
  const artifact = {
    schemaVersion: 1 as const,
    runId: 'r',
    generatedAt: NOW.toISOString(),
    role: 'backend' as const,
    surfaces: ['a', 'b', 'c'].map((id, index) => ({
      id,
      title: id,
      componentId: 'api',
      paths: ['src/index.ts'],
      summary: 's',
      scores: { isolation: 1 - index * 0.1, representativeness: 0.5, richness: 0.5 },
      rationale: 'r',
      assessmentIdea: 'i',
      total: 1 - index * 0.1,
    })),
    agent: { attempts: 1 },
  };

  it('--auto takes the top-ranked surface', () => {
    expect(pickSurface(Surfaces.parse(artifact), { auto: true }).id).toBe('a');
  });

  it('picks a named surface', () => {
    expect(pickSurface(Surfaces.parse(artifact), { surfaceId: 'b' }).id).toBe('b');
  });

  it('lists the options when asked for one that does not exist', () => {
    const error = (() => {
      try {
        pickSurface(Surfaces.parse(artifact), { surfaceId: 'nope' });
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(QuarryError);
    expect((error as QuarryError).message).toContain('a, b, c');
  });
});

describe('rankSurfaces', () => {
  it('breaks ties by id, so ranking is stable', () => {
    const base = {
      title: 't',
      componentId: 'api',
      paths: ['src/index.ts'],
      summary: 's',
      scores: { isolation: 0.5, representativeness: 0.5, richness: 0.5 },
      rationale: 'r',
      assessmentIdea: 'i',
    };

    const ranked = rankSurfaces([
      { ...base, id: 'zebra' },
      { ...base, id: 'apple' },
    ]);

    expect(ranked.map((surface) => surface.id)).toEqual(['apple', 'zebra']);
  });
});

describe('the recorded S4 reply itself', () => {
  it('still satisfies the current schema', async () => {
    const parsed = SurfacesReply.safeParse(JSON.parse(await recordedReply()));
    expect(parsed.success).toBe(true);
  });
});

describe.runIf(LIVE)('S4 against the real agent (LIVE=1)', () => {
  it('returns 3–5 usable surfaces for the fixture', async () => {
    const result = await surfaceSelection({
      run,
      ingest: ingested,
      components,
      role: 'backend',
      now: NOW,
    });

    expect(result.surfaces.surfaces.length).toBeGreaterThanOrEqual(3);
    expect(result.surfaces.surfaces.length).toBeLessThanOrEqual(5);

    const paths = new Set(ingested.tree.map((entry) => entry.path));
    for (const surface of result.surfaces.surfaces) {
      expect(surface.componentId).toBe('mini-ts-api');
      for (const file of surface.paths) expect(paths.has(file)).toBe(true);
    }
  }, 300_000);
});
