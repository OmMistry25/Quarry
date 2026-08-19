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
