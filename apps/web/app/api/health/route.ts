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
 * Readiness, not liveness.
 *
 * A container that boots without `claude`, without `gitleaks`, or without a writable volume
 * serves a page that looks perfectly healthy and then fails several minutes into a run, after
 * spending real money. Better to say so at the door.
 */
export async function GET(): Promise<Response> {
  const [claude, gitleaks, git] = await Promise.all([
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

  return Response.json(
    { ok, claude, gitleaks, git, workDir: work, writable, apiKey },
    { status: ok ? 200 : 503 },
  );
}
