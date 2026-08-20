import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import { taskForSeniority, type SeniorityId } from '../archetypes/tasks.js';
import type { AgentTransport } from '../agent/claude.js';
import { appendAgentLog } from '../agent/log.js';
import { renderPrompt } from '../agent/prompts.js';
import { runAgent, type AgentAttempt } from '../agent/runAgent.js';
import { QuarryError } from '../errors.js';
import type { Meta } from '../schemas/meta.js';
import type { RunDir } from '../run.js';

/**
 * Targeted repair — the cheap half of SPEC's "one automatic repair loop".
 *
 * The obvious reading of that instruction is to generate the package again with the failures
 * appended, and that is what Quarry did first. It works, but it costs a *second full
 * generation*: measured at ~870 s on a real repo, turning a 15-minute run into a 31-minute
 * one and blowing the latency target on exactly the runs that were already going badly.
 *
 * It is also more than the job needs. The dominant failure by far is a test asserting
 * something the implementation does not do — a few lines wrong in a package that is otherwise
 * sound. So the repair agent is given the package it already wrote, told what failed, and
 * asked to edit in place. Same one loop, a fraction of the cost, and a far better fit to what
 * actually goes wrong.
 */

const REPAIR_SYSTEM_PROMPT =
  'You are a senior engineer fixing a take-home assessment package that failed automated ' +
  'verification. The package is in your working directory. You edit the files that are wrong ' +
  'with the Edit and Write tools, then reply with a single JSON object describing what you ' +
  'changed — no prose, no markdown fence.';

const REPAIR_TIMEOUT_MS = 10 * 60 * 1_000;

const RepairReply = z.object({
  files: z.array(z.string().min(1)),
  setupCommand: z.string().min(1),
  testCommand: z.string().min(1),
  notes: z.string().optional(),
});

export interface RepairOptions {
  run: RunDir;
  meta: Meta;
  seniority: SeniorityId;
  failures: readonly string[];
  packageDir?: string;
  model?: string | undefined;
  transport?: AgentTransport;
  now?: Date;
  onAttempt?: (attempt: AgentAttempt) => void;
}

export interface RepairResult {
  /** Files the agent reported changing. */
  changed: string[];
  packageDir: string;
  costUsd: number | undefined;
  /** Commands as they stand after the repair; they may have been corrected. */
  setupCommand: string;
  testCommand: string;
}

export async function repairPackage(options: RepairOptions): Promise<RepairResult> {
  const packageDir = options.packageDir ?? path.join(options.run.dir, 'package');

  if (!(await fs.stat(packageDir).catch(() => undefined))?.isDirectory()) {
    throw new QuarryError(`No package at ${packageDir} to repair.`, { stage: 's5' });
  }

  const task = taskForSeniority(options.seniority);

  // Repair in a temp copy, for the same reason generation happens there: CLAUDE.md is
  // discovered by walking up from the working directory, and work/ sits inside Quarry's own
  // checkout. Copying back only on success also means a failed repair cannot leave the
  // package half-edited.
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-repair-'));

  try {
    await fs.cp(packageDir, workingDir, { recursive: true });

    const prompt = await renderPrompt('s5-repair.md', {
      FAILURES: options.failures.map((failure) => `- ${failure}`).join('\n\n'),
      FILE_LISTING: (await listFiles(workingDir)).map((file) => `- ${file}`).join('\n'),
      ARCHETYPE_RULE: task.requiresBugDemonstration
        ? 'The planted bug stays planted. `interviewer/fix/` must remain the fix for it, and ' +
          "the starter's own suite must pass *against* the bug — if a shipped test catches " +
          'it, move the bug somewhere the suite does not reach rather than removing it.'
        : 'This is an extension: nothing is planted, and `candidate/` must be correct as ' +
          'shipped. Do not add a verification test or a fix directory.',
    });

    const result = await runAgent({
      stage: 's5',
      prompt,
      schema: RepairReply,
      systemPrompt: REPAIR_SYSTEM_PROMPT,
      mode: 'write',
      cwd: workingDir,
      timeoutMs: REPAIR_TIMEOUT_MS,
      // One attempt at the contract; the repair itself is the retry.
      retries: 1,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.transport === undefined ? {} : { transport: options.transport }),
      onAttempt: (attempt) => {
        void appendAgentLog(options.run, attempt);
        options.onAttempt?.(attempt);
      },
    });

    await fs.rm(packageDir, { recursive: true, force: true });
    await fs.cp(workingDir, packageDir, { recursive: true });

    return {
      changed: result.data.files,
      packageDir,
      costUsd: result.costUsd,
      setupCommand: result.data.setupCommand,
      testCommand: result.data.testCommand,
    };
  } finally {
    await fs.rm(workingDir, { recursive: true, force: true });
  }
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];

  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relPath);
      else out.push(relPath);
    }
  };

  await walk(root, '');
  return out.sort();
}
