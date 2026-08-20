import path from 'node:path';

/**
 * Where run directories live.
 *
 * `next dev` runs with `apps/web` as its working directory, so the repo's `work/` is two
 * levels up. Overridable, because the default is a guess about how the server was started
 * and a wrong guess would silently start a second, empty run root.
 */
export function workRoot(): string {
  return process.env.QUARRY_WORK_DIR ?? path.resolve(process.cwd(), '..', '..', 'work');
}
