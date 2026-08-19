import { Command, InvalidArgumentError } from 'commander';
import {
  assertRoleSupported,
  generateVerifiedPackage,
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
  /** commander sets this false when --no-repair is passed. */
  repair: boolean;
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
    .option(
      '--resume <runId>',
      'reuse an existing run\'s artifacts instead of starting over ("latest" for the most recent)',
    )
    .option('--max-size-mb <mb>', 'repository size cap', parsePositiveNumber, 200)
    .option('--model <model>', 'model for the agent calls (defaults to the CLI default)')
    .option('--no-repair', 'fail on the first bad package instead of regenerating once')
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

      // A resumed run that already picked surfaces for this role reuses them; S4 is an agent
      // call, and re-paying for it while iterating on generation is the whole thing --resume
      // exists to avoid.
      const reusable =
        mapped.surfaces !== undefined && mapped.surfaces.role === options.role
          ? mapped.surfaces
          : undefined;

      if (!options.json && reusable === undefined) console.error('S4  selecting surfaces…');

      const selected =
        reusable !== undefined
          ? { surfaces: reusable }
          : await surfaceSelection({
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

      const result = await generateVerifiedPackage({
        run: mapped.run,
        ingest: mapped.ingest,
        components: mapped.components,
        surface,
        role: options.role,
        seniority: options.seniority,
        repairAttempts: options.repair === false ? 0 : 1,
        ...(options.model === undefined ? {} : { model: options.model }),
        onAttempt: (attempt) => reportAttempt(options.json, attempt),
        onStep: (step) => {
          if (options.json) return;
          const mark = step.ok ? 'ok  ' : 'FAIL';
          console.error(`S6  ${mark} ${step.name.padEnd(9)} ${firstLine(step.detail)}`);
        },
        onRepair: (failures) => {
          if (options.json) return;
          console.error(
            `\nS5  verification failed; regenerating once with ${failures.length} problem(s) ` +
              'fed back',
          );
        },
      });

      if (options.json) {
        console.log(JSON.stringify(result.meta, null, 2));
        return;
      }

      const files = Object.keys(result.meta).length > 0 ? await listPackage(result.packageDir) : [];
      console.log(`\n${formatPackage(result.meta, files)}`);
      if (result.generations > 1) {
        console.log(`\nTook ${result.generations} generation attempts (one repair loop).`);
      }
      console.log(
        `\nVerified. Wrote ${result.package.zipPath} (${formatBytes(result.package.bytes)})`,
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

function firstLine(detail: string): string {
  return detail.split('\n')[0] ?? '';
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

async function listPackage(packageDir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const out: string[] = [];

  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) await walk(`${dir}/${entry.name}`, relPath);
      else out.push(relPath);
    }
  };

  await walk(packageDir, '');
  return out.sort();
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
