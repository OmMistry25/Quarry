import { Command } from 'commander';
import { VERSION } from 'core';

/**
 * Subcommands are registered as their pipeline stages land:
 *   ingest (Phase 1) · map (Phase 2) · roles, surfaces (Phase 3) · generate (Phase 5).
 * Until then `quarry --help` describes the tool and exits cleanly.
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
