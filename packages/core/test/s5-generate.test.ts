import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentInvocation, AgentReply } from '../src/agent/claude.js';
import { QuarryError } from '../src/errors.js';
import { Meta } from '../src/schemas/meta.js';
import type { Components } from '../src/schemas/components.js';
import type { Ingest } from '../src/schemas/ingest.js';
import type { Surface } from '../src/schemas/surfaces.js';
import { cartography } from '../src/stages/s2-cartography.js';
import { generate } from '../src/stages/s5-generate.js';
import { ingest } from '../src/stages/s1-ingest.js';
import type { RunDir } from '../src/run.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/mini-ts-api', import.meta.url));
const RECORDED_S2 = fileURLToPath(new URL('./recorded/s2-mini-ts-api.json', import.meta.url));
const RECORDED_S4 = fileURLToPath(new URL('./recorded/s4-mini-ts-api.json', import.meta.url));
const NOW = new Date('2026-08-19T16:45:00.000Z');

let workRoot: string;
let run: RunDir;
let ingested: Ingest;
let components: Components;
let surface: Surface;

beforeEach(async () => {
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-s5-'));

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

  const s4 = JSON.parse(await fs.readFile(RECORDED_S4, 'utf8')) as { surfaces: Surface[] };
  const first = s4.surfaces[0];
  if (first === undefined) throw new Error('recorded S4 reply is empty');
  surface = first;
});

afterEach(async () => {
  await fs.rm(workRoot, { recursive: true, force: true });
});

/** A transport that writes a plausible package into the agent's cwd, then reports it. */
function writingTransport(
  files: Record<string, string>,
  reply?: Record<string, unknown>,
): ((invocation: AgentInvocation) => Promise<AgentReply>) & { calls: AgentInvocation[] } {
  const calls: AgentInvocation[] = [];

  const transport = async (invocation: AgentInvocation): Promise<AgentReply> => {
    calls.push(invocation);

    for (const [relPath, contents] of Object.entries(files)) {
      const target = path.join(invocation.cwd, relPath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, contents, 'utf8');
    }

    return {
      text: JSON.stringify(
        reply ?? {
          files: Object.keys(files),
          setupCommand: 'npm install',
          testCommand: 'npm test',
          plantedBugFile: 'candidate/src/services/inventory.ts',
        },
      ),
      costUsd: 1.5,
    };
  };

  return Object.assign(transport, { calls });
}

const VALID_PACKAGE: Record<string, string> = {
  'candidate/README.md': '# app\n\nnpm install\n',
  'candidate/BRIEF.md': '# Incident\n',
  'candidate/package.json': '{"name":"app"}\n',
  'candidate/tsconfig.json': '{}\n',
  'candidate/src/index.ts': 'export const app = 1;\n',
  'candidate/src/services/inventory.ts': 'export const adjust = () => 1;\n',
  'candidate/test/inventory.spec.ts': 'it("works", () => {});\n',
  'interviewer/rubric.md': '# Rubric\n',
  'interviewer/answer-key.md': '# Answer key\n',
  'interviewer/verify.test.ts': 'it("fails on starter", () => {});\n',
};

async function run5(
  transport: (invocation: AgentInvocation) => Promise<AgentReply>,
  overrides: Partial<Parameters<typeof generate>[0]> = {},
) {
  return generate({
    run,
    ingest: ingested,
    components,
    surface,
    role: 'backend',
    seniority: 'junior',
    now: NOW,
    transport,
    ...overrides,
  });
}

describe('S5 generation', () => {
  it('moves the package into the run directory and writes meta.json', async () => {
    const result = await run5(writingTransport(VALID_PACKAGE));

    const onDisk: unknown = JSON.parse(
      await fs.readFile(path.join(result.packageDir, 'meta.json'), 'utf8'),
    );
    expect(() => Meta.parse(onDisk)).not.toThrow();
    expect(result.packageDir).toBe(path.join(run.dir, 'package'));

    const readme = await fs.readFile(
      path.join(result.packageDir, 'candidate', 'README.md'),
      'utf8',
    );
    expect(readme).toContain('npm install');
  });

  it('generates outside the repo, so CLAUDE.md cannot leak into the generator', async () => {
    // Phase 2 established this by experiment. S5 is the stage where it is hardest to get
    // right, because the agent genuinely needs a writable working directory.
    const transport = writingTransport(VALID_PACKAGE);
    await run5(transport);

    const cwd = transport.calls[0]?.cwd ?? '';
    expect(cwd).not.toContain('Quarry');
    expect(cwd).toContain('quarry-generate-');
  });

  it('asks for write mode, not analysis mode', async () => {
    const transport = writingTransport(VALID_PACKAGE);
    await run5(transport);

    expect(transport.calls[0]?.mode).toBe('write');
    expect(transport.calls[0]?.systemPrompt).toMatch(/write files/i);
  });

  it('records what the generator was allowed to read, for auditing invariant 1', async () => {
    const result = await run5(writingTransport(VALID_PACKAGE));

    expect(result.meta.generation.referenceFiles.length).toBeGreaterThan(0);
    expect(result.meta.generation.referenceFiles).toContain('src/services/inventory.ts');
  });

  it('records the surface it came from, so a package is traceable', async () => {
    const result = await run5(writingTransport(VALID_PACKAGE));

    expect(result.meta.source.surfaceId).toBe(surface.id);
    expect(result.meta.source.componentId).toBe(surface.componentId);
    expect(result.meta.task).toBe('bug-hunt');
  });

  it('puts the synthesis rule and the stub strategy in the prompt', async () => {
    const transport = writingTransport(VALID_PACKAGE);
    await run5(transport);

    const prompt = transport.calls[0]?.prompt ?? '';
    expect(prompt).toMatch(/Write every file fresh/);
    expect(prompt).toMatch(/8 or more lines/);
    expect(prompt).toMatch(/SQLite or in-memory/);
    expect(prompt).toMatch(/API design/);
    // Reference material must actually be there for it to imitate.
    expect(prompt).toContain('below zero');
  });

  it("reports files from disk, not from the agent's word", async () => {
    // The agent claims a file it never wrote; the truth is the filesystem.
    const transport = writingTransport(VALID_PACKAGE, {
      files: [...Object.keys(VALID_PACKAGE), 'candidate/src/imaginary.ts'],
      setupCommand: 'npm install',
      testCommand: 'npm test',
      plantedBugFile: 'candidate/src/services/inventory.ts',
    });

    const result = await run5(transport);
    expect(result.files).not.toContain('candidate/src/imaginary.ts');
  });
});

describe('S5 package shape checks', () => {
  it.each([
    ['candidate/README.md'],
    ['candidate/BRIEF.md'],
    ['interviewer/rubric.md'],
    ['interviewer/answer-key.md'],
    ['interviewer/verify.test.ts'],
  ])('fails when %s is missing', async (missing) => {
    const files = { ...VALID_PACKAGE };
    delete files[missing];

    const error = await run5(writingTransport(files)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(QuarryError);
    expect((error as QuarryError).stage).toBe('s5');
  });

  it('fails when candidate/ is too thin to be a real repo', async () => {
    const files = {
      'candidate/README.md': '#\n',
      'candidate/BRIEF.md': '#\n',
      'interviewer/rubric.md': '#\n',
      'interviewer/answer-key.md': '#\n',
      'interviewer/verify.test.ts': '\n',
    };

    const error = await run5(writingTransport(files)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(QuarryError);
    expect((error as QuarryError).message).toMatch(/only \d+ file/);
  });

  it('fails when the verification test leaks into candidate/', async () => {
    // It gives the answer away outright, so this must never ship.
    const files = { ...VALID_PACKAGE, 'candidate/test/verify.test.ts': 'it("x", () => {});\n' };

    const error = await run5(writingTransport(files)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(QuarryError);
    expect((error as QuarryError).message).toMatch(/leaked into candidate/);
  });

  it('leaves no temp directory behind after a failure', async () => {
    const before = (await fs.readdir(os.tmpdir())).filter((entry) =>
      entry.startsWith('quarry-generate-'),
    );

    await run5(writingTransport({ 'candidate/README.md': '#\n' })).catch(() => undefined);

    const after = (await fs.readdir(os.tmpdir())).filter((entry) =>
      entry.startsWith('quarry-generate-'),
    );
    expect(after.length).toBe(before.length);
  });
});

describe('S5 scope gate', () => {
  it.each(['mid', 'senior'] as const)(
    'refuses %s until the extension archetype ships',
    async (seniority) => {
      const error = await run5(writingTransport(VALID_PACKAGE), { seniority }).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(QuarryError);
      expect((error as QuarryError).message).toMatch(/not implemented yet/);
    },
  );
});
