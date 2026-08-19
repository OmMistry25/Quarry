import fs from 'node:fs/promises';
import path from 'node:path';

import { isSkippedDir } from '../ingest/exclusions.js';

/**
 * The synthesis check (CLAUDE.md invariant 1, SPEC acceptance 4): no file in `candidate/`
 * may reproduce an 8-line block from the source repository.
 *
 * Comparison is over *normalised* lines — trailing whitespace stripped, blank lines dropped —
 * so reformatting cannot be used to slip a copy past it.
 */

export const SHINGLE_LINES = 8;

/**
 * Files exempt from the check.
 *
 * Dependency manifests only, and this is a deliberate, narrow decision rather than a
 * convenience. A generated repo is *supposed* to declare the same libraries at the same
 * versions as the source — that is the stub rule working, and it is what makes the starter
 * feel like the real codebase. Requiring divergence would mean deliberately pinning
 * different versions than the team actually uses, which makes the package worse for no gain
 * in IP protection: a dependency list is not code and leaks nothing S2 does not already
 * report openly.
 *
 * Everything that can carry logic — every source file, every script, every config file that
 * executes — stays byte-strict.
 */
const EXEMPT_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'npm-shrinkwrap.json',
  'requirements.txt',
  'requirements-dev.txt',
  'pyproject.toml',
  'poetry.lock',
  'Pipfile',
  'Pipfile.lock',
  'uv.lock',
]);

export function isExemptFromOverlap(relPath: string): boolean {
  return EXEMPT_BASENAMES.has(path.posix.basename(relPath));
}

export interface OverlapMatch {
  candidateFile: string;
  candidateLine: number;
  sourceFile: string;
  sourceLine: number;
  /** The offending block, for the failure report. */
  excerpt: string;
}

export interface OverlapResult {
  ok: boolean;
  matches: OverlapMatch[];
  filesChecked: number;
  filesExempt: number;
}

function normalise(contents: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];

  contents.split('\n').forEach((raw, index) => {
    const text = raw.replace(/\s+$/, '');
    if (text.trim() === '') return;
    out.push({ text, line: index + 1 });
  });

  return out;
}

function shingles(contents: string): Map<string, number> {
  const lines = normalise(contents);
  const found = new Map<string, number>();

  for (let index = 0; index + SHINGLE_LINES <= lines.length; index += 1) {
    const window = lines.slice(index, index + SHINGLE_LINES);
    const key = window.map((entry) => entry.text).join('\n');
    const startLine = window[0]?.line ?? index + 1;
    if (!found.has(key)) found.set(key, startLine);
  }

  return found;
}

async function* walk(root: string): AsyncGenerator<string> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (isSkippedDir(entry.name)) continue;
      yield* walk(path.join(root, entry.name));
    } else if (entry.isFile()) {
      yield path.join(root, entry.name);
    }
  }
}

/**
 * @param candidateDir the generated `candidate/` directory
 * @param sourceDir    the source repo clone
 */
export async function checkOverlap(
  candidateDir: string,
  sourceDir: string,
): Promise<OverlapResult> {
  const sourceIndex = new Map<string, { file: string; line: number }>();

  for await (const file of walk(sourceDir)) {
    const contents = await fs.readFile(file, 'utf8').catch(() => '');
    if (contents === '') continue;

    const relPath = path.relative(sourceDir, file);
    for (const [key, line] of shingles(contents)) {
      if (!sourceIndex.has(key)) sourceIndex.set(key, { file: relPath, line });
    }
  }

  const matches: OverlapMatch[] = [];
  let filesChecked = 0;
  let filesExempt = 0;

  for await (const file of walk(candidateDir)) {
    const relPath = path.relative(candidateDir, file).split(path.sep).join('/');

    if (isExemptFromOverlap(relPath)) {
      filesExempt += 1;
      continue;
    }

    const contents = await fs.readFile(file, 'utf8').catch(() => '');
    if (contents === '') continue;
    filesChecked += 1;

    for (const [key, line] of shingles(contents)) {
      const source = sourceIndex.get(key);
      if (source === undefined) continue;

      matches.push({
        candidateFile: relPath,
        candidateLine: line,
        sourceFile: source.file,
        sourceLine: source.line,
        excerpt: key.split('\n').slice(0, 3).join('\n'),
      });
      // One match per file is enough to fail it and to explain why.
      break;
    }
  }

  return { ok: matches.length === 0, matches, filesChecked, filesExempt };
}
