/**
 * Quarry core — public surface.
 *
 * Pipeline stages land in `src/stages/` (S1 ingest … S7 package) as they are built;
 * this barrel is what `cli` and `apps/web` are allowed to import.
 */

export const VERSION = '0.0.0';

export { STAGES, type Stage } from './types.js';
export { QuarryError } from './errors.js';

export { ingest, type IngestOptions, type IngestResult } from './stages/s1-ingest.js';
export {
  Ingest,
  INGEST_SCHEMA_VERSION,
  type IngestSource,
  type LanguageSummary,
  type ManifestEntry,
  type TreeEntry,
} from './schemas/ingest.js';
export { DEFAULT_MAX_REPO_BYTES, DEFAULT_MAX_FILE_BYTES } from './ingest/limits.js';

export {
  cartography,
  type CartographyOptions,
  type CartographyResult,
} from './stages/s2-cartography.js';
export {
  Components,
  COMPONENTS_SCHEMA_VERSION,
  type Component,
  type ComponentKind,
} from './schemas/components.js';
export { runAgent, type AgentAttempt, type AgentResult } from './agent/runAgent.js';
export type { AgentTransport, AgentInvocation, AgentReply } from './agent/claude.js';
export { DEFAULT_CONTEXT_BUDGET, type ContextBudget } from './agent/context.js';
export { createRunDir, type RunDir } from './run.js';
export { loadRun, findRun, listRuns, latestRun, type ResumedRun } from './resume.js';

export { roleMenu, scoreRole, computeScore, assertRoleSupported } from './stages/s3-roles.js';
export { Roles, ROLES_SCHEMA_VERSION, type RoleCard, type RoleRating } from './schemas/roles.js';
export {
  ROLE_ARCHETYPES,
  ROLE_IDS,
  roleArchetype,
  type RoleId,
  type RoleArchetype,
} from './archetypes/roles.js';

export {
  surfaceSelection,
  pickSurface,
  rankSurfaces,
  type SurfaceSelectionOptions,
  type SurfaceSelectionResult,
} from './stages/s4-surfaces.js';
export {
  Surfaces,
  SURFACES_SCHEMA_VERSION,
  surfaceTotal,
  type Surface,
  type SurfaceScores,
} from './schemas/surfaces.js';
export {
  DEFAULT_SURFACE_BUDGET,
  buildSurfaceContext,
  type SurfaceContextBudget,
} from './agent/surfaceContext.js';
export { generate, type GenerateOptions, type GenerateResult } from './stages/s5-generate.js';
export { repairPackage, type RepairOptions, type RepairResult } from './stages/s5-repair.js';
export { Meta, META_SCHEMA_VERSION, type VerificationResult } from './schemas/meta.js';
export {
  verify,
  type VerifyOptions,
  type VerifyReport,
  type VerifyStep,
} from './stages/s6-verify.js';
export { packageRun, zipName, type PackageResult } from './stages/s7-package.js';
export {
  generateVerifiedPackage,
  type GenerateVerifiedOptions,
  type GenerateVerifiedResult,
} from './stages/pipeline.js';
export { checkOverlap, isExemptFromOverlap, SHINGLE_LINES } from './verify/overlap.js';
export { scanForSecrets } from './verify/gitleaks.js';
export { checkBugDemonstrable } from './verify/bugDemo.js';
export { runCommand, scrubbedEnv, INSTALL_TIMEOUT_MS, TEST_TIMEOUT_MS } from './verify/sandbox.js';
export {
  TASK_ARCHETYPES,
  TASK_IDS,
  SENIORITY_ARCHETYPES,
  SENIORITY_IDS,
  taskForSeniority,
  resolveTask,
  type ResolvedTask,
  type TaskId,
  type SeniorityId,
} from './archetypes/tasks.js';
export {
  buildReferenceMaterial,
  DEFAULT_REFERENCE_BUDGET,
  type ReferenceBudget,
} from './agent/referenceMaterial.js';

export {
  componentMatcher,
  filesForComponent,
  isTestPath,
  isAssessableLanguage,
  assessableLanguages,
} from './components/match.js';
