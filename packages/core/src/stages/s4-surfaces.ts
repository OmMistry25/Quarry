import { roleArchetype, type RoleId } from '../archetypes/roles.js';
import type { AgentTransport } from '../agent/claude.js';
import { renderPrompt } from '../agent/prompts.js';
import { appendAgentLog } from '../agent/log.js';
import { runAgent, type AgentAttempt } from '../agent/runAgent.js';
import {
  buildSurfaceContext,
  DEFAULT_SURFACE_BUDGET,
  type SurfaceContextBudget,
} from '../agent/surfaceContext.js';
import { QuarryError } from '../errors.js';
import type { Components } from '../schemas/components.js';
import type { Ingest } from '../schemas/ingest.js';
import {
  Surfaces,
  SurfacesReply,
  SURFACES_SCHEMA_VERSION,
  surfaceTotal,
  type Surface,
} from '../schemas/surfaces.js';
import { writeArtifact, type RunDir } from '../run.js';

export interface SurfaceSelectionOptions {
  run: RunDir;
  ingest: Ingest;
  components: Components;
  role: RoleId;
  budget?: SurfaceContextBudget;
  model?: string | undefined;
  transport?: AgentTransport;
  retries?: number;
  now?: Date;
  onAttempt?: (attempt: AgentAttempt) => void;
}

export interface SurfaceSelectionResult {
  surfaces: Surfaces;
  artifactPath: string;
  prompt: string;
}

/**
 * S4 — Surface selection (docs/SPEC.md).
 *
 * One agent pass over the in-lane components' *source*, returning 3–5 candidate surfaces
 * scored on isolation, representativeness and richness. Ranking is done here rather than by
 * the agent, so the weighting is inspectable and `--auto` is reproducible.
 */
export async function surfaceSelection(
  options: SurfaceSelectionOptions,
): Promise<SurfaceSelectionResult> {
  const archetype = roleArchetype(options.role);

  const context = await buildSurfaceContext(
    archetype,
    options.components,
    options.ingest,
    options.run.repoDir,
    options.budget ?? DEFAULT_SURFACE_BUDGET,
  );

  if (context.componentIds.length === 0) {
    throw new QuarryError(
      `No ${archetype.label} components to select a surface from. Check \`quarry roles\` first.`,
      { stage: 's4' },
    );
  }

  const knownComponentIds = new Set(context.componentIds);
  const knownPaths = new Set(options.ingest.tree.map((entry) => entry.path));

  const prompt = await renderPrompt('s4-surfaces.md', { CONTEXT: context.text });

  const result = await runAgent({
    stage: 's4',
    prompt,
    // Validating ids and paths against reality here means a hallucinated file becomes a
    // retry with a specific complaint, rather than a broken S5 input.
    schema: SurfacesReply.superRefine((reply, ctx) => {
      for (const [index, surface] of reply.surfaces.entries()) {
        if (!knownComponentIds.has(surface.componentId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['surfaces', index, 'componentId'],
            message:
              `"${surface.componentId}" is not an in-lane component id ` +
              `(expected one of: ${[...knownComponentIds].join(', ')})`,
          });
        }

        for (const [pathIndex, filePath] of surface.paths.entries()) {
          if (!knownPaths.has(filePath)) {
            ctx.addIssue({
              code: 'custom',
              path: ['surfaces', index, 'paths', pathIndex],
              message: `"${filePath}" is not a file in this repository`,
            });
          }
        }
      }
    }),
    ...(options.retries === undefined ? {} : { retries: options.retries }),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.transport === undefined ? {} : { transport: options.transport }),
    onAttempt: (attempt) => {
      void appendAgentLog(options.run, attempt);
      options.onAttempt?.(attempt);
    },
  });

  const ranked = rankSurfaces(result.data.surfaces);

  const artifact = Surfaces.parse({
    schemaVersion: SURFACES_SCHEMA_VERSION,
    runId: options.run.runId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    role: options.role,
    surfaces: ranked,
    agent: {
      attempts: result.attempts,
      ...(result.costUsd === undefined ? {} : { costUsd: result.costUsd }),
      ...(options.model === undefined ? {} : { model: options.model }),
    },
  });

  const artifactPath = await writeArtifact(options.run, 'surfaces.json', artifact);
  return { surfaces: artifact, artifactPath, prompt };
}

export function rankSurfaces(surfaces: readonly Surface[]): (Surface & { total: number })[] {
  return surfaces
    .map((surface) => ({ ...surface, total: surfaceTotal(surface.scores) }))
    .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
}

/**
 * SPEC: "user picks one, or `--auto` picks top score."
 */
export function pickSurface(
  artifact: Surfaces,
  choice: { auto: true } | { surfaceId: string },
): Surfaces['surfaces'][number] {
  if ('auto' in choice) {
    const top = artifact.surfaces[0];
    if (top === undefined) {
      throw new QuarryError('No surfaces to choose from.', { stage: 's4' });
    }
    return top;
  }

  const chosen = artifact.surfaces.find((surface) => surface.id === choice.surfaceId);
  if (chosen === undefined) {
    throw new QuarryError(
      `No surface with id "${choice.surfaceId}". Available: ` +
        artifact.surfaces.map((surface) => surface.id).join(', '),
      { stage: 's4' },
    );
  }

  return chosen;
}
