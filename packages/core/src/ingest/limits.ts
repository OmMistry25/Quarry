/** Default repo size cap: 200 MB, per docs/mvp.md. Configurable via `--max-size-mb`. */
export const DEFAULT_MAX_REPO_BYTES = 200 * 1_000_000;

/**
 * Per-file ceiling. Files above this are recorded as `too-large` rather than read — a 3 MB
 * generated client or a checked-in dataset would otherwise dominate both the walk and every
 * downstream token budget while teaching an agent nothing.
 */
export const DEFAULT_MAX_FILE_BYTES = 512 * 1_000;
