/**
 * Load `core` at runtime rather than letting Next bundle it.
 *
 * Two things make bundling impossible. `core` locates its prompt templates with
 * `new URL('../../../../prompts/', import.meta.url)`, which webpack rewrites and then cannot
 * resolve; and `core` is ESM-only, so declaring it a CommonJS external makes the server
 * `require()` a package whose exports map has no `require` condition.
 *
 * A dynamic import marked `webpackIgnore` is left in the output untouched, so Node resolves
 * it from `node_modules` the same way the CLI does — the UI then runs exactly the code the
 * CLI runs, rather than a rewritten copy of it.
 */
import type * as CoreModule from 'core';

export type Core = typeof CoreModule;

let loaded: Promise<Core> | undefined;

export function core(): Promise<Core> {
  loaded ??= import(/* webpackIgnore: true */ 'core') as Promise<Core>;
  return loaded;
}
