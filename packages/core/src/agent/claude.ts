import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { z } from 'zod';

import { QuarryError } from '../errors.js';
import type { Stage } from '../types.js';

/**
 * The envelope `claude -p --output-format json` prints. Only the fields Quarry uses are
 * declared; the CLI adds plenty more and is free to keep doing so.
 */
const AgentEnvelope = z.object({
  is_error: z.boolean(),
  result: z.string(),
  total_cost_usd: z.number().optional(),
  subtype: z.string().optional(),
  api_error_status: z.union([z.string(), z.number()]).nullish(),
});

export interface AgentInvocation {
  prompt: string;
  systemPrompt: string;
  model?: string | undefined;
  cwd: string;
  timeoutMs: number;
  /**
   * `analyse` (default) — the agent reads a prompt and replies with JSON. No tools needed,
   * because the context is already in the prompt.
   *
   * `write` — the agent writes files into `cwd` and then replies with JSON describing what
   * it wrote. Used only by S5, which architecture-mvp.md specifies as "Claude Code *inside*
   * an empty target dir with write access".
   */
  mode?: 'analyse' | 'write' | undefined;
}

export interface AgentReply {
  text: string;
  costUsd: number | undefined;
}

/** Seam for tests: everything above this line stays real, the subprocess does not. */
export type AgentTransport = (invocation: AgentInvocation) => Promise<AgentReply>;

/**
 * Flags that make a Quarry agent call reproducible and cheap, rather than inheriting
 * whatever the operator's machine happens to have configured:
 *
 *  - `--strict-mcp-config` with no `--mcp-config`: no MCP servers. Without it every call
 *    would drag in the user's connectors, at real token cost and with real nondeterminism.
 *  - `--setting-sources ''`: ignore user, project and local settings.
 *  - `--disable-slash-commands`: the operator's skills are not part of this contract.
 *  - `--system-prompt`: replaces the default Claude Code system prompt, which is written for
 *    interactive coding and is both large and off-task here.
 *
 * The remaining leak is CLAUDE.md auto-discovery, which is handled by *where* the process
 * runs — see `neutralCwd()`.
 */
function buildArgs(invocation: AgentInvocation): string[] {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--system-prompt',
    invocation.systemPrompt,
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--setting-sources',
    '',
  ];

  if (invocation.model !== undefined) args.push('--model', invocation.model);

  if (invocation.mode === 'write') {
    // acceptEdits rather than skipping permissions wholesale: the agent may write inside its
    // own working directory without a prompt, and nothing more. The tool list is an explicit
    // allowlist — no Bash, so a generation pass cannot install packages, run tests, or reach
    // the network. Running the generated code is S6's job, in a sandbox.
    args.push('--permission-mode', 'acceptEdits');
    args.push('--allowedTools', 'Read', 'Write', 'Edit', 'Glob', 'Grep');
  }

  return args;
}

/** Exposed for tests: argument construction is worth asserting, the subprocess is not. */
export const buildArgsForTest = buildArgs;

/**
 * Which binary to run. `claude` on PATH by default, per CLAUDE.md.
 *
 * The override exists because PATH is not always arrangeable. On Railway the CLI installs to
 * a known location and the runtime PATH, composed by the platform's builder, does not include
 * it — so the binary is present and `claude` still resolves to nothing. Naming the path
 * directly removes the guesswork rather than fighting the PATH the platform gives you.
 */
export function claudeBinary(): string {
  const configured = process.env.QUARRY_CLAUDE_BIN?.trim();
  return configured !== undefined && configured !== '' ? configured : 'claude';
}

type Envelope = z.infer<typeof AgentEnvelope>;

/**
 * Turn the CLI's error envelope into something a human can act on.
 *
 * The envelope is the same whether the CLI exits 0 or 1, and an API error exits 1 — so
 * without this the caller saw execa's raw message: the whole command line, then the whole
 * JSON blob, with `"result":"Credit balance is too low"` buried in the middle of it. The
 * cause was one short sentence and the report was four hundred characters of noise.
 */
function describeAgentError(envelope: Envelope): QuarryError {
  const status = envelope.api_error_status ?? envelope.subtype ?? 'unknown';
  const result = truncate(envelope.result, 400);

  // Billing is the one failure here that no amount of retrying or regenerating can fix, and
  // it is not a problem with the repository being assessed — say so, rather than leaving it
  // to look like Quarry mis-handled the run.
  if (/credit balance|insufficient|quota|billing/i.test(envelope.result)) {
    return new QuarryError(
      `The Anthropic account behind this API key cannot run the request: ${result}. ` +
        'Quarry cannot proceed until that is resolved — this is an account problem, not a ' +
        'problem with the repository or the generated package.',
    );
  }

  return new QuarryError(`The agent reported an error (${String(status)}): ${result}`);
}

/**
 * Read the CLI's error envelope out of a failed invocation, if it left one.
 *
 * A non-zero exit does not mean there is nothing to read: on an API error the CLI prints its
 * JSON envelope and *then* exits 1. Without this the caller got execa's raw message — the
 * whole command line followed by the whole blob — with the one useful sentence buried in it.
 *
 * Returns undefined when the failure carries no envelope, so the caller can fall back to the
 * raw detail rather than inventing a cause.
 */
export function explainCliFailure(error: unknown): QuarryError | undefined {
  const output = (error as { stdout?: unknown } | null)?.stdout;
  const envelope = AgentEnvelope.safeParse(safeJsonParse(typeof output === 'string' ? output : ''));

  return envelope.success && envelope.data.is_error ? describeAgentError(envelope.data) : undefined;
}

export const execaTransport: AgentTransport = async (invocation) => {
  let stdout: string;

  try {
    const result = await execa(claudeBinary(), buildArgs(invocation), {
      cwd: invocation.cwd,
      // The prompt goes in on stdin, not as an argument. Linux caps a single argv entry at
      // 128 KB (MAX_ARG_STRLEN), and architecture-mvp.md budgets S5's reference material at
      // 150 KB alone — so passing it as an argument fails with E2BIG on any repo whose files
      // are large enough. psf/requests is one; expressjs/express only fitted by luck.
      input: invocation.prompt,
      timeout: invocation.timeoutMs,
      // Large replies are normal; the default buffer is not generous enough for S5.
      maxBuffer: 64 * 1_024 * 1_024,
      reject: true,
    });
    stdout = result.stdout;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    if (detail.includes('ENOENT')) {
      throw new QuarryError(
        'The `claude` CLI is not on PATH. Quarry shells out to Claude Code for its agent ' +
          'stages — install it, or see docs/architecture-mvp.md for the alternative.',
        { cause: error },
      );
    }

    const reported = explainCliFailure(error);
    if (reported !== undefined) throw reported;

    throw new QuarryError(`The \`claude\` CLI failed: ${detail}`, { cause: error });
  }

  const parsed = AgentEnvelope.safeParse(safeJsonParse(stdout));
  if (!parsed.success) {
    throw new QuarryError(
      `Could not read the \`claude\` CLI's JSON envelope. Got: ${truncate(stdout, 400)}`,
    );
  }

  if (parsed.data.is_error) throw describeAgentError(parsed.data);

  return { text: parsed.data.result, costUsd: parsed.data.total_cost_usd };
};

/**
 * Claude Code auto-discovers CLAUDE.md by walking up from its working directory. Run an
 * agent anywhere inside Quarry's own checkout — `work/<run>/` very much included — and
 * Quarry's working agreement silently becomes part of the prompt. Verified, not assumed.
 *
 * So agent calls default to a directory outside the repo entirely. Stages that genuinely
 * need a working directory (S5 writes files) pass their own, and must reckon with the same
 * hazard.
 */
export async function neutralCwd(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'quarry-agent-'));
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export type { Stage };
