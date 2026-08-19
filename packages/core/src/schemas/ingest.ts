import { z } from 'zod';

/**
 * `ingest.json` — the S1 artifact (docs/SPEC.md).
 *
 * This file is the first thing an agent ever sees, so it is metadata only: paths, sizes and
 * counts. File *contents* are read later, from the clone still sitting in the run directory,
 * by each stage's context builder. Two consequences worth keeping in mind:
 *
 *  - Anything excluded here is excluded from every downstream agent call. That is how
 *    CLAUDE.md invariant 2 ("no secrets in context") is actually enforced.
 *  - Secret-bearing files are absent entirely rather than listed — only a count survives, so
 *    a filename like `stripe-prod.key` never reaches a prompt.
 */

export const INGEST_SCHEMA_VERSION = 1;

export const SourceKind = z.enum(['url', 'local']);
export type SourceKind = z.infer<typeof SourceKind>;

export const ManifestKind = z.enum([
  'npm-package',
  'pnpm-workspace',
  'tsconfig',
  'python-pyproject',
  'python-requirements',
  'python-setup',
  'docker-compose',
  'dockerfile',
  'makefile',
  'ci-workflow',
  'other',
]);
export type ManifestKind = z.infer<typeof ManifestKind>;

/** Why a file was left out of the tree. Reported as counts, never as paths. */
export const ExclusionReason = z.enum([
  'secret',
  'binary',
  'vendored',
  'too-large',
  'git-internal',
]);
export type ExclusionReason = z.infer<typeof ExclusionReason>;

export const TreeEntry = z.object({
  /** Repo-relative, POSIX separators, no leading `./`. */
  path: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  /** Language attributed to this file, if recognised. */
  lang: z.string().min(1).optional(),
  /** Lines of code. Absent for files we deliberately never read (lockfiles). */
  loc: z.number().int().nonnegative().optional(),
});
export type TreeEntry = z.infer<typeof TreeEntry>;

export const ManifestEntry = z.object({
  path: z.string().min(1),
  kind: ManifestKind,
  sizeBytes: z.number().int().nonnegative(),
});
export type ManifestEntry = z.infer<typeof ManifestEntry>;

export const LanguageSummary = z.object({
  name: z.string().min(1),
  loc: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  /** Fraction of total counted LOC, 0–1, rounded to 4 dp. */
  share: z.number().min(0).max(1),
});
export type LanguageSummary = z.infer<typeof LanguageSummary>;

export const IngestSource = z.object({
  kind: SourceKind,
  /** Exactly what the user passed: a URL or a path. */
  ref: z.string().min(1),
  /** Resolved commit SHA. Absent for a local directory that is not a git repo. */
  commit: z.string().min(7).optional(),
  /** Branch or tag the clone landed on, when git reports one. */
  branch: z.string().min(1).optional(),
});
export type IngestSource = z.infer<typeof IngestSource>;

export const Ingest = z.object({
  schemaVersion: z.literal(INGEST_SCHEMA_VERSION),
  runId: z.string().min(1),
  generatedAt: z.string().datetime(),
  source: IngestSource,

  repo: z.object({
    /** Directory name of the clone — the closest thing to a repo name we have offline. */
    name: z.string().min(1),
    /** Total size of *included* files. Excluded files do not count toward this. */
    sizeBytes: z.number().int().nonnegative(),
    fileCount: z.number().int().nonnegative(),
  }),

  tree: z.array(TreeEntry),
  manifests: z.array(ManifestEntry),
  /** READMEs, `docs/**`, and other prose — the highest-signal context for S2. */
  docs: z.array(TreeEntry),
  /** Sorted by LOC, descending. */
  languages: z.array(LanguageSummary),

  /** Counts only. Paths are withheld on purpose; see the note at the top of this file. */
  excluded: z.record(ExclusionReason, z.number().int().nonnegative()),
});
export type Ingest = z.infer<typeof Ingest>;
