import { afterEach, describe, expect, it } from 'vitest';

import { claudeBinary } from '../src/agent/claude.js';

const original = process.env.QUARRY_CLAUDE_BIN;

afterEach(() => {
  if (original === undefined) delete process.env.QUARRY_CLAUDE_BIN;
  else process.env.QUARRY_CLAUDE_BIN = original;
});

describe('claudeBinary', () => {
  it('is `claude` on PATH by default, which is the contract in CLAUDE.md', () => {
    delete process.env.QUARRY_CLAUDE_BIN;
    expect(claudeBinary()).toBe('claude');
  });

  /**
   * The deploy this exists for: the CLI installed to a known location, and the platform's
   * runtime PATH did not include it — binary present, `claude` resolving to nothing.
   */
  it('runs the configured binary when PATH cannot be arranged', () => {
    process.env.QUARRY_CLAUDE_BIN = '/usr/local/bin/claude';
    expect(claudeBinary()).toBe('/usr/local/bin/claude');
  });

  it('treats a blank override as unset, since an empty variable is not a path', () => {
    process.env.QUARRY_CLAUDE_BIN = '   ';
    expect(claudeBinary()).toBe('claude');
  });
});
