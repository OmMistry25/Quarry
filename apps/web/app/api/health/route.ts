import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

import { workRoot } from '@/lib/work';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const run = promisify(execFile);

const present = async (command: string, args: string[]): Promise<boolean> =>
  run(command, args).then(
    () => true,
    () => false,
  );

/**
 * Liveness, with readiness in the body.
 *
 * This returned 503 when a binary was missing, on the reasoning that a container which cannot
 * do the work should not come up. That was wrong in a way only a real deploy shows: Railway
 * reports a failed healthcheck as "service unavailable" and never surfaces the response body,
 * so fourteen identical retries said nothing about *which* piece was missing — the one thing
 * this endpoint exists to answer.
 *
 * So the status code answers "is the server serving", which is what a platform healthcheck is
 * for, and the body answers "can it actually work". The page reads the same body and refuses
 * to start a run it knows will fail, which is where that check belongs — in front of the user
 * about to spend ten minutes and real money, not in front of the deploy.
 */
export async function GET(): Promise<Response> {
  // Probe exactly what the pipeline will spawn — `QUARRY_CLAUDE_BIN` when set, `claude`
  // otherwise — plus bare `claude`, because "not on PATH" and "not installed" produce the
  // same failure and telling them apart cost a deploy round trip each time.
  const binary = (process.env.QUARRY_CLAUDE_BIN ?? '').trim() || 'claude';
  const [claude, claudeOnPath, gitleaks, git] = await Promise.all([
    present(binary, ['--version']),
    present('claude', ['--version']),
    present('gitleaks', ['version']),
    present('git', ['--version']),
  ]);

  const work = workRoot();
  const writable = await fs
    .mkdir(work, { recursive: true })
    .then(() => fs.access(work, constants.W_OK))
    .then(
      () => true,
      () => false,
    );

  // Reported, but deliberately not part of `ok`: `claude` can equally be authenticated by a
  // login session, and this container is proof — the pipeline runs here with no key in the
  // environment. Failing readiness on it would 503 a working deploy.
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '') !== '';
  const ok = claude && gitleaks && git && writable;

  const missing = [
    claude ? undefined : `claude (tried ${binary})`,
    gitleaks ? undefined : 'gitleaks',
    git ? undefined : 'git',
    writable ? undefined : `a writable ${work}`,
  ].filter((name): name is string => name !== undefined);

  return Response.json({
    ok,
    missing,
    claude,
    claudeBinary: binary,
    claudeOnPath,
    gitleaks,
    git,
    workDir: work,
    writable,
    apiKey,
    // The list itself, because a PATH problem is unfixable without seeing what PATH is.
    path: (process.env.PATH ?? '').split(':'),
  });
}
