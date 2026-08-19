import { describe, expect, it } from 'vitest';

import { slugFromRef, timestampSlug } from '../src/run.js';

describe('slugFromRef', () => {
  it.each([
    ['https://github.com/acme/my-repo.git', 'my-repo'],
    ['https://github.com/acme/my-repo', 'my-repo'],
    ['https://github.com/acme/my-repo/', 'my-repo'],
    ['git@github.com:acme/My_Repo.git', 'my_repo'],
    ['/src/projects/signal-engine', 'signal-engine'],
    ['./relative/path/', 'path'],
    ['https://github.com/acme/repo?ref=main', 'repo'],
  ])('derives %s → %s', (ref, expected) => {
    expect(slugFromRef(ref)).toBe(expected);
  });

  it('falls back rather than producing an empty slug', () => {
    expect(slugFromRef('///')).toBe('repo');
    expect(slugFromRef('!!!')).toBe('repo');
  });
});

describe('timestampSlug', () => {
  it('formats UTC as a sortable directory name', () => {
    expect(timestampSlug(new Date('2026-08-19T07:54:31.000Z'))).toBe('20260819-075431');
  });

  it('zero-pads every field', () => {
    expect(timestampSlug(new Date('2026-01-02T03:04:05.000Z'))).toBe('20260102-030405');
  });
});
