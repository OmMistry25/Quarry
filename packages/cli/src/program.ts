import { Command } from 'commander';
import { VERSION } from 'core';

import { ingestCommand } from './commands/ingest.js';
import { mapCommand } from './commands/map.js';
import { rolesCommand } from './commands/roles.js';
import { surfacesCommand } from './commands/surfaces.js';

/**
 * Subcommands are registered as their pipeline stages land:
 *   ingest (S1) · map (S2) · roles, surfaces (S3–S4) · generate (the whole pipeline).
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('quarry')
    .description(
      'Generate a role-specific, verified take-home test package from a GitHub repo.\n' +
        'Reads a codebase for its stack, conventions and domain, then writes a fresh\n' +
        'mini-repo that mirrors them — no source code from the original ever ships.',
    )
    .version(VERSION, '-v, --version', 'print the Quarry version')
    .showHelpAfterError('(run `quarry --help` for usage)');

  program.addCommand(ingestCommand());
  program.addCommand(mapCommand());
  program.addCommand(rolesCommand());
  program.addCommand(surfacesCommand());

  return program;
}

/**
 * `pnpm --filter cli dev -- <args>` forwards the `--` separator itself into argv, where
 * commander would read it as an options terminator and treat `--help` (or a subcommand
 * name) as a stray positional. Drop one leading separator so the invocation documented in
 * CLAUDE.md behaves the same as the compiled `quarry` binary.
 */
export function stripPassthroughSeparator(argv: readonly string[]): string[] {
  const rest = argv.slice(2);
  if (rest[0] !== '--') return [...argv];
  return [...argv.slice(0, 2), ...rest.slice(1)];
}

export async function run(rawArgv: readonly string[]): Promise<void> {
  const argv = stripPassthroughSeparator(rawArgv);
  const program = buildProgram();

  // With no subcommands yet, a bare `quarry` should show help rather than exit silently.
  if (argv.length <= 2) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(argv);
}
