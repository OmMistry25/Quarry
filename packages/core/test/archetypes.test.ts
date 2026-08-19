import { describe, expect, it } from 'vitest';

import { ROLE_ARCHETYPES, ROLE_IDS } from '../src/archetypes/roles.js';
import {
  SENIORITY_ARCHETYPES,
  SENIORITY_IDS,
  TASK_ARCHETYPES,
  TASK_IDS,
  taskForSeniority,
} from '../src/archetypes/tasks.js';

describe('role archetypes match the SPEC table', () => {
  it.each(ROLE_IDS)('%s has every field S5 needs', (id) => {
    const archetype = ROLE_ARCHETYPES[id];

    expect(archetype.inLaneKinds.length).toBeGreaterThan(0);
    expect(archetype.stubStrategy.length).toBeGreaterThan(20);
    expect(archetype.absentHint.length).toBeGreaterThan(0);
  });

  it.each(ROLE_IDS)('%s has 4–6 rubric dimensions, per SPEC', (id) => {
    const count = ROLE_ARCHETYPES[id].rubricDimensions.length;
    expect(count).toBeGreaterThanOrEqual(4);
    expect(count).toBeLessThanOrEqual(6);
  });

  it('gives backend the dimensions SPEC names', () => {
    expect([...ROLE_ARCHETYPES.backend.rubricDimensions]).toEqual([
      'API design',
      'Error handling',
      'Data modeling',
      'Test quality',
      'Code clarity',
    ]);
  });

  it('keeps every role free of external services in its stub strategy', () => {
    for (const id of ROLE_IDS) {
      const strategy = ROLE_ARCHETYPES[id].stubStrategy.toLowerCase();
      // Invariant 4: the candidate repo runs with one command and no external services.
      expect(strategy).toMatch(/sqlite|in-memory|fixture|msw|checked-in|sample/);
    }
  });
});

describe('task and seniority archetypes', () => {
  it('maps seniority to task exactly as SPEC describes', () => {
    expect(SENIORITY_ARCHETYPES.junior.task).toBe('bug-hunt');
    expect(SENIORITY_ARCHETYPES.mid.task).toBe('extension');
    expect(SENIORITY_ARCHETYPES.senior.task).toBe('extension');
  });

  it('asks only senior for a design note', () => {
    expect(SENIORITY_ARCHETYPES.junior.requiresDesignNote).toBe(false);
    expect(SENIORITY_ARCHETYPES.mid.requiresDesignNote).toBe(false);
    expect(SENIORITY_ARCHETYPES.senior.requiresDesignNote).toBe(true);
  });

  it('gives mid and senior extra scope, junior none', () => {
    expect(SENIORITY_ARCHETYPES.junior.extraScope).toBe('');
    expect(SENIORITY_ARCHETYPES.mid.extraScope).toMatch(/ambiguity/);
    expect(SENIORITY_ARCHETYPES.senior.extraScope).toMatch(/DESIGN\.md/);
  });

  it('requires bug demonstration only for a bug hunt', () => {
    expect(TASK_ARCHETYPES['bug-hunt'].requiresBugDemonstration).toBe(true);
    expect(TASK_ARCHETYPES.extension.requiresBugDemonstration).toBe(false);
  });

  it('resolves the task for a seniority', () => {
    expect(taskForSeniority('junior').id).toBe('bug-hunt');
    expect(taskForSeniority('senior').id).toBe('extension');
  });

  it('describes a bug-hunt brief as an incident report, not a ticket', () => {
    expect(TASK_ARCHETYPES['bug-hunt'].briefStyle).toMatch(/incident/i);
    // The brief must not hand over the cause.
    expect(TASK_ARCHETYPES['bug-hunt'].briefStyle).toMatch(/never names the file/i);
  });

  it('covers every declared id', () => {
    expect(Object.keys(TASK_ARCHETYPES).sort()).toEqual([...TASK_IDS].sort());
    expect(Object.keys(SENIORITY_ARCHETYPES).sort()).toEqual([...SENIORITY_IDS].sort());
  });
});

describe('bug-hunt planting guidance', () => {
  it('tells the generator to plant the bug last, after reading its own tests', () => {
    // Two of three express generations planted a bug their own shipped suite caught, which
    // S6 correctly rejects as "not a bug hunt". Stating the rule was not enough; the
    // generator needs the order of operations and a check it can perform.
    const guidance = TASK_ARCHETYPES['bug-hunt'].plantingGuidance ?? '';

    expect(guidance).toMatch(/Do this \*\*last\*\*/);
    expect(guidance).toMatch(/Re-read your own test files/);
    expect(guidance).toMatch(/none of those assertions cover/);
  });

  it('warns against thinning the test suite to make room for the bug', () => {
    const guidance = TASK_ARCHETYPES['bug-hunt'].plantingGuidance ?? '';
    expect(guidance).toMatch(/does not mean writing a thin suite/);
  });

  it('gives the extension no planting guidance, since nothing is planted', () => {
    expect(TASK_ARCHETYPES.extension.plantingGuidance).toBeUndefined();
  });
});
