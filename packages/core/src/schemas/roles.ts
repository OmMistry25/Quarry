import { z } from 'zod';

import { ROLE_IDS } from '../archetypes/roles.js';

/**
 * `roles.json` — the S3 artifact (docs/SPEC.md).
 *
 * Produced by a pure function over `components.json` and `ingest.json`; no agent is involved,
 * so this artifact is fully reproducible from its inputs.
 */

export const ROLES_SCHEMA_VERSION = 1;

export const RoleId = z.enum(ROLE_IDS);
export type RoleId = z.infer<typeof RoleId>;

export const RoleRating = z.enum(['strong', 'good', 'weak', 'none']);
export type RoleRating = z.infer<typeof RoleRating>;

/** The measurements the rating was derived from, so a surprising verdict is explainable. */
export const RoleEvidence = z.object({
  /** Component ids that are in-lane for this role. */
  componentIds: z.array(z.string()),
  /** Lines of code in in-lane components written in a language Quarry can assess. */
  assessableLoc: z.number().int().nonnegative(),
  /** Lines of code in in-lane components Quarry cannot generate an assessment for. */
  unassessableLoc: z.number().int().nonnegative(),
  testLoc: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  docCount: z.number().int().nonnegative(),
  /** 0–100, before bucketing into a rating. */
  score: z.number().int().min(0).max(100),
});
export type RoleEvidence = z.infer<typeof RoleEvidence>;

export const RoleCard = z.object({
  role: RoleId,
  label: z.string().min(1),
  rating: RoleRating,
  /** One line, shown on the card and in the CLI table. */
  reason: z.string().min(1),
  evidence: RoleEvidence,
});
export type RoleCard = z.infer<typeof RoleCard>;

export const Roles = z.object({
  schemaVersion: z.literal(ROLES_SCHEMA_VERSION),
  runId: z.string().min(1),
  generatedAt: z.string().datetime(),
  roles: z.array(RoleCard).length(ROLE_IDS.length),
});
export type Roles = z.infer<typeof Roles>;
