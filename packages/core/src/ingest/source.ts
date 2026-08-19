import fs from 'node:fs/promises';
import path from 'node:path';

import { simpleGit } from 'simple-git';

import { QuarryError } from '../errors.js';
import type { IngestSource } from '../schemas/ingest.js';

import { isSkippedDir } from './exclusions.js';

/** Anything that looks like a remote we can hand to `git clone`. */
export function looksLikeUrl(ref: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/.test(ref);
}

/**
 * Inject `GITHUB_TOKEN` into an HTTPS GitHub URL for private clones (mvp.md: env var only,
 * no OAuth). Returned separately from the display URL so the token never reaches a log line,
 * an error message, or `ingest.json`.
 */
function authenticatedUrl(url: string, token: string | undefined): string {
  if (!token) return url;
  if (!/^https:\/\/(www\.)?github\.com\//.test(url)) return url;
  return url.replace(/^https:\/\//, `https://x-access-token:${token}@`);
}

export interface PrepareOptions {
  /** Where the working copy should end up — `work/<run>/repo`. */
  repoDir: string;
  githubToken?: string | undefined;
}

/**
 * Get the repo onto local disk: shallow clone for a URL, recursive copy for a local path.
 *
 * A local directory is copied rather than read in place so that later stages cannot mutate
 * the user's actual working tree, and so a run directory stays a complete record of itself.
 */
export async function prepareSource(ref: string, options: PrepareOptions): Promise<IngestSource> {
  return looksLikeUrl(ref) ? cloneRemote(ref, options) : copyLocal(ref, options);
}

async function cloneRemote(url: string, options: PrepareOptions): Promise<IngestSource> {
  await fs.mkdir(path.dirname(options.repoDir), { recursive: true });

  try {
    await simpleGit().clone(authenticatedUrl(url, options.githubToken), options.repoDir, [
      '--depth',
      '1',
      '--single-branch',
    ]);
  } catch (error) {
    // simple-git puts the failing command in the message, which would echo the token back.
    throw new QuarryError(
      `Could not clone ${url}. Check the URL is reachable, and set GITHUB_TOKEN if the ` +
        'repository is private.',
      { stage: 's1', cause: error },
    );
  }

  const git = simpleGit(options.repoDir);
  const commit = (await git.revparse(['HEAD'])).trim();
  const branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();

  return {
    kind: 'url',
    ref: url,
    commit,
    ...(branch && branch !== 'HEAD' ? { branch } : {}),
  };
}

async function copyLocal(ref: string, options: PrepareOptions): Promise<IngestSource> {
  const resolved = path.resolve(ref);

  const stat = await fs.stat(resolved).catch(() => undefined);
  if (!stat?.isDirectory()) {
    throw new QuarryError(`${ref} is not a directory and does not look like a git URL.`, {
      stage: 's1',
    });
  }

  await fs.mkdir(options.repoDir, { recursive: true });
  await copyTree(resolved, options.repoDir);

  const source: IngestSource = { kind: 'local', ref: resolved };

  // A local path may or may not be a git checkout; a missing SHA is not an error.
  //
  // The toplevel check matters: `git rev-parse HEAD` inside a subdirectory happily reports
  // the *enclosing* repo's commit, so a plain directory that merely sits inside a checkout
  // would be labelled with a SHA that has nothing to do with it.
  try {
    const git = simpleGit(resolved);
    const toplevel = (await git.revparse(['--show-toplevel'])).trim();
    if (path.resolve(toplevel) !== resolved) return source;

    const commit = (await git.revparse(['HEAD'])).trim();
    return { ...source, commit };
  } catch {
    return source;
  }
}

/**
 * Recursive copy that skips the directories the walker would skip anyway. Copying a
 * `node_modules` only to ignore it can mean tens of thousands of pointless file operations.
 */
async function copyTree(from: string, to: string): Promise<void> {
  const dirents = await fs.readdir(from, { withFileTypes: true });

  for (const dirent of dirents) {
    if (dirent.isDirectory() && isSkippedDir(dirent.name)) continue;

    const src = path.join(from, dirent.name);
    const dest = path.join(to, dirent.name);

    if (dirent.isDirectory()) {
      await fs.mkdir(dest, { recursive: true });
      await copyTree(src, dest);
    } else if (dirent.isFile()) {
      await fs.copyFile(src, dest);
    }
    // Symlinks are skipped, matching the walker.
  }
}
