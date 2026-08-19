import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { QuarryError } from '../src/errors.js';
import { Meta, type VerificationResult } from '../src/schemas/meta.js';
import { packageRun, zipName } from '../src/stages/s7-package.js';
import { createRunDir, type RunDir } from '../src/run.js';

const NOW = new Date('2026-08-19T17:30:00.000Z');

let workRoot: string;
let run: RunDir;
let packageDir: string;

const meta: Meta = Meta.parse({
  schemaVersion: 1,
  runId: 'run',
  role: 'backend',
  seniority: 'junior',
  task: 'bug-hunt',
  source: {
    ref: 'https://github.com/acme/widget-api.git',
    surfaceId: 's',
    surfaceTitle: 'Stock adjustment',
    componentId: 'api',
  },
  generation: {
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    attempts: 1,
    referenceFiles: ['src/a.ts'],
    setupCommand: 'npm install',
    testCommand: 'npm test',
  },
});

function verification(passed: boolean): VerificationResult {
  return {
    passed,
    installOk: passed,
    testsOk: passed,
    bugDemonstrated: passed,
    secretsScanOk: passed,
    overlapOk: passed,
    ranAt: NOW.toISOString(),
    notes: [],
  };
}

beforeEach(async () => {
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-s7-'));
  run = await createRunDir({ workRoot, ref: 'widget-api', runId: 'run' });

  packageDir = path.join(run.dir, 'package');
  await fs.mkdir(path.join(packageDir, 'candidate'), { recursive: true });
  await fs.mkdir(path.join(packageDir, 'interviewer'), { recursive: true });
  await fs.writeFile(path.join(packageDir, 'candidate', 'README.md'), '# app\n');
  await fs.writeFile(path.join(packageDir, 'interviewer', 'rubric.md'), '# rubric\n');
});

afterEach(async () => {
  await fs.rm(workRoot, { recursive: true, force: true });
});

describe('packageRun', () => {
  it('refuses to package an unverified run — CLAUDE.md invariant 3', async () => {
    const error = await packageRun({
      run,
      meta,
      verification: verification(false),
      now: NOW,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(QuarryError);
    expect((error as QuarryError).stage).toBe('s7');
    expect((error as QuarryError).message).toMatch(/unverified/i);
  });

  it('writes no zip at all when it refuses', async () => {
    await packageRun({ run, meta, verification: verification(false), now: NOW }).catch(
      () => undefined,
    );

    const entries = await fs.readdir(run.dir);
    expect(entries.filter((entry) => entry.endsWith('.zip'))).toEqual([]);
  });

  it('produces a zip for a verified run', async () => {
    const result = await packageRun({ run, meta, verification: verification(true), now: NOW });

    const stat = await fs.stat(result.zipPath);
    expect(stat.isFile()).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('stamps the verification block into the shipped meta.json', async () => {
    // The package should carry proof of what was checked, not just a claim that it was.
    await packageRun({ run, meta, verification: verification(true), now: NOW });

    const written: unknown = JSON.parse(
      await fs.readFile(path.join(packageDir, 'meta.json'), 'utf8'),
    );
    const parsed = Meta.parse(written);

    expect(parsed.verification?.passed).toBe(true);
    expect(parsed.verification?.overlapOk).toBe(true);
  });

  it('names the zip from the repo, role, seniority and date', () => {
    expect(zipName(meta, NOW)).toBe('quarry-widget-api-backend-junior-2026-08-19.zip');
  });

  it('handles a local path as a source ref', () => {
    const local = Meta.parse({ ...meta, source: { ...meta.source, ref: '/src/my-repo' } });
    expect(zipName(local, NOW)).toBe('quarry-my-repo-backend-junior-2026-08-19.zip');
  });

  it('fails clearly when there is no package directory', async () => {
    await fs.rm(packageDir, { recursive: true, force: true });

    const error = await packageRun({
      run,
      meta,
      verification: verification(true),
      now: NOW,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(QuarryError);
    expect((error as QuarryError).message).toMatch(/No package directory/);
  });
});
