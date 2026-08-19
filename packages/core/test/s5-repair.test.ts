import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentInvocation, AgentReply } from '../src/agent/claude.js';
import { QuarryError } from '../src/errors.js';
import { Meta } from '../src/schemas/meta.js';
import { repairPackage } from '../src/stages/s5-repair.js';
import { createRunDir, type RunDir } from '../src/run.js';

const NOW = new Date('2026-08-19T23:00:00.000Z');

let workRoot: string;
let run: RunDir;
let packageDir: string;

const meta: Meta = Meta.parse({
  schemaVersion: 1,
  runId: 'run',
  role: 'backend',
  seniority: 'junior',
  task: 'bug-hunt',
  source: { ref: '/src/repo', surfaceId: 's', surfaceTitle: 'T', componentId: 'api' },
  generation: {
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    attempts: 1,
    referenceFiles: [],
    setupCommand: 'npm install',
    testCommand: 'npm test',
  },
});

beforeEach(async () => {
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-repair-t-'));
  run = await createRunDir({ workRoot, ref: 'repo', runId: 'run' });
  packageDir = path.join(run.dir, 'package');

  await fs.mkdir(path.join(packageDir, 'candidate', 'test'), { recursive: true });
  await fs.mkdir(path.join(packageDir, 'interviewer'), { recursive: true });
  await fs.writeFile(path.join(packageDir, 'candidate', 'service.ts'), 'export const a = 1;\n');
  await fs.writeFile(path.join(packageDir, 'candidate', 'test', 'a.test.ts'), 'broken\n');
  await fs.writeFile(path.join(packageDir, 'interviewer', 'rubric.md'), '# rubric\n');
});

afterEach(async () => {
  await fs.rm(workRoot, { recursive: true, force: true });
});

/** Edits one file in place and reports it, the way a real repair does. */
function editingTransport(
  edits: Record<string, string>,
  reply?: Record<string, unknown>,
): ((invocation: AgentInvocation) => Promise<AgentReply>) & { calls: AgentInvocation[] } {
  const calls: AgentInvocation[] = [];

  const transport = async (invocation: AgentInvocation): Promise<AgentReply> => {
    calls.push(invocation);
    for (const [relPath, contents] of Object.entries(edits)) {
      const target = path.join(invocation.cwd, relPath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, contents, 'utf8');
    }
    return {
      text: JSON.stringify(
        reply ?? {
          files: Object.keys(edits),
          setupCommand: 'npm install',
          testCommand: 'npm test',
        },
      ),
      costUsd: 0.2,
    };
  };

  return Object.assign(transport, { calls });
}

describe('targeted repair', () => {
  it('edits the package in place rather than regenerating it', async () => {
    const transport = editingTransport({
      'candidate/test/a.test.ts': 'it("works", () => {});\n',
    });

    const result = await repairPackage({
      run,
      meta,
      seniority: 'junior',
      failures: ['`npm test` failed: assertion error'],
      transport,
    });

    // The edit landed, and the files it did not touch are untouched.
    const test = await fs.readFile(path.join(packageDir, 'candidate', 'test', 'a.test.ts'), 'utf8');
    const service = await fs.readFile(path.join(packageDir, 'candidate', 'service.ts'), 'utf8');
    expect(test).toContain('it("works"');
    expect(service).toBe('export const a = 1;\n');
    expect(result.changed).toEqual(['candidate/test/a.test.ts']);
  });

  it('shows the agent the failures and the files it has to work with', async () => {
    const transport = editingTransport({ 'candidate/service.ts': 'export const a = 2;\n' });

    await repairPackage({
      run,
      meta,
      seniority: 'junior',
      failures: ['`npm test` failed: expected 2, got 1'],
      transport,
    });

    const prompt = transport.calls[0]?.prompt ?? '';
    expect(prompt).toContain('expected 2, got 1');
    expect(prompt).toContain('candidate/service.ts');
    expect(prompt).toMatch(/Fix it in place/);
  });

  it('repairs outside the repo, so CLAUDE.md cannot leak in', async () => {
    const transport = editingTransport({ 'candidate/service.ts': 'x\n' });

    await repairPackage({ run, meta, seniority: 'junior', failures: ['x'], transport });

    const cwd = transport.calls[0]?.cwd ?? '';
    expect(cwd).not.toContain('Quarry');
    expect(cwd).toContain('quarry-repair-');
  });

  it('reminds a bug hunt that the bug stays planted', async () => {
    const transport = editingTransport({ 'candidate/service.ts': 'x\n' });
    await repairPackage({ run, meta, seniority: 'junior', failures: ['x'], transport });

    expect(transport.calls[0]?.prompt).toMatch(/planted bug stays planted/);
  });

  it('reminds an extension that nothing is planted', async () => {
    const transport = editingTransport({ 'candidate/service.ts': 'x\n' });
    await repairPackage({ run, meta, seniority: 'mid', failures: ['x'], transport });

    expect(transport.calls[0]?.prompt).toMatch(/nothing is planted/);
  });

  it('restates the synthesis rule, which a repair has broken before', async () => {
    const transport = editingTransport({ 'candidate/service.ts': 'x\n' });
    await repairPackage({ run, meta, seniority: 'junior', failures: ['x'], transport });

    expect(transport.calls[0]?.prompt).toMatch(/freshly written/);
    expect(transport.calls[0]?.prompt).toMatch(/8 or more lines/);
  });

  it('returns the commands as they stand, since a repair may correct them', async () => {
    const transport = editingTransport(
      { 'candidate/package.json': '{}\n' },
      {
        files: ['candidate/package.json'],
        setupCommand: 'npm ci',
        testCommand: 'npx vitest run',
      },
    );

    const result = await repairPackage({
      run,
      meta,
      seniority: 'junior',
      failures: ['wrong test command'],
      transport,
    });

    expect(result.setupCommand).toBe('npm ci');
    expect(result.testCommand).toBe('npx vitest run');
  });

  it('fails clearly when there is no package to repair', async () => {
    await fs.rm(packageDir, { recursive: true, force: true });

    const error = await repairPackage({
      run,
      meta,
      seniority: 'junior',
      failures: ['x'],
      transport: editingTransport({}),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(QuarryError);
    expect((error as QuarryError).message).toMatch(/No package at/);
  });

  it('leaves no temp directory behind', async () => {
    const before = (await fs.readdir(os.tmpdir())).filter((e) => e.startsWith('quarry-repair-'));
    await repairPackage({
      run,
      meta,
      seniority: 'junior',
      failures: ['x'],
      transport: editingTransport({ 'candidate/service.ts': 'x\n' }),
    });
    const after = (await fs.readdir(os.tmpdir())).filter((e) => e.startsWith('quarry-repair-'));

    expect(after.length).toBe(before.length);
  });
});
