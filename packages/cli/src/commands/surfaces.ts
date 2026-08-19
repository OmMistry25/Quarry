import { Command, InvalidArgumentError } from 'commander';
import {
  assertRoleSupported,
  pickSurface,
  surfaceSelection,
  ROLE_IDS,
  type RoleId,
  type Surfaces,
} from 'core';

import {
  formatRoles,
  indentDetail,
  mapRepo,
  parsePositiveNumber,
  type SharedOptions,
} from './pipeline.js';

interface SurfacesOptions extends SharedOptions {
  role: RoleId;
  auto: boolean;
}

export function surfacesCommand(): Command {
  return new Command('surfaces')
    .description('List assessable surfaces for a role (stages S1 → S4)')
    .argument('<repo>', 'GitHub repo URL, or a path to a local directory')
    .requiredOption('--role <role>', `one of: ${ROLE_IDS.join(', ')}`, parseRole)
    .option('--auto', 'also print which surface --auto would choose', false)
    .option('--work-dir <dir>', 'root for run directories', 'work')
    .option('--max-size-mb <mb>', 'repository size cap', parsePositiveNumber, 200)
    .option('--model <model>', 'model for the agent call (defaults to the CLI default)')
    .option('--json', 'print surfaces.json instead of a table', false)
    .action(async (repo: string, options: SurfacesOptions) => {
      const mapped = await mapRepo(repo, options);

      if (!options.json) console.error(`\n${formatRoles(mapped.roles)}\n`);

      // SPEC: requesting a `none` role is a hard error with the reason shown.
      assertRoleSupported(mapped.roles, options.role);

      if (!options.json) console.error('S4  selecting surfaces…');

      const selected = await surfaceSelection({
        run: mapped.run,
        ingest: mapped.ingest,
        components: mapped.components,
        role: options.role,
        ...(options.model === undefined ? {} : { model: options.model }),
        onAttempt: (attempt) => {
          if (options.json || attempt.outcome === 'ok') return;
          console.error(
            `    attempt ${attempt.attempt} rejected (${attempt.outcome})` +
              (attempt.detail === undefined ? '' : `\n${indentDetail(attempt.detail)}`),
          );
        },
      });

      if (options.json) {
        console.log(JSON.stringify(selected.surfaces, null, 2));
        return;
      }

      // Resolve --auto through the same function S5 will call, rather than assuming the
      // top of the printed list is what the pipeline would pick.
      const chosen = options.auto ? pickSurface(selected.surfaces, { auto: true }) : undefined;

      console.log(`\n${formatSurfaces(selected.surfaces, chosen?.id)}`);
      console.log(`\nWrote ${selected.artifactPath}`);
    });
}

function parseRole(value: string): RoleId {
  if (!(ROLE_IDS as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`must be one of: ${ROLE_IDS.join(', ')}`);
  }
  return value as RoleId;
}

export function formatSurfaces(artifact: Surfaces, chosenId?: string | undefined): string {
  const cost =
    artifact.agent.costUsd === undefined ? '' : ` · $${artifact.agent.costUsd.toFixed(3)}`;

  const header =
    `${artifact.surfaces.length} surface(s) for ${artifact.role} · ` +
    `${artifact.agent.attempts} attempt(s)${cost}\n`;

  const rows = artifact.surfaces.map((surface, index) => {
    const marker = surface.id === chosenId ? ' ← --auto' : '';

    return (
      `${String(index + 1).padStart(2)}. ${surface.title}${marker}\n` +
      `    ${surface.id}  in ${surface.componentId}  ` +
      `total ${surface.total.toFixed(2)}  ` +
      `(iso ${surface.scores.isolation.toFixed(2)}, ` +
      `rep ${surface.scores.representativeness.toFixed(2)}, ` +
      `rich ${surface.scores.richness.toFixed(2)})\n` +
      `    ${surface.summary}\n` +
      `    why: ${surface.rationale}\n` +
      `    idea: ${surface.assessmentIdea}`
    );
  });

  return `${header}\n${rows.join('\n\n')}`;
}
