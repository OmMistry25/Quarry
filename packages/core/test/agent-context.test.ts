import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildRepoContext,
  summariseDirectories,
  DEFAULT_CONTEXT_BUDGET,
} from '../src/agent/context.js';
import type { TreeEntry } from '../src/schemas/ingest.js';
import { ingest } from '../src/stages/s1-ingest.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/mini-ts-api', import.meta.url));

describe('summariseDirectories', () => {
  const tree: TreeEntry[] = [
    { path: 'README.md', sizeBytes: 10, lang: 'Markdown', loc: 5 },
    { path: 'src/index.ts', sizeBytes: 10, lang: 'TypeScript', loc: 20 },
    { path: 'src/routes/items.ts', sizeBytes: 10, lang: 'TypeScript', loc: 40 },
    { path: 'src/routes/deep/nested/thing.ts', sizeBytes: 10, lang: 'TypeScript', loc: 7 },
  ];

  it('buckets root files under "."', () => {
    const summary = summariseDirectories(tree, 3);
    const root = summary.find((entry) => entry.path === '.');

    expect(root?.fileCount).toBe(1);
    expect(root?.languages).toEqual(['Markdown']);
  });

  it('aggregates file counts and loc per directory', () => {
    const summary = summariseDirectories(tree, 3);

    // At depth 3, `src/routes/deep` survives in its own right, so the file nested below it
    // folds into that rather than into `src/routes`.
    expect(summary.find((entry) => entry.path === 'src/routes')?.fileCount).toBe(1);
    expect(summary.find((entry) => entry.path === 'src/routes')?.loc).toBe(40);
    expect(summary.find((entry) => entry.path === 'src/routes/deep')?.fileCount).toBe(1);
  });

  it('counts files deeper than maxDepth against their nearest ancestor, keeping totals honest', () => {
    const shallow = summariseDirectories(tree, 1);
    const src = shallow.find((entry) => entry.path === 'src');

    expect(src?.fileCount).toBe(3);
    expect(src?.loc).toBe(67);

    const totalFiles = shallow.reduce((sum, entry) => sum + entry.fileCount, 0);
    expect(totalFiles).toBe(tree.length);
  });

  it('ranks languages within a directory by loc', () => {
    const summary = summariseDirectories(
      [
        { path: 'a/one.ts', sizeBytes: 1, lang: 'TypeScript', loc: 5 },
        { path: 'a/two.py', sizeBytes: 1, lang: 'Python', loc: 90 },
      ],
      2,
    );

    expect(summary[0]?.languages).toEqual(['Python', 'TypeScript']);
  });
});

describe('buildRepoContext', () => {
  let workRoot: string;

  beforeEach(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-ctx-'));
  });

  afterEach(async () => {
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  async function contextForFixture(budget = DEFAULT_CONTEXT_BUDGET) {
    const result = await ingest({ ref: FIXTURE, workRoot, runId: 'ctx-run' });
    return buildRepoContext(result.ingest, result.run.repoDir, budget);
  }

  it('includes the overview, directory map, manifests and docs', async () => {
    const context = await contextForFixture();

    expect(context.text).toContain('## Repository');
    expect(context.text).toContain('## Directory map');
    expect(context.text).toContain('## Manifests');
    expect(context.text).toContain('## Documentation');
  });

  it('includes manifest *contents*, which is what actually identifies a stack', async () => {
    const context = await contextForFixture();

    expect(context.included.manifests).toContain('package.json');
    expect(context.text).toContain('better-sqlite3');
    expect(context.text).toContain('express');
  });

  it('includes README and architecture prose', async () => {
    const context = await contextForFixture();

    expect(context.included.docs).toContain('README.md');
    expect(context.text).toContain('inventory API');
  });

  it('never includes stripped secrets — they are not in ingest.json to begin with', async () => {
    const context = await contextForFixture();

    expect(context.text).not.toContain('placeholder-not-a-real-secret');
    expect(context.text).not.toContain('WAREHOUSE_API_TOKEN');
  });

  it('summarises the tree rather than listing every file', async () => {
    const context = await contextForFixture();

    // Directories appear; individual source files do not get their own line in the map.
    expect(context.text).toContain('src/routes');
    expect(context.text).not.toContain('src/routes/items.ts   ');
  });

  it('respects the total byte budget', async () => {
    const context = await contextForFixture({ ...DEFAULT_CONTEXT_BUDGET, totalBytes: 2_000 });

    expect(context.bytes).toBeLessThanOrEqual(4_000);
    expect(context.included.docs.length).toBeLessThan(2);
  });

  it('truncates an individual file rather than dropping it', async () => {
    const context = await contextForFixture({ ...DEFAULT_CONTEXT_BUDGET, fileBytes: 120 });

    expect(context.text).toContain('… (truncated)');
    expect(context.included.manifests).toContain('package.json');
  });

  it('never lets manifests starve docs entirely, however manifest-heavy the repo', async () => {
    // Regression, reproducing the shape of pnpm/pnpm: 1,458 manifests. Under a single
    // shared budget they consumed all of it and the agent got zero prose on the repo that
    // most needed it.
    const repo = path.join(workRoot, 'manifest-heavy');
    await fs.mkdir(repo, { recursive: true });
    await fs.writeFile(
      path.join(repo, 'README.md'),
      '# Monorepo\n\nThe prose that must survive a crowd of manifests.\n',
    );
    for (let index = 0; index < 60; index += 1) {
      const pkg = path.join(repo, 'packages', `pkg-${index}`);
      await fs.mkdir(pkg, { recursive: true });
      await fs.writeFile(
        path.join(pkg, 'package.json'),
        JSON.stringify(
          { name: `pkg-${index}`, dependencies: { express: '^4', zod: '^3' } },
          null,
          2,
        ),
      );
      await fs.writeFile(path.join(pkg, 'index.ts'), 'export const x = 1;\n');
    }

    const heavy = await ingest({ ref: repo, workRoot, runId: 'starve-run' });
    expect(heavy.ingest.manifests.length).toBeGreaterThan(50);

    const context = await buildRepoContext(heavy.ingest, heavy.run.repoDir, {
      ...DEFAULT_CONTEXT_BUDGET,
      totalBytes: 6_000,
    });

    expect(context.included.manifests.length).toBeGreaterThan(0);
    expect(context.included.docs).toContain('README.md');
    expect(context.text).toContain('prose that must survive');
  });

  it('gives docs whatever manifests leave unspent', async () => {
    const result = await ingest({ ref: FIXTURE, workRoot, runId: 'spill-run' });

    // The fixture's manifests are tiny, so docs should get far more than the 45% floor.
    const context = await buildRepoContext(result.ingest, result.run.repoDir, {
      ...DEFAULT_CONTEXT_BUDGET,
      manifestShare: 0.55,
    });

    expect(context.included.docs).toContain('README.md');
    expect(context.included.docs).toContain('docs/architecture.md');
  });

  it('prefers shallow manifests, since a root manifest says the most', async () => {
    const context = await contextForFixture({ ...DEFAULT_CONTEXT_BUDGET, maxManifests: 1 });

    expect(context.included.manifests).toEqual(['package.json']);
  });
});

describe('directory map budget', () => {
  let workRoot: string;

  beforeEach(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-dirmap-'));
  });

  afterEach(async () => {
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  it('keeps the largest directories and says how many it dropped', async () => {
    const repo = path.join(workRoot, 'wide');
    await fs.mkdir(repo, { recursive: true });
    await fs.writeFile(path.join(repo, 'README.md'), '# Wide\n');

    // One large directory among many tiny ones.
    await fs.mkdir(path.join(repo, 'big'), { recursive: true });
    await fs.writeFile(path.join(repo, 'big', 'main.ts'), 'const x = 1;\n'.repeat(400));
    for (let index = 0; index < 80; index += 1) {
      const dir = path.join(repo, `tiny-${index}`);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'index.ts'), 'export const a = 1;\n');
    }

    const result = await ingest({ ref: repo, workRoot, runId: 'wide-run' });
    const context = await buildRepoContext(result.ingest, result.run.repoDir, {
      ...DEFAULT_CONTEXT_BUDGET,
      totalBytes: 8_000,
    });

    expect(context.text).toContain('big');
    expect(context.text).toMatch(/smaller directories omitted/);
    // The map must not crowd out the sections it exists to introduce.
    expect(context.included.manifests.length + context.included.docs.length).toBeGreaterThan(0);
  });

  it('omits nothing when the map fits', async () => {
    const result = await ingest({ ref: FIXTURE, workRoot, runId: 'fits-run' });
    const context = await buildRepoContext(result.ingest, result.run.repoDir);

    expect(context.text).not.toMatch(/directories omitted/);
  });
});
