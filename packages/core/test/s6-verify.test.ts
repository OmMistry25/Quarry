import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { QuarryError } from '../src/errors.js';
import { Meta } from '../src/schemas/meta.js';
import { verify } from '../src/stages/s6-verify.js';
import { createRunDir, type RunDir } from '../src/run.js';

/**
 * These run against a hand-built package rather than a generated one: the point is to prove
 * each check fires on the failure it exists for, which needs packages that are deliberately
 * broken in one specific way each.
 */

const NOW = new Date('2026-08-19T17:30:00.000Z');

let workRoot: string;
let run: RunDir;
let packageDir: string;

const meta: Meta = Meta.parse({
  schemaVersion: 1,
  runId: 'run',
  role: 'backend',
  seniority: 'junior',
  task: 'bug-hunt',
  source: { ref: '/src/repo', surfaceId: 's', surfaceTitle: 'Adjust', componentId: 'api' },
  generation: {
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    attempts: 1,
    referenceFiles: [],
    // Node only, so these tests never touch the network.
    setupCommand: 'true',
    testCommand: 'node run-tests.mjs',
  },
});

/**
 * A miniature package whose "test runner" is a plain Node script: it exits non-zero when the
 * guard is wrong. That gives a real install/test/fix cycle without npm or a network.
 */
async function buildPackage(options: {
  guard: '<' | '<=';
  fixGuard?: '<' | '<=';
  withVerifyTest?: boolean;
  withFix?: boolean;
  starterTestChecksZero?: boolean;
}): Promise<void> {
  const candidate = path.join(packageDir, 'candidate');
  await fs.mkdir(path.join(candidate, 'test'), { recursive: true });
  await fs.mkdir(path.join(packageDir, 'interviewer'), { recursive: true });

  const service = (guard: string): string =>
    `export function adjust(current, delta) {\n` +
    `  const next = current + delta;\n` +
    `  if (next ${guard} 0) throw new Error('below zero');\n` +
    `  return next;\n` +
    `}\n`;

  await fs.writeFile(path.join(candidate, 'service.mjs'), service(options.guard));

  // A stand-in test runner that behaves like vitest: with no argument it runs the shipped
  // suite, with a file argument it runs only that file. The bug-demo check appends a path,
  // so the fixture has to honour that contract.
  const starterAssertions = options.starterTestChecksZero
    ? "  if (adjust(3, -3) !== 0) { console.error('boundary'); process.exit(1); }\n"
    : '';
  await fs.writeFile(
    path.join(candidate, 'run-tests.mjs'),
    `const target = process.argv[2];\n` +
      `if (target) {\n` +
      `  await import(new URL(target, import.meta.url).href);\n` +
      `} else {\n` +
      `  const { adjust } = await import('./service.mjs');\n` +
      `  let failed = false;\n` +
      `  try { adjust(2, -5); failed = true; } catch {}\n` +
      `  if (failed) { console.error('should have thrown'); process.exit(1); }\n` +
      starterAssertions +
      `  console.log('ok');\n` +
      `}\n`,
  );

  await fs.writeFile(path.join(candidate, 'README.md'), '# app\n');

  if (options.withVerifyTest !== false) {
    await fs.writeFile(
      path.join(packageDir, 'interviewer', 'verify.test.mjs'),
      `const { adjust } = await import('../service.mjs');\n` +
        `if (adjust(3, -3) !== 0) { console.error('expected 0'); process.exit(1); }\n` +
        `console.log('ok');\n`,
    );
  }

  if (options.withFix !== false) {
    await fs.mkdir(path.join(packageDir, 'interviewer', 'fix'), { recursive: true });
    await fs.writeFile(
      path.join(packageDir, 'interviewer', 'fix', 'service.mjs'),
      service(options.fixGuard ?? '<'),
    );
  }
}

beforeEach(async () => {
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-s6-'));
  run = await createRunDir({ workRoot, ref: 'repo', runId: 'run' });
  // The overlap check compares against the source clone; an empty one means no overlap.
  await fs.mkdir(run.repoDir, { recursive: true });
  packageDir = path.join(run.dir, 'package');
});

afterEach(async () => {
  await fs.rm(workRoot, { recursive: true, force: true });
});

const metaForNode: Meta = meta;

describe('S6 verification', () => {
  it('passes a package that installs, tests, and demonstrates its bug', async () => {
    await buildPackage({ guard: '<=' });

    const report = await verify({ run, meta: metaForNode, now: NOW });

    expect(report.install.ok).toBe(true);
    expect(report.bugDemo?.ok).toBe(true);
    expect(report.overlap.ok).toBe(true);
    // gitleaks may or may not be installed; assert the checks that do not depend on it.
    expect(report.failures.filter((failure) => !failure.startsWith('Secrets scan'))).toEqual([]);
  }, 120_000);

  it('fails when the verify test passes against the starter — nothing was planted', async () => {
    // Guard is already correct, so there is no bug to find.
    await buildPackage({ guard: '<' });

    const report = await verify({ run, meta: metaForNode, now: NOW });

    expect(report.bugDemo?.failsOnStarter).toBe(false);
    expect(report.bugDemo?.detail).toMatch(/nothing was actually planted/);
    expect(report.ok).toBe(false);
  }, 120_000);

  it('fails when the documented fix does not fix it', async () => {
    await buildPackage({ guard: '<=', fixGuard: '<=' });

    const report = await verify({ run, meta: metaForNode, now: NOW });

    expect(report.bugDemo?.passesOnFixed).toBe(false);
    expect(report.bugDemo?.detail).toMatch(/does not fix it/);
  }, 120_000);

  it("fails when the starter's own suite already catches the bug", async () => {
    // The candidate would find it by running the tests once, so it is not a hunt.
    await buildPackage({ guard: '<=', starterTestChecksZero: true });

    const report = await verify({ run, meta: metaForNode, now: NOW });

    expect(report.bugDemo?.starterSuitePasses).toBe(false);
    expect(report.bugDemo?.detail).toMatch(/not a bug hunt/);
  }, 120_000);

  it('fails when there is no verify test to prove anything with', async () => {
    await buildPackage({ guard: '<=', withVerifyTest: false });

    const report = await verify({ run, meta: metaForNode, now: NOW });

    expect(report.bugDemo?.ok).toBe(false);
    expect(report.bugDemo?.detail).toMatch(/no verify\.test/);
  }, 120_000);

  it('fails when interviewer/fix is missing', async () => {
    await buildPackage({ guard: '<=', withFix: false });

    const report = await verify({ run, meta: metaForNode, now: NOW });

    expect(report.bugDemo?.ok).toBe(false);
    expect(report.bugDemo?.detail).toMatch(/fix\/ is empty/);
  }, 120_000);

  it('reports a failing install without pretending the tests ran', async () => {
    await buildPackage({ guard: '<=' });
    const failing = Meta.parse({
      ...metaForNode,
      generation: { ...metaForNode.generation, setupCommand: 'exit 7' },
    });

    const report = await verify({ run, meta: failing, now: NOW });

    expect(report.install.ok).toBe(false);
    expect(report.tests.stderr).toMatch(/skipped: install failed/);
    expect(report.failures.some((failure) => failure.includes('exit 7'))).toBe(true);
  }, 120_000);

  it('catches copied source code', async () => {
    await buildPackage({ guard: '<=' });

    const copied = Array.from({ length: 10 }, (_, index) => `const v${index} = ${index};`).join(
      '\n',
    );
    await fs.writeFile(path.join(run.repoDir, 'original.mjs'), copied);
    await fs.writeFile(path.join(packageDir, 'candidate', 'copied.mjs'), copied);

    const report = await verify({ run, meta: metaForNode, now: NOW });

    expect(report.overlap.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('Synthesis rule violated'))).toBe(
      true,
    );
  }, 120_000);

  it('leaves the packaged artifact untouched, working on a copy', async () => {
    await buildPackage({ guard: '<=' });
    const before = (await fs.readdir(path.join(packageDir, 'candidate'))).sort();

    await verify({ run, meta: metaForNode, now: NOW });

    const after = (await fs.readdir(path.join(packageDir, 'candidate'))).sort();
    expect(after).toEqual(before);
    // The bug-demo check copies the verify test in; it must not land in the real package.
    expect(after).not.toContain('verify.test.mjs');
  }, 120_000);

  it('writes a log with every command that ran', async () => {
    await buildPackage({ guard: '<=' });

    const report = await verify({ run, meta: metaForNode, now: NOW });
    const log = await fs.readFile(report.logPath, 'utf8');

    expect(log).toContain('# install:');
    expect(log).toContain('# bug demonstrability:');
    expect(log).toContain('# overlap:');
  }, 120_000);

  it('fails loudly when there is no package to verify', async () => {
    const error = await verify({ run, meta: metaForNode, now: NOW }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(QuarryError);
    expect((error as QuarryError).stage).toBe('s6');
  });
});

describe('environmental failures', () => {
  it('marks an install timeout as environmental, not a package problem', async () => {
    await buildPackage({ guard: '<=' });
    const hanging = Meta.parse({
      ...metaForNode,
      generation: { ...metaForNode.generation, setupCommand: 'sleep 30' },
    });

    const report = await verify({ run, meta: hanging, now: NOW, installTimeoutMs: 500 });

    expect(report.install.timedOut).toBe(true);
    expect(report.environmental).toBe(true);
  }, 60_000);

  it('does not mark an ordinary failing install as environmental', async () => {
    await buildPackage({ guard: '<=' });
    const failing = Meta.parse({
      ...metaForNode,
      generation: { ...metaForNode.generation, setupCommand: 'exit 1' },
    });

    const report = await verify({ run, meta: failing, now: NOW });

    // A package whose install genuinely errors is worth regenerating for.
    expect(report.install.timedOut).toBe(false);
  }, 60_000);
});
