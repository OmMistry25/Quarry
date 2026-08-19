import fs from 'node:fs/promises';
import path from 'node:path';

import { ExclusionReason, type TreeEntry } from '../schemas/ingest.js';
import { QuarryError } from '../errors.js';

import { classify, isLockfile, isSkippedDir } from './exclusions.js';
import { countLoc, detectLanguage } from './languages.js';

export interface WalkOptions {
  /** Abort once included bytes exceed this. SPEC S1: "abort with a clear error". */
  maxTotalBytes: number;
  /** Files above this are listed as `too-large` rather than read. */
  maxFileBytes: number;
}

export interface WalkResult {
  entries: TreeEntry[];
  totalBytes: number;
  /**
   * Every reason is always present, zero included: "secret: 0" records that the check ran
   * and found nothing, which is a different claim from the key being absent.
   */
  excluded: Record<ExclusionReason, number>;
}

function zeroedCounts(): Record<ExclusionReason, number> {
  return Object.fromEntries(ExclusionReason.options.map((reason) => [reason, 0])) as Record<
    ExclusionReason,
    number
  >;
}

/**
 * Walk the clone, producing the tree that becomes agent context.
 *
 * The size cap is checked *during* the walk rather than after, so pointing Quarry at
 * something enormous fails in seconds instead of after reading gigabytes.
 */
export async function walkRepo(repoDir: string, options: WalkOptions): Promise<WalkResult> {
  const entries: TreeEntry[] = [];
  const excluded = zeroedCounts();
  let totalBytes = 0;

  const note = (reason: ExclusionReason): void => {
    excluded[reason] += 1;
  };

  const walkDir = async (absDir: string, relDir: string): Promise<void> => {
    const dirents = await fs.readdir(absDir, { withFileTypes: true });

    for (const dirent of dirents) {
      const relPath = relDir === '' ? dirent.name : `${relDir}/${dirent.name}`;
      const absPath = path.join(absDir, dirent.name);

      if (dirent.isDirectory()) {
        if (isSkippedDir(dirent.name)) {
          note(dirent.name === '.git' ? 'git-internal' : 'vendored');
          continue;
        }
        await walkDir(absPath, relPath);
        continue;
      }

      // Symlinks are not followed: a link out of the repo could pull in anything, and a
      // link inside it would double-count.
      if (!dirent.isFile()) continue;

      const stat = await fs.stat(absPath);
      const verdict = classify(relPath, stat.size, options.maxFileBytes);

      if (verdict.excluded) {
        note(verdict.reason ?? 'binary');
        continue;
      }

      totalBytes += stat.size;
      if (totalBytes > options.maxTotalBytes) {
        throw new QuarryError(
          `Repository exceeds the ${formatMb(options.maxTotalBytes)} size cap ` +
            `(hit at ${formatMb(totalBytes)}). Raise it with --max-size-mb if this repo is ` +
            'genuinely that large.',
          { stage: 's1' },
        );
      }

      const lang = detectLanguage(relPath);

      // Lockfiles are listed but never read — SPEC S1 excludes lockfile *contents*.
      if (isLockfile(dirent.name)) {
        entries.push({ path: relPath, sizeBytes: stat.size, ...(lang ? { lang } : {}) });
        continue;
      }

      const loc = countLoc(await fs.readFile(absPath, 'utf8'));
      entries.push({
        path: relPath,
        sizeBytes: stat.size,
        ...(lang ? { lang } : {}),
        loc,
      });
    }
  };

  await walkDir(repoDir, '');
  entries.sort((a, b) => a.path.localeCompare(b.path));

  return { entries, totalBytes, excluded };
}

function formatMb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
