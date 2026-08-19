import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { roleArchetype, type RoleId } from '../archetypes/roles.js';
import { SENIORITY_ARCHETYPES, taskForSeniority, type SeniorityId } from '../archetypes/tasks.js';
import type { AgentTransport } from '../agent/claude.js';
import { appendAgentLog } from '../agent/log.js';
import { renderPrompt } from '../agent/prompts.js';
import {
  buildReferenceMaterial,
  DEFAULT_REFERENCE_BUDGET,
  type ReferenceBudget,
} from '../agent/referenceMaterial.js';
import { runAgent, type AgentAttempt } from '../agent/runAgent.js';
import { QuarryError } from '../errors.js';
import type { Components } from '../schemas/components.js';
import type { Ingest } from '../schemas/ingest.js';
import { GenerationReply, Meta, META_SCHEMA_VERSION } from '../schemas/meta.js';
import type { Surface } from '../schemas/surfaces.js';
import type { RunDir } from '../run.js';

/**
 * The generator's system prompt. Deliberately different from the analysis one: this agent
 * writes files and only then reports.
 */
const GENERATOR_SYSTEM_PROMPT =
  'You are a senior engineer building a take-home assessment package. You write files into ' +
  'your working directory with the Write tool, and when finished you reply with a single ' +
  'JSON object describing what you wrote — no prose, no markdown fence. Everything you write ' +
  'is read by a real hiring team and sent to a real candidate.';

const GENERATION_TIMEOUT_MS = 20 * 60 * 1_000;

export interface GenerateOptions {
  run: RunDir;
  ingest: Ingest;
  components: Components;
  surface: Surface;
  role: RoleId;
  seniority: SeniorityId;
  budget?: ReferenceBudget;
  model?: string | undefined;
  transport?: AgentTransport;
  retries?: number;
  now?: Date;
  onAttempt?: (attempt: AgentAttempt) => void;
}

export interface GenerateResult {
  meta: Meta;
  /** `work/<run>/package`. */
  packageDir: string;
  /** Files that actually exist on disk, verified rather than taken from the agent's word. */
  files: string[];
  prompt: string;
}

/**
 * S5 — Generation (docs/SPEC.md).
 *
 * Runs the agent inside an empty target directory with write access, then moves the result
 * into the run directory.
 *
 * The temp directory is not a detail. Claude Code discovers CLAUDE.md by walking up from its
 * working directory, and `work/` lives inside Quarry's own checkout — so generating directly
 * into `work/<run>/package` would feed Quarry's working agreement to the generator as if it
 * were instructions. Phase 2 established this by experiment; here it decides the design.
 */
export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const seniority = SENIORITY_ARCHETYPES[options.seniority];
  const task = taskForSeniority(options.seniority);
  const role = roleArchetype(options.role);

  if (task.id !== 'bug-hunt') {
    throw new QuarryError(
      `The ${task.label} archetype is not implemented yet — Phase 4 ships backend x bug-hunt ` +
        'only (docs/tasks-mvp.md). Use --seniority junior.',
      { stage: 's5' },
    );
  }

  const startedAt = options.now ?? new Date();

  const reference = await buildReferenceMaterial(
    options.surface,
    options.components,
    options.ingest,
    options.run.repoDir,
    options.budget ?? DEFAULT_REFERENCE_BUDGET,
  );

  if (reference.included.length === 0) {
    throw new QuarryError(`No readable reference material for surface "${options.surface.id}".`, {
      stage: 's5',
    });
  }

  const prompt = await renderPrompt('s5-generate.md', {
    TASK_BRIEF: taskBrief(options.surface, role.label, task.label, seniority.extraScope),
    STUB_STRATEGY: role.stubStrategy,
    BRIEF_STYLE: task.briefStyle,
    RUBRIC_DIMENSIONS: role.rubricDimensions.map((dimension) => `- ${dimension}`).join('\n'),
    ANSWER_KEY_REQUIREMENTS: task.answerKeyRequirements,
    REFERENCE_MATERIAL: reference.text,
  });

  // Generate outside the repo, then move in. See the note on this function.
  const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quarry-generate-'));

  try {
    const result = await runAgent({
      stage: 's5',
      prompt,
      schema: GenerationReply,
      systemPrompt: GENERATOR_SYSTEM_PROMPT,
      mode: 'write',
      cwd: targetDir,
      timeoutMs: GENERATION_TIMEOUT_MS,
      ...(options.retries === undefined ? {} : { retries: options.retries }),
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.transport === undefined ? {} : { transport: options.transport }),
      onAttempt: (attempt) => {
        void appendAgentLog(options.run, attempt);
        options.onAttempt?.(attempt);
      },
    });

    // Trust the filesystem, not the reply: an agent that says it wrote a file and did not is
    // a failure worth catching here rather than in S6.
    const onDisk = await listFiles(targetDir);
    await assertPackageShape(onDisk, task.requiresBugDemonstration);

    const packageDir = path.join(options.run.dir, 'package');
    await fs.rm(packageDir, { recursive: true, force: true });
    await fs.cp(targetDir, packageDir, { recursive: true });

    const meta = Meta.parse({
      schemaVersion: META_SCHEMA_VERSION,
      runId: options.run.runId,
      role: options.role,
      seniority: options.seniority,
      task: task.id,
      source: {
        ref: options.ingest.source.ref,
        ...(options.ingest.source.commit === undefined
          ? {}
          : { commit: options.ingest.source.commit }),
        surfaceId: options.surface.id,
        surfaceTitle: options.surface.title,
        componentId: options.surface.componentId,
      },
      generation: {
        startedAt: startedAt.toISOString(),
        // With an injected clock both stamps are the fixed value, which keeps tests
        // deterministic; in a real run this is the genuine finish time.
        finishedAt: (options.now ?? new Date()).toISOString(),
        attempts: result.attempts,
        ...(result.costUsd === undefined ? {} : { costUsd: result.costUsd }),
        ...(options.model === undefined ? {} : { model: options.model }),
        referenceFiles: reference.included,
        setupCommand: result.data.setupCommand,
        testCommand: result.data.testCommand,
      },
    });

    await fs.writeFile(
      path.join(packageDir, 'meta.json'),
      `${JSON.stringify(meta, null, 2)}\n`,
      'utf8',
    );

    return { meta, packageDir, files: onDisk, prompt };
  } finally {
    await fs.rm(targetDir, { recursive: true, force: true });
  }
}

function taskBrief(
  surface: Surface,
  roleLabel: string,
  taskLabel: string,
  extraScope: string,
): string {
  return (
    `A **${taskLabel}** for a **${roleLabel}** candidate, built around this surface from the ` +
    `source repository:\n\n` +
    `> **${surface.title}**\n>\n` +
    `> ${surface.summary}\n>\n` +
    `> Suggested angle: ${surface.assessmentIdea}\n\n` +
    'Mirror this workflow. The planted bug must be one a competent engineer could plausibly ' +
    'have written — an off-by-one on a boundary, a wrong comparison operator, a missing ' +
    'guard, a mis-ordered pair of operations. Never a typo, never obviously broken code, ' +
    'never something a linter would catch.\n\n' +
    "The starter repo's own tests must **pass** against the planted bug. A bug the shipped " +
    'test suite already catches is not a bug hunt — the candidate would find it by running ' +
    '`npm test` once.' +
    (extraScope === '' ? '' : `\n\n${extraScope}`)
  );
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];

  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        out.push(relPath);
      }
    }
  };

  await walk(root, '');
  return out.sort();
}

/**
 * Structural checks S6 should never have to discover. These are cheap and catch the failure
 * modes that make a package unusable rather than merely imperfect.
 */
async function assertPackageShape(files: string[], requiresVerifyTest: boolean): Promise<void> {
  const problems: string[] = [];

  const has = (predicate: (file: string) => boolean): boolean => files.some(predicate);

  if (!has((file) => file === 'candidate/README.md')) problems.push('candidate/README.md');
  if (!has((file) => file === 'candidate/BRIEF.md')) problems.push('candidate/BRIEF.md');
  if (!has((file) => file === 'interviewer/rubric.md')) problems.push('interviewer/rubric.md');
  if (!has((file) => file === 'interviewer/answer-key.md')) {
    problems.push('interviewer/answer-key.md');
  }
  if (requiresVerifyTest && !has((file) => /^interviewer\/verify\.test\./.test(file))) {
    problems.push('interviewer/verify.test.*');
  }

  if (problems.length > 0) {
    throw new QuarryError(
      `The generator did not write: ${problems.join(', ')}. Wrote ${files.length} file(s): ` +
        `${files.slice(0, 20).join(', ')}${files.length > 20 ? ' …' : ''}`,
      { stage: 's5' },
    );
  }

  const candidateFiles = files.filter((file) => file.startsWith('candidate/'));
  if (candidateFiles.length < 5) {
    throw new QuarryError(
      `candidate/ has only ${candidateFiles.length} file(s); SPEC expects roughly 10-25.`,
      { stage: 's5' },
    );
  }

  // The verification test must never reach the candidate.
  const leaked = candidateFiles.filter((file) => /verify\.test\./.test(file));
  if (leaked.length > 0) {
    throw new QuarryError(
      `The verification test leaked into candidate/: ${leaked.join(', ')}. It gives the ` +
        'answer away and must stay in interviewer/.',
      { stage: 's5' },
    );
  }
}
