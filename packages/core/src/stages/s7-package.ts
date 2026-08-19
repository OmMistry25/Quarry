import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

// archiver 8 exports named classes; the callable `archiver('zip')` form is v5-era.
import { ZipArchive } from 'archiver';

import { QuarryError } from '../errors.js';
import { Meta, type VerificationResult } from '../schemas/meta.js';
import { slugFromRef, type RunDir } from '../run.js';

/**
 * S7 — Packaging (docs/SPEC.md).
 *
 * Zips `package/` to `quarry-<repo>-<role>-<seniority>-<date>.zip`. The only interesting
 * thing here is the refusal: CLAUDE.md invariant 3 says an unverified run never gets
 * packaged, so this stage checks the verification block rather than trusting its caller.
 */

export interface PackageOptions {
  run: RunDir;
  meta: Meta;
  verification: VerificationResult;
  packageDir?: string;
  /** Where the zip goes. Defaults to the run directory. */
  outputDir?: string;
  now?: Date;
}

export interface PackageResult {
  zipPath: string;
  bytes: number;
  meta: Meta;
}

export async function packageRun(options: PackageOptions): Promise<PackageResult> {
  if (!options.verification.passed) {
    throw new QuarryError(
      'Refusing to package an unverified run. Verification did not pass, and a package that ' +
        'has not been installed, tested and scanned is exactly the demo toy this tool exists ' +
        'to avoid shipping.',
      { stage: 's7' },
    );
  }

  const packageDir = options.packageDir ?? path.join(options.run.dir, 'package');
  if (!(await fs.stat(packageDir).catch(() => undefined))?.isDirectory()) {
    throw new QuarryError(`No package directory at ${packageDir}.`, { stage: 's7' });
  }

  // meta.json is rewritten with the verification block, so the shipped package carries proof
  // of what was checked rather than only a claim that it was.
  const meta = Meta.parse({ ...options.meta, verification: options.verification });
  await fs.writeFile(
    path.join(packageDir, 'meta.json'),
    `${JSON.stringify(meta, null, 2)}\n`,
    'utf8',
  );

  const outputDir = options.outputDir ?? options.run.dir;
  await fs.mkdir(outputDir, { recursive: true });
  const zipPath = path.join(outputDir, zipName(meta, options.now ?? new Date()));

  await writeZip(packageDir, zipPath);
  const { size } = await fs.stat(zipPath);

  return { zipPath, bytes: size, meta };
}

export function zipName(meta: Meta, now: Date): string {
  const repo = slugFromRef(meta.source.ref);
  const date = now.toISOString().slice(0, 10);
  return `quarry-${repo}-${meta.role}-${meta.seniority}-${date}.zip`;
}

function writeZip(sourceDir: string, zipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    // A warning here (a vanished file, a symlink) means the zip is not what we think it is.
    archive.on('warning', reject);

    archive.pipe(output);
    archive.directory(sourceDir, false);
    void archive.finalize();
  });
}
