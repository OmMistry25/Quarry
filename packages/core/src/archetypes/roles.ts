import type { ComponentKind } from '../schemas/components.js';

/**
 * Role archetypes — the lens that decides which components matter (docs/SPEC.md, "Role
 * archetype table").
 *
 * Only the in-lane component kinds are defined here, because that is all S3 and S4 need.
 * The stub strategy and rubric dimensions from the same SPEC table land in Phase 4 with S5,
 * which is the first stage that has any use for them.
 */
export interface RoleArchetype {
  id: RoleId;
  label: string;
  /** Component kinds this role is assessed on. */
  inLaneKinds: readonly ComponentKind[];
  /** Shown on a role card when the repo cannot support this role at all. */
  absentHint: string;
}

export const ROLE_IDS = ['backend', 'frontend', 'fullstack', 'data'] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export const ROLE_ARCHETYPES: Readonly<Record<RoleId, RoleArchetype>> = {
  backend: {
    id: 'backend',
    label: 'Backend',
    inLaneKinds: ['backend-api', 'worker', 'shared-lib'],
    absentHint: 'no API, worker or shared library components',
  },
  frontend: {
    id: 'frontend',
    label: 'Frontend',
    inLaneKinds: ['frontend-app'],
    absentHint: 'no frontend application components',
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
  },
  data: {
    id: 'data',
    label: 'Data',
    inLaneKinds: ['data-pipeline', 'worker'],
    absentHint: 'no data pipeline or worker components',
  },
};

export function roleArchetype(id: RoleId): RoleArchetype {
  return ROLE_ARCHETYPES[id];
}
