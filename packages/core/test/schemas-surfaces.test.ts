import { describe, expect, it } from 'vitest';

import { Surface, SurfacesReply, surfaceTotal } from '../src/schemas/surfaces.js';

function surface(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'stock-adjustment',
    title: 'Stock adjustment with non-negative invariant',
    componentId: 'api',
    paths: ['src/services/inventory.ts'],
    summary: 'Applies a signed delta to stock and rejects anything below zero.',
    scores: { isolation: 0.9, representativeness: 0.8, richness: 0.7 },
    rationale: 'Depends only on its own db layer; already has tests.',
    assessmentIdea: 'Plant an off-by-one in the boundary check.',
    ...overrides,
  };
}

describe('Surface schema', () => {
  it('accepts a well-formed surface', () => {
    expect(() => Surface.parse(surface())).not.toThrow();
  });

  it('requires a slug id', () => {
    expect(() => Surface.parse(surface({ id: 'Stock Adjustment' }))).toThrow();
  });

  it('requires at least one path', () => {
    expect(() => Surface.parse(surface({ paths: [] }))).toThrow();
  });

  it.each([
    ['isolation', { isolation: 1.2, representativeness: 0.5, richness: 0.5 }],
    ['richness', { isolation: 0.5, representativeness: 0.5, richness: -0.1 }],
  ])('constrains %s to 0–1', (_label, scores) => {
    expect(() => Surface.parse(surface({ scores }))).toThrow();
  });

  it('requires a rationale, since it is what a reviewer reads to trust the ranking', () => {
    expect(() => Surface.parse(surface({ rationale: '' }))).toThrow();
  });
});

describe('SurfacesReply', () => {
  const three = [surface({ id: 'a' }), surface({ id: 'b' }), surface({ id: 'c' })];

  it('accepts three surfaces', () => {
    expect(() => SurfacesReply.parse({ surfaces: three })).not.toThrow();
  });

  it('rejects fewer than three, per SPEC', () => {
    expect(() => SurfacesReply.parse({ surfaces: three.slice(0, 2) })).toThrow();
  });

  it('rejects more than five, per SPEC', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => surface({ id }));
    expect(() => SurfacesReply.parse({ surfaces: six })).toThrow();
  });

  it('rejects duplicate ids', () => {
    const result = SurfacesReply.safeParse({
      surfaces: [surface({ id: 'a' }), surface({ id: 'a' }), surface({ id: 'c' })],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/duplicate surface id/);
  });
});

describe('surfaceTotal', () => {
  it('weights isolation highest, because one-command setup depends on it', () => {
    const isolated = surfaceTotal({ isolation: 1, representativeness: 0, richness: 0 });
    const representative = surfaceTotal({ isolation: 0, representativeness: 1, richness: 0 });
    const rich = surfaceTotal({ isolation: 0, representativeness: 0, richness: 1 });

    expect(isolated).toBeGreaterThan(representative);
    expect(representative).toBeGreaterThan(rich);
  });

  it('returns 1 for a perfect surface and 0 for a hopeless one', () => {
    expect(surfaceTotal({ isolation: 1, representativeness: 1, richness: 1 })).toBe(1);
    expect(surfaceTotal({ isolation: 0, representativeness: 0, richness: 0 })).toBe(0);
  });
});
