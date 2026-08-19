import { describe, expect, it } from 'vitest';

import { isVerifyTestFile, VERIFY_TEST_NAMING } from '../src/verify/verifyTestName.js';

describe('isVerifyTestFile', () => {
  it.each(['verify.test.ts', 'verify.test.js', 'verify.test.mjs', 'verify.spec.ts'])(
    'accepts the JavaScript form %s',
    (name) => {
      expect(isVerifyTestFile(name)).toBe(true);
    },
  );

  it.each(['test_verify.py', 'verify_test.py'])('accepts the Python form %s', (name) => {
    // Regression: a Python generation against psf/requests was rejected because the check
    // only knew `verify.test.*`, a JavaScript convention. pytest collects `test_*.py`, and
    // `verify.test.py` would not be collected at all.
    expect(isVerifyTestFile(name)).toBe(true);
  });

  it.each(['rubric.md', 'answer-key.md', 'verify.md', 'helpers.ts', 'test_helpers.py'])(
    'rejects %s',
    (name) => {
      expect(isVerifyTestFile(name)).toBe(false);
    },
  );

  it('names both conventions in the guidance handed to the generator', () => {
    expect(VERIFY_TEST_NAMING).toMatch(/verify\.test/);
    expect(VERIFY_TEST_NAMING).toMatch(/test_verify\.py/);
  });
});
