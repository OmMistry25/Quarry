import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * A run directory is the only shared state between stages (docs/architecture-mvp.md):
 *
 *   work/<runId>/repo/          the clone
 *   work/<runId>/ingest.json    S1
 *   work/<runId>/…              later stages
 *
 * Everything under `work/` is gitignored scratch.
 */
export interface RunDir {
  runId: string;
  dir: string;
  repoDir: string;
}

/** `my-repo` from `https://github.com/acme/my-repo.git` or `/src/my-repo`. */
export function slugFromRef(ref: string): string {
  const withoutQuery = ref.split(/[?#]/)[0] ?? ref;
  const trimmed = withoutQuery.replace(/\.git$/, '').replace(/\/+$/, '');
  const last = trimmed.split(/[/\\]/).filter(Boolean).pop() ?? 'repo';

  const slug = last
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug === '' ? 'repo' : slug;
}

/** `20260819-075431` — sorts chronologically as a directory name. */
export function timestampSlug(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  );
}

export interface CreateRunDirOptions {
  workRoot: string;
  ref: string;
  /** Injectable so tests get deterministic run ids. */
  now?: Date;
  /** Overrides the generated id entirely. */
  runId?: string;
}

export async function createRunDir(options: CreateRunDirOptions): Promise<RunDir> {
  const runId =
    options.runId ?? `${timestampSlug(options.now ?? new Date())}-${slugFromRef(options.ref)}`;

  const dir = path.join(options.workRoot, runId);
  const repoDir = path.join(dir, 'repo');

  await fs.mkdir(dir, { recursive: true });

  return { runId, dir, repoDir };
}

export async function writeArtifact(run: RunDir, name: string, value: unknown): Promise<string> {
  const target = path.join(run.dir, name);
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return target;
}
