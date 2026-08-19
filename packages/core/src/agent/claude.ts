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
    invocation.prompt,
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

export const execaTransport: AgentTransport = async (invocation) => {
  let stdout: string;

  try {
    const result = await execa('claude', buildArgs(invocation), {
      cwd: invocation.cwd,
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

    throw new QuarryError(`The \`claude\` CLI failed: ${detail}`, { cause: error });
  }

  const parsed = AgentEnvelope.safeParse(safeJsonParse(stdout));
  if (!parsed.success) {
    throw new QuarryError(
      `Could not read the \`claude\` CLI's JSON envelope. Got: ${truncate(stdout, 400)}`,
    );
  }

  if (parsed.data.is_error) {
    throw new QuarryError(
      `The agent reported an error (${parsed.data.api_error_status ?? parsed.data.subtype ?? 'unknown'}): ` +
        truncate(parsed.data.result, 400),
    );
  }

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
