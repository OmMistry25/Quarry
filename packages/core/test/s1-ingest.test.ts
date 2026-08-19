import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { QuarryError } from '../src/errors.js';
import { Ingest } from '../src/schemas/ingest.js';
import { ingest } from '../src/stages/s1-ingest.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/mini-ts-api', import.meta.url));
const NOW = new Date('2026-08-19T07:54:31.000Z');

let workRoot: string;

beforeEach(async () => {
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-s1-'));
});

afterEach(async () => {
  await fs.rm(workRoot, { recursive: true, force: true });
});

async function ingestFixture() {
  return ingest({ ref: FIXTURE, workRoot, now: NOW, runId: 'test-run' });
}

describe('S1 ingest on the fixture repo', () => {
  it('writes an ingest.json that satisfies its own schema', async () => {
    const { artifactPath } = await ingestFixture();

    const onDisk: unknown = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
    expect(() => Ingest.parse(onDisk)).not.toThrow();
    expect(artifactPath.endsWith(path.join('test-run', 'ingest.json'))).toBe(true);
  });

  it('copies the repo into the run directory rather than reading it in place', async () => {
    const { run } = await ingestFixture();

    const copied = await fs.readFile(path.join(run.repoDir, 'package.json'), 'utf8');
    expect(copied).toContain('mini-ts-api');
    // The original is untouched: later stages cannot corrupt someone's working tree.
    await expect(fs.stat(path.join(FIXTURE, 'package.json'))).resolves.toBeDefined();
  });

  it('strips secret files from the tree entirely — CLAUDE.md invariant 2', async () => {
    const { ingest: artifact } = await ingestFixture();

    const serialised = JSON.stringify(artifact);
    expect(serialised).not.toContain('.env"');
    expect(serialised).not.toContain('placeholder-not-a-real-secret');

    const paths = artifact.tree.map((entry) => entry.path);
    expect(paths).not.toContain('.env');
    expect(artifact.excluded.secret).toBeGreaterThanOrEqual(1);
  });

  it('keeps .env.example, which carries key names but no values', async () => {
    const { ingest: artifact } = await ingestFixture();

    expect(artifact.tree.map((entry) => entry.path)).toContain('.env.example');
  });

  it('excludes binaries and counts them', async () => {
    const { ingest: artifact } = await ingestFixture();

    expect(artifact.tree.map((entry) => entry.path)).not.toContain('docs/logo.png');
    expect(artifact.excluded.binary).toBeGreaterThanOrEqual(1);
  });

  it('lists the lockfile but never reads it', async () => {
    const { ingest: artifact } = await ingestFixture();

    const lockfile = artifact.tree.find((entry) => entry.path === 'package-lock.json');
    expect(lockfile).toBeDefined();
    expect(lockfile?.sizeBytes).toBeGreaterThan(0);
    // No `loc` is the signal that the contents were never opened.
    expect(lockfile?.loc).toBeUndefined();
  });

  it('detects the manifests S2 will need to read', async () => {
    const { ingest: artifact } = await ingestFixture();

    const byPath = new Map(artifact.manifests.map((entry) => [entry.path, entry.kind]));
    expect(byPath.get('package.json')).toBe('npm-package');
    expect(byPath.get('tsconfig.json')).toBe('tsconfig');
  });

  it('collects README and docs prose', async () => {
    const { ingest: artifact } = await ingestFixture();

    const docs = artifact.docs.map((entry) => entry.path);
    expect(docs).toContain('README.md');
    expect(docs).toContain('docs/architecture.md');
  });

  it('reports TypeScript as the primary language', async () => {
    const { ingest: artifact } = await ingestFixture();

    const primary = artifact.languages.find((language) => language.share > 0);
    expect(primary?.name).toBe('TypeScript');
    expect(primary?.share).toBeGreaterThan(0.5);
  });

  it('records the source and a deterministic run id', async () => {
    const { ingest: artifact } = await ingestFixture();

    expect(artifact.source.kind).toBe('local');
    expect(artifact.runId).toBe('test-run');
    expect(artifact.generatedAt).toBe(NOW.toISOString());
  });

  it('produces paths that are repo-relative and POSIX-separated', async () => {
    const { ingest: artifact } = await ingestFixture();

    for (const entry of artifact.tree) {
      expect(entry.path.startsWith('/')).toBe(false);
      expect(entry.path.startsWith('./')).toBe(false);
      expect(entry.path).not.toContain('\\');
    }
  });
});

describe('S1 ingest failure modes', () => {
  it('aborts with a clear error when the size cap is exceeded', async () => {
    const error = await ingest({
      ref: FIXTURE,
      workRoot,
      now: NOW,
      runId: 'too-big',
      maxTotalBytes: 100,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(QuarryError);
    expect((error as QuarryError).stage).toBe('s1');
    expect((error as QuarryError).message).toMatch(/size cap/i);
  });

  it('rejects a path that is neither a directory nor a URL', async () => {
    const error = await ingest({
      ref: path.join(FIXTURE, 'package.json'),
      workRoot,
      now: NOW,
      runId: 'not-a-dir',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(QuarryError);
    expect((error as QuarryError).message).toMatch(/not a directory/i);
  });

  it('refuses a repo with nothing readable in it', async () => {
    const empty = path.join(workRoot, 'empty-src');
    await fs.mkdir(path.join(empty, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(empty, 'node_modules', 'x.js'), 'noop');

    const error = await ingest({ ref: empty, workRoot, now: NOW, runId: 'empty' }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(QuarryError);
    expect((error as QuarryError).message).toMatch(/no readable source files/i);
  });
});

describe('S1 ingest source resolution', () => {
  it("does not attribute the enclosing repo's commit to a plain directory", async () => {
    // The fixture lives inside Quarry's own checkout. `git rev-parse HEAD` there would
    // happily return Quarry's SHA, which says nothing about the fixture.
    const { ingest: artifact } = await ingestFixture();

    expect(artifact.source.commit).toBeUndefined();
  });

  it('records a commit when the directory is itself a repo root', async () => {
    const repo = path.join(workRoot, 'standalone');
    await fs.mkdir(repo, { recursive: true });
    await fs.writeFile(path.join(repo, 'index.ts'), 'export const a = 1;\n');

    const git = simpleGit(repo);
    await git.init();
    await git.addConfig('user.email', 'test@example.com');
    await git.addConfig('user.name', 'Test');
    await git.add('.');
    await git.commit('initial');

    const { ingest: artifact } = await ingest({
      ref: repo,
      workRoot,
      now: NOW,
      runId: 'standalone-run',
    });

    expect(artifact.source.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});
