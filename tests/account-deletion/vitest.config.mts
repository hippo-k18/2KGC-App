import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The account-deletion route on the Firestore and Auth emulators, on their own
 * ports (`firebase.account-deletion-test.json`), so a run never touches the
 * shared 8080/9099 emulator other work is using. `@` is the website's `src`,
 * as in `tests/group-purchase`.
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
    include: ['tests/account-deletion/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
