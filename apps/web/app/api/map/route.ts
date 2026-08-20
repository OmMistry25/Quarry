import { core } from '@/lib/core';
import { streamResponse } from '@/lib/sse';
import { workRoot } from '@/lib/work';

// The pipeline clones repos, spawns installs and shells out to `claude`. None of that exists
// on the edge runtime.
export const runtime = 'nodejs';
export const maxDuration = 900;

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as { repo?: unknown };
  const repo = typeof body.repo === 'string' ? body.repo.trim() : '';

  if (repo === '') {
    return Response.json({ error: 'Give me a repository URL.' }, { status: 400 });
  }

  const { cartography, ingest, roleMenu } = await core();

  return streamResponse(async (emit) => {
    emit({ kind: 'stage', stage: 'S1', message: 'cloning and reading the repository…' });
    const s1 = await ingest({ ref: repo, workRoot: workRoot() });
    emit({
      kind: 'stage',
      stage: 'S1',
      message: `${s1.ingest.repo.fileCount} files, ${s1.ingest.manifests.length} manifests`,
    });

    emit({ kind: 'stage', stage: 'S2', message: 'mapping components…' });
    const s2 = await cartography({ run: s1.run, ingest: s1.ingest });
    emit({
      kind: 'stage',
      stage: 'S2',
      message: `${s2.components.components.length} components`,
    });

    emit({ kind: 'stage', stage: 'S3', message: 'scoring roles…' });
    const s3 = await roleMenu({ run: s1.run, ingest: s1.ingest, components: s2.components });

    emit({
      kind: 'roles',
      runId: s1.run.runId,
      roles: s3.roles.roles.map((card) => ({
        role: card.role,
        label: card.label,
        rating: card.rating,
        reason: card.reason,
      })),
    });
  });
}
