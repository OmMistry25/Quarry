import type { Stage } from './types.js';

/**
 * Thrown on *expected* failure — size cap exceeded, unsupported role, verification failure.
 * Carries the stage so the CLI and the UI event stream can report where a run died without
 * parsing messages. Unexpected failures stay as ordinary errors and surface with a stack.
 */
export class QuarryError extends Error {
  readonly stage: Stage | undefined;

  constructor(message: string, options: { stage?: Stage; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'QuarryError';
    this.stage = options.stage;
  }
}
