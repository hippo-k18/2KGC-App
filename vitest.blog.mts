import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The blog store's review-link write paths, against a real Firestore emulator.
 *
 * The blog collections have no rules and are written only through the Admin
 * SDK, so the store is the whole boundary, and the only test worth having runs
 * the real store rather than a copy of it. `server-only` is stubbed and `@/`
 * points at `apps/web/src`, for the reasons `vitest.cfa.mts` gives.
 *
 * Run on its own port, so it cannot collide with a dev emulator on 8080 or the
 * other emulator suites on 8097 and 8099:
 *
 *   npm run test:blog
 */
const empty = path.resolve(import.meta.dirname, 'tests/import-emulator/empty.ts');
const nextCache = path.resolve(import.meta.dirname, 'tests/blog/next-cache-stub.ts');

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: empty },
      { find: /^next\/cache$/, replacement: nextCache },
      { find: /^@\//, replacement: path.resolve(import.meta.dirname, 'apps/web/src') + '/' },
    ],
  },
  test: {
    include: ['tests/blog/**/*.test.ts'],
    env: { WEB_PUBLIC_ORIGIN: 'http://localhost:3200' },
    fileParallelism: false,
  },
});
