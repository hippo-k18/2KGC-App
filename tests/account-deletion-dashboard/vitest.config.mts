import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The dashboard's side of account deletion, on the same private emulator as
 * `tests/account-deletion`. Separate config because here `@` is the dashboard's
 * `src`, not the website's.
 */
const root = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  root,
  resolve: {
    alias: {
      '@': path.resolve(root, 'apps/organizer/src'),
      'server-only': path.resolve(root, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    include: ['tests/account-deletion-dashboard/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
