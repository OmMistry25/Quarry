import fs from 'node:fs/promises';
import path from 'node:path';

import type { RunDir } from '../run.js';
import type { AgentAttempt } from './runAgent.js';

/**
 * Append an agent attempt to `work/<run>/logs/agent.log`.
 *
 * A rejected attempt is the most useful diagnostic the pipeline produces: it says exactly
 * which part of a prompt's contract the model failed to satisfy, which is how prompts get
 * improved. Without this the information exists only in memory during the run and is gone by
 * the time anyone wonders why a stage cost double.
 */
export async function appendAgentLog(run: RunDir, attempt: AgentAttempt): Promise<void> {
  const logDir = path.join(run.dir, 'logs');
  await fs.mkdir(logDir, { recursive: true });

  const detail = attempt.detail === undefined ? '' : `\n${indent(attempt.detail)}`;
  const reply = attempt.reply === undefined ? '' : `\n  reply:\n${indent(attempt.reply)}`;
  const line = `[${attempt.stage}] attempt ${attempt.attempt}: ${attempt.outcome}${detail}${reply}\n`;

  await fs.appendFile(path.join(logDir, 'agent.log'), line, 'utf8');
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}
