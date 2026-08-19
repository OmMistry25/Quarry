/**
 * What the verification-only test may be called.
 *
 * `verify.test.ts` is a JavaScript convention. Asking for `verify.test.py` would be both
 * unnatural and undiscoverable by pytest, which collects `test_*.py`. A Python generation
 * against psf/requests duly wrote something else and was rejected for a file-naming rule
 * that had no business applying to it.
 */
const PATTERNS = [
  // JS/TS: verify.test.ts, verify.test.mjs, verify.spec.js
  /^verify\.(test|spec)\.[cm]?[jt]sx?$/,
  // Python: test_verify.py, verify_test.py
  /^test_verify\.py$/,
  /^verify_test\.py$/,
];

export function isVerifyTestFile(basename: string): boolean {
  return PATTERNS.some((pattern) => pattern.test(basename));
}

/** Written into the prompt so the generator is told, not left to guess. */
export const VERIFY_TEST_NAMING =
  '`verify.test.<ext>` for JavaScript or TypeScript (e.g. `verify.test.ts`), or ' +
  '`test_verify.py` for Python';
