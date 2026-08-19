import path from 'node:path';

import { Command } from 'commander';
import { ingest, type Ingest } from 'core';

import { parsePositiveNumber } from './pipeline.js';

export function ingestCommand(): Command {
  return new Command('ingest')
    .description('Clone or copy a repo and write ingest.json (pipeline stage S1)')
    .argument('<repo>', 'GitHub repo URL, or a path to a local directory')
    .option('--work-dir <dir>', 'root for run directories', 'work')
    .option('--max-size-mb <mb>', 'repository size cap', parsePositiveNumber, 200)
    .option('--json', 'print the artifact as JSON instead of a summary', false)
    .action(async (repo: string, options: IngestCommandOptions) => {
      const result = await ingest({
        ref: repo,
        workRoot: path.resolve(options.workDir),
        maxTotalBytes: options.maxSizeMb * 1_000_000,
        githubToken: process.env.GITHUB_TOKEN,
      });

      if (options.json) {
        console.log(JSON.stringify(result.ingest, null, 2));
        return;
      }

      printSummary(result.ingest, result.artifactPath);
    });
}

interface IngestCommandOptions {
  workDir: string;
  maxSizeMb: number;
  json: boolean;
}

export function formatSummary(artifact: Ingest): string {
  const lines: string[] = [];

  const where =
    artifact.source.commit === undefined
      ? artifact.source.ref
      : `${artifact.source.ref} @ ${artifact.source.commit.slice(0, 7)}`;

  lines.push(`${artifact.repo.name}  ${where}`);
  lines.push(
    `${artifact.repo.fileCount} files · ${formatBytes(artifact.repo.sizeBytes)} · ` +
      `${artifact.manifests.length} manifests · ${artifact.docs.length} docs`,
  );

  const languages = artifact.languages
    .filter((language) => language.share > 0)
    .slice(0, 5)
    .map((language) => `${language.name} ${Math.round(language.share * 100)}%`);

  if (languages.length > 0) {
    lines.push(`Languages: ${languages.join(', ')}`);
  }

  // Surfacing the secret count is the point: it is the visible evidence that CLAUDE.md
  // invariant 2 ran, rather than a silent no-op.
  const excluded = Object.entries(artifact.excluded)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${count} ${reason}`);

  lines.push(`Excluded: ${excluded.length > 0 ? excluded.join(', ') : 'nothing'}`);

  return lines.join('\n');
}

function printSummary(artifact: Ingest, artifactPath: string): void {
  console.log(formatSummary(artifact));
  console.log(`\nWrote ${artifactPath}`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
