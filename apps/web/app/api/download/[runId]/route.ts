import fs from 'node:fs/promises';
import path from 'node:path';

import { workRoot } from '@/lib/work';

export const runtime = 'nodejs';

/**
 * Serve a run's package.
 *
 * The zip is found by reading the run directory rather than taking a filename from the
 * client, and the run id is matched against a strict pattern before it is joined to a path:
 * this handler turns a URL segment into a filesystem read, which is exactly the shape that
 * serves `../../etc/passwd` if it is written trustingly.
 */
export async function GET(
  _request: Request,
  { params }: { params: { runId: string } },
): Promise<Response> {
  const { runId } = params;

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) {
    return Response.json({ error: 'Not a run id.' }, { status: 400 });
  }

  const root = workRoot();
  const dir = path.resolve(root, runId);
  if (dir !== path.join(root, runId)) {
    return Response.json({ error: 'Not a run id.' }, { status: 400 });
  }

  const entries = await fs.readdir(dir).catch(() => undefined);
  if (entries === undefined) {
    return Response.json({ error: `No run "${runId}".` }, { status: 404 });
  }

  const zip = entries
    .filter((entry) => entry.endsWith('.zip'))
    .sort()
    .at(-1);
  if (zip === undefined) {
    return Response.json({ error: 'That run has no package.' }, { status: 404 });
  }

  const bytes = await fs.readFile(path.join(dir, zip));

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(bytes.byteLength),
      'content-disposition': `attachment; filename="${zip}"`,
    },
  });
}
