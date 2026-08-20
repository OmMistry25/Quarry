import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isPythonPackage, prepareVenv } from '../src/verify/pythonVenv.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-venv-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('isPythonPackage', () => {
  it.each(['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg'])(
    'recognises a package by its %s',
    async (manifest) => {
      await fs.writeFile(path.join(dir, manifest), '');
      expect(await isPythonPackage(dir)).toBe(true);
    },
  );

  it('leaves a JavaScript package alone, since npm installs locally already', async () => {
    await fs.writeFile(path.join(dir, 'package.json'), '{}');
    expect(await isPythonPackage(dir)).toBe(false);
  });
});

describe('prepareVenv', () => {
  /**
   * The failure this exists for: pip installed into the host's site-packages while `pytest`
   * on PATH resolved to a uv-managed tool venv that could not see it, so a package whose
   * tests all pass was rejected for a module it had correctly declared.
   */
  it('puts the virtualenv ahead of everything on PATH', async () => {
    const venvDir = path.join(dir, '.venv');
    const result = await prepareVenv(venvDir, dir);

    expect(result.ok).toBe(true);
    expect(result.env.PATH?.startsWith(path.join(venvDir, 'bin'))).toBe(true);
    expect(result.env.VIRTUAL_ENV).toBe(venvDir);
  });

  it('reports a failure rather than throwing, so S6 can call it environmental', async () => {
    const result = await prepareVenv('/dev/null/impossible', dir);

    expect(result.ok).toBe(false);
    expect(result.command?.ok).toBe(false);
  });
});
