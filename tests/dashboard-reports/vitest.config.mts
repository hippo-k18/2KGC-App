import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The dashboard's Reports queue (`apps/organizer/src/lib/reports.ts`) against
 * the Firestore emulator. `@` is the dashboard's `src`, and `server-only` is the
 * empty stub the other emulator suites use.
 */
const root = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  root,
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: path.resolve(root, 'tests/import-emulator/empty.ts') },
      { find: /^@\//, replacement: path.resolve(root, 'apps/organizer/src') + '/' },
    ],
  },
  test: {
    include: ['tests/dashboard-reports/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
