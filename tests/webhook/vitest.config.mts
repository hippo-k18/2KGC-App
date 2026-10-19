import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The Stripe webhook route, loaded as the website loads it.
 *
 * Its own config because the root one points `@` at the app (`app/src`), and
 * the route imports everything through `@` meaning `apps/web/src`. Every module
 * that reaches Firestore, Stripe or Resend is mocked in the test itself, so this
 * suite needs no emulator and runs in a second.
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
    include: ['tests/webhook/**/*.test.ts'],
  },
});
