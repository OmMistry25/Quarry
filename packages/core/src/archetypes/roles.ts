import type { ComponentKind } from '../schemas/components.js';

/**
 * Role archetypes — the lens that decides which components matter, what gets stubbed, and
 * what the rubric measures (docs/SPEC.md, "Role archetype table").
 */
export interface RoleArchetype {
  id: RoleId;
  label: string;
  /** Component kinds this role is assessed on. */
  inLaneKinds: readonly ComponentKind[];
  /** Shown on a role card when the repo cannot support this role at all. */
  absentHint: string;
  /**
   * How out-of-lane dependencies are replaced so the candidate repo runs standalone. Goes
   * into the S5 prompt verbatim, and is the mechanism behind CLAUDE.md invariant 4.
   */
  stubStrategy: string;
  /** Rubric dimensions, 4–6 of them, from the SPEC table. S5 writes one section per entry. */
  rubricDimensions: readonly string[];
}

export const ROLE_IDS = ['backend', 'frontend', 'fullstack', 'data'] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export const ROLE_ARCHETYPES: Readonly<Record<RoleId, RoleArchetype>> = {
  backend: {
    id: 'backend',
    label: 'Backend',
    inLaneKinds: ['backend-api', 'worker', 'shared-lib'],
    absentHint: 'no API, worker or shared library components',
    stubStrategy:
      'No frontend of any kind. Persistence is SQLite or in-memory — never Postgres, MySQL, ' +
      'Redis or any service that has to be started separately. Outbound HTTP calls become ' +
      'checked-in fixture responses. Tests run through an in-process HTTP harness against ' +
      'the app object, not a listening port.',
    rubricDimensions: [
      'API design',
      'Error handling',
      'Data modeling',
      'Test quality',
      'Code clarity',
    ],
  },
  frontend: {
    id: 'frontend',
    label: 'Frontend',
    inLaneKinds: ['frontend-app'],
    absentHint: 'no frontend application components',
    stubStrategy:
      'The backend becomes MSW handlers or checked-in fixture JSON. No real API calls, no ' +
      "dev server dependency beyond the framework's own.",
    rubricDimensions: [
      'Component design',
      'State management',
      'Edge-case UX',
      'Accessibility basics',
      'Test quality',
    ],
  },
  /**
   * Fullstack is assessed on a vertical slice across the seam, so it needs *both* sides
   * present — a repo with only an API supports backend, not fullstack.
   */
  fullstack: {
    id: 'fullstack',
    label: 'Fullstack',
    inLaneKinds: ['frontend-app', 'backend-api', 'shared-lib'],
    absentHint: 'no frontend and backend pair to slice across',
    stubStrategy:
      'Keep both sides of one vertical slice real. Only genuinely external services are ' +
      'stubbed; persistence is SQLite or in-memory.',
    rubricDimensions: [
      'Seam design',
      'End-to-end correctness',
      'API contract quality',
      'Test quality',
    ],
  },
  data: {
    id: 'data',
    label: 'Data',
    inLaneKinds: ['data-pipeline', 'worker'],
    absentHint: 'no data pipeline or worker components',
    stubStrategy:
      'Sources become small checked-in sample datasets (CSV or JSON) committed to the repo. ' +
      'No warehouse, no object store, no network reads.',
    rubricDimensions: [
      'Transform correctness',
      'Idempotency',
      'Data validation',
      'Performance awareness',
      'Test quality',
    ],
  },
};

export function roleArchetype(id: RoleId): RoleArchetype {
  return ROLE_ARCHETYPES[id];
}
