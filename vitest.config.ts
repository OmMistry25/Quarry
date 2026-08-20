import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        // Resolve the `core` workspace package to its source, so `pnpm test` works on a
        // fresh clone without a build first. Exact match only — `core-js` must not hit this.
        find: /^core$/,
        replacement: fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'work/**'],
    environment: 'node',
    // Stage tests shell out to git/subprocesses; keep the default generous but bounded.
    testTimeout: 30_000,
  },
});
