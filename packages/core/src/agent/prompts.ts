import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { QuarryError } from '../errors.js';

/**
 * Prompts live in `prompts/` at the repo root and are treated as code (CLAUDE.md): versioned,
 * reviewed, never inline string literals in TypeScript.
 *
 * The relative depth is the same from `src/agent/` and `dist/agent/`, so this resolves
 * correctly whether the code is running from source under vitest or from the build.
 */
const PROMPTS_ROOT = fileURLToPath(new URL('../../../../prompts/', import.meta.url));

export function promptsRoot(): string {
  return PROMPTS_ROOT;
}

/**
 * Load a prompt template and substitute `{{PLACEHOLDER}}` tokens.
 *
 * Substitution is intentionally dumb — no conditionals, no loops. A prompt with logic in it
 * is a prompt nobody can review, and everything Quarry needs is a rendered block of text
 * prepared in TypeScript where it can be tested.
 */
export async function renderPrompt(
  name: string,
  values: Readonly<Record<string, string>>,
  root: string = PROMPTS_ROOT,
): Promise<string> {
  const file = path.join(root, name);

  let template: string;
  try {
    template = await fs.readFile(file, 'utf8');
  } catch (error) {
    throw new QuarryError(`Could not read the prompt template ${name} (looked in ${root}).`, {
      cause: error,
    });
  }

  const missing: string[] = [];
  const rendered = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      missing.push(key);
      return '';
    }
    return value;
  });

  if (missing.length > 0) {
    throw new QuarryError(
      `The prompt template ${name} expects ${missing.join(', ')}, which was not supplied.`,
    );
  }

  return rendered;
}
