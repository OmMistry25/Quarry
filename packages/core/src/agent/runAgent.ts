import fs from 'node:fs/promises';

import type { z } from 'zod';

import { QuarryError } from '../errors.js';
import type { Stage } from '../types.js';

import { execaTransport, neutralCwd, type AgentTransport } from './claude.js';
import { extractJsonObject } from './json.js';

/**
 * The system prompt for every agent stage. Deliberately short: the per-stage prompt in
 * `prompts/` carries the actual task and its JSON contract.
 */
const SYSTEM_PROMPT =
  'You are a precise code-analysis tool inside a larger pipeline. Your entire reply is ' +
  'consumed by a program, never read by a human. Reply with a single JSON object and ' +
  'nothing else: no prose, no explanation, no markdown code fence.';

export interface RunAgentOptions<T> {
  stage: Stage;
  /** The rendered prompt — built from a template in `prompts/`, never inline in TypeScript. */
  prompt: string;
  schema: z.ZodType<T>;
  /** Additional attempts after the first. SPEC/architecture: 2. */
  retries?: number;
  model?: string | undefined;
  timeoutMs?: number;
  /**
   * Working directory for the agent process. Defaults to a fresh temp dir outside the repo
   * — see `neutralCwd()` for why that is not incidental.
   */
  cwd?: string;
  transport?: AgentTransport;
  /** Called once per attempt, for progress reporting and run logs. */
  onAttempt?: (attempt: AgentAttempt) => void;
}

export interface AgentAttempt {
  stage: Stage;
  attempt: number;
  outcome: 'ok' | 'invalid-json' | 'schema-mismatch';
  detail?: string;
}

export interface AgentResult<T> {
  data: T;
  attempts: number;
  costUsd: number | undefined;
}

const DEFAULT_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000;

/**
 * Run one agent stage and return schema-valid data, or fail loudly.
 *
 * Agents drift, so nothing here trusts the reply: the JSON is extracted defensively, parsed
 * with zod, and on failure the *specific* validation errors are appended to the prompt and
 * the call is retried. Feeding the errors back is the point — a bare "try again" tends to
 * produce the same malformed shape a second time.
 */
export async function runAgent<T>(options: RunAgentOptions<T>): Promise<AgentResult<T>> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const transport = options.transport ?? execaTransport;
  const ownedCwd = options.cwd === undefined ? await neutralCwd() : undefined;
  const cwd = options.cwd ?? ownedCwd;

  if (cwd === undefined) throw new QuarryError('No working directory for the agent.');

  try {
    let prompt = options.prompt;
    let costUsd: number | undefined;
    let lastFailure = '';

    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      const reply = await transport({
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        model: options.model,
        cwd,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });

      costUsd = addCost(costUsd, reply.costUsd);

      const json = extractJsonObject(reply.text);
      if (json === undefined) {
        lastFailure = 'The reply contained no JSON object.';
        options.onAttempt?.({
          stage: options.stage,
          attempt,
          outcome: 'invalid-json',
          detail: lastFailure,
        });
        prompt = withFeedback(options.prompt, lastFailure);
        continue;
      }

      let value: unknown;
      try {
        value = JSON.parse(json);
      } catch (error) {
        lastFailure = `The JSON did not parse: ${error instanceof Error ? error.message : String(error)}`;
        options.onAttempt?.({
          stage: options.stage,
          attempt,
          outcome: 'invalid-json',
          detail: lastFailure,
        });
        prompt = withFeedback(options.prompt, lastFailure);
        continue;
      }

      const parsed = options.schema.safeParse(value);
      if (parsed.success) {
        options.onAttempt?.({ stage: options.stage, attempt, outcome: 'ok' });
        return { data: parsed.data, attempts: attempt, costUsd };
      }

      lastFailure = formatIssues(parsed.error);
      options.onAttempt?.({
        stage: options.stage,
        attempt,
        outcome: 'schema-mismatch',
        detail: lastFailure,
      });
      prompt = withFeedback(options.prompt, lastFailure);
    }

    throw new QuarryError(
      `The agent did not return valid ${options.stage} output after ${retries + 1} attempts. ` +
        `Last problem:\n${lastFailure}`,
      { stage: options.stage },
    );
  } finally {
    if (ownedCwd !== undefined) {
      await fs.rm(ownedCwd, { recursive: true, force: true });
    }
  }
}

function withFeedback(basePrompt: string, failure: string): string {
  return (
    `${basePrompt}\n\n` +
    '## Your previous reply was rejected\n\n' +
    'It did not satisfy the contract above:\n\n' +
    `${failure}\n\n` +
    'Return the corrected JSON object. Fix only what is listed; do not restructure the rest.'
  );
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `- ${where}: ${issue.message}`;
    })
    .join('\n');
}

function addCost(total: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return total;
  return (total ?? 0) + next;
}
