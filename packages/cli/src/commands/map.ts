import { Command } from 'commander';
import { type Components } from 'core';

import { mapRepo, parsePositiveNumber, type SharedOptions } from './pipeline.js';

export function mapCommand(): Command {
  return new Command('map')
    .description('Ingest a repo and partition it into components.json (stages S1 → S2)')
    .argument('<repo>', 'GitHub repo URL, or a path to a local directory')
    .option('--work-dir <dir>', 'root for run directories', 'work')
    .option(
      '--resume <runId>',
      'reuse an existing run\'s artifacts instead of starting over ("latest" for the most recent)',
    )
    .option('--max-size-mb <mb>', 'repository size cap', parsePositiveNumber, 200)
    .option('--model <model>', 'model for the agent call (defaults to the CLI default)')
    .option('--json', 'print components.json instead of a summary', false)
    .action(async (repo: string, options: SharedOptions) => {
      const mapped = await mapRepo(repo, options);

      if (options.json) {
        console.log(JSON.stringify(mapped.components, null, 2));
        return;
      }

      console.log(`\n${formatComponents(mapped.components)}`);
      console.log(`\nWrote ${mapped.run.dir}/components.json`);
    });
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
