import { describe, expect, it } from 'vitest';

import { buildProgram, stripPassthroughSeparator } from '../src/program.js';

describe('buildProgram', () => {
  it('is named quarry and renders help without throwing', () => {
    const program = buildProgram();

    expect(program.name()).toBe('quarry');
    expect(program.helpInformation()).toContain('Usage: quarry');
  });
});

describe('stripPassthroughSeparator', () => {
  it('drops the separator pnpm forwards into argv', () => {
    expect(stripPassthroughSeparator(['node', 'quarry', '--', '--help'])).toEqual([
      'node',
      'quarry',
      '--help',
    ]);
  });

  it('leaves argv alone when there is no separator', () => {
    expect(stripPassthroughSeparator(['node', 'quarry', 'ingest', '--role', 'backend'])).toEqual([
      'node',
      'quarry',
      'ingest',
      '--role',
      'backend',
    ]);
  });

  it('drops only the first separator, so a later one still terminates options', () => {
    expect(stripPassthroughSeparator(['node', 'quarry', '--', 'generate', '--', '-x'])).toEqual([
      'node',
      'quarry',
      'generate',
      '--',
      '-x',
    ]);
  });

  it('handles a bare invocation', () => {
    expect(stripPassthroughSeparator(['node', 'quarry'])).toEqual(['node', 'quarry']);
  });
});
