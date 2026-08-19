import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { promptsRoot, renderPrompt } from '../src/agent/prompts.js';
import { QuarryError } from '../src/errors.js';

describe('prompt loading', () => {
  it('resolves the prompts directory from source and from dist alike', async () => {
    const stat = await fs.stat(promptsRoot());
    expect(stat.isDirectory()).toBe(true);
  });

  it('finds the S2 template where the stage expects it', async () => {
    const contents = await fs.readFile(path.join(promptsRoot(), 's2-cartography.md'), 'utf8');
    expect(contents).toContain('{{CONTEXT}}');
  });

  it('substitutes placeholders', async () => {
    const rendered = await renderPrompt('s2-cartography.md', { CONTEXT: 'CURATED-CONTEXT-HERE' });

    expect(rendered).toContain('CURATED-CONTEXT-HERE');
    expect(rendered).not.toContain('{{CONTEXT}}');
  });

  it('fails loudly when a placeholder has no value, rather than sending "{{CONTEXT}}" to the agent', async () => {
    await expect(renderPrompt('s2-cartography.md', {})).rejects.toBeInstanceOf(QuarryError);
  });

  it('fails loudly when the template is missing', async () => {
    await expect(renderPrompt('does-not-exist.md', {})).rejects.toThrow(/Could not read/);
  });
});
