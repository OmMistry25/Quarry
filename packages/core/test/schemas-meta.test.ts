import { describe, expect, it } from 'vitest';

import { GenerationReply, Meta, META_SCHEMA_VERSION } from '../src/schemas/meta.js';

function meta(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: META_SCHEMA_VERSION,
    runId: 'run',
    role: 'backend',
    seniority: 'junior',
    task: 'bug-hunt',
    source: {
      ref: '/src/repo',
      surfaceId: 'stock-adjustment',
      surfaceTitle: 'Stock adjustment',
      componentId: 'api',
    },
    generation: {
      startedAt: '2026-08-19T16:45:00.000Z',
      finishedAt: '2026-08-19T16:52:00.000Z',
      attempts: 1,
      costUsd: 1.6,
      referenceFiles: ['src/services/inventory.ts'],
      setupCommand: 'npm install',
      testCommand: 'npm test',
    },
    ...overrides,
  };
}

describe('Meta schema', () => {
  it('accepts a package that has not been verified yet', () => {
    // S5 writes meta.json before S6 runs; S7 is what refuses to ship an unverified package.
    expect(() => Meta.parse(meta())).not.toThrow();
  });

  it('accepts a verification block', () => {
    const withVerification = meta({
      verification: {
        passed: true,
        installOk: true,
        testsOk: true,
        bugDemonstrated: true,
        secretsScanOk: true,
        overlapOk: true,
        ranAt: '2026-08-19T17:00:00.000Z',
        notes: [],
      },
    });

    expect(() => Meta.parse(withVerification)).not.toThrow();
  });

  /**
   * The first live repair packaged a run whose meta.json said one clean generation, because
   * the loop updated the commands a repair had corrected but not the fact that it ran.
   */
  it('defaults repairs to zero, so a clean run says so rather than saying nothing', () => {
    expect(Meta.parse(meta()).generation.repairs).toBe(0);
  });

  it('records repair rounds when there were some', () => {
    const repaired = meta({
      generation: {
        startedAt: '2026-08-19T16:45:00.000Z',
        finishedAt: '2026-08-19T16:52:00.000Z',
        attempts: 1,
        repairs: 1,
        costUsd: 3.9,
        referenceFiles: ['src/services/inventory.ts'],
        setupCommand: 'npm install',
        testCommand: 'npm test',
      },
    });

    expect(Meta.parse(repaired).generation.repairs).toBe(1);
  });

  it('rejects a negative repair count', () => {
    const negative = meta({
      generation: {
        startedAt: '2026-08-19T16:45:00.000Z',
        finishedAt: '2026-08-19T16:52:00.000Z',
        attempts: 1,
        repairs: -1,
        referenceFiles: [],
        setupCommand: 'npm install',
        testCommand: 'npm test',
      },
    });

    expect(() => Meta.parse(negative)).toThrow();
  });

  it('requires both commands, since one-command setup is an invariant', () => {
    const generation = { ...(meta() as { generation: Record<string, unknown> }).generation };
    generation.setupCommand = '';

    expect(() => Meta.parse(meta({ generation }))).toThrow();
  });

  it('rejects a role or seniority outside the archetypes', () => {
    expect(() => Meta.parse(meta({ role: 'devops' }))).toThrow();
    expect(() => Meta.parse(meta({ seniority: 'staff' }))).toThrow();
  });

  it('keeps the reference file list, which is the audit trail for invariant 1', () => {
    const parsed = Meta.parse(meta());
    expect(parsed.generation.referenceFiles).toContain('src/services/inventory.ts');
  });
});

describe('GenerationReply', () => {
  it('accepts a well-formed reply', () => {
    expect(() =>
      GenerationReply.parse({
        files: ['candidate/README.md'],
        setupCommand: 'npm install',
        testCommand: 'npm test',
        plantedBugFile: 'candidate/src/x.ts',
      }),
    ).not.toThrow();
  });

  it('rejects a reply that wrote nothing', () => {
    expect(() =>
      GenerationReply.parse({ files: [], setupCommand: 'a', testCommand: 'b' }),
    ).toThrow();
  });

  it('requires the commands S6 will run', () => {
    expect(() => GenerationReply.parse({ files: ['a'], testCommand: 'b' })).toThrow();
  });
});
