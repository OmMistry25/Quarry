import path from 'node:path';

import { Command, InvalidArgumentError } from 'commander';
import { cartography, ingest, type Components } from 'core';

export function mapCommand(): Command {
  return new Command('map')
    .description('Ingest a repo and partition it into components.json (stages S1 → S2)')
    .argument('<repo>', 'GitHub repo URL, or a path to a local directory')
    .option('--work-dir <dir>', 'root for run directories', 'work')
    .option('--max-size-mb <mb>', 'repository size cap', parsePositiveNumber, 200)
    .option('--model <model>', 'model for the agent call (defaults to the CLI default)')
    .option('--json', 'print components.json instead of a summary', false)
    .action(async (repo: string, options: MapCommandOptions) => {
      const ingested = await ingest({
        ref: repo,
        workRoot: path.resolve(options.workDir),
        maxTotalBytes: options.maxSizeMb * 1_000_000,
        githubToken: process.env.GITHUB_TOKEN,
      });

      if (!options.json) {
        console.error(
          `S1  ${ingested.ingest.repo.fileCount} files, ` +
            `${ingested.ingest.manifests.length} manifests, ` +
            `${ingested.ingest.docs.length} docs`,
        );
        console.error('S2  mapping components…');
      }

      const mapped = await cartography({
        run: ingested.run,
        ingest: ingested.ingest,
        ...(options.model === undefined ? {} : { model: options.model }),
        onAttempt: (attempt) => {
          if (options.json || attempt.outcome === 'ok') return;
          // A retry is worth surfacing: it usually means the prompt needs work.
          console.error(`    attempt ${attempt.attempt} rejected (${attempt.outcome})`);
        },
      });

      if (options.json) {
        console.log(JSON.stringify(mapped.components, null, 2));
        return;
      }

      console.log(`\n${formatComponents(mapped.components)}`);
      console.log(`\nWrote ${mapped.artifactPath}`);
    });
}

interface MapCommandOptions {
  workDir: string;
  maxSizeMb: number;
  model?: string;
  json: boolean;
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('must be a positive number');
  }
  return parsed;
}

export function formatComponents(artifact: Components): string {
  const lines = artifact.components.map((component) => {
    const dependsOn =
      component.depends_on.length > 0 ? `  → ${component.depends_on.join(', ')}` : '';

    return (
      `${component.id.padEnd(18)} ${component.kind.padEnd(14)} ` +
      `${String(Math.round(component.confidence * 100)).padStart(3)}%  ` +
      `${component.paths.join(' ')}${dependsOn}\n` +
      `${' '.repeat(18)} ${component.stack.join(', ') || '—'}\n` +
      `${' '.repeat(18)} ${component.notes}`
    );
  });

  const cost =
    artifact.agent.costUsd === undefined ? '' : ` · $${artifact.agent.costUsd.toFixed(3)}`;

  return (
    `${artifact.components.length} component(s) · ${artifact.agent.attempts} attempt(s)${cost}\n\n` +
    lines.join('\n\n')
  );
}
