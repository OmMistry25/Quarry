import fs from 'node:fs';
import path from 'node:path';

/**
 * Where run directories live.
 *
 * Set `QUARRY_WORK_DIR` explicitly when deploying — on Railway that is the mounted volume,
 * because `/api/map` writes `work/<runId>/` and `/api/generate` reads it back.
 *
 * A blank value counts as unset. `??` only falls back on `undefined`, so an empty variable
 * silently became the working directory: the live health check reported `workDir: ""`, and a
 * `mkdir('')` fails, which read as "the volume is not writable".
 */
export function workRoot(): string {
  const configured = process.env.QUARRY_WORK_DIR?.trim();
  if (configured !== undefined && configured !== '') return configured;

  // A mounted volume is the right default in a container, and its absence is the signal that
  // this is a developer's checkout instead.
  if (fs.existsSync('/data')) return '/data/work';

  // `next dev` runs with apps/web as its working directory, so the repo's work/ is two up.
  return path.resolve(process.cwd(), '..', '..', 'work');
}
