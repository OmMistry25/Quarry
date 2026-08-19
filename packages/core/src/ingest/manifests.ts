import path from 'node:path';

import type { ManifestKind } from '../schemas/ingest.js';

/**
 * Manifest detection (SPEC S1). These are the files S2's context builder reads in full —
 * they name the stack far more reliably than file extensions do.
 */
const BY_BASENAME: Record<string, ManifestKind> = {
  'package.json': 'npm-package',
  'pnpm-workspace.yaml': 'pnpm-workspace',
  'lerna.json': 'pnpm-workspace',
  'turbo.json': 'pnpm-workspace',
  'pyproject.toml': 'python-pyproject',
  'requirements.txt': 'python-requirements',
  'requirements-dev.txt': 'python-requirements',
  'setup.py': 'python-setup',
  'setup.cfg': 'python-setup',
  'docker-compose.yml': 'docker-compose',
  'docker-compose.yaml': 'docker-compose',
  'compose.yml': 'docker-compose',
  'compose.yaml': 'docker-compose',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
};

export function detectManifestKind(relPath: string): ManifestKind | undefined {
  const basename = path.posix.basename(relPath).toLowerCase();

  const direct = BY_BASENAME[basename];
  if (direct) return direct;

  // tsconfig.json, tsconfig.build.json, jsconfig.json …
  if (/^[jt]sconfig(\..+)?\.json$/.test(basename)) return 'tsconfig';

  // Dockerfile.prod, api.Dockerfile
  if (basename.startsWith('dockerfile.') || basename.endsWith('.dockerfile')) return 'dockerfile';

  // Both `requirements-dev.txt` at the root and the `requirements/dev.txt` directory layout.
  if (/^requirements.*\.txt$/.test(basename)) return 'python-requirements';
  if (/(^|\/)requirements\/[^/]+\.txt$/i.test(relPath)) return 'python-requirements';

  if (/^\.github\/workflows\/.+\.ya?ml$/.test(relPath)) return 'ci-workflow';
  if (/^(\.gitlab-ci\.ya?ml|\.circleci\/config\.ya?ml|azure-pipelines\.ya?ml)$/.test(relPath)) {
    return 'ci-workflow';
  }

  return undefined;
}

/**
 * Prose worth feeding to cartography: READMEs anywhere, plus anything under a docs
 * directory. Deliberately narrow — `docs` is the highest-signal-per-token context S2 gets,
 * and padding it with every stray markdown file dilutes that.
 */
export function isDocPath(relPath: string): boolean {
  const basename = path.posix.basename(relPath).toLowerCase();

  if (/^readme(\..+)?$/.test(basename)) return true;
  if (/^(contributing|architecture|design|adr)(\..+)?$/.test(basename)) return true;
  if (/(^|\/)(docs?|adr|rfcs?)\//i.test(relPath) && /\.(md|mdx|rst|txt)$/i.test(basename)) {
    return true;
  }

  return false;
}
