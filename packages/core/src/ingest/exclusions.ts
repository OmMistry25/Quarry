import path from 'node:path';

import type { ExclusionReason } from '../schemas/ingest.js';

/**
 * Directories never walked. `.git` and `node_modules` are named in SPEC S1; the rest are
 * the same class of thing — vendored dependencies and build output that tell an agent
 * nothing about how the team writes code.
 */
const SKIPPED_DIRS = new Set([
  '.git',
  'node_modules',
  'bower_components',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'coverage',
  '.nyc_output',
  '.idea',
  '.vscode',
  '.gradle',
  'target',
]);

/**
 * Secret-bearing filenames. CLAUDE.md invariant 2: these are stripped at S1, before any
 * agent call — not redacted downstream, not filtered per-prompt. Stripped.
 *
 * Deliberately errs toward over-exclusion: a missed config file costs an agent a little
 * context, whereas a leaked credential costs a customer their trust in the whole premise.
 * `.env.example` and friends are the one carve-out — they hold key *names* with empty
 * values, which is genuinely useful signal about a repo's stack.
 */
const SECRET_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i,
  /^\.?netrc$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.htpasswd$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /^.*\.(pem|key|p12|pfx|jks|keystore|asc|gpg|ppk)$/i,
  /^.*\.kdbx?$/i,
  /credentials(\.json|\.ya?ml)?$/i,
  /^service-account.*\.json$/i,
  /secrets?\.(json|ya?ml|toml|ini|cfg|conf|txt)$/i,
  /^.*[._-]secrets?\.(json|ya?ml|toml|ini|cfg|conf|txt)$/i,
  /^terraform\.tfvars$/i,
  /^.*\.auto\.tfvars$/i,
];

/** Example/template files that look secret-ish but hold no values. */
const SECRET_EXEMPTIONS: RegExp[] = [
  /\.(example|sample|template|dist|tmpl)$/i,
  /^(example|sample|template)[._-]/i,
];

/** Extensions we never read as text. Excluded from the tree per tasks-mvp.md Phase 1. */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.avif',
  '.tiff',
  '.svgz',
  '.mp3',
  '.mp4',
  '.wav',
  '.ogg',
  '.webm',
  '.mov',
  '.avi',
  '.flac',
  '.m4a',
  '.zip',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.tar',
  '.jar',
  '.war',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.so',
  '.dylib',
  '.dll',
  '.exe',
  '.bin',
  '.o',
  '.a',
  '.class',
  '.pyc',
  '.pyo',
  '.wasm',
  '.node',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.mo',
  '.pack',
  '.idx',
]);

/**
 * Lockfiles: listed in the tree as a stack signal, but never read. SPEC S1 excludes
 * "lockfile contents" specifically — the path is informative, the 40k lines are not.
 */
const LOCKFILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'npm-shrinkwrap.json',
  'bun.lockb',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'pdm.lock',
  'Cargo.lock',
  'composer.lock',
  'Gemfile.lock',
  'go.sum',
]);

export function isSkippedDir(name: string): boolean {
  return SKIPPED_DIRS.has(name);
}

export function isLockfile(basename: string): boolean {
  return LOCKFILES.has(basename);
}

export function isBinaryPath(relPath: string): boolean {
  return BINARY_EXTENSIONS.has(path.posix.extname(relPath).toLowerCase());
}

/** @param relPath repo-relative POSIX path */
export function isSecretPath(relPath: string): boolean {
  const basename = path.posix.basename(relPath);

  if (SECRET_EXEMPTIONS.some((pattern) => pattern.test(basename))) {
    return false;
  }

  if (SECRET_FILE_PATTERNS.some((pattern) => pattern.test(basename))) {
    return true;
  }

  // A couple of rules are about location rather than filename.
  return /(^|\/)\.aws\/credentials$/i.test(relPath) || /(^|\/)\.ssh\//i.test(relPath);
}

export interface ExclusionVerdict {
  excluded: boolean;
  reason?: ExclusionReason;
}

/**
 * Single decision point for "does this file reach the agent". Order matters: `secret` is
 * checked before `binary` so a `secrets.json.gz` is reported as a secret, and before the
 * size check so an enormous key file is never mislabelled as merely too large.
 */
export function classify(
  relPath: string,
  sizeBytes: number,
  maxFileBytes: number,
): ExclusionVerdict {
  if (isSecretPath(relPath)) return { excluded: true, reason: 'secret' };
  if (isBinaryPath(relPath)) return { excluded: true, reason: 'binary' };
  if (sizeBytes > maxFileBytes) return { excluded: true, reason: 'too-large' };
  return { excluded: false };
}
