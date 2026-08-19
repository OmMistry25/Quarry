import fs from 'node:fs/promises';
import path from 'node:path';

import { runCommand, TEST_TIMEOUT_MS, type CommandResult } from './sandbox.js';

/**
 * Bug demonstrability (SPEC S6): the planted bug must be *provable*, not merely claimed.
 *
 * `interviewer/verify.test.*` is copied into a working copy of `candidate/` and run twice —
 * once as shipped, once with `interviewer/fix/` overlaid. It has to fail the first time and
 * pass the second. A test that passes both times proves nothing was planted; one that fails
 * both times means the documented fix does not actually fix it.
 *
 * The starter's own suite is checked too: if it already catches the bug, this is not a bug
 * hunt, because the candidate would find it by running the tests once.
 */

export interface BugDemoResult {
  ok: boolean;
  failsOnStarter: boolean;
  passesOnFixed: boolean;
  /** The shipped suite must pass against the planted bug for the hunt to be a hunt. */
  starterSuitePasses: boolean;
  detail: string;
  runs: CommandResult[];
}

export interface BugDemoOptions {
  packageDir: string;
  /** An already-installed copy of `candidate/`, so node_modules is not built twice. */
  installedCandidateDir: string;
  testCommand: string;
  timeoutMs?: number;
}

/** `interviewer/verify.test.ts` → `verify.test.ts` */
async function findVerifyTest(packageDir: string): Promise<string | undefined> {
  const entries = await fs
    .readdir(path.join(packageDir, 'interviewer'), { withFileTypes: true })
    .catch(() => []);

  return entries.find((entry) => entry.isFile() && /^verify\.test\./.test(entry.name))?.name;
}

/**
 * Where to drop the verification test inside the candidate copy. It imports as though it sits
 * in the project's own test directory, so that is where it goes.
 */
async function testDirectory(candidateDir: string): Promise<string> {
  for (const name of ['test', 'tests', '__tests__', 'src']) {
    const stat = await fs.stat(path.join(candidateDir, name)).catch(() => undefined);
    if (stat?.isDirectory()) return name;
  }
  return '.';
}

async function overlayFix(candidateDir: string, packageDir: string): Promise<number> {
  const fixDir = path.join(packageDir, 'interviewer', 'fix');
  const stat = await fs.stat(fixDir).catch(() => undefined);
  if (!stat?.isDirectory()) return 0;

  let applied = 0;

  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relPath);
        continue;
      }
      const target = path.join(candidateDir, relPath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(dir, entry.name), target);
      applied += 1;
    }
  };

  await walk(fixDir, '');
  return applied;
}

export async function checkBugDemonstrable(options: BugDemoOptions): Promise<BugDemoResult> {
  const timeoutMs = options.timeoutMs ?? TEST_TIMEOUT_MS;
  const runs: CommandResult[] = [];

  const verifyTestName = await findVerifyTest(options.packageDir);
  if (verifyTestName === undefined) {
    return {
      ok: false,
      failsOnStarter: false,
      passesOnFixed: false,
      starterSuitePasses: false,
      detail: 'interviewer/ has no verify.test.* file, so the planted bug cannot be proved.',
      runs,
    };
  }

  // 1. The shipped suite must pass against the planted bug.
  const starterSuite = await runCommand(options.testCommand, {
    cwd: options.installedCandidateDir,
    timeoutMs,
  });
  runs.push(starterSuite);

  // 2. Drop the verification test in and run only it, against the starter.
  const testDir = await testDirectory(options.installedCandidateDir);
  const verifyRelPath = testDir === '.' ? verifyTestName : `${testDir}/${verifyTestName}`;
  await fs.copyFile(
    path.join(options.packageDir, 'interviewer', verifyTestName),
    path.join(options.installedCandidateDir, verifyRelPath),
  );

  const onStarter = await runCommand(`${options.testCommand} ${verifyRelPath}`, {
    cwd: options.installedCandidateDir,
    timeoutMs,
  });
  runs.push(onStarter);

  // 3. Overlay the documented fix and run it again.
  const applied = await overlayFix(options.installedCandidateDir, options.packageDir);
  const onFixed = await runCommand(`${options.testCommand} ${verifyRelPath}`, {
    cwd: options.installedCandidateDir,
    timeoutMs,
  });
  runs.push(onFixed);

  const failsOnStarter = !onStarter.ok;
  const passesOnFixed = onFixed.ok;
  const starterSuitePasses = starterSuite.ok;
  const ok = failsOnStarter && passesOnFixed && starterSuitePasses;

  const problems: string[] = [];
  if (!starterSuitePasses) {
    problems.push(
      "the starter's own test suite fails, so the candidate would find the bug by running " +
        'the tests once — that is not a bug hunt',
    );
  }
  if (!failsOnStarter) {
    problems.push('verify.test.* passes against the starter, so nothing was actually planted');
  }
  if (!passesOnFixed) {
    problems.push(
      applied === 0
        ? 'interviewer/fix/ is empty, so the documented fix could not be applied'
        : `verify.test.* still fails after applying ${applied} fix file(s), so the documented fix does not fix it`,
    );
  }

  return {
    ok,
    failsOnStarter,
    passesOnFixed,
    starterSuitePasses,
    detail: ok ? 'planted bug is demonstrable' : problems.join('; '),
    runs,
  };
}
