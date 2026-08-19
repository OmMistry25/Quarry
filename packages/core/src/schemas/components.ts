import { z } from 'zod';

/**
 * `components.json` — the S2 artifact (docs/SPEC.md).
 *
 * A component is a coherent sub-part of the repo. S3 scores roles over these, and S4 only
 * ever looks inside the ones that are in-lane for the chosen role — so the partition is what
 * lets Quarry treat a large heterogeneous repo as a quarry rather than something it has to
 * understand end to end.
 */

export const COMPONENTS_SCHEMA_VERSION = 1;

export const ComponentKind = z.enum([
  'frontend-app',
  'backend-api',
  'worker',
  'data-pipeline',
  'shared-lib',
  'infra',
  'docs',
  'other',
]);
export type ComponentKind = z.infer<typeof ComponentKind>;

export const Component = z.object({
  /** Stable slug, referenced by `depends_on` and by later stages. */
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'must be a lowercase slug'),
  kind: ComponentKind,
  /** Glob patterns scoping the component, e.g. `apps/api/**`. */
  paths: z.array(z.string().min(1)).min(1),
  /** Lowercase technology tags: `typescript`, `express`, `postgres`. */
  stack: z.array(z.string().min(1)),
  entrypoints: z.array(z.string().min(1)),
  /** Ids of other components this one depends on. Validated for referential integrity. */
  depends_on: z.array(z.string().min(1)),
  docs: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  notes: z.string(),
});
export type Component = z.infer<typeof Component>;

/**
 * What the agent is asked to return. Kept separate from the stored artifact so the prompt
 * contract stays exactly the shape in SPEC — the run metadata is Quarry's to add.
 */
export const CartographyReply = z
  .object({
    components: z.array(Component).min(1),
  })
  .superRefine((reply, ctx) => {
    const ids = new Set<string>();

    for (const [index, component] of reply.components.entries()) {
      if (ids.has(component.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['components', index, 'id'],
          message: `duplicate component id "${component.id}"`,
        });
      }
      ids.add(component.id);
    }

    // Dangling depends_on would quietly break S3's scoring, so it fails the parse and the
    // agent gets told about it on retry.
    for (const [index, component] of reply.components.entries()) {
      for (const [depIndex, dependency] of component.depends_on.entries()) {
        if (!ids.has(dependency)) {
          ctx.addIssue({
            code: 'custom',
            path: ['components', index, 'depends_on', depIndex],
            message:
              `"${dependency}" is not one of the component ids in this reply ` +
              `(${[...ids].join(', ')})`,
          });
        }
        if (dependency === component.id) {
          ctx.addIssue({
            code: 'custom',
            path: ['components', index, 'depends_on', depIndex],
            message: `component "${component.id}" cannot depend on itself`,
          });
        }
      }
    }
  });
export type CartographyReply = z.infer<typeof CartographyReply>;

export const Components = z.object({
  schemaVersion: z.literal(COMPONENTS_SCHEMA_VERSION),
  runId: z.string().min(1),
  generatedAt: z.string().datetime(),
  components: z.array(Component).min(1),
  /** What the agent cost and how many attempts it took — useful when a run looks wrong. */
  agent: z.object({
    attempts: z.number().int().positive(),
    costUsd: z.number().nonnegative().optional(),
    model: z.string().min(1).optional(),
  }),
});
export type Components = z.infer<typeof Components>;
