import { describe, expect, it } from 'vitest';

import {
  componentMatcher,
  filesForComponent,
  isAssessableLanguage,
  isTestPath,
} from '../src/components/match.js';
import type { Component } from '../src/schemas/components.js';
import type { TreeEntry } from '../src/schemas/ingest.js';

describe('componentMatcher', () => {
  it('matches a glob under a directory', () => {
    const matches = componentMatcher(['apps/api/**']);

    expect(matches('apps/api/src/index.ts')).toBe(true);
    expect(matches('apps/web/src/index.ts')).toBe(false);
  });

  it('treats ** as the whole repo', () => {
    const matches = componentMatcher(['**']);
    expect(matches('src/index.ts')).toBe(true);
    expect(matches('README.md')).toBe(true);
  });

  it('honours a negation, which trpc/trpc really produced', () => {
    // ["www/**", "!www/og-image/**"] carves a nested component out of its parent.
    const matches = componentMatcher(['www/**', '!www/og-image/**']);

    expect(matches('www/docs/index.md')).toBe(true);
    expect(matches('www/og-image/handler.ts')).toBe(false);
  });

  it('expands a bare directory, which agents write routinely', () => {
    const matches = componentMatcher(['src/api']);

    expect(matches('src/api/routes.ts')).toBe(true);
    expect(matches('src/apiary/routes.ts')).toBe(false);
  });

  it('tolerates a trailing slash and a ./ prefix', () => {
    expect(componentMatcher(['./src/api/'])('src/api/routes.ts')).toBe(true);
  });

  it('matches dotfiles, which default glob behaviour would skip', () => {
    expect(componentMatcher(['.github/**'])('.github/workflows/ci.yml')).toBe(true);
  });

  it('claims nothing when there is no positive pattern', () => {
    // A component with only exclusions describes nothing, rather than everything.
    expect(componentMatcher(['!src/**'])('src/index.ts')).toBe(false);
    expect(componentMatcher([])('src/index.ts')).toBe(false);
  });
});

describe('filesForComponent', () => {
  const tree: TreeEntry[] = [
    { path: 'apps/api/src/index.ts', sizeBytes: 1, lang: 'TypeScript', loc: 10 },
    { path: 'apps/web/src/App.tsx', sizeBytes: 1, lang: 'TypeScript', loc: 20 },
  ];

  const component = {
    id: 'api',
    kind: 'backend-api',
    paths: ['apps/api/**'],
    stack: [],
    entrypoints: [],
    depends_on: [],
    docs: [],
    confidence: 0.9,
    notes: '',
  } satisfies Component;

  it('returns only the files inside the component', () => {
    expect(filesForComponent(component, tree).map((file) => file.path)).toEqual([
      'apps/api/src/index.ts',
    ]);
  });
});

describe('isTestPath', () => {
  it.each([
    'test/inventory.spec.ts',
    'tests/test_thing.py',
    'src/__tests__/foo.ts',
    'src/foo.test.ts',
    'src/foo.spec.tsx',
    'api/test_views.py',
    'api/views_test.py',
    'e2e/checkout.ts',
  ])('recognises %s', (candidate) => {
    expect(isTestPath(candidate)).toBe(true);
  });

  it.each(['src/index.ts', 'src/latest.ts', 'src/contest.ts', 'src/protest/index.ts'])(
    'does not mistake %s for a test',
    (candidate) => {
      expect(isTestPath(candidate)).toBe(false);
    },
  );
});

describe('isAssessableLanguage', () => {
  it.each(['TypeScript', 'JavaScript', 'Python'])('accepts %s', (language) => {
    expect(isAssessableLanguage(language)).toBe(true);
  });

  it.each(['Rust', 'Go', 'Java', 'Markdown'])('rejects %s, per mvp.md scope', (language) => {
    expect(isAssessableLanguage(language)).toBe(false);
  });

  it('rejects an unknown language', () => {
    expect(isAssessableLanguage(undefined)).toBe(false);
  });
});
