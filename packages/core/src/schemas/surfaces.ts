import { z } from 'zod';

import { RoleId } from './roles.js';

/**
 * `surfaces.json` — the S4 artifact (docs/SPEC.md).
 *
 * A surface is a self-contained workflow inside a component that is suitable for assessment:
 * an API route with its service and tests, a sync job, a data transform. S5 generates from
 * exactly one of these, so the scores here decide what the candidate actually gets asked.
 */

export const SURFACES_SCHEMA_VERSION = 1;

/** The three criteria SPEC names, each 0–1. */
export const SurfaceScores = z.object({
  /** Few cross-component dependencies — how cleanly it can be lifted out. */
  isolation: z.number().min(0).max(1),
  /** Looks like the daily work of someone in this role. */
  representativeness: z.number().min(0).max(1),
  /** Enough behaviour to hide a bug in or extend. */
  richness: z.number().min(0).max(1),
});
export type SurfaceScores = z.infer<typeof SurfaceScores>;

export const Surface = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'must be a lowercase slug'),
  title: z.string().min(1),
  /** The component this surface lives in. Checked against components.json. */
  componentId: z.string().min(1),
  /**
   * The other side of the seam, for a role assessed on a vertical slice.
   *
   * A surface is normally one workflow inside one component, which is why `componentId` is
   * singular. Fullstack is the exception its definition demands: "assessed on a vertical
   * slice across the seam" cannot be expressed by a surface that names one component, and a
   * fullstack run that could only name one produced a package with no frontend in it.
   */
  seamComponentId: z.string().min(1).optional(),
  /** Repo-relative paths that make up the surface. */
  paths: z.array(z.string().min(1)).min(1),
  /** What the workflow does, in a couple of sentences. */
  summary: z.string().min(1),
  scores: SurfaceScores,
  /** Why this scored the way it did — the reviewer-facing justification. */
  rationale: z.string().min(1),
  /** A concrete behaviour a bug could be planted in, or an extension could build on. */
  assessmentIdea: z.string().min(1),
});
export type Surface = z.infer<typeof Surface>;

/** SPEC: "Identify 3–5 candidate surfaces". */
export const SurfacesReply = z
  .object({
    surfaces: z.array(Surface).min(3).max(5),
  })
  .superRefine((reply, ctx) => {
    const ids = new Set<string>();
    for (const [index, surface] of reply.surfaces.entries()) {
      if (ids.has(surface.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['surfaces', index, 'id'],
          message: `duplicate surface id "${surface.id}"`,
        });
      }
      ids.add(surface.id);
    }
  });
export type SurfacesReply = z.infer<typeof SurfacesReply>;

export const Surfaces = z.object({
  schemaVersion: z.literal(SURFACES_SCHEMA_VERSION),
  runId: z.string().min(1),
  generatedAt: z.string().datetime(),
  role: RoleId,
  /** Ranked best first, by `total`. */
  surfaces: z
    .array(Surface.extend({ total: z.number().min(0).max(1) }))
    .min(3)
    .max(5),
  agent: z.object({
    attempts: z.number().int().positive(),
    costUsd: z.number().nonnegative().optional(),
    model: z.string().min(1).optional(),
  }),
});
export type Surfaces = z.infer<typeof Surfaces>;

/**
 * Weighted total used to rank surfaces and to resolve `--auto`.
 *
 * Isolation is weighted highest deliberately: a surface that cannot be lifted out of the
 * repo without dragging three other components with it fails the one-command-setup
 * invariant no matter how interesting it is.
 */
export function surfaceTotal(scores: SurfaceScores): number {
  const weighted =
    scores.isolation * 0.4 + scores.representativeness * 0.35 + scores.richness * 0.25;
  return Math.round(weighted * 1_000) / 1_000;
}
