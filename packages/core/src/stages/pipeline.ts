import type { RoleId } from '../archetypes/roles.js';
import type { SeniorityId } from '../archetypes/tasks.js';
import type { AgentTransport } from '../agent/claude.js';
import type { AgentAttempt } from '../agent/runAgent.js';
import { QuarryError } from '../errors.js';
import type { Components } from '../schemas/components.js';
import type { Ingest } from '../schemas/ingest.js';
import type { Meta, VerificationResult } from '../schemas/meta.js';
import type { Surface } from '../schemas/surfaces.js';
import type { RunDir } from '../run.js';

import { generate } from './s5-generate.js';
import { packageRun, type PackageResult } from './s7-package.js';
import { verify, type VerifyReport, type VerifyStep } from './s6-verify.js';

/**
 * Generate → verify → (repair once) → package.
 *
 * SPEC S6: "On failure: one automatic repair loop (feed errors back to the generator), then
 * fail loudly with logs." The repair is a *fresh* generation given the failures, not a patch
 * attempt — the generator has no memory of the previous run, and asking it to fix code it
 * cannot see produces worse results than asking it to write the thing again knowing what
 * went wrong.
 */

export interface GenerateVerifiedOptions {
  run: RunDir;
  ingest: Ingest;
  components: Components;
  surface: Surface;
  role: RoleId;
  seniority: SeniorityId;
  model?: string | undefined;
  transport?: AgentTransport;
  now?: Date;
  /** Set to 0 to fail on the first bad package. SPEC allows exactly one. */
  repairAttempts?: number;
  onAttempt?: (attempt: AgentAttempt) => void;
  onStep?: (step: VerifyStep) => void;
  onRepair?: (failures: string[]) => void;
  installTimeoutMs?: number;
  testTimeoutMs?: number;
}

export interface GenerateVerifiedResult {
  meta: Meta;
  packageDir: string;
  report: VerifyReport;
  verification: VerificationResult;
  package: PackageResult;
  /** 1 when the first generation verified, 2 when the repair loop was needed. */
  generations: number;
}

export async function generateVerifiedPackage(
  options: GenerateVerifiedOptions,
): Promise<GenerateVerifiedResult> {
  const maxRepairs = options.repairAttempts ?? 1;

  let attempt = 0;
  let lastReport: VerifyReport | undefined;
  let packageDir = '';

  while (attempt <= maxRepairs) {
    attempt += 1;

    const generated = await generate({
      run: options.run,
      ingest: options.ingest,
      components: options.components,
      surface: options.surface,
      role: options.role,
      seniority: options.seniority,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.transport === undefined ? {} : { transport: options.transport }),
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.onAttempt === undefined ? {} : { onAttempt: options.onAttempt }),
      ...(lastReport === undefined ? {} : { priorFailures: lastReport.failures }),
    });

    packageDir = generated.packageDir;

    const report = await verify({
      run: options.run,
      meta: generated.meta,
      packageDir: generated.packageDir,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.onStep === undefined ? {} : { onStep: options.onStep }),
      ...(options.installTimeoutMs === undefined
        ? {}
        : { installTimeoutMs: options.installTimeoutMs }),
      ...(options.testTimeoutMs === undefined ? {} : { testTimeoutMs: options.testTimeoutMs }),
    });

    lastReport = report;

    if (report.ok) {
      const verification = toVerification(report, options.now ?? new Date());
      const packaged = await packageRun({
        run: options.run,
        meta: generated.meta,
        verification,
        packageDir: generated.packageDir,
        ...(options.now === undefined ? {} : { now: options.now }),
      });

      return {
        meta: packaged.meta,
        packageDir: generated.packageDir,
        report,
        verification,
        package: packaged,
        generations: attempt,
      };
    }

    if (attempt > maxRepairs) break;

    // Regenerating cannot fix a machine problem. Failing now costs the user one wasted
    // verification; carrying on would cost them a full generation pass to reach the same
    // wall — which is exactly what happened the first time this ran behind a proxy.
    if (report.environmental) break;

    options.onRepair?.(report.failures);
  }

  throw new QuarryError(
    (lastReport?.environmental === true
      ? 'Verification failed for a reason regenerating cannot fix — this looks like the ' +
        'machine, not the package. Check network access to the package registry (including ' +
        'any proxy configuration) and that gitleaks is installed.\n\n'
      : '') +
      `Verification failed after ${attempt} generation attempt(s). Nothing was packaged.\n\n` +
      `${(lastReport?.failures ?? []).join('\n\n')}\n\n` +
      `Full logs: ${lastReport?.logPath ?? `${options.run.dir}/logs`}\n` +
      `Package left in place for inspection: ${packageDir}`,
    { stage: 's6' },
  );
}

function toVerification(report: VerifyReport, now: Date): VerificationResult {
  return {
    passed: report.ok,
    installOk: report.install.ok,
    testsOk: report.tests.ok,
    ...(report.bugDemo === undefined ? {} : { bugDemonstrated: report.bugDemo.ok }),
    secretsScanOk: report.secrets.ok,
    overlapOk: report.overlap.ok,
    ranAt: now.toISOString(),
    notes: [
      `install: ${report.install.command} (${report.install.durationMs}ms)`,
      `tests: ${report.tests.command} (${report.tests.durationMs}ms)`,
      `overlap: ${report.overlap.filesChecked} files checked, ${report.overlap.filesExempt} exempt`,
      `secrets: ${report.secrets.detail}`,
    ],
  };
}
