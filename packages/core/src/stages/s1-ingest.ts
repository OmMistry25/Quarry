import path from 'node:path';

import { detectManifestKind, isDocPath } from '../ingest/manifests.js';
import { DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_REPO_BYTES } from '../ingest/limits.js';
import { prepareSource } from '../ingest/source.js';
import { summariseLanguages } from '../ingest/languages.js';
import { walkRepo } from '../ingest/walk.js';
import { Ingest, INGEST_SCHEMA_VERSION } from '../schemas/ingest.js';
import { createRunDir, writeArtifact, type RunDir } from '../run.js';
import { QuarryError } from '../errors.js';

export interface IngestOptions {
  /** Repo URL or local directory path. */
  ref: string;
  /** Root for run directories — `work/` by default. */
  workRoot: string;
  maxTotalBytes?: number;
  maxFileBytes?: number;
  githubToken?: string | undefined;
  /** Injectable for deterministic tests. */
  now?: Date;
  runId?: string;
}

export interface IngestResult {
  run: RunDir;
  ingest: Ingest;
  /** Absolute path to the written `ingest.json`. */
  artifactPath: string;
}

/**
 * S1 — Ingest (docs/SPEC.md).
 *
 * Gets the repo onto disk, walks it into a tree of paths and sizes, and writes
 * `ingest.json`. Nothing here calls an agent; this stage exists to decide, once, what an
 * agent is ever allowed to see. Secret-bearing files are dropped during the walk, so they
 * are absent from the artifact rather than filtered out of prompts later.
 */
export async function ingest(options: IngestOptions): Promise<IngestResult> {
  const run = await createRunDir({
    workRoot: options.workRoot,
    ref: options.ref,
    ...(options.now ? { now: options.now } : {}),
    ...(options.runId ? { runId: options.runId } : {}),
  });

  const source = await prepareSource(options.ref, {
    repoDir: run.repoDir,
    githubToken: options.githubToken,
  });

  const walk = await walkRepo(run.repoDir, {
    maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_REPO_BYTES,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
  });

  if (walk.entries.length === 0) {
    throw new QuarryError(
      `No readable source files found in ${options.ref}. An empty repository, or one made ` +
        'entirely of binaries and vendored code, has nothing to build an assessment from.',
      { stage: 's1' },
    );
  }

  const manifests = walk.entries.flatMap((entry) => {
    const kind = detectManifestKind(entry.path);
    return kind ? [{ path: entry.path, kind, sizeBytes: entry.sizeBytes }] : [];
  });

  const artifact: Ingest = {
    schemaVersion: INGEST_SCHEMA_VERSION,
    runId: run.runId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    source,
    repo: {
      name: path.basename(source.kind === 'local' ? source.ref : source.ref.replace(/\.git$/, '')),
      sizeBytes: walk.totalBytes,
      fileCount: walk.entries.length,
    },
    tree: walk.entries,
    manifests,
    docs: walk.entries.filter((entry) => isDocPath(entry.path)),
    languages: summariseLanguages(walk.entries),
    excluded: walk.excluded,
  };

  // Parse our own output too: the schema is the contract every later stage codes against,
  // and a drifting producer is as damaging as a drifting agent.
  const parsed = Ingest.parse(artifact);
  const artifactPath = await writeArtifact(run, 'ingest.json', parsed);

  return { run, ingest: parsed, artifactPath };
}
