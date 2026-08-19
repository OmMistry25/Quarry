import { describe, expect, it } from 'vitest';

import { detectManifestKind, isDocPath } from '../src/ingest/manifests.js';

describe('detectManifestKind', () => {
  it.each([
    ['package.json', 'npm-package'],
    ['tsconfig.json', 'tsconfig'],
    ['tsconfig.build.json', 'tsconfig'],
    ['pyproject.toml', 'python-pyproject'],
    ['requirements.txt', 'python-requirements'],
    ['requirements/dev.txt', 'python-requirements'],
    ['docker-compose.yml', 'docker-compose'],
    ['Dockerfile', 'dockerfile'],
    ['api.Dockerfile', 'dockerfile'],
    ['Makefile', 'makefile'],
    ['pnpm-workspace.yaml', 'pnpm-workspace'],
    ['.github/workflows/ci.yml', 'ci-workflow'],
  ])('maps %s to %s', (candidate, expected) => {
    expect(detectManifestKind(candidate)).toBe(expected);
  });

  it('returns undefined for ordinary source', () => {
    expect(detectManifestKind('src/index.ts')).toBeUndefined();
  });
});

describe('isDocPath', () => {
  it.each([
    'README.md',
    'readme.rst',
    'packages/api/README.md',
    'docs/architecture.md',
    'doc/design.md',
    'CONTRIBUTING.md',
  ])('treats %s as documentation', (candidate) => {
    expect(isDocPath(candidate)).toBe(true);
  });

  it.each(['src/index.ts', 'CHANGELOG.md', 'src/components/Button.tsx'])(
    'does not treat %s as documentation',
    (candidate) => {
      expect(isDocPath(candidate)).toBe(false);
    },
  );
});
