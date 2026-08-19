import { Command, InvalidArgumentError } from 'commander';
import {
  assertRoleSupported,
  generate,
  pickSurface,
  surfaceSelection,
  ROLE_IDS,
  SENIORITY_IDS,
  type Meta,
  type RoleId,
  type SeniorityId,
} from 'core';

import {
  formatRoles,
  indentDetail,
  mapRepo,
  parsePositiveNumber,
  type SharedOptions,
} from './pipeline.js';

interface GenerateOptions extends SharedOptions {
  role: RoleId;
  seniority: SeniorityId;
  auto: boolean;
  surface?: string;
}

export function generateCommand(): Command {
  return new Command('generate')
    .description('Generate a take-home package (stages S1 → S5)')
    .argument('<repo>', 'GitHub repo URL, or a path to a local directory')
    .requiredOption('--role <role>', `one of: ${ROLE_IDS.join(', ')}`, parseRole)
    .option('--seniority <level>', `one of: ${SENIORITY_IDS.join(', ')}`, parseSeniority, 'junior')
    .option('--auto', 'pick the top-scored surface without asking', false)
    .option('--surface <id>', 'generate from a specific surface id')
    .option('--work-dir <dir>', 'root for run directories', 'work')
    .option('--max-size-mb <mb>', 'repository size cap', parsePositiveNumber, 200)
    .option('--model <model>', 'model for the agent calls (defaults to the CLI default)')
    .option('--json', 'print meta.json instead of a summary', false)
    .action(async (repo: string, options: GenerateOptions) => {
      if (!options.auto && options.surface === undefined) {
        throw new InvalidArgumentError(
          'pass --auto to take the top-scored surface, or --surface <id> to choose one ' +
            '(list them with `quarry surfaces`)',
        );
      }

      const mapped = await mapRepo(repo, options);
      if (!options.json) console.error(`\n${formatRoles(mapped.roles)}\n`);

      assertRoleSupported(mapped.roles, options.role);

      if (!options.json) console.error('S4  selecting surfaces…');
      const selected = await surfaceSelection({
        run: mapped.run,
        ingest: mapped.ingest,
        components: mapped.components,
        role: options.role,
        ...(options.model === undefined ? {} : { model: options.model }),
        onAttempt: (attempt) => reportAttempt(options.json, attempt),
      });

      const surface = pickSurface(
        selected.surfaces,
        options.surface === undefined ? { auto: true } : { surfaceId: options.surface },
      );

      if (!options.json) {
        console.error(`    chose "${surface.title}" (total ${surface.total.toFixed(2)})`);
        console.error('S5  generating package… this is the slow one');
      }

      const generated = await generate({
        run: mapped.run,
        ingest: mapped.ingest,
        components: mapped.components,
        surface,
        role: options.role,
        seniority: options.seniority,
        ...(options.model === undefined ? {} : { model: options.model }),
        onAttempt: (attempt) => reportAttempt(options.json, attempt),
      });

      if (options.json) {
        console.log(JSON.stringify(generated.meta, null, 2));
        return;
      }

      console.log(`\n${formatPackage(generated.meta, generated.files)}`);
      console.log(`\nWrote ${generated.packageDir}`);
      console.log(
        '\nNot verified yet — S6 runs install, tests, bug demonstrability, gitleaks and the ' +
          'overlap check (Phase 5).',
      );
    });
}

function reportAttempt(
  json: boolean,
  attempt: { attempt: number; outcome: string; detail?: string },
): void {
  if (json || attempt.outcome === 'ok') return;
  console.error(
    `    attempt ${attempt.attempt} rejected (${attempt.outcome})` +
      (attempt.detail === undefined ? '' : `\n${indentDetail(attempt.detail)}`),
  );
}

function parseRole(value: string): RoleId {
  if (!(ROLE_IDS as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`must be one of: ${ROLE_IDS.join(', ')}`);
  }
  return value as RoleId;
}

function parseSeniority(value: string): SeniorityId {
  if (!(SENIORITY_IDS as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`must be one of: ${SENIORITY_IDS.join(', ')}`);
  }
  return value as SeniorityId;
}

export function formatPackage(meta: Meta, files: string[]): string {
  const candidate = files.filter((file) => file.startsWith('candidate/'));
  const interviewer = files.filter((file) => file.startsWith('interviewer/'));

  const cost =
    meta.generation.costUsd === undefined ? '' : ` · $${meta.generation.costUsd.toFixed(3)}`;

  return (
    `${meta.role} / ${meta.seniority} / ${meta.task}${cost}\n` +
    `from surface: ${meta.source.surfaceTitle}\n\n` +
    `candidate/    ${candidate.length} files · setup \`${meta.generation.setupCommand}\` · ` +
    `tests \`${meta.generation.testCommand}\`\n` +
    candidate.map((file) => `  ${file}`).join('\n') +
    `\n\ninterviewer/  ${interviewer.length} files\n` +
    interviewer.map((file) => `  ${file}`).join('\n')
  );
}
