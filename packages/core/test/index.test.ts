import { describe, expect, it } from 'vitest';

import { QuarryError, STAGES, VERSION } from '../src/index.js';

describe('core barrel', () => {
  it('exposes a version', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('lists the seven pipeline stages in order', () => {
    expect([...STAGES]).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7']);
  });
});

describe('QuarryError', () => {
  it('records the stage that failed', () => {
    const err = new QuarryError('size cap exceeded', { stage: 's1' });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('QuarryError');
    expect(err.stage).toBe('s1');
    expect(err.message).toBe('size cap exceeded');
  });

  it('is usable without a stage and preserves the cause', () => {
    const cause = new Error('boom');
    const err = new QuarryError('wrapped', { cause });

    expect(err.stage).toBeUndefined();
    expect(err.cause).toBe(cause);
  });
});
