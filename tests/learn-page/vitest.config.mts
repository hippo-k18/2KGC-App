import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The Learn page editor's server half (T309) (`apps/organizer/src/lib/learn-page.ts`)
 * against the Firestore and Storage emulators. `@` is the dashboard's `src`, and
 * `server-only` is the empty stub the other emulator suites use.
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
    include: ['tests/learn-page/**/*.test.ts'],
    env: { FIREBASE_STORAGE_BUCKET: 'demo-learn-page.appspot.com' },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
