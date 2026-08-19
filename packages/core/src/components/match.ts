import picomatch from 'picomatch';

import type { Component } from '../schemas/components.js';
import type { TreeEntry } from '../schemas/ingest.js';

/**
 * Map a component's `paths` globs onto the files S1 actually found.
 *
 * Agents write path lists in whatever dialect feels natural, so this is forgiving in the two
 * ways that matter in practice:
 *
 *  - A leading `!` marks a negation. `trpc/trpc` really produced `["www/**", "!www/og-image/**"]`
 *    to carve a nested component out of its parent, and taking that literally as a filename
 *    would silently match nothing.
 *  - A bare directory (`src/api`) is treated as `src/api/**`. Agents drop the trailing glob
 *    routinely, and reading it strictly would match a single non-existent file.
 */
export function componentMatcher(paths: readonly string[]): (filePath: string) => boolean {
  const positive: string[] = [];
  const negative: string[] = [];

  for (const raw of paths) {
    const isNegated = raw.startsWith('!');
    const pattern = normalisePattern(isNegated ? raw.slice(1) : raw);
    (isNegated ? negative : positive).push(pattern);
  }

  // No usable positive pattern means the component claims nothing, not everything.
  const isIncluded = positive.length > 0 ? picomatch(positive, { dot: true }) : () => false;
  const isExcluded = negative.length > 0 ? picomatch(negative, { dot: true }) : () => false;

  return (filePath: string): boolean => isIncluded(filePath) && !isExcluded(filePath);
}

function normalisePattern(pattern: string): string {
  const trimmed = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  if (trimmed === '' || trimmed === '.') return '**';
  // Already a glob — leave it alone.
  if (/[*?[\]{}]/.test(trimmed)) return trimmed;
  // A bare path: match the entry itself and anything beneath it.
  return `${trimmed}/**`;
}

export function filesForComponent(component: Component, tree: readonly TreeEntry[]): TreeEntry[] {
  const matches = componentMatcher(component.paths);
  return tree.filter((entry) => matches(entry.path));
}

/** Test files, by the conventions of the languages Quarry assesses. */
export function isTestPath(filePath: string): boolean {
  return (
    /(^|\/)(tests?|__tests__|spec|specs|e2e)\//i.test(filePath) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(filePath) ||
    /(^|\/)test_[^/]+\.py$/i.test(filePath) ||
    /_test\.py$/i.test(filePath)
  );
}

/**
 * Languages Quarry can actually generate an assessment in (docs/mvp.md: TS/JS and Python).
 * Everything else may be present and even dominant, but cannot support a take-home.
 */
const ASSESSABLE_LANGUAGES = new Set(['TypeScript', 'JavaScript', 'Python']);

export function isAssessableLanguage(language: string | undefined): boolean {
  return language !== undefined && ASSESSABLE_LANGUAGES.has(language);
}

export function assessableLanguages(): string[] {
  return [...ASSESSABLE_LANGUAGES];
}
