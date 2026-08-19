import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { QuarryError } from '../errors.js';
import type { Meta } from '../schemas/meta.js';
import type { RunDir } from '../run.js';

import { checkBugDemonstrable, type BugDemoResult } from '../verify/bugDemo.js';
import { scanForSecrets, type SecretsScanResult } from '../verify/gitleaks.js';
import { checkOverlap, type OverlapResult } from '../verify/overlap.js';
import {
  INSTALL_TIMEOUT_MS,
  runCommand,
  salientErrors,
  tail,
  TEST_TIMEOUT_MS,
  type CommandResult,
} from '../verify/sandbox.js';

/**
 * S6 — Verification (docs/SPEC.md).
 *
 * Install, run the tests, prove the planted bug, scan for secrets, and check for copied code.
 * Nothing is packaged until every one of these passes (CLAUDE.md invariant 3), and each
 * result carries enough detail to feed the repair loop or to explain a hard failure.
 */

export interface VerifyOptions {
  run: RunDir;
  meta: Meta;
  /** Defaults to `<run>/package`. */
  packageDir?: string;
  requireBugDemonstration?: boolean;
  installTimeoutMs?: number;
  testTimeoutMs?: number;
  now?: Date;
  onStep?: (step: VerifyStep) => void;
}

export interface VerifyStep {
  name: 'install' | 'tests' | 'bug-demo' | 'secrets' | 'overlap';
  ok: boolean;
  detail: string;
}

export interface VerifyReport {
  ok: boolean;
  /**
   * True when the failure is about the machine, not the package: an install that timed out
   * (usually an unreachable registry), or gitleaks not being installed. Regenerating cannot
   * fix either, so the repair loop must not waste a full generation pass on them.
   */
  environmental: boolean;
  install: CommandResult;
  tests: CommandResult;
  bugDemo: BugDemoResult | undefined;
  secrets: SecretsScanResult;
  overlap: OverlapResult;
  /** Everything that failed, phrased for a human and for the repair prompt. */
  failures: string[];
  logPath: string;
}

export async function verify(options: VerifyOptions): Promise<VerifyReport> {
  const packageDir = options.packageDir ?? path.join(options.run.dir, 'package');
  const candidateDir = path.join(packageDir, 'candidate');

  if (!(await fs.stat(candidateDir).catch(() => undefined))?.isDirectory()) {
    throw new QuarryError(`No candidate/ directory in ${packageDir}. Run generation first.`, {
      stage: 's6',
    });
  }

  const report = (step: VerifyStep): void => options.onStep?.(step);

  // Work on a copy: installing writes node_modules, and the bug-demo check mutates files.
  // The packaged artifact must stay exactly as generated.
  const sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-verify-'));
  const workingCandidate = path.join(sandboxDir, 'candidate');
  await fs.cp(candidateDir, workingCandidate, { recursive: true });

  try {
    const failures: string[] = [];

    const install = await runCommand(options.meta.generation.setupCommand, {
      cwd: workingCandidate,
      timeoutMs: options.installTimeoutMs ?? INSTALL_TIMEOUT_MS,
    });
    report({
      name: 'install',
      ok: install.ok,
      detail: install.ok ? `${(install.durationMs / 1000).toFixed(0)}s` : tail(install, 10),
    });
    if (!install.ok) failures.push(describeFailure(install));

    // Without a successful install nothing downstream can run; report honestly rather than
    // producing misleading "tests failed" noise.
    const tests = install.ok
      ? await runCommand(options.meta.generation.testCommand, {
          cwd: workingCandidate,
          timeoutMs: options.testTimeoutMs ?? TEST_TIMEOUT_MS,
        })
      : skipped(options.meta.generation.testCommand, 'install failed');
    report({
      name: 'tests',
      ok: tests.ok,
      detail: tests.ok ? `${(tests.durationMs / 1000).toFixed(0)}s` : tail(tests, 10),
    });
    if (!tests.ok) failures.push(describeFailure(tests));

    const wantsBugDemo = options.requireBugDemonstration ?? options.meta.task === 'bug-hunt';
    const bugDemo =
      wantsBugDemo && install.ok
        ? await checkBugDemonstrable({
            packageDir,
            installedCandidateDir: workingCandidate,
            testCommand: options.meta.generation.testCommand,
            ...(options.testTimeoutMs === undefined ? {} : { timeoutMs: options.testTimeoutMs }),
          })
        : undefined;

    if (wantsBugDemo) {
      const ok = bugDemo?.ok ?? false;
      report({
        name: 'bug-demo',
        ok,
        detail: bugDemo?.detail ?? 'skipped: install failed',
      });
      if (!ok) failures.push(`Bug demonstrability: ${bugDemo?.detail ?? 'could not run'}`);
    }

    const secrets = await scanForSecrets(packageDir);
    report({ name: 'secrets', ok: secrets.ok, detail: secrets.detail });
    if (!secrets.ok) failures.push(`Secrets scan: ${secrets.detail}`);

    const overlap = await checkOverlap(candidateDir, options.run.repoDir);
    report({
      name: 'overlap',
      ok: overlap.ok,
      detail: overlap.ok
        ? `${overlap.filesChecked} files clean (${overlap.filesExempt} exempt)`
        : overlap.matches
            .map(
              (match) =>
                `${match.candidateFile}:${match.candidateLine} matches ` +
                `${match.sourceFile}:${match.sourceLine}`,
            )
            .join('\n'),
    });
    if (!overlap.ok) {
      failures.push(
        'Synthesis rule violated — these files reproduce source-repo code verbatim:\n' +
          overlap.matches
            .map(
              (match) =>
                `  ${match.candidateFile}:${match.candidateLine} <- ` +
                `${match.sourceFile}:${match.sourceLine}\n${indent(match.excerpt)}`,
            )
            .join('\n'),
      );
    }

    const logPath = await writeLog(options.run, {
      install,
      tests,
      bugDemo,
      secrets,
      overlap,
      failures,
    });

    const environmental = install.timedOut || !secrets.ran;

    return {
      ok: failures.length === 0,
      environmental,
      install,
      tests,
      bugDemo,
      secrets,
      overlap,
      failures,
      logPath,
    };
  } finally {
    await fs.rm(sandboxDir, { recursive: true, force: true });
  }
}

/**
 * Lead with what went wrong, then the raw tail. The generator reads this to repair a package,
 * and a wall of test-runner boilerplate buries the one line that would let it.
 */
function describeFailure(result: CommandResult): string {
  const errors = salientErrors(result);
  const headline = errors.length > 0 ? `\n  ${errors.join('\n  ')}` : '';

  return (
    `\`${result.command}\` failed${result.timedOut ? ' (timed out)' : ''}.` +
    (headline === '' ? '' : `\n\nThe errors that matter:${headline}`) +
    `\n\nFull output (last lines):\n${tail(result)}`
  );
}

function skipped(command: string, reason: string): CommandResult {
  return {
    command,
    exitCode: 1,
    ok: false,
    stdout: '',
    stderr: `skipped: ${reason}`,
    timedOut: false,
    durationMs: 0,
  };
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

async function writeLog(
  run: RunDir,
  report: Omit<VerifyReport, 'ok' | 'logPath' | 'environmental'>,
): Promise<string> {
  const logDir = path.join(run.dir, 'logs');
  await fs.mkdir(logDir, { recursive: true });
  const logPath = path.join(logDir, 'verify.log');

  const sections = [
    `# install: ${report.install.command}`,
    `exit ${report.install.exitCode} in ${report.install.durationMs}ms`,
    report.install.stdout,
    report.install.stderr,
    '',
    `# tests: ${report.tests.command}`,
    `exit ${report.tests.exitCode} in ${report.tests.durationMs}ms`,
    report.tests.stdout,
    report.tests.stderr,
    '',
    `# bug demonstrability: ${report.bugDemo?.detail ?? 'not applicable'}`,
    ...(report.bugDemo?.runs.map(
      (run_) => `$ ${run_.command}\nexit ${run_.exitCode}\n${run_.stdout}\n${run_.stderr}`,
    ) ?? []),
    '',
    `# secrets: ${report.secrets.detail}`,
    '',
    `# overlap: ${report.overlap.ok ? 'clean' : `${report.overlap.matches.length} match(es)`}`,
    ...report.overlap.matches.map(
      (match) =>
        `${match.candidateFile}:${match.candidateLine} <- ${match.sourceFile}:${match.sourceLine}`,
    ),
    '',
    `# failures: ${report.failures.length}`,
    ...report.failures,
  ];

  await fs.writeFile(logPath, `${sections.join('\n')}\n`, 'utf8');
  return logPath;
}
