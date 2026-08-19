import fs from 'node:fs/promises';
import path from 'node:path';

import { filesForComponent, isAssessableLanguage, isTestPath } from '../components/match.js';
import type { Component, Components } from '../schemas/components.js';
import type { Ingest, TreeEntry } from '../schemas/ingest.js';
import type { Surface } from '../schemas/surfaces.js';

/**
 * Reference material for S5 — the source files the generator reads to learn a repo's
 * conventions before writing something fresh in that style.
 *
 * architecture-mvp.md caps this at "~40 files / 150 KB, chosen by S4's surface definition".
 * The cap is not only about cost: the generator's job is to *imitate conventions*, and past
 * a certain volume more example code makes it likelier to reproduce something verbatim,
 * which is the one thing CLAUDE.md invariant 1 forbids.
 */

export interface ReferenceBudget {
  maxFiles: number;
  maxBytes: number;
  fileBytes: number;
}

export const DEFAULT_REFERENCE_BUDGET: ReferenceBudget = {
  maxFiles: 40,
  maxBytes: 150 * 1_000,
  fileBytes: 16 * 1_000,
};

export interface ReferenceMaterial {
  text: string;
  included: string[];
  bytes: number;
}

/**
 * Order candidates by how much they teach about this surface:
 *
 *  1. The surface's own files — the thing being mirrored.
 *  2. Its component's tests — the clearest statement of conventions, and the generated repo
 *     needs its own tests to look like these.
 *  3. Its component's manifests — the stack, exactly.
 *  4. Everything else in the component, largest first.
 */
function orderCandidates(
  surface: Surface,
  component: Component | undefined,
  ingest: Ingest,
): TreeEntry[] {
  const byPath = new Map(ingest.tree.map((entry) => [entry.path, entry]));
  const ordered: TreeEntry[] = [];
  const seen = new Set<string>();

  const push = (entry: TreeEntry | undefined): void => {
    if (entry === undefined || seen.has(entry.path)) return;
    seen.add(entry.path);
    ordered.push(entry);
  };

  for (const filePath of surface.paths) push(byPath.get(filePath));

  const componentFiles = component ? filesForComponent(component, ingest.tree) : [];

  for (const file of componentFiles) {
    if (isTestPath(file.path) && isAssessableLanguage(file.lang)) push(file);
  }

  const componentPaths = new Set(componentFiles.map((file) => file.path));
  for (const manifest of ingest.manifests) {
    // The component's own manifests, plus any root manifest: a root package.json names the
    // stack even when it sits outside the component's paths.
    const isRootManifest = !manifest.path.includes('/');
    if (componentPaths.has(manifest.path) || isRootManifest) push(byPath.get(manifest.path));
  }

  for (const file of [...componentFiles].sort((a, b) => (b.loc ?? 0) - (a.loc ?? 0))) {
    if (isAssessableLanguage(file.lang)) push(file);
  }

  return ordered;
}

export async function buildReferenceMaterial(
  surface: Surface,
  components: Components,
  ingest: Ingest,
  repoDir: string,
  budget: ReferenceBudget = DEFAULT_REFERENCE_BUDGET,
): Promise<ReferenceMaterial> {
  const component = components.components.find((entry) => entry.id === surface.componentId);
  const candidates = orderCandidates(surface, component, ingest);

  const parts: string[] = [];
  const included: string[] = [];
  let spent = 0;

  for (const file of candidates) {
    if (included.length >= budget.maxFiles) break;
    if (spent >= budget.maxBytes) break;

    const body = await readCapped(repoDir, file.path, budget.fileBytes);
    if (body.trim() === '') continue;

    const block = `\n### ${file.path}\n\n\`\`\`\n${body}\n\`\`\`\n`;
    if (spent + block.length > budget.maxBytes) continue;

    parts.push(block);
    included.push(file.path);
    spent += block.length;
  }

  return { text: parts.join(''), included, bytes: spent };
}

async function readCapped(repoDir: string, relPath: string, capBytes: number): Promise<string> {
  const contents = await fs.readFile(path.join(repoDir, relPath), 'utf8').catch(() => '');
  if (contents.length <= capBytes) return contents;
  return `${contents.slice(0, capBytes)}\n… (truncated)`;
}
