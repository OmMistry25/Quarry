import fs from 'node:fs/promises';
import path from 'node:path';

import type { Ingest, TreeEntry } from '../schemas/ingest.js';

/**
 * Curated context for the S2/S4 agent calls (docs/architecture-mvp.md: "S2/S4 receive
 * *curated* context … never the raw repo").
 *
 * The raw tree is not an option. `pnpm/pnpm` ingests to 5,691 files and a 1 MB `ingest.json`
 * — pasting that in would cost real money to tell an agent almost nothing. So the tree is
 * compressed into a directory map (counts and languages per directory, depth-limited) and
 * the token budget is spent instead on the two things that genuinely identify a component:
 * manifest contents and prose.
 */

export interface ContextBudget {
  /** Ceiling for the whole rendered context. */
  totalBytes: number;
  /** Per-file ceiling for manifests and docs. */
  fileBytes: number;
  /** Directories deeper than this are folded into their ancestor. */
  maxDepth: number;
  maxManifests: number;
  maxDocs: number;
  /**
   * Share of `totalBytes` the directory map may claim. Without a cap of its own the map is
   * unbounded in repo size — a few thousand directories would consume the entire budget and
   * leave nothing for manifests *or* docs. When rows do not fit, the largest directories by
   * LOC are kept and the rest are counted in a trailing note, so the map degrades into a
   * summary rather than being silently cut off mid-tree.
   */
  directoryShare: number;
  /**
   * Share of `totalBytes` manifests may claim before docs get their turn.
   *
   * Without this split, manifests starve docs outright: `pnpm/pnpm` has 1,458 manifests, and
   * a single shared budget spent all of it on 20 `package.json` files, leaving the agent
   * with **zero** prose on the repo it most needed prose for. Manifests still get first
   * refusal — they identify a stack more reliably — but they can no longer take everything.
   * Whatever they leave unspent flows to docs, and vice versa.
   */
  manifestShare: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  totalBytes: 120 * 1_000,
  fileBytes: 8 * 1_000,
  maxDepth: 3,
  maxManifests: 40,
  maxDocs: 12,
  directoryShare: 0.3,
  manifestShare: 0.55,
};

export interface DirectorySummary {
  path: string;
  fileCount: number;
  loc: number;
  languages: string[];
}

/**
 * Fold the file tree into per-directory rows, truncated at `maxDepth`. A file deeper than
 * the limit is counted against its nearest surviving ancestor, so totals stay honest.
 */
export function summariseDirectories(
  tree: readonly TreeEntry[],
  maxDepth: number,
): DirectorySummary[] {
  const buckets = new Map<string, { fileCount: number; loc: number; langs: Map<string, number> }>();

  for (const entry of tree) {
    const segments = entry.path.split('/');
    const dirSegments = segments.slice(0, -1);
    const key = dirSegments.slice(0, maxDepth).join('/');
    const bucketKey = key === '' ? '.' : key;

    const bucket = buckets.get(bucketKey) ?? { fileCount: 0, loc: 0, langs: new Map() };
    bucket.fileCount += 1;
    bucket.loc += entry.loc ?? 0;
    if (entry.lang !== undefined) {
      bucket.langs.set(entry.lang, (bucket.langs.get(entry.lang) ?? 0) + (entry.loc ?? 0));
    }
    buckets.set(bucketKey, bucket);
  }

  return [...buckets.entries()]
    .map(([dirPath, bucket]) => ({
      path: dirPath,
      fileCount: bucket.fileCount,
      loc: bucket.loc,
      languages: [...bucket.langs.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Shallower paths first — a root `package.json` says more than the 400th nested one. */
function directoryRow(dir: DirectorySummary): string {
  return (
    `${dir.path.padEnd(48)} ${String(dir.fileCount).padStart(5)} files  ` +
    `${String(dir.loc).padStart(7)} loc  ${dir.languages.join(', ')}`
  );
}

/**
 * Render the map within `ceilingBytes`, keeping the directories with the most code when it
 * does not all fit.
 */
function renderDirectoryMap(
  directories: readonly DirectorySummary[],
  maxDepth: number,
  ceilingBytes: number,
): string {
  const heading = `## Directory map (depth ${maxDepth}; deeper files counted against their ancestor)\n\n`;

  const ranked = [...directories].sort((a, b) => b.loc - a.loc || b.fileCount - a.fileCount);

  const kept: DirectorySummary[] = [];
  let used = heading.length + '```\n```\n'.length;

  for (const dir of ranked) {
    const cost = directoryRow(dir).length + 1;
    if (used + cost > ceilingBytes) break;
    kept.push(dir);
    used += cost;
  }

  // Back to path order: a map is read as a tree, not as a leaderboard.
  kept.sort((a, b) => a.path.localeCompare(b.path));

  const omitted = directories.length - kept.length;
  const note =
    omitted > 0
      ? `\n… ${omitted} smaller directories omitted (${directories.length} in total)\n`
      : '';

  return `${heading}\`\`\`\n${kept.map(directoryRow).join('\n')}\n${note}\`\`\`\n`;
}

interface CollectOptions {
  repoDir: string;
  heading: string;
  candidates: readonly { path: string; label: string }[];
  fileBytes: number;
  startingSpend: number;
  ceiling: number;
}

interface Collected {
  section: string;
  included: string[];
  spent: number;
}

/** Read candidate files into a section, stopping at `ceiling`. */
async function collectFiles(options: CollectOptions): Promise<Collected> {
  const parts: string[] = [options.heading];
  const included: string[] = [];
  let spent = options.startingSpend;

  for (const candidate of options.candidates) {
    if (spent >= options.ceiling) break;

    const body = await readCapped(options.repoDir, candidate.path, options.fileBytes);
    if (body.trim() === '') continue;

    const block = `\n### ${candidate.label}\n\n\`\`\`\n${body}\n\`\`\`\n`;
    if (spent + block.length > options.ceiling) break;

    parts.push(block);
    included.push(candidate.path);
    spent += block.length;
  }

  return { section: parts.join(''), included, spent };
}

function byShallowness(a: { path: string }, b: { path: string }): number {
  const depth = a.path.split('/').length - b.path.split('/').length;
  return depth !== 0 ? depth : a.path.localeCompare(b.path);
}

async function readCapped(repoDir: string, relPath: string, capBytes: number): Promise<string> {
  const contents = await fs.readFile(path.join(repoDir, relPath), 'utf8').catch(() => '');
  if (contents.length <= capBytes) return contents;
  return `${contents.slice(0, capBytes)}\n… (truncated)`;
}

export interface BuiltContext {
  text: string;
  /** What actually made it in, for the run log and for tests. */
  included: { manifests: string[]; docs: string[]; directories: number };
  bytes: number;
}

/**
 * Render the curated context block that gets substituted into a prompt template.
 */
export async function buildRepoContext(
  ingest: Ingest,
  repoDir: string,
  budget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
): Promise<BuiltContext> {
  const sections: string[] = [];
  let spent = 0;

  const languages = ingest.languages
    .filter((language) => language.share > 0)
    .map(
      (language) =>
        `${language.name} (${Math.round(language.share * 100)}% of code, ${language.loc} loc)`,
    )
    .join(', ');

  const overview =
    `## Repository\n\n` +
    `- name: ${ingest.repo.name}\n` +
    `- files: ${ingest.repo.fileCount}\n` +
    `- primary languages: ${languages || 'none detected'}\n` +
    `- other languages present: ${
      ingest.languages
        .filter((language) => language.share === 0)
        .map((language) => language.name)
        .join(', ') || 'none'
    }\n`;
  sections.push(overview);
  spent += overview.length;

  const directories = summariseDirectories(ingest.tree, budget.maxDepth);
  const directorySection = renderDirectoryMap(
    directories,
    budget.maxDepth,
    Math.max(0, budget.totalBytes - spent) * budget.directoryShare,
  );
  sections.push(directorySection);
  spent += directorySection.length;

  // Manifests may claim at most their share, so a manifest-heavy monorepo cannot leave the
  // agent with no prose at all.
  const manifestCeiling = spent + (budget.totalBytes - spent) * budget.manifestShare;

  const manifests = await collectFiles({
    repoDir,
    heading: '## Manifests\n',
    candidates: [...ingest.manifests]
      .sort(byShallowness)
      .slice(0, budget.maxManifests)
      .map((manifest) => ({ path: manifest.path, label: `${manifest.path} (${manifest.kind})` })),
    fileBytes: budget.fileBytes,
    startingSpend: spent,
    ceiling: manifestCeiling,
  });
  spent = manifests.spent;
  if (manifests.included.length > 0) sections.push(manifests.section);

  // Docs get everything manifests did not use.
  const docs = await collectFiles({
    repoDir,
    heading: '## Documentation\n',
    candidates: [...ingest.docs]
      .sort(byShallowness)
      .slice(0, budget.maxDocs)
      .map((doc) => ({ path: doc.path, label: doc.path })),
    fileBytes: budget.fileBytes,
    startingSpend: spent,
    ceiling: budget.totalBytes,
  });
  spent = docs.spent;
  if (docs.included.length > 0) sections.push(docs.section);

  const includedManifests = manifests.included;
  const includedDocs = docs.included;

  const text = sections.join('\n');

  return {
    text,
    included: {
      manifests: includedManifests,
      docs: includedDocs,
      directories: directories.length,
    },
    bytes: text.length,
  };
}
