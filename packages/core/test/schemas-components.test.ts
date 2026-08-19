import { describe, expect, it } from 'vitest';

import {
  CartographyReply,
  Component,
  ComponentKind,
  Components,
  COMPONENTS_SCHEMA_VERSION,
} from '../src/schemas/components.js';

function component(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'api',
    kind: 'backend-api',
    paths: ['apps/api/**'],
    stack: ['typescript', 'express'],
    entrypoints: ['apps/api/src/index.ts'],
    depends_on: [],
    docs: ['apps/api/README.md'],
    confidence: 0.9,
    notes: 'REST API, jest tests present',
    ...overrides,
  };
}

describe('Component schema', () => {
  it('accepts a well-formed component', () => {
    expect(() => Component.parse(component())).not.toThrow();
  });

  it.each([
    ['an uppercase id', { id: 'API' }],
    ['an id with spaces', { id: 'my api' }],
    ['an id starting with a dash', { id: '-api' }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => Component.parse(component(overrides))).toThrow();
  });

  it('requires at least one path, so a component is always locatable', () => {
    expect(() => Component.parse(component({ paths: [] }))).toThrow();
  });

  it('rejects a kind outside the SPEC enum', () => {
    expect(() => Component.parse(component({ kind: 'microservice' }))).toThrow();
  });

  it('constrains confidence to 0–1', () => {
    expect(() => Component.parse(component({ confidence: 1.4 }))).toThrow();
    expect(() => Component.parse(component({ confidence: -0.1 }))).toThrow();
  });

  it('pins the kind enum that S3 scores against', () => {
    expect(ComponentKind.options).toEqual([
      'frontend-app',
      'backend-api',
      'worker',
      'data-pipeline',
      'shared-lib',
      'infra',
      'docs',
      'other',
    ]);
  });
});

describe('CartographyReply referential integrity', () => {
  it('accepts depends_on that points at another component in the reply', () => {
    const reply = {
      components: [
        component({ id: 'api', depends_on: ['shared'] }),
        component({ id: 'shared', kind: 'shared-lib', depends_on: [] }),
      ],
    };
    expect(() => CartographyReply.parse(reply)).not.toThrow();
  });

  it('rejects a dangling depends_on rather than letting S3 trip over it later', () => {
    const reply = { components: [component({ depends_on: ['ghost'] })] };

    const result = CartographyReply.safeParse(reply);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('ghost');
  });

  it('rejects a self-dependency', () => {
    const reply = { components: [component({ id: 'api', depends_on: ['api'] })] };

    const result = CartographyReply.safeParse(reply);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/cannot depend on itself/);
  });

  it('rejects duplicate ids', () => {
    const reply = { components: [component({ id: 'api' }), component({ id: 'api' })] };

    const result = CartographyReply.safeParse(reply);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/duplicate component id/);
  });

  it('rejects an empty component list', () => {
    expect(() => CartographyReply.parse({ components: [] })).toThrow();
  });
});

describe('Components artifact', () => {
  it('accepts a well-formed artifact', () => {
    const artifact = {
      schemaVersion: COMPONENTS_SCHEMA_VERSION,
      runId: 'test-run',
      generatedAt: '2026-08-19T07:54:31.000Z',
      components: [component()],
      agent: { attempts: 1, costUsd: 0.19 },
    };
    expect(() => Components.parse(artifact)).not.toThrow();
  });

  it('requires a positive attempt count', () => {
    const artifact = {
      schemaVersion: COMPONENTS_SCHEMA_VERSION,
      runId: 'test-run',
      generatedAt: '2026-08-19T07:54:31.000Z',
      components: [component()],
      agent: { attempts: 0 },
    };
    expect(() => Components.parse(artifact)).toThrow();
  });
});
