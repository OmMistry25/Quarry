import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ROLE_ARCHETYPES } from '../src/archetypes/roles.js';
import { QuarryError } from '../src/errors.js';
import { Roles } from '../src/schemas/roles.js';
import type { Component, Components } from '../src/schemas/components.js';
import type { Ingest, TreeEntry } from '../src/schemas/ingest.js';
import { assertRoleSupported, computeScore, roleMenu, scoreRole } from '../src/stages/s3-roles.js';
import { createRunDir } from '../src/run.js';

function component(overrides: Partial<Component> = {}): Component {
  return {
    id: 'api',
    kind: 'backend-api',
    paths: ['apps/api/**'],
    stack: ['typescript'],
    entrypoints: [],
    depends_on: [],
    docs: [],
    confidence: 0.9,
    notes: '',
    ...overrides,
  };
}

function components(list: Component[]): Components {
  return {
    schemaVersion: 1,
    runId: 'r',
    generatedAt: '2026-08-19T00:00:00.000Z',
    components: list,
    agent: { attempts: 1 },
  };
}

function ingestWith(tree: TreeEntry[]): Ingest {
  return {
    schemaVersion: 1,
    runId: 'r',
    generatedAt: '2026-08-19T00:00:00.000Z',
    source: { kind: 'local', ref: '/x' },
    repo: { name: 'x', sizeBytes: 1, fileCount: tree.length },
    tree,
    manifests: [],
    docs: [],
    languages: [],
    excluded: { secret: 0, binary: 0, vendored: 0, 'too-large': 0, 'git-internal': 0 },
  };
}

/** n source files plus m test files, all TypeScript, under `apps/api/`. */
function apiTree(sourceLoc: number, testLoc: number): TreeEntry[] {
  return [
    { path: 'apps/api/src/service.ts', sizeBytes: 1, lang: 'TypeScript', loc: sourceLoc },
    ...(testLoc > 0
      ? [
          {
            path: 'apps/api/test/service.spec.ts',
            sizeBytes: 1,
            lang: 'TypeScript',
            loc: testLoc,
          } satisfies TreeEntry,
        ]
      : []),
  ];
}

describe('scoreRole ratings', () => {
  it('reports none when the role has no in-lane components at all', () => {
    const card = scoreRole(
      ROLE_ARCHETYPES.frontend,
      components([component({ kind: 'backend-api' })]),
      ingestWith(apiTree(2_000, 500)),
    );

    expect(card.rating).toBe('none');
    expect(card.reason).toMatch(/no frontend application components/);
  });

  it('rates a substantial, well-tested API strong', () => {
    const card = scoreRole(
      ROLE_ARCHETYPES.backend,
      components([component({ docs: ['README.md', 'docs/api.md', 'docs/adr.md'] })]),
      ingestWith(apiTree(4_000, 1_500)),
    );

    expect(card.rating).toBe('strong');
    expect(card.evidence.assessableLoc).toBe(5_500);
  });

  it('rates a small untested API weak rather than strong', () => {
    const card = scoreRole(
      ROLE_ARCHETYPES.backend,
      components([component()]),
      ingestWith(apiTree(300, 0)),
    );

    expect(card.rating).toBe('weak');
    expect(card.reason).toMatch(/no tests found/);
  });

  it('reports none when there is barely any in-lane code', () => {
    const card = scoreRole(
      ROLE_ARCHETYPES.backend,
      components([component()]),
      ingestWith(apiTree(40, 0)),
    );

    expect(card.rating).toBe('none');
    expect(card.reason).toMatch(/too little to build a task from/);
  });

  it('counts a file once when two components claim it', () => {
    const card = scoreRole(
      ROLE_ARCHETYPES.backend,
      components([
        component({ id: 'api', paths: ['apps/api/**'] }),
        component({ id: 'shared', kind: 'shared-lib', paths: ['apps/**'] }),
      ]),
      ingestWith(apiTree(1_000, 200)),
    );

    expect(card.evidence.assessableLoc).toBe(1_200);
  });
});

describe('tests living outside the in-lane component', () => {
  it('counts a top-level test/ directory that S2 mapped as its own component', () => {
    // expressjs/express, exactly: lib/** is the backend component, and 13.5k lines of tests
    // sit in a separate `other` component. Counting only in-lane files reported "no tests
    // found" for one of the better-tested repos in the ecosystem.
    const card = scoreRole(
      ROLE_ARCHETYPES.backend,
      components([
        component({ id: 'express', kind: 'backend-api', paths: ['index.js', 'lib/**'] }),
        component({ id: 'test', kind: 'other', paths: ['test/**'] }),
      ]),
      ingestWith([
        { path: 'lib/express.js', sizeBytes: 1, lang: 'JavaScript', loc: 2_300 },
        { path: 'test/acceptance/auth.js', sizeBytes: 1, lang: 'JavaScript', loc: 13_500 },
      ]),
    );

    expect(card.rating).toBe('strong');
    expect(card.evidence.testLoc).toBe(13_500);
    expect(card.reason).not.toMatch(/no tests found/);
  });

  it("does not credit another role's tests to this one", () => {
    // A frontend app's suite must not make the backend look well tested.
    const card = scoreRole(
      ROLE_ARCHETYPES.backend,
      components([
        component({ id: 'api', kind: 'backend-api', paths: ['apps/api/**'] }),
        component({ id: 'web', kind: 'frontend-app', paths: ['apps/web/**'] }),
      ]),
      ingestWith([
        { path: 'apps/api/src/service.ts', sizeBytes: 1, lang: 'TypeScript', loc: 1_000 },
        { path: 'apps/web/test/App.spec.tsx', sizeBytes: 1, lang: 'TypeScript', loc: 5_000 },
      ]),
    );

    expect(card.evidence.testLoc).toBe(0);
    expect(card.reason).toMatch(/no tests found/);
  });

  it('counts tests that belong to no component at all', () => {
    const card = scoreRole(
      ROLE_ARCHETYPES.backend,
      components([component({ id: 'api', paths: ['src/**'] })]),
      ingestWith([
        { path: 'src/service.ts', sizeBytes: 1, lang: 'TypeScript', loc: 900 },
        { path: 'tests/test_service.py', sizeBytes: 1, lang: 'Python', loc: 400 },
      ]),
    );

    expect(card.evidence.testLoc).toBe(400);
  });

  it('adds nothing when the role has no lane to begin with', () => {
    const card = scoreRole(
      ROLE_ARCHETYPES.frontend,
      components([component({ id: 'api', kind: 'backend-api', paths: ['src/**'] })]),
      ingestWith([
        { path: 'src/service.ts', sizeBytes: 1, lang: 'TypeScript', loc: 900 },
        { path: 'test/service.spec.ts', sizeBytes: 1, lang: 'TypeScript', loc: 400 },
      ]),
    );

    expect(card.rating).toBe('none');
    expect(card.evidence.testLoc).toBe(0);
  });
});

describe('scoreRole and unassessable languages', () => {
  it('reports none for a large Rust backend, naming the language', () => {
    // The pnpm/pnpm case: real, substantial in-lane components Quarry cannot assess.
    const card = scoreRole(
      ROLE_ARCHETYPES.backend,
      components([component({ paths: ['crates/**'] })]),
      ingestWith([
        { path: 'crates/server/src/main.rs', sizeBytes: 1, lang: 'Rust', loc: 40_000 },
        { path: 'crates/server/src/lib.rs', sizeBytes: 1, lang: 'Rust', loc: 20_000 },
      ]),
    );

    expect(card.rating).toBe('none');
    expect(card.reason).toContain('Rust');
    expect(card.reason).toMatch(/does not assess/);
    expect(card.evidence.unassessableLoc).toBe(60_000);
  });

  it('still rates a mixed repo on its assessable half', () => {
    const card = scoreRole(
      ROLE_ARCHETYPES.backend,
      components([component({ paths: ['apps/**'] })]),
      ingestWith([
        { path: 'apps/api/src/service.ts', sizeBytes: 1, lang: 'TypeScript', loc: 3_000 },
        { path: 'apps/api/test/service.spec.ts', sizeBytes: 1, lang: 'TypeScript', loc: 900 },
        { path: 'apps/core/src/lib.rs', sizeBytes: 1, lang: 'Rust', loc: 50_000 },
      ]),
    );

    expect(card.rating).toBe('strong');
    expect(card.evidence.assessableLoc).toBe(3_900);
    expect(card.evidence.unassessableLoc).toBe(50_000);
  });
});

describe('fullstack needs both sides of the seam', () => {
  it('reports none when only a backend is present', () => {
    const card = scoreRole(
      ROLE_ARCHETYPES.fullstack,
      components([component({ kind: 'backend-api' })]),
      ingestWith(apiTree(4_000, 1_000)),
    );

    expect(card.rating).toBe('none');
    expect(card.reason).toMatch(/no frontend and backend pair/);
  });

  it('rates it when both sides exist', () => {
    const card = scoreRole(
      ROLE_ARCHETYPES.fullstack,
      components([
        component({ id: 'api', kind: 'backend-api', paths: ['apps/api/**'] }),
        component({ id: 'web', kind: 'frontend-app', paths: ['apps/web/**'] }),
      ]),
      ingestWith([
        ...apiTree(2_000, 600),
        { path: 'apps/web/src/App.tsx', sizeBytes: 1, lang: 'TypeScript', loc: 1_500 },
      ]),
    );

    expect(card.rating).not.toBe('none');
  });
});

describe('computeScore', () => {
  it('rewards tests more than raw size', () => {
    const bigNoTests = computeScore({
      assessableLoc: 5_000,
      testLoc: 0,
      componentCount: 1,
      docCount: 0,
    });
    const smallWellTested = computeScore({
      assessableLoc: 1_000,
      testLoc: 300,
      componentCount: 1,
      docCount: 0,
    });

    expect(smallWellTested).toBeGreaterThan(bigNoTests);
  });

  it('is monotonic in test coverage', () => {
    const base = { assessableLoc: 2_000, componentCount: 2, docCount: 1 };
    const none = computeScore({ ...base, testLoc: 0 });
    const some = computeScore({ ...base, testLoc: 150 });
    const lots = computeScore({ ...base, testLoc: 800 });

    expect(none).toBeLessThan(some);
    expect(some).toBeLessThan(lots);
  });

  it('never exceeds 100', () => {
    expect(
      computeScore({ assessableLoc: 500_000, testLoc: 400_000, componentCount: 20, docCount: 40 }),
    ).toBeLessThanOrEqual(100);
  });
});

describe('assertRoleSupported', () => {
  const roles = Roles.parse({
    schemaVersion: 1,
    runId: 'r',
    generatedAt: '2026-08-19T00:00:00.000Z',
    roles: [
      {
        role: 'backend',
        label: 'Backend',
        rating: 'strong',
        reason: 'x',
        evidence: {
          componentIds: ['api'],
          assessableLoc: 1,
          unassessableLoc: 0,
          testLoc: 0,
          fileCount: 1,
          docCount: 0,
          score: 80,
        },
      },
      ...(['frontend', 'fullstack', 'data'] as const).map((role) => ({
        role,
        label: role,
        rating: 'none' as const,
        reason: 'nothing in lane.',
        evidence: {
          componentIds: [],
          assessableLoc: 0,
          unassessableLoc: 0,
          testLoc: 0,
          fileCount: 0,
          docCount: 0,
          score: 0,
        },
      })),
    ],
  });

  it('returns the card for a supported role', () => {
    expect(assertRoleSupported(roles, 'backend').rating).toBe('strong');
  });

  it('throws for a none role, showing the reason and what is supported', () => {
    const error = (() => {
      try {
        assertRoleSupported(roles, 'frontend');
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(QuarryError);
    expect((error as QuarryError).stage).toBe('s3');
    expect((error as QuarryError).message).toContain('nothing in lane');
    expect((error as QuarryError).message).toContain('backend (strong)');
  });
});

describe('roleMenu artifact', () => {
  let workRoot: string;

  beforeEach(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-s3-'));
  });

  afterEach(async () => {
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  it('writes a roles.json with a card for every role', async () => {
    const run = await createRunDir({ workRoot, ref: 'x', runId: 'run' });

    const result = await roleMenu({
      run,
      ingest: ingestWith(apiTree(3_000, 900)),
      components: components([component()]),
      now: new Date('2026-08-19T00:00:00.000Z'),
    });

    const onDisk: unknown = JSON.parse(await fs.readFile(result.artifactPath, 'utf8'));
    expect(() => Roles.parse(onDisk)).not.toThrow();
    expect(result.roles.roles.map((card) => card.role)).toEqual([
      'backend',
      'frontend',
      'fullstack',
      'data',
    ]);
  });

  it('is deterministic — the same inputs give the same artifact', async () => {
    const run = await createRunDir({ workRoot, ref: 'x', runId: 'run' });
    const args = {
      run,
      ingest: ingestWith(apiTree(3_000, 900)),
      components: components([component()]),
      now: new Date('2026-08-19T00:00:00.000Z'),
    };

    const first = await roleMenu(args);
    const second = await roleMenu(args);

    expect(JSON.stringify(second.roles)).toBe(JSON.stringify(first.roles));
  });
});
