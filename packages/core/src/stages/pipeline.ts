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
import { repairPackage } from './s5-repair.js';
import { packageRun, type PackageResult } from './s7-package.js';
import { verify, type VerifyReport, type VerifyStep } from './s6-verify.js';

/**
 * Generate → verify → (repair once) → package.
 *
 * SPEC S6: "On failure: one automatic repair loop (feed errors back to the generator), then
 * fail loudly with logs."
 *
 * That loop is a *targeted* repair: the agent is handed the package it already wrote and asked
 * to edit the parts that failed. Regenerating from scratch also works and was tried first, but
 * it costs a second full generation — ~870 s on a real repo, turning a 15-minute run into a
 * 31-minute one, on precisely the runs that were already going badly. It is also more than the
 * job needs, since the dominant failure is a handful of wrong lines in a package that is
 * otherwise sound.
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
  onSubstitution?: (reason: string) => void;
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
    ...(options.onSubstitution === undefined ? {} : { onSubstitution: options.onSubstitution }),
  });

  const packageDir = generated.packageDir;
  let meta = generated.meta;

  let attempt = 0;
  let lastReport: VerifyReport | undefined;

  while (attempt <= maxRepairs) {
    attempt += 1;

    if (attempt > 1) {
      options.onRepair?.(lastReport?.failures ?? []);

      const repaired = await repairPackage({
        run: options.run,
        meta,
        seniority: options.seniority,
        failures: lastReport?.failures ?? [],
        packageDir,
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(options.transport === undefined ? {} : { transport: options.transport }),
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.onAttempt === undefined ? {} : { onAttempt: options.onAttempt }),
      });

      // A repair may correct the documented commands, and verification has to use the
      // corrected ones — a wrong test command was one of the failures it exists to fix.
      meta = {
        ...meta,
        generation: {
          ...meta.generation,
          setupCommand: repaired.setupCommand,
          testCommand: repaired.testCommand,
        },
      };
    }

    const report = await verify({
      run: options.run,
      meta,
      packageDir,
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
        meta,
        verification,
        packageDir,
        ...(options.now === undefined ? {} : { now: options.now }),
      });

      return {
        meta: packaged.meta,
        packageDir,
        report,
        verification,
        package: packaged,
        generations: attempt,
      };
    }

    if (attempt > maxRepairs) break;

    // Repairing cannot fix a machine problem. Failing now costs one wasted verification;
    // carrying on would spend an agent call to reach the same wall — which is exactly what
    // happened the first time this ran behind a proxy.
    if (report.environmental) break;
  }

  throw new QuarryError(
    (lastReport?.environmental === true
      ? 'Verification failed for a reason repairing cannot fix — this looks like the ' +
        'machine, not the package. Check network access to the package registry (including ' +
        'any proxy configuration) and that gitleaks is installed.\n\n'
      : '') +
      `Verification failed after ${attempt} attempt(s). Nothing was packaged.\n\n` +
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
