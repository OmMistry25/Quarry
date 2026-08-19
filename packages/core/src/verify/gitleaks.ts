import { runCommand, scrubbedEnv } from './sandbox.js';

/**
 * gitleaks over the package directory (SPEC S6). A generated repo should never contain a
 * credential, but "should never" is not a control — this is.
 */

export interface SecretsScanResult {
  ok: boolean;
  /** False when gitleaks is not installed; distinguished from a clean scan on purpose. */
  ran: boolean;
  findings: number;
  detail: string;
}

const GITLEAKS_TIMEOUT_MS = 60_000;

export async function scanForSecrets(packageDir: string): Promise<SecretsScanResult> {
  const probe = await runCommand('gitleaks version', {
    cwd: packageDir,
    timeoutMs: 10_000,
    env: scrubbedEnv(),
  });

  if (!probe.ok) {
    return {
      ok: false,
      ran: false,
      findings: 0,
      detail:
        'gitleaks is not on PATH. Quarry will not ship a package it could not scan — ' +
        'install gitleaks (https://github.com/gitleaks/gitleaks) and re-run.',
    };
  }

  // `gitleaks dir` exits non-zero when it finds something.
  const result = await runCommand(`gitleaks dir . --no-banner --exit-code 1`, {
    cwd: packageDir,
    timeoutMs: GITLEAKS_TIMEOUT_MS,
    env: scrubbedEnv(),
  });

  if (result.ok) {
    return { ok: true, ran: true, findings: 0, detail: 'no leaks found' };
  }

  const output = `${result.stdout}\n${result.stderr}`;
  const reported = /(\d+)\s+leaks? found/i.exec(output)?.[1];

  return {
    ok: false,
    ran: true,
    findings: reported === undefined ? 1 : Number(reported),
    detail: output.trim().split('\n').slice(-30).join('\n'),
  };
}
