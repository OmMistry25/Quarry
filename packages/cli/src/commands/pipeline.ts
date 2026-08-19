import path from 'node:path';

import { InvalidArgumentError } from 'commander';
import {
  cartography,
  ingest,
  latestRun,
  loadRun,
  roleMenu,
  type Components,
  type Ingest,
  type RunDir,
  type Roles,
  type Surfaces,
} from 'core';

/** Options shared by every command that has to get a repo mapped before it can do its job. */
export interface SharedOptions {
  workDir: string;
  maxSizeMb: number;
  model?: string;
  json: boolean;
  /** Run id to reuse, or "latest". Stages whose artifacts already exist are skipped. */
  resume?: string;
}

export function parsePositiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('must be a positive number');
  }
  return parsed;
}

/**
 * Surfaces belong to the role they were selected for.
 *
 * S4 is an agent call, so reusing its artifact is the whole point of `--resume` — but only
 * when the resumed run picked surfaces for the role being asked for now. Resuming a frontend
 * run as `--role backend` has to re-run S4, and saying otherwise made the banner claim a
 * reuse that never happened.
 */
export function reusableSurfaces(
  surfaces: Surfaces | undefined,
  role: string,
): Surfaces | undefined {
  return surfaces !== undefined && surfaces.role === role ? surfaces : undefined;
}

export interface MappedRepo {
  run: RunDir;
  ingest: Ingest;
  components: Components;
  roles: Roles;
  /** Present only when resuming a run that already selected surfaces. */
  surfaces?: Surfaces;
}

/**
 * S1 → S2 → S3. Every command below `ingest` needs all three, and S3 is free, so the role
 * menu is always computed rather than being its own opt-in step.
 */
export async function mapRepo(repo: string, options: SharedOptions): Promise<MappedRepo> {
  const log = (message: string): void => {
    if (!options.json) console.error(message);
  };

  const workRoot = path.resolve(options.workDir);

  if (options.resume !== undefined) {
    const runId =
      options.resume === 'latest' ? ((await latestRun(workRoot)) ?? 'latest') : options.resume;
    const resumed = await loadRun(workRoot, runId);

    if (resumed.ingest === undefined) {
      throw new Error(`Run "${runId}" has no ingest.json; it cannot be resumed.`);
    }

    log(`--  resuming ${runId}`);
    log(`S1  reused (${resumed.ingest.repo.fileCount} files)`);

    const components =
      resumed.components ??
      (log('S2  mapping components…'),
      (
        await cartography({
          run: resumed.run,
          ingest: resumed.ingest,
          ...(options.model === undefined ? {} : { model: options.model }),
        })
      ).components);
    if (resumed.components !== undefined) {
      log(`S2  reused (${components.components.length} components)`);
    }

    const roles =
      resumed.roles ??
      (await roleMenu({ run: resumed.run, ingest: resumed.ingest, components })).roles;
    if (resumed.roles !== undefined) log('S3  reused');

    // S4 is deliberately not reported here. Surfaces are role-specific, and only the caller
    // knows which role it is about to ask for, so a banner printed at this point announced
    // "S4  reused" for frontend surfaces and then re-ran S4 for backend on the next line.

    return {
      run: resumed.run,
      ingest: resumed.ingest,
      components,
      roles,
      ...(resumed.surfaces === undefined ? {} : { surfaces: resumed.surfaces }),
    };
  }

  const ingested = await ingest({
    ref: repo,
    workRoot,
    maxTotalBytes: options.maxSizeMb * 1_000_000,
    githubToken: process.env.GITHUB_TOKEN,
  });

  log(
    `S1  ${ingested.ingest.repo.fileCount} files, ` +
      `${ingested.ingest.manifests.length} manifests, ${ingested.ingest.docs.length} docs`,
  );
  log('S2  mapping components…');

  const mapped = await cartography({
    run: ingested.run,
    ingest: ingested.ingest,
    ...(options.model === undefined ? {} : { model: options.model }),
    onAttempt: (attempt) => {
      if (attempt.outcome === 'ok') return;
      log(
        `    attempt ${attempt.attempt} rejected (${attempt.outcome})` +
          (attempt.detail === undefined ? '' : `\n${indentDetail(attempt.detail)}`),
      );
    },
  });

  log(`S3  scoring roles over ${mapped.components.components.length} component(s)…`);

  const scored = await roleMenu({
    run: ingested.run,
    ingest: ingested.ingest,
    components: mapped.components,
  });

  return {
    run: ingested.run,
    ingest: ingested.ingest,
    components: mapped.components,
    roles: scored.roles,
  };
}

/** Keep a rejection reason readable in a terminal without drowning the progress output. */
export function indentDetail(detail: string, maxLines = 6): string {
  const lines = detail.split('\n');
  const shown = lines.slice(0, maxLines).map((line) => `      ${line}`);
  if (lines.length > maxLines) shown.push(`      … ${lines.length - maxLines} more`);
  return shown.join('\n');
}

export function formatRoles(artifact: Roles): string {
  const badge: Record<string, string> = {
    strong: 'STRONG',
    good: 'GOOD  ',
    weak: 'WEAK  ',
    none: 'NONE  ',
  };

  const rows = artifact.roles.map((card) => {
    const evidence =
      card.rating === 'none'
        ? ''
        : `  [${card.evidence.assessableLoc.toLocaleString('en-US')} loc, ` +
          `${card.evidence.componentIds.length} component(s)]`;

    return `${card.label.padEnd(11)} ${badge[card.rating] ?? card.rating}  ${card.reason}${evidence}`;
  });

  return rows.join('\n');
}
