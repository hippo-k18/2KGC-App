import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The checkout reminder (T363, `apps/organizer/src/lib/checkout-reminder*.ts`
 * and `/api/cron/checkout-reminder`) against the Firestore emulator. Run with
 * `npm run test:checkout-reminder`, which starts a private emulator on 8363.
 * Resend is a stubbed `fetch`: no mail leaves.
 */
const root = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  root,
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: path.resolve(root, 'tests/import-emulator/empty.ts') },
      { find: /^@\//, replacement: path.resolve(root, 'apps/organizer/src') + '/' },
      // The route under test is the dashboard's; its `next` is the dashboard's install.
      { find: /^next\/server$/, replacement: path.resolve(root, 'apps/organizer/node_modules/next/server.js') },
    ],
  },
  test: {
    include: ['tests/checkout-reminder/**/*.test.ts'],
    env: {
      WEB_PUBLIC_ORIGIN: 'https://www.knowledgegraph.tech',
      WEB_UNSUBSCRIBE_SECRET: 'checkout-reminder-test-secret-0123456789',
      CRON_SECRET: 'checkout-reminder-cron-secret-0123456789',
      CONSOLE_ALLOWLIST: 'owner@kgc.test',
    },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
