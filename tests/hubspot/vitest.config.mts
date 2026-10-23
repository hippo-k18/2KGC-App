import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The HubSpot contact sync (T333, `scripts/src/lib/hubspot-*`) against the
 * Firestore emulator and the fake HubSpot in `fake-hubspot.mjs`. Run with
 * `npm run test:hubspot`, which starts a private emulator on 8197 so it never
 * shares data with another suite.
 */
const root = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  root,
  test: {
    include: ['tests/hubspot/**/*.test.ts'],
    env: { WEB_ORDER_SECRET: 'hubspot-test-order-secret-0123456789' },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
