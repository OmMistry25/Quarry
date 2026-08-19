import path from 'node:path';

import type { LanguageSummary } from '../schemas/ingest.js';

/**
 * Extension → language. Only languages Quarry can actually assess are named precisely
 * (mvp.md: TS/JS and Python); everything else is coarse, because its only job downstream is
 * to tell S2 "there is also some Go in here" so cartography does not mistake the repo for
 * pure TypeScript.
 */
const EXTENSION_LANGUAGES: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.pyi': 'Python',
  '.rb': 'Ruby',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.php': 'PHP',
  '.cs': 'C#',
  '.c': 'C',
  '.h': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.hpp': 'C++',
  '.swift': 'Swift',
  '.scala': 'Scala',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.sql': 'SQL',
  '.html': 'HTML',
  '.css': 'CSS',
  '.scss': 'CSS',
  '.sass': 'CSS',
  '.less': 'CSS',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.md': 'Markdown',
  '.mdx': 'Markdown',
  '.json': 'JSON',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.toml': 'TOML',
  '.xml': 'XML',
  '.graphql': 'GraphQL',
  '.gql': 'GraphQL',
  '.tf': 'Terraform',
  '.proto': 'Protobuf',
};

/** Files with no extension whose name alone identifies the language. */
const FILENAME_LANGUAGES: Record<string, string> = {
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
  rakefile: 'Ruby',
  gemfile: 'Ruby',
  procfile: 'Config',
};

/**
 * Languages that are real code for the purposes of "primary languages by LOC". Markup,
 * config and docs are still counted and reported, but a repo that is 80% JSON by line count
 * is not a JSON repo, and S3's role scoring would be badly misled if it were told otherwise.
 */
const PROSE_AND_CONFIG = new Set([
  'Markdown',
  'JSON',
  'YAML',
  'TOML',
  'XML',
  'Config',
  'HTML',
  'CSS',
]);

export function detectLanguage(relPath: string): string | undefined {
  const basename = path.posix.basename(relPath).toLowerCase();

  const byName = FILENAME_LANGUAGES[basename];
  if (byName) return byName;

  const ext = path.posix.extname(basename);
  if (ext === '' && basename.startsWith('.')) return undefined;

  return EXTENSION_LANGUAGES[ext];
}

export function isCodeLanguage(language: string): boolean {
  return !PROSE_AND_CONFIG.has(language);
}

/** Lines of code: non-blank lines. Cheap, language-agnostic, and good enough for ranking. */
export function countLoc(contents: string): number {
  if (contents === '') return 0;

  let count = 0;
  for (const line of contents.split('\n')) {
    if (line.trim() !== '') count += 1;
  }
  return count;
}

/**
 * Aggregate per-file LOC into a ranked language summary.
 *
 * `share` is computed over *code* languages only, so a docs-heavy repo still reports
 * "TypeScript 0.9" rather than burying it under Markdown. Prose and config languages are
 * still listed, with a share of 0, because their presence is a real signal.
 */
export function summariseLanguages(
  files: readonly { lang?: string | undefined; loc?: number | undefined }[],
): LanguageSummary[] {
  const totals = new Map<string, { loc: number; fileCount: number }>();

  for (const file of files) {
    if (file.lang === undefined) continue;
    const entry = totals.get(file.lang) ?? { loc: 0, fileCount: 0 };
    entry.loc += file.loc ?? 0;
    entry.fileCount += 1;
    totals.set(file.lang, entry);
  }

  let codeLoc = 0;
  for (const [name, entry] of totals) {
    if (isCodeLanguage(name)) codeLoc += entry.loc;
  }

  return [...totals.entries()]
    .map(([name, entry]) => ({
      name,
      loc: entry.loc,
      fileCount: entry.fileCount,
      share:
        isCodeLanguage(name) && codeLoc > 0
          ? Math.round((entry.loc / codeLoc) * 10_000) / 10_000
          : 0,
    }))
    .sort((a, b) => b.loc - a.loc || a.name.localeCompare(b.name));
}
