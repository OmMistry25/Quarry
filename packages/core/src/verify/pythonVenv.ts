import fs from 'node:fs/promises';
import path from 'node:path';

import { runCommand, scrubbedEnv, type CommandResult } from './sandbox.js';

/**
 * Verification of a Python package happens inside its own virtualenv.
 *
 * The reason is a real failure, not a precaution. On this container `pip` installs into
 * `/usr/local/lib/python3.11/dist-packages`, while `pytest` on PATH is
 * `/root/.local/bin/pytest`, whose shebang points at a uv-managed tool venv that can see
 * nothing pip installs. So `pip install -e .` reported success, `pytest -q` reported
 * `ModuleNotFoundError: No module named 'flask'`, and S6 blamed a package whose 23 tests pass
 * the moment both commands share an interpreter.
 *
 * A venv also makes the install step mean what it claims. Without one, `pip` answered
 * "Requirement already satisfied" from the host's site-packages, so a package could ship a
 * dependency list that has never once been proved to install.
 */
const PYTHON_MANIFESTS = ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg'] as const;

const VENV_TIMEOUT_MS = 120 * 1_000;

export async function isPythonPackage(candidateDir: string): Promise<boolean> {
  const present = await Promise.all(
    PYTHON_MANIFESTS.map((name) =>
      fs.stat(path.join(candidateDir, name)).then(
        () => true,
        () => false,
      ),
    ),
  );

  return present.includes(true);
}

export interface VenvResult {
  ok: boolean;
  /** Every later command runs with this: the venv's `bin` ahead of everything on PATH. */
  env: NodeJS.ProcessEnv;
  /** Present when creating the venv failed, for the failure message. */
  command?: CommandResult;
}

/**
 * Create a virtualenv next to the package — never inside it, so `setuptools` package
 * discovery and the overlap check never see it — and return the env that uses it.
 */
export async function prepareVenv(venvDir: string, cwd: string): Promise<VenvResult> {
  const base = scrubbedEnv();
  const created = await runCommand(`python3 -m venv ${JSON.stringify(venvDir)}`, {
    cwd,
    timeoutMs: VENV_TIMEOUT_MS,
    env: base,
  });

  if (!created.ok) return { ok: false, env: base, command: created };

  const bin = path.join(venvDir, 'bin');

  return {
    ok: true,
    env: {
      ...base,
      VIRTUAL_ENV: venvDir,
      PATH: base.PATH === undefined ? bin : `${bin}${path.delimiter}${base.PATH}`,
    },
  };
}
