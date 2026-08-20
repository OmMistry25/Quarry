import path from 'node:path';

import type { RoleId, SeniorityId } from 'core';

import { core } from '@/lib/core';
import { streamResponse } from '@/lib/sse';
import { workRoot } from '@/lib/work';

export const runtime = 'nodejs';
// S5 ran 444-723 s across the four verified runs, and a repair adds another round on top.
export const maxDuration = 1800;

const isOneOf = <T extends string>(ids: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (ids as readonly string[]).includes(value);

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as {
    runId?: unknown;
    role?: unknown;
    seniority?: unknown;
  };

  // The valid ids come from core rather than a copy kept here, which would drift the first
  // time a role or seniority is added.
  const {
    assertRoleSupported,
    generateVerifiedPackage,
    loadRun,
    pickSurface,
    surfaceSelection,
    ROLE_IDS,
    SENIORITY_IDS,
  } = await core();

  const { runId, role, seniority } = body;

  if (
    typeof runId !== 'string' ||
    !isOneOf<RoleId>(ROLE_IDS, role) ||
    !isOneOf<SeniorityId>(SENIORITY_IDS, seniority)
  ) {
    return Response.json({ error: 'Need a runId, a role and a seniority.' }, { status: 400 });
  }

  return streamResponse(async (emit) => {
    const resumed = await loadRun(workRoot(), runId);
    if (resumed.ingest === undefined || resumed.components === undefined) {
      throw new Error(`Run "${runId}" has not been mapped yet.`);
    }
    if (resumed.roles === undefined) {
      throw new Error(`Run "${runId}" has no role menu.`);
    }

    // SPEC acceptance 5: a role the repo cannot support is refused, not attempted.
    assertRoleSupported(resumed.roles, role);

    emit({ kind: 'stage', stage: 'S4', message: 'selecting a surface…' });
    const s4 = await surfaceSelection({
      run: resumed.run,
      ingest: resumed.ingest,
      components: resumed.components,
      role,
    });

    const surface = pickSurface(s4.surfaces, { auto: true });
    emit({ kind: 'stage', stage: 'S4', message: `chose "${surface.title}"` });

    emit({ kind: 'stage', stage: 'S5', message: 'generating the package — this is the slow one' });
    const result = await generateVerifiedPackage({
      run: resumed.run,
      ingest: resumed.ingest,
      components: resumed.components,
      surface,
      role,
      seniority,
      onSubstitution: (reason) => emit({ kind: 'notice', message: reason }),
      onRepair: (failures) =>
        emit({
          kind: 'stage',
          stage: 'S5',
          message: `verification failed; repairing in place with ${failures.length} problem(s) fed back`,
        }),
      onStep: (step) => emit({ kind: 'step', name: step.name, ok: step.ok, detail: step.detail }),
    });

    emit({
      kind: 'done',
      runId,
      zip: path.basename(result.package.zipPath),
      bytes: result.package.bytes,
      role: result.meta.role,
      seniority: result.meta.seniority,
      task: result.meta.task,
      surfaceTitle: result.meta.source.surfaceTitle,
      repairs: result.meta.generation.repairs,
      ...(result.meta.generation.costUsd === undefined
        ? {}
        : { costUsd: result.meta.generation.costUsd }),
    });
  });
}
