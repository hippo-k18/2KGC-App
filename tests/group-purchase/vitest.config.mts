import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The webhook suite's aliases (`@` is the website's `src`), for a suite that
 * also needs the Firestore emulator. Kept apart from `tests/webhook` so that
 * `npm run test:webhook` still runs with nothing else started.
 */
const root = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  root,
  resolve: {
    alias: {
      '@': path.resolve(root, 'apps/web/src'),
      'server-only': path.resolve(root, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    include: ['tests/group-purchase/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
