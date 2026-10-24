import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The dashboard's Email Log (T274) (`apps/organizer/src/lib/email-log*.ts`,
 * `email-schedule*.ts`) against the Firestore emulator. `@` is the dashboard's
 * `src`, and `server-only` is the empty stub the other emulator suites use.
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
    include: ['tests/email-log/**/*.test.ts'],
    env: { WEB_PUBLIC_ORIGIN: 'http://localhost:3200' },
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
