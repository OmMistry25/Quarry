import fs from 'node:fs/promises';
import path from 'node:path';

import type { RoleArchetype } from '../archetypes/roles.js';
import { filesForComponent, isAssessableLanguage, isTestPath } from '../components/match.js';
import type { Component, Components } from '../schemas/components.js';
import type { Ingest, TreeEntry } from '../schemas/ingest.js';

/**
 * Context for S4 (docs/architecture-mvp.md: "S4 receive[s] *curated* context … scoped to
 * in-lane components").
 *
 * Different shape from S2's on purpose. Cartography needed to know what exists, so it got
 * manifests and prose. Surface selection needs to judge whether a workflow is isolated,
 * representative and rich enough to hide a bug in — none of which can be told from a
 * directory listing. So this stage spends its budget on **source code**.
 */

export interface SurfaceContextBudget {
  totalBytes: number;
  fileBytes: number;
  /** Hard ceiling on files read, independent of bytes. */
  maxFiles: number;
}

export const DEFAULT_SURFACE_BUDGET: SurfaceContextBudget = {
  totalBytes: 120 * 1_000,
  fileBytes: 12 * 1_000,
  maxFiles: 40,
};

export interface BuiltSurfaceContext {
  text: string;
  included: string[];
  bytes: number;
  /** In-lane components, in the order they appear in the context. */
  componentIds: string[];
}

/**
 * Rank files by how much they say about a component's behaviour.
 *
 * Entrypoints come first because they name the workflows. Tests come next — they describe
 * behaviour more explicitly than the implementation does, and a surface without tests is a
 * poor bug-hunt candidate anyway. Everything else follows by size, on the rough basis that
 * a 300-line service is more informative than a 4-line barrel file.
 */
function rankFiles(component: Component, files: readonly TreeEntry[]): TreeEntry[] {
  const entrypoints = new Set(component.entrypoints);

  return [...files]
    .filter((file) => isAssessableLanguage(file.lang))
    .map((file) => {
      let priority = 2;
      if (entrypoints.has(file.path)) priority = 0;
      else if (isTestPath(file.path)) priority = 1;
      return { file, priority };
    })
    .sort((a, b) => a.priority - b.priority || (b.file.loc ?? 0) - (a.file.loc ?? 0))
    .map((entry) => entry.file);
}

export async function buildSurfaceContext(
  role: RoleArchetype,
  components: Components,
  ingest: Ingest,
  repoDir: string,
  budget: SurfaceContextBudget = DEFAULT_SURFACE_BUDGET,
): Promise<BuiltSurfaceContext> {
  const inLane = components.components.filter((component) =>
    role.inLaneKinds.includes(component.kind),
  );

  const sections: string[] = [];
  const included: string[] = [];
  let spent = 0;

  const header =
    `## Role\n\n${role.label} — in-lane component kinds: ${role.inLaneKinds.join(', ')}\n\n` +
    `## In-lane components\n\n` +
    inLane
      .map(
        (component) =>
          `- **${component.id}** (${component.kind}) — ${component.paths.join(', ')}\n` +
          `  stack: ${component.stack.join(', ') || 'unknown'}\n` +
          `  ${component.notes}`,
      )
      .join('\n');
  sections.push(header);
  spent += header.length;

  // Each component gets a fair share, so one enormous component cannot crowd the others out
  // of consideration entirely.
  const perComponent = inLane.length > 0 ? (budget.totalBytes - spent) / inLane.length : 0;

  for (const component of inLane) {
    const files = rankFiles(component, filesForComponent(component, ingest.tree));
    if (files.length === 0) continue;

    const parts: string[] = [`\n## Component: ${component.id}\n`];
    const listing = files
      .slice(0, 200)
      .map((file) => `${file.path} (${file.loc ?? 0} loc)`)
      .join('\n');
    parts.push(`\n### Files\n\n\`\`\`\n${listing}\n\`\`\`\n`);

    let componentSpent = parts.join('').length;
    const ceiling = componentSpent + perComponent;

    for (const file of files) {
      if (included.length >= budget.maxFiles) break;
      if (componentSpent >= ceiling) break;

      const body = await readCapped(repoDir, file.path, budget.fileBytes);
      if (body.trim() === '') continue;

      const block = `\n### ${file.path}\n\n\`\`\`\n${body}\n\`\`\`\n`;
      if (componentSpent + block.length > ceiling) continue;

      parts.push(block);
      included.push(file.path);
      componentSpent += block.length;
    }

    const section = parts.join('');
    sections.push(section);
    spent += section.length;
  }

  const text = sections.join('\n');
  return { text, included, bytes: text.length, componentIds: inLane.map((c) => c.id) };
}

async function readCapped(repoDir: string, relPath: string, capBytes: number): Promise<string> {
  const contents = await fs.readFile(path.join(repoDir, relPath), 'utf8').catch(() => '');
  if (contents.length <= capBytes) return contents;
  return `${contents.slice(0, capBytes)}\n… (truncated)`;
}
