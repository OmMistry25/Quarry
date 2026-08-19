/**
 * Quarry core — public surface.
 *
 * Pipeline stages land in `src/stages/` (S1 ingest … S7 package) as they are built;
 * this barrel is what `cli` and `apps/web` are allowed to import.
 */

export const VERSION = '0.0.0';

/** Stage identifiers, in pipeline order. See docs/SPEC.md. */
export const STAGES = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'] as const;

export type Stage = (typeof STAGES)[number];

/**
 * Error type every stage throws on expected failure (size cap exceeded, unsupported
 * role, verification failure). Carries the stage so the CLI and the UI event stream
 * can report *where* a run died without parsing messages.
 */
export class QuarryError extends Error {
  readonly stage: Stage | undefined;

  constructor(message: string, options: { stage?: Stage; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'QuarryError';
    this.stage = options.stage;
  }
}
