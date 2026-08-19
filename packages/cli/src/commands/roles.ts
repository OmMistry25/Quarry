import { Command } from 'commander';

import { formatRoles, mapRepo, parsePositiveNumber, type SharedOptions } from './pipeline.js';

export function rolesCommand(): Command {
  return new Command('roles')
    .description('Show which roles this repo can be assessed for (stages S1 → S3)')
    .argument('<repo>', 'GitHub repo URL, or a path to a local directory')
    .option('--work-dir <dir>', 'root for run directories', 'work')
    .option('--max-size-mb <mb>', 'repository size cap', parsePositiveNumber, 200)
    .option('--model <model>', 'model for the agent call (defaults to the CLI default)')
    .option('--json', 'print roles.json instead of a table', false)
    .action(async (repo: string, options: SharedOptions) => {
      const mapped = await mapRepo(repo, options);

      if (options.json) {
        console.log(JSON.stringify(mapped.roles, null, 2));
        return;
      }

      console.log(`\n${formatRoles(mapped.roles)}`);
      console.log(`\nWrote ${mapped.run.dir}/roles.json`);
    });
}
