import fs from 'node:fs/promises';
import path from 'node:path';

import { QuarryError } from './errors.js';
import { Components } from './schemas/components.js';
import { Ingest } from './schemas/ingest.js';
import { Roles } from './schemas/roles.js';
import { Surfaces } from './schemas/surfaces.js';
import type { RunDir } from './run.js';

/**
 * Reuse the artifacts an earlier run already produced.
 *
 * architecture-mvp.md: "stages are resumable (`--from s5`) … `runDir` is the only shared
 * state". This matters more than convenience — S5 alone is ~6 minutes and the bulk of the
 * token spend, so iterating on generation while re-paying for ingest, cartography and
 * surface selection every time is both slow and wasteful.
 *
 * Artifacts are re-parsed against their current schemas rather than trusted: a run directory
 * from before a schema change should fail loudly, not feed a stale shape into a later stage.
 */

export interface ResumedRun {
  run: RunDir;
  ingest?: Ingest;
  components?: Components;
  roles?: Roles;
  surfaces?: Surfaces;
}

export async function findRun(workRoot: string, runId: string): Promise<RunDir> {
  const dir = path.join(workRoot, runId);
  const stat = await fs.stat(dir).catch(() => undefined);

  if (!stat?.isDirectory()) {
    const available = await listRuns(workRoot);
    throw new QuarryError(
      `No run "${runId}" in ${workRoot}.` +
        (available.length > 0 ? ` Available: ${available.slice(0, 10).join(', ')}` : ''),
    );
  }

  return { runId, dir, repoDir: path.join(dir, 'repo') };
}

export async function listRuns(workRoot: string): Promise<string[]> {
  const entries = await fs.readdir(workRoot, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

/** The most recent run, which is almost always the one being iterated on. */
export async function latestRun(workRoot: string): Promise<string | undefined> {
  return (await listRuns(workRoot))[0];
}

export async function loadRun(workRoot: string, runId: string): Promise<ResumedRun> {
  const run = await findRun(workRoot, runId);

  const repoExists = (await fs.stat(run.repoDir).catch(() => undefined))?.isDirectory();
  if (repoExists !== true) {
    throw new QuarryError(
      `Run "${runId}" has no repo/ directory. Later stages read source files from the clone, ` +
        'so this run cannot be resumed.',
    );
  }

  return {
    run,
    ...(await read(run, 'ingest.json', Ingest, 'ingest')),
    ...(await read(run, 'components.json', Components, 'components')),
    ...(await read(run, 'roles.json', Roles, 'roles')),
    ...(await read(run, 'surfaces.json', Surfaces, 'surfaces')),
  };
}

async function read<T>(
  run: RunDir,
  fileName: string,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  key: string,
): Promise<Record<string, T>> {
  const file = path.join(run.dir, fileName);
  const raw = await fs.readFile(file, 'utf8').catch(() => undefined);
  if (raw === undefined) return {};

  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success || parsed.data === undefined) {
    throw new QuarryError(
      `${fileName} in run "${run.runId}" does not match the current schema. It was probably ` +
        'written by an older version of Quarry; start a fresh run rather than resuming.',
    );
  }

  return { [key]: parsed.data } as Record<string, T>;
}
