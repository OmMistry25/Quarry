import { describe, expect, it } from 'vitest';

import {
  countLoc,
  detectLanguage,
  isCodeLanguage,
  summariseLanguages,
} from '../src/ingest/languages.js';

describe('detectLanguage', () => {
  it.each([
    ['src/index.ts', 'TypeScript'],
    ['src/App.tsx', 'TypeScript'],
    ['scripts/build.mjs', 'JavaScript'],
    ['api/main.py', 'Python'],
    ['Dockerfile', 'Dockerfile'],
    ['Makefile', 'Makefile'],
    ['README.md', 'Markdown'],
    ['config/app.yaml', 'YAML'],
  ])('maps %s to %s', (candidate, expected) => {
    expect(detectLanguage(candidate)).toBe(expected);
  });

  it('returns undefined for an unknown extension', () => {
    expect(detectLanguage('data/blob.xyz')).toBeUndefined();
  });

  it('does not mistake a dotfile for an extension', () => {
    expect(detectLanguage('.gitignore')).toBeUndefined();
  });
});

describe('countLoc', () => {
  it('counts non-blank lines', () => {
    expect(countLoc('a\n\nb\n   \nc')).toBe(3);
  });

  it('returns zero for an empty file', () => {
    expect(countLoc('')).toBe(0);
  });
});

describe('summariseLanguages', () => {
  it('ranks by LOC descending', () => {
    const summary = summariseLanguages([
      { lang: 'Python', loc: 10 },
      { lang: 'TypeScript', loc: 100 },
      { lang: 'TypeScript', loc: 50 },
    ]);

    expect(summary.map((entry) => entry.name)).toEqual(['TypeScript', 'Python']);
    expect(summary[0]?.loc).toBe(150);
    expect(summary[0]?.fileCount).toBe(2);
  });

  it('computes share over code only, so docs cannot bury the real language', () => {
    const summary = summariseLanguages([
      { lang: 'Markdown', loc: 900 },
      { lang: 'TypeScript', loc: 100 },
    ]);

    const typescript = summary.find((entry) => entry.name === 'TypeScript');
    const markdown = summary.find((entry) => entry.name === 'Markdown');

    expect(typescript?.share).toBe(1);
    expect(markdown?.share).toBe(0);
    // Markdown is still reported — its presence is real signal for S2.
    expect(markdown?.loc).toBe(900);
  });

  it('ignores files with no detected language', () => {
    expect(summariseLanguages([{ lang: undefined, loc: 10 }])).toEqual([]);
  });

  it('survives a repo with zero code lines', () => {
    const summary = summariseLanguages([{ lang: 'TypeScript', loc: 0 }]);
    expect(summary[0]?.share).toBe(0);
  });

  it('classifies prose and config apart from code', () => {
    expect(isCodeLanguage('TypeScript')).toBe(true);
    expect(isCodeLanguage('Markdown')).toBe(false);
    expect(isCodeLanguage('JSON')).toBe(false);
  });
});
