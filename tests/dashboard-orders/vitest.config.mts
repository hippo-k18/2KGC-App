import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The organizer dashboard's order code (`apps/organizer/src/lib`) against the
 * Firestore emulator. `@` is the dashboard's `src`, and `server-only` is the
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
  // Attendee Orders is rendered as a server component in the erasure test.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['tests/dashboard-orders/**/*.test.ts'],
    env: { WEB_ORDER_SECRET: 'test-order-secret-test-order-secret-0123', WEB_PUBLIC_ORIGIN: 'http://localhost:3200' },
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
