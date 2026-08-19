import { execa } from 'execa';

/**
 * Run a command from a generated package.
 *
 * architecture-mvp.md: "Subprocess in temp dir with timeouts + env-scrubbed shell … local
 * subprocess is enough for MVP (only runs code the agent just wrote)". Two things follow
 * from that last clause: the code is not hostile, but it is unreviewed, so it must not be
 * handed anything it could leak.
 */

/** Timeouts from architecture-mvp.md. */
export const INSTALL_TIMEOUT_MS = 5 * 60 * 1_000;
export const TEST_TIMEOUT_MS = 3 * 60 * 1_000;

/**
 * Environment variables a generated package is allowed to see.
 *
 * An allowlist, not a denylist: a new secret in the operator's shell must not become visible
 * to generated code just because nobody thought to add it to a blocklist. Notably absent are
 * `ANTHROPIC_API_KEY`, `GITHUB_TOKEN` and everything else the pipeline itself runs on.
 */
const PASSTHROUGH_ENV = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TZ',
  'TMPDIR',
  'SHELL',
  'USER',
  'NODE_VERSION',

  // Network reachability. Installing dependencies is the entire point of the install step,
  // and on any machine behind a proxy — CI runners, corporate networks, this project's own
  // container — dropping these means npm cannot reach the registry at all. It does not fail
  // fast either: it hangs until the 5-minute timeout, and then the repair loop regenerates
  // the whole package and hits exactly the same wall.
  //
  // Caveat worth knowing: a proxy URL can embed credentials. That is a real trade-off, but
  // an install step with no network is useless, and the alternative is a tool that only works
  // on unproxied machines.
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'npm_config_registry',
  'npm_config_proxy',
  'npm_config_https_proxy',
  'npm_config_noproxy',
  'npm_config_cafile',
  'npm_config_strict_ssl',
] as const;

export function scrubbedEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const key of PASSTHROUGH_ENV) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }

  // Keep installs quiet and deterministic rather than interactive.
  env.CI = '1';
  env.NO_COLOR = '1';
  env.npm_config_audit = 'false';
  env.npm_config_fund = 'false';
  env.npm_config_update_notifier = 'false';

  return env;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface RunCommandOptions {
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Run a shell command and report rather than throw — a failing install is a verification
 * result, not an exception, and its output is what the repair loop feeds back.
 */
export async function runCommand(
  command: string,
  options: RunCommandOptions,
): Promise<CommandResult> {
  const startedAt = Date.now();

  try {
    // `detached` puts the command in its own process group. Without it, a timeout kills only
    // the shell: any child it spawned survives, keeps the pipe open, and the await blocks for
    // the child's full lifetime rather than the timeout. A test that waits on a port would
    // stall the whole pipeline that way.
    const subprocess = execa(command, {
      cwd: options.cwd,
      env: options.env ?? scrubbedEnv(),
      extendEnv: false,
      shell: true,
      detached: true,
      // Nothing on stdin, ever. A command that waits for input — a bare `node` opening a
      // REPL, a package manager asking to confirm — would otherwise hang until the timeout.
      stdin: 'ignore',
      reject: false,
      all: false,
      maxBuffer: 16 * 1_024 * 1_024,
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(subprocess.pid);
    }, options.timeoutMs);

    let result;
    try {
      result = await subprocess;
    } finally {
      clearTimeout(timer);
    }

    return {
      command,
      exitCode: result.exitCode ?? 1,
      ok: result.exitCode === 0 && !timedOut,
      stdout: result.stdout,
      stderr: timedOut
        ? `${result.stderr}\n[quarry] killed after ${options.timeoutMs}ms`.trim()
        : result.stderr,
      timedOut,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    // execa still throws for things reject:false does not cover, e.g. a missing shell.
    return {
      command,
      exitCode: 1,
      ok: false,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      timedOut: false,
      durationMs: Date.now() - startedAt,
    };
  }
}

/** Kill the whole process group, so orphaned children die with the shell that spawned them. */
function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Already gone, or never got its own group; fall back to the process itself.
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Nothing left to kill.
    }
  }
}

/** The last few lines of output, which is what a human or the repair loop actually reads. */
export function tail(result: CommandResult, lines = 40): string {
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  const split = combined.split('\n');
  return split.slice(-lines).join('\n');
}

/**
 * Lines that say what actually went wrong, pulled out of the noise around them.
 *
 * This exists because a repair once failed for want of it: a generated package used a test
 * invocation Node rejects, and the feedback the generator received was forty lines of TAP
 * boilerplate with the single line that mattered — `Cannot find module …/test` — buried in
 * the middle. It regenerated the same mistake, at the cost of a full generation pass.
 */
const ERROR_SIGNATURES = [
  /cannot find module/i,
  /module_not_found/i,
  /^\s*(Error|TypeError|SyntaxError|ReferenceError|AssertionError):/,
  /^\s*error[: ]/i,
  /ERR_[A-Z_]+/,
  /command not found/i,
  /is not recognized/i,
  /No such file or directory/i,
  /ModuleNotFoundError|ImportError/,
  /npm ERR!/,
  /Unknown (option|argument|command)/i,
];

export function salientErrors(result: CommandResult, max = 8): string[] {
  const seen = new Set<string>();
  const combined = `${result.stdout}\n${result.stderr}`;

  for (const raw of combined.split('\n')) {
    const line = raw.replace(/^[#>\s]*/, '').trim();
    if (line === '' || line.length > 400) continue;
    if (!ERROR_SIGNATURES.some((pattern) => pattern.test(line))) continue;
    if (seen.has(line)) continue;

    seen.add(line);
    if (seen.size >= max) break;
  }

  return [...seen];
}
