import { describe, expect, it } from 'vitest';
import type { Surfaces } from 'core';

import { reusableSurfaces } from '../src/commands/pipeline.js';

const surfaces = (role: string, entries: unknown[] = []): Surfaces =>
  ({
    schemaVersion: 1,
    runId: 'r',
    generatedAt: '2026-08-19T00:00:00.000Z',
    role,
    surfaces: entries,
  }) as unknown as Surfaces;

describe('reusableSurfaces', () => {
  it('reuses surfaces picked for the same role', () => {
    const picked = surfaces('backend');
    expect(reusableSurfaces(picked, 'backend')).toBe(picked);
  });

  /**
   * The case that made the resume banner lie: `--resume` on a run whose surfaces were chosen
   * for another role reported "S4  reused" and then re-ran S4 on the next line.
   */
  it('does not reuse surfaces picked for a different role', () => {
    expect(reusableSurfaces(surfaces('frontend'), 'backend')).toBeUndefined();
  });

  it('reuses fullstack surfaces that name both sides of the seam', () => {
    const picked = surfaces('fullstack', [{ seamComponentId: 'api' }]);
    expect(reusableSurfaces(picked, 'fullstack')).toBe(picked);
  });

  /** Reusing these resumed straight back into the bug that produced them. */
  it('discards fullstack surfaces picked before a surface could name a seam', () => {
    expect(reusableSurfaces(surfaces('fullstack', [{}]), 'fullstack')).toBeUndefined();
  });

  it('has nothing to reuse on a fresh run', () => {
    expect(reusableSurfaces(undefined, 'backend')).toBeUndefined();
  });
});
