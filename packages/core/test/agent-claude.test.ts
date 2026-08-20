import { describe, expect, it } from 'vitest';

import { buildArgsForTest, explainCliFailure } from '../src/agent/claude.js';

/**
 * The transport itself shells out, so these cover the argument construction rather than the
 * subprocess. The one that matters is the prompt's absence.
 */
describe('claude invocation arguments', () => {
  it('never puts the prompt in argv', () => {
    // Regression: Linux caps a single argv entry at 128 KB (MAX_ARG_STRLEN) and S5's
    // reference material alone is budgeted at 150 KB, so passing the prompt as an argument
    // failed with E2BIG on psf/requests. expressjs/express only fitted by luck.
    const prompt = 'x'.repeat(200_000);
    const args = buildArgsForTest({
      prompt,
      systemPrompt: 'sys',
      cwd: '/tmp',
      timeoutMs: 1_000,
    });

    expect(args).not.toContain(prompt);
    expect(args.join(' ').length).toBeLessThan(1_000);
  });

  it("keeps the operator's machine out of the run", () => {
    const args = buildArgsForTest({
      prompt: 'p',
      systemPrompt: 'sys',
      cwd: '/tmp',
      timeoutMs: 1_000,
    });

    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--disable-slash-commands');
    expect(args).toContain('--setting-sources');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
  });

  it('grants write tools only in write mode', () => {
    const analyse = buildArgsForTest({
      prompt: 'p',
      systemPrompt: 's',
      cwd: '/tmp',
      timeoutMs: 1,
    });
    const write = buildArgsForTest({
      prompt: 'p',
      systemPrompt: 's',
      cwd: '/tmp',
      timeoutMs: 1,
      mode: 'write',
    });

    expect(analyse).not.toContain('--allowedTools');
    expect(write).toContain('--allowedTools');
    expect(write).toContain('Write');
    // No Bash: a generation pass must not install packages or reach the network.
    expect(write).not.toContain('Bash');
  });

  it('passes a model only when one is chosen', () => {
    const base = { prompt: 'p', systemPrompt: 's', cwd: '/tmp', timeoutMs: 1 };

    expect(buildArgsForTest(base)).not.toContain('--model');
    expect(buildArgsForTest({ ...base, model: 'sonnet' })).toContain('sonnet');
  });
});

describe('a CLI that exits non-zero still has something to say', () => {
  /**
   * The real failure, from the deployed app: the account behind the key ran out of credit.
   * The CLI printed its envelope and exited 1, so the caller saw execa's raw message — the
   * command line and the whole JSON blob, with the one useful sentence buried in it.
   */
  const failure = (stdout: string): Error & { stdout: string } =>
    Object.assign(new Error('Command failed with exit code 1: /usr/local/bin/claude -p …'), {
      stdout,
    });

  const outOfCredit = failure(
    JSON.stringify({
      is_error: true,
      result: 'Credit balance is too low',
      api_error_status: 400,
      subtype: 'success',
    }),
  );

  it('names billing as the cause, and says it is not the repository', () => {
    expect(explainCliFailure(outOfCredit)?.message).toMatch(
      /account problem, not a problem with the repository/,
    );
  });

  it('quotes what the API actually said', () => {
    expect(explainCliFailure(outOfCredit)?.message).toMatch(/Credit balance is too low/);
  });

  it('reports other agent errors with their status', () => {
    const overloaded = failure(
      JSON.stringify({ is_error: true, result: 'Overloaded', api_error_status: 529 }),
    );

    expect(explainCliFailure(overloaded)?.message).toMatch(/\(529\): Overloaded/);
  });

  it('says nothing when the failure carries no envelope, so the caller keeps the raw detail', () => {
    expect(explainCliFailure(failure('not json at all'))).toBeUndefined();
    expect(explainCliFailure(new Error('spawn ENOENT'))).toBeUndefined();
  });
});
