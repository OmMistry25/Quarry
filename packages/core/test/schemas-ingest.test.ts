import { describe, expect, it } from 'vitest';

import {
  Ingest,
  INGEST_SCHEMA_VERSION,
  ManifestKind,
  ExclusionReason,
  TreeEntry,
} from '../src/schemas/ingest.js';

function validIngest(): unknown {
  return {
    schemaVersion: INGEST_SCHEMA_VERSION,
    runId: '20260819-075431-mini-ts-api',
    generatedAt: '2026-08-19T07:54:31.000Z',
    source: { kind: 'local', ref: '/src/mini-ts-api' },
    repo: { name: 'mini-ts-api', sizeBytes: 1234, fileCount: 12 },
    tree: [{ path: 'src/index.ts', sizeBytes: 400, lang: 'TypeScript', loc: 20 }],
    manifests: [{ path: 'package.json', kind: 'npm-package', sizeBytes: 300 }],
    docs: [{ path: 'README.md', sizeBytes: 200, lang: 'Markdown', loc: 10 }],
    languages: [{ name: 'TypeScript', loc: 20, fileCount: 1, share: 1 }],
    excluded: { secret: 1, binary: 0, vendored: 0, 'too-large': 0, 'git-internal': 1 },
  };
}

describe('Ingest schema', () => {
  it('accepts a well-formed artifact', () => {
    expect(() => Ingest.parse(validIngest())).not.toThrow();
  });

  it('rejects a mismatched schema version, so old artifacts fail loudly', () => {
    const artifact = { ...(validIngest() as Record<string, unknown>), schemaVersion: 99 };
    expect(() => Ingest.parse(artifact)).toThrow();
  });

  it('requires generatedAt to be a real timestamp', () => {
    const artifact = { ...(validIngest() as Record<string, unknown>), generatedAt: 'yesterday' };
    expect(() => Ingest.parse(artifact)).toThrow();
  });

  it('rejects a negative file size', () => {
    expect(() => TreeEntry.parse({ path: 'a.ts', sizeBytes: -1 })).toThrow();
  });

  it('rejects an empty path', () => {
    expect(() => TreeEntry.parse({ path: '', sizeBytes: 1 })).toThrow();
  });

  it('treats lang and loc as optional, since lockfiles are listed but never read', () => {
    expect(() => TreeEntry.parse({ path: 'pnpm-lock.yaml', sizeBytes: 900 })).not.toThrow();
  });

  it('requires every exclusion reason to be reported, including zeroes', () => {
    const artifact = validIngest() as Record<string, unknown>;
    artifact.excluded = { secret: 1 };
    expect(() => Ingest.parse(artifact)).toThrow();
  });

  it('constrains share to 0–1', () => {
    const artifact = validIngest() as Record<string, unknown>;
    artifact.languages = [{ name: 'TypeScript', loc: 20, fileCount: 1, share: 1.5 }];
    expect(() => Ingest.parse(artifact)).toThrow();
  });

  it('pins the manifest and exclusion enums, which downstream stages switch on', () => {
    expect(ManifestKind.options).toContain('npm-package');
    expect(ManifestKind.options).toContain('python-requirements');
    expect(ExclusionReason.options).toEqual([
      'secret',
      'binary',
      'vendored',
      'too-large',
      'git-internal',
    ]);
  });
});
