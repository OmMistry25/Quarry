import { describe, expect, it } from 'vitest';

import { extractJsonObject } from '../src/agent/json.js';

describe('extractJsonObject', () => {
  it('returns a bare object unchanged', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('unwraps a ```json fence', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('unwraps an unlabelled fence', () => {
    expect(extractJsonObject('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('ignores prose either side of the object', () => {
    expect(extractJsonObject('Here you go:\n{"a":1}\nHope that helps!')).toBe('{"a":1}');
  });

  it('keeps nested objects intact', () => {
    const json = '{"a":{"b":{"c":1}},"d":2}';
    expect(extractJsonObject(json)).toBe(json);
  });

  it('is not fooled by a brace inside a string', () => {
    const json = '{"note":"a } inside a string","ok":true}';
    expect(extractJsonObject(json)).toBe(json);
  });

  it('is not fooled by an escaped quote before a brace', () => {
    const json = '{"note":"he said \\"}\\" loudly","ok":true}';
    expect(extractJsonObject(json)).toBe(json);
  });

  it('returns undefined when there is no object at all', () => {
    expect(extractJsonObject('I could not do that.')).toBeUndefined();
  });

  it('returns undefined for an unterminated object', () => {
    expect(extractJsonObject('{"a":1')).toBeUndefined();
  });
});
