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

describe('the generation prompt guards what it cannot check', () => {
  it('tells the generator it cannot run its own tests', async () => {
    // Every generation failure in Phase 6 hardening was the same shape: a suite describing
    // intended behaviour against an implementation that does something slightly different.
    // The generator has no Bash tool, so it cannot discover this itself.
    const rendered = await renderPrompt('s5-generate.md', {
      TASK_BRIEF: 'x',
      STUB_STRATEGY: 'x',
      BRIEF_STYLE: 'x',
      RUBRIC_DIMENSIONS: 'x',
      ANSWER_KEY_REQUIREMENTS: 'x',
      INTERVIEWER_EXTRAS: 'x',
      TASK_SPECIFIC_SECTIONS: 'x',
      REFERENCE_MATERIAL: 'x',
    });

    expect(rendered).toMatch(/You cannot run these tests/);
    expect(rendered).toMatch(/assert only what you are certain of/);
    expect(rendered).toMatch(/smaller suite that passes/);
  });

  it('names framework boilerplate as where copying happens', async () => {
    const rendered = await renderPrompt('s5-generate.md', {
      TASK_BRIEF: 'x',
      STUB_STRATEGY: 'x',
      BRIEF_STYLE: 'x',
      RUBRIC_DIMENSIONS: 'x',
      ANSWER_KEY_REQUIREMENTS: 'x',
      INTERVIEWER_EXTRAS: 'x',
      TASK_SPECIFIC_SECTIONS: 'x',
      REFERENCE_MATERIAL: 'x',
    });

    expect(rendered).toMatch(/framework boilerplate/);
    expect(rendered).toMatch(/handleFormSubmit/);
  });
});
