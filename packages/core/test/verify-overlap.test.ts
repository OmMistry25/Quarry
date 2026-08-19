import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkOverlap, isExemptFromOverlap, SHINGLE_LINES } from '../src/verify/overlap.js';

let root: string;
let candidateDir: string;
let sourceDir: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-overlap-'));
  candidateDir = path.join(root, 'candidate');
  sourceDir = path.join(root, 'source');
  await fs.mkdir(candidateDir, { recursive: true });
  await fs.mkdir(sourceDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function write(dir: string, relPath: string, contents: string): Promise<void> {
  const target = path.join(dir, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, 'utf8');
}

const TEN_LINES = Array.from({ length: 10 }, (_, index) => `const value${index} = ${index};`).join(
  '\n',
);

describe('checkOverlap', () => {
  it('passes when nothing is shared', async () => {
    await write(sourceDir, 'src/a.ts', TEN_LINES);
    await write(candidateDir, 'src/b.ts', 'const different = 1;\nconst other = 2;\n');

    const result = await checkOverlap(candidateDir, sourceDir);
    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it('fails on an 8-line copied block', async () => {
    await write(sourceDir, 'src/a.ts', TEN_LINES);
    await write(candidateDir, 'src/b.ts', TEN_LINES);

    const result = await checkOverlap(candidateDir, sourceDir);
    expect(result.ok).toBe(false);
    expect(result.matches[0]?.candidateFile).toBe('src/b.ts');
    expect(result.matches[0]?.sourceFile).toBe('src/a.ts');
  });

  it('allows a 7-line block, so the window boundary is exact', async () => {
    const seven = TEN_LINES.split('\n')
      .slice(0, SHINGLE_LINES - 1)
      .join('\n');
    await write(sourceDir, 'src/a.ts', TEN_LINES);
    await write(candidateDir, 'src/b.ts', seven);

    expect((await checkOverlap(candidateDir, sourceDir)).ok).toBe(true);
  });

  it('is not fooled by reformatting: blank lines and trailing whitespace do not hide a copy', async () => {
    const padded = TEN_LINES.split('\n')
      .map((line) => `${line}   `)
      .join('\n\n');

    await write(sourceDir, 'src/a.ts', TEN_LINES);
    await write(candidateDir, 'src/b.ts', padded);

    expect((await checkOverlap(candidateDir, sourceDir)).ok).toBe(false);
  });

  it('reports where the match is, so a failure is actionable', async () => {
    await write(sourceDir, 'src/a.ts', `// header\n${TEN_LINES}`);
    await write(candidateDir, 'src/b.ts', TEN_LINES);

    const match = (await checkOverlap(candidateDir, sourceDir)).matches[0];
    expect(match?.candidateLine).toBe(1);
    expect(match?.sourceLine).toBe(2);
    expect(match?.excerpt).toContain('const value0');
  });

  it('exempts dependency manifests, per the Phase 4 decision', async () => {
    // A generated repo is supposed to declare the same libraries at the same versions.
    const manifest = [
      '{',
      '  "dependencies": {',
      '    "better-sqlite3": "^11.0.0",',
      '    "express": "^4.19.2",',
      '    "zod": "^3.23.8"',
      '  },',
      '  "devDependencies": {',
      '    "vitest": "^2.0.0"',
      '  }',
      '}',
    ].join('\n');

    await write(sourceDir, 'package.json', manifest);
    await write(candidateDir, 'package.json', manifest);

    const result = await checkOverlap(candidateDir, sourceDir);
    expect(result.ok).toBe(true);
    expect(result.filesExempt).toBe(1);
  });

  it('still fails a copied source file in a repo that also has an exempt manifest', async () => {
    await write(sourceDir, 'package.json', TEN_LINES);
    await write(candidateDir, 'package.json', TEN_LINES);
    await write(sourceDir, 'src/a.ts', TEN_LINES);
    await write(candidateDir, 'src/a.ts', TEN_LINES);

    const result = await checkOverlap(candidateDir, sourceDir);
    expect(result.ok).toBe(false);
    expect(result.matches.map((match) => match.candidateFile)).toEqual(['src/a.ts']);
  });

  it('ignores node_modules on both sides', async () => {
    await write(sourceDir, 'node_modules/dep/index.js', TEN_LINES);
    await write(candidateDir, 'node_modules/dep/index.js', TEN_LINES);

    expect((await checkOverlap(candidateDir, sourceDir)).ok).toBe(true);
  });

  it('reports one match per file rather than hundreds', async () => {
    const long = Array.from({ length: 60 }, (_, index) => `const v${index} = ${index};`).join('\n');
    await write(sourceDir, 'src/a.ts', long);
    await write(candidateDir, 'src/a.ts', long);

    expect((await checkOverlap(candidateDir, sourceDir)).matches).toHaveLength(1);
  });
});

describe('isExemptFromOverlap', () => {
  it.each([
    'package.json',
    'candidate/package.json',
    'pnpm-lock.yaml',
    'requirements.txt',
    'pyproject.toml',
  ])('exempts %s', (candidate) => {
    expect(isExemptFromOverlap(candidate)).toBe(true);
  });

  it.each(['src/index.ts', 'tsconfig.json', 'vitest.config.ts', 'README.md', 'scripts/build.sh'])(
    'does not exempt %s, which can carry logic',
    (candidate) => {
      expect(isExemptFromOverlap(candidate)).toBe(false);
    },
  );
});
