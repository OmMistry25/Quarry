import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  INSTALL_TIMEOUT_MS,
  runCommand,
  salientErrors,
  scrubbedEnv,
  tail,
  TEST_TIMEOUT_MS,
  type CommandResult,
} from '../src/verify/sandbox.js';

let cwd: string;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-sandbox-'));
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

describe('scrubbedEnv', () => {
  it('keeps only what a build genuinely needs', () => {
    const env = scrubbedEnv({ PATH: '/usr/bin', HOME: '/home/x', LANG: 'C' });

    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/x');
    expect(env.LANG).toBe('C');
  });

  it("drops the pipeline's own credentials", () => {
    const env = scrubbedEnv({
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'sk-should-not-leak',
      GITHUB_TOKEN: 'ghp-should-not-leak',
      AWS_SECRET_ACCESS_KEY: 'should-not-leak',
    });

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it('is an allowlist, so an unknown secret is dropped without being named', () => {
    // The point of allowlisting: a new variable nobody thought about must not pass through.
    const env = scrubbedEnv({ PATH: '/usr/bin', SOME_FUTURE_VENDOR_TOKEN: 'secret' });

    expect(env.SOME_FUTURE_VENDOR_TOKEN).toBeUndefined();
  });

  /**
   * pip could not reach PyPI at all on a proxy that terminates TLS with its own CA. It read
   * as a package problem — a certificate error in the middle of an install — and it was the
   * allowlist, which had been written for npm.
   */
  it("keeps pip's certificate configuration, not just npm's", () => {
    const env = scrubbedEnv({
      PATH: '/usr/bin',
      PIP_CERT: '/etc/ca.crt',
      REQUESTS_CA_BUNDLE: '/etc/ca.crt',
      CURL_CA_BUNDLE: '/etc/ca.crt',
    });

    expect(env.PIP_CERT).toBe('/etc/ca.crt');
    expect(env.REQUESTS_CA_BUNDLE).toBe('/etc/ca.crt');
    expect(env.CURL_CA_BUNDLE).toBe('/etc/ca.crt');
  });

  it('sets CI so installers do not go interactive', () => {
    expect(scrubbedEnv({ PATH: '/usr/bin' }).CI).toBe('1');
  });
});

describe('runCommand', () => {
  it('reports success', async () => {
    const result = await runCommand('echo hello', { cwd, timeoutMs: 10_000 });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
  });

  it('reports failure instead of throwing, because a failed install is a result', async () => {
    const result = await runCommand('exit 3', { cwd, timeoutMs: 10_000 });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
  });

  it('captures stderr, which is where the useful part of a failure lives', async () => {
    const result = await runCommand('echo boom >&2; exit 1', { cwd, timeoutMs: 10_000 });

    expect(result.stderr).toContain('boom');
  });

  it('runs in the directory it was given', async () => {
    await fs.writeFile(path.join(cwd, 'marker.txt'), 'x');
    const result = await runCommand('ls', { cwd, timeoutMs: 10_000 });

    expect(result.stdout).toContain('marker.txt');
  });

  it('times out rather than hanging the pipeline', async () => {
    const result = await runCommand('sleep 5', { cwd, timeoutMs: 300 });

    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  }, 20_000);

  it('returns at the timeout, not when the orphaned child finishes', async () => {
    // Regression: killing only the shell left `sleep` alive holding the pipe open, so a
    // 300ms timeout still took 5s to return. A hung install would have stalled the pipeline
    // for its full duration despite being correctly reported as timed out.
    const startedAt = Date.now();
    const result = await runCommand('sleep 10', { cwd, timeoutMs: 500 });
    const elapsed = Date.now() - startedAt;

    expect(result.timedOut).toBe(true);
    expect(elapsed).toBeLessThan(3_000);
  }, 30_000);

  it("does not pass the pipeline's credentials to the command", async () => {
    const result = await runCommand('echo "[$ANTHROPIC_API_KEY]"', {
      cwd,
      timeoutMs: 10_000,
      env: scrubbedEnv({ PATH: process.env.PATH ?? '', ANTHROPIC_API_KEY: 'sk-leak' }),
    });

    expect(result.stdout).toContain('[]');
    expect(result.stdout).not.toContain('sk-leak');
  });
});

describe('timeouts match the architecture doc', () => {
  it('allows 5 minutes to install and 3 to test', () => {
    expect(INSTALL_TIMEOUT_MS).toBe(5 * 60 * 1_000);
    expect(TEST_TIMEOUT_MS).toBe(3 * 60 * 1_000);
  });
});

describe('tail', () => {
  it('returns the end of the output, which is the part worth reading', () => {
    const result = {
      command: 'x',
      exitCode: 1,
      ok: false,
      stdout: Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n'),
      stderr: '',
      timedOut: false,
      durationMs: 1,
    };

    const output = tail(result, 3);
    expect(output).toContain('line 99');
    expect(output).not.toContain('line 50');
  });
});

describe('network configuration reaches the sandbox', () => {
  it('passes proxy and CA settings through', () => {
    // Regression: the allowlist dropped these, so on any proxied machine `npm install` could
    // not reach the registry. It did not fail fast either — it hung until the 5-minute
    // timeout, and the repair loop then spent a full generation pass reaching the same wall.
    const env = scrubbedEnv({
      PATH: '/usr/bin',
      HTTPS_PROXY: 'http://proxy:8080',
      HTTP_PROXY: 'http://proxy:8080',
      NO_PROXY: 'localhost',
      NODE_EXTRA_CA_CERTS: '/etc/ca.pem',
      npm_config_registry: 'https://registry.example.com',
    });

    expect(env.HTTPS_PROXY).toBe('http://proxy:8080');
    expect(env.HTTP_PROXY).toBe('http://proxy:8080');
    expect(env.NO_PROXY).toBe('localhost');
    expect(env.NODE_EXTRA_CA_CERTS).toBe('/etc/ca.pem');
    expect(env.npm_config_registry).toBe('https://registry.example.com');
  });

  it('still drops credentials while passing network settings', () => {
    const env = scrubbedEnv({
      PATH: '/usr/bin',
      HTTPS_PROXY: 'http://proxy:8080',
      ANTHROPIC_API_KEY: 'sk-leak',
      GITHUB_TOKEN: 'ghp-leak',
    });

    expect(env.HTTPS_PROXY).toBeDefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });
});

describe('salientErrors', () => {
  function result(output: string): CommandResult {
    return {
      command: 'npm test',
      exitCode: 1,
      ok: false,
      stdout: output,
      stderr: '',
      timedOut: false,
      durationMs: 1,
    };
  }

  it('pulls the one line that matters out of TAP noise', () => {
    // Regression: a repair failed because this line was buried in forty lines of TAP
    // boilerplate, so the generator reproduced the same broken test invocation.
    const tap = [
      '# Subtest: test',
      'not ok 1 - test',
      '  ---',
      '  duration_ms: 40.5',
      "# Error: Cannot find module '/tmp/x/candidate/test'",
      '#     at Function._resolveFilename (node:internal/modules/cjs/loader:1383:15)',
      '  type: test',
      '# fail 1',
    ].join('\n');

    expect(salientErrors(result(tap))).toContain(
      "Error: Cannot find module '/tmp/x/candidate/test'",
    );
  });

  it.each([
    ['npm ERR! missing script: test', /npm ERR!/],
    ['SyntaxError: Unexpected token', /SyntaxError/],
    ['ModuleNotFoundError: No module named app', /ModuleNotFoundError/],
    ['sh: 1: vitest: command not found', /command not found/],
    ['error: Unknown option --foo', /Unknown option/],
  ])('recognises %s', (line, pattern) => {
    expect(salientErrors(result(line)).join('\n')).toMatch(pattern);
  });

  it('returns nothing when the output is only noise', () => {
    expect(salientErrors(result('# pass 17\n# fail 0\nok 1 - thing'))).toEqual([]);
  });

  it('deduplicates repeats, which stack traces produce constantly', () => {
    const repeated = Array.from({ length: 5 }, () => "Error: Cannot find module 'x'").join('\n');
    expect(salientErrors(result(repeated))).toHaveLength(1);
  });

  it('caps the list so it cannot become the noise it exists to cut through', () => {
    const many = Array.from({ length: 40 }, (_, i) => `Error: thing ${i} failed`).join('\n');
    expect(salientErrors(result(many)).length).toBeLessThanOrEqual(8);
  });

  it('skips absurdly long lines, which are minified bundles rather than messages', () => {
    expect(salientErrors(result(`Error: ${'x'.repeat(500)}`))).toEqual([]);
  });
});
