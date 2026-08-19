import { describe, expect, it } from 'vitest';

import {
  classify,
  isBinaryPath,
  isLockfile,
  isSecretPath,
  isSkippedDir,
} from '../src/ingest/exclusions.js';

describe('isSecretPath', () => {
  it.each([
    '.env',
    '.env.local',
    '.env.production',
    'config/.env.staging',
    'server.pem',
    'certs/private.key',
    'id_rsa',
    '.npmrc',
    'service-account-prod.json',
    'secrets.yaml',
    'app_secrets.json',
    'terraform.tfvars',
    'infra/prod.auto.tfvars',
    'home/.aws/credentials',
    'deploy/.ssh/known_hosts',
  ])('excludes %s', (candidate) => {
    expect(isSecretPath(candidate)).toBe(true);
  });

  it.each([
    '.env.example',
    '.env.sample',
    '.env.template',
    'secrets.example.json',
    'src/index.ts',
    'README.md',
    'package.json',
    'keyboard.ts',
    'monkey.py',
  ])('keeps %s', (candidate) => {
    expect(isSecretPath(candidate)).toBe(false);
  });
});

describe('classify', () => {
  const maxFileBytes = 1_000;

  it('reports a secret as a secret even when it is also enormous', () => {
    expect(classify('.env.production', 50_000, maxFileBytes)).toEqual({
      excluded: true,
      reason: 'secret',
    });
  });

  it('flags binaries by extension', () => {
    expect(classify('docs/logo.png', 10, maxFileBytes).reason).toBe('binary');
  });

  it('flags oversized text files', () => {
    expect(classify('src/generated.ts', 5_000, maxFileBytes).reason).toBe('too-large');
  });

  it('admits an ordinary source file', () => {
    expect(classify('src/index.ts', 400, maxFileBytes)).toEqual({ excluded: false });
  });
});

describe('directory and lockfile rules', () => {
  it.each(['.git', 'node_modules', 'dist', '__pycache__', '.venv', 'coverage'])(
    'skips %s',
    (dir) => {
      expect(isSkippedDir(dir)).toBe(true);
    },
  );

  it('walks ordinary source directories', () => {
    expect(isSkippedDir('src')).toBe(false);
    expect(isSkippedDir('services')).toBe(false);
  });

  it.each(['package-lock.json', 'pnpm-lock.yaml', 'poetry.lock', 'go.sum'])(
    'recognises %s as a lockfile',
    (name) => {
      expect(isLockfile(name)).toBe(true);
    },
  );

  it('does not treat a manifest as a lockfile', () => {
    expect(isLockfile('package.json')).toBe(false);
  });

  it('is case-insensitive about binary extensions', () => {
    expect(isBinaryPath('docs/Diagram.PNG')).toBe(true);
  });
});
