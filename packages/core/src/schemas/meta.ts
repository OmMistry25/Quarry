import { z } from 'zod';

import { SENIORITY_IDS, TASK_IDS } from '../archetypes/tasks.js';
import { RoleId } from './roles.js';

/**
 * `package/meta.json` — what the package is and how it came to be (docs/SPEC.md S5).
 *
 * The verification block is filled in by S6. It is optional here because S5 writes meta.json
 * before verification has run — but S7 refuses to package anything whose `verification` is
 * absent or failing (CLAUDE.md invariant 3).
 */

export const META_SCHEMA_VERSION = 1;

export const TaskId = z.enum(TASK_IDS);
export const SeniorityId = z.enum(SENIORITY_IDS);

export const VerificationResult = z.object({
  passed: z.boolean(),
  installOk: z.boolean(),
  testsOk: z.boolean(),
  bugDemonstrated: z.boolean().optional(),
  secretsScanOk: z.boolean(),
  overlapOk: z.boolean(),
  ranAt: z.string().datetime(),
  notes: z.array(z.string()).default([]),
});
export type VerificationResult = z.infer<typeof VerificationResult>;

export const Meta = z.object({
  schemaVersion: z.literal(META_SCHEMA_VERSION),
  runId: z.string().min(1),
  role: RoleId,
  seniority: SeniorityId,
  task: TaskId,

  source: z.object({
    /** What the user pointed Quarry at. Never a token-bearing URL. */
    ref: z.string().min(1),
    commit: z.string().optional(),
    /** The surface S4 chose, so a package can be traced back to its origin. */
    surfaceId: z.string().min(1),
    surfaceTitle: z.string().min(1),
    componentId: z.string().min(1),
  }),

  generation: z.object({
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    attempts: z.number().int().positive(),
    costUsd: z.number().nonnegative().optional(),
    model: z.string().optional(),
    /** Source files the generator was allowed to read, for auditing invariant 1. */
    referenceFiles: z.array(z.string()),
    /** One command, per CLAUDE.md invariant 4. */
    setupCommand: z.string().min(1),
    testCommand: z.string().min(1),
  }),

  verification: VerificationResult.optional(),
});
export type Meta = z.infer<typeof Meta>;

/**
 * What the generator itself returns. Kept separate from the stored artifact: the agent
 * reports what it wrote and how to run it, and Quarry supplies everything else.
 */
export const GenerationReply = z.object({
  /** Every file written, repo-relative to `package/`. */
  files: z.array(z.string().min(1)).min(1),
  setupCommand: z.string().min(1),
  testCommand: z.string().min(1),
  /** One line naming the planted bug's file, for the answer key cross-check. */
  plantedBugFile: z.string().min(1).optional(),
  /**
   * The corrected files under `interviewer/fix/`. S6 overlays these onto a copy of
   * `candidate/` to prove the planted bug is demonstrable, so the fix has to exist as code
   * and not only as prose in the answer key.
   */
  fixFiles: z.array(z.string().min(1)).optional(),
  notes: z.string().optional(),
});
export type GenerationReply = z.infer<typeof GenerationReply>;
