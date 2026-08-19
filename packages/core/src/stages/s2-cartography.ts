import fs from 'node:fs/promises';
import path from 'node:path';

import type { AgentTransport } from '../agent/claude.js';
import { buildRepoContext, DEFAULT_CONTEXT_BUDGET, type ContextBudget } from '../agent/context.js';
import { renderPrompt } from '../agent/prompts.js';
import { runAgent, type AgentAttempt } from '../agent/runAgent.js';
import { QuarryError } from '../errors.js';
import { Ingest } from '../schemas/ingest.js';
import { CartographyReply, Components, COMPONENTS_SCHEMA_VERSION } from '../schemas/components.js';
import { writeArtifact, type RunDir } from '../run.js';

export interface CartographyOptions {
  run: RunDir;
  /** Defaults to reading `ingest.json` from the run directory. */
  ingest?: Ingest;
  budget?: ContextBudget;
  model?: string | undefined;
  transport?: AgentTransport;
  retries?: number;
  now?: Date;
  onAttempt?: (attempt: AgentAttempt) => void;
}

export interface CartographyResult {
  components: Components;
  artifactPath: string;
  /** The rendered prompt, kept so a surprising result can be explained. */
  prompt: string;
}

/**
 * S2 — Cartography (docs/SPEC.md).
 *
 * One agent pass over curated context — the directory map plus manifest and doc contents,
 * never the raw repo — producing `components.json`.
 */
export async function cartography(options: CartographyOptions): Promise<CartographyResult> {
  const ingest = options.ingest ?? (await readIngest(options.run));

  const context = await buildRepoContext(
    ingest,
    options.run.repoDir,
    options.budget ?? DEFAULT_CONTEXT_BUDGET,
  );

  const prompt = await renderPrompt('s2-cartography.md', { CONTEXT: context.text });

  const result = await runAgent({
    stage: 's2',
    prompt,
    schema: CartographyReply,
    ...(options.retries === undefined ? {} : { retries: options.retries }),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.transport === undefined ? {} : { transport: options.transport }),
    ...(options.onAttempt === undefined ? {} : { onAttempt: options.onAttempt }),
  });

  const artifact: Components = {
    schemaVersion: COMPONENTS_SCHEMA_VERSION,
    runId: options.run.runId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    components: result.data.components,
    agent: {
      attempts: result.attempts,
      ...(result.costUsd === undefined ? {} : { costUsd: result.costUsd }),
      ...(options.model === undefined ? {} : { model: options.model }),
    },
  };

  const parsed = Components.parse(artifact);
  const artifactPath = await writeArtifact(options.run, 'components.json', parsed);

  return { components: parsed, artifactPath, prompt };
}

async function readIngest(run: RunDir): Promise<Ingest> {
  const file = path.join(run.dir, 'ingest.json');

  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    throw new QuarryError(
      `No ingest.json in ${run.dir}. Cartography reads S1's artifact — run ingest first.`,
      { stage: 's2', cause: error },
    );
  }

  const parsed = Ingest.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new QuarryError(`The ingest.json in ${run.dir} does not match the current schema.`, {
      stage: 's2',
    });
  }

  return parsed.data;
}
