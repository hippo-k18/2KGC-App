import path from 'node:path';

import { defineConfig, type Plugin } from 'vitest/config';

/**
 * The blog access list as both screens manage it: the website's blog People
 * page (`apps/web/src/lib/blog/people.ts` and its server actions) and the
 * dashboard's Admin Settings (`apps/organizer/src/lib/blog-access.ts`), against
 * one Firestore emulator.
 *
 * Both apps import their own code as `@/…`, so `@/` is resolved by which app
 * the importing file belongs to. The tests themselves import by path.
 */
const root = path.resolve(import.meta.dirname, '../..');
const web = path.join(root, 'apps/web/src');
const organizer = path.join(root, 'apps/organizer/src');

const twoApps: Plugin = {
  name: 'kgc-two-apps-at-sign',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!source.startsWith('@/') || !importer) return null;
    const base = importer.includes('/apps/organizer/') ? organizer : web;
    return this.resolve(path.join(base, source.slice(2)), importer, { ...options, skipSelf: true });
  },
};

export default defineConfig({
  root,
  plugins: [twoApps],
  resolve: {
    alias: [{ find: /^server-only$/, replacement: path.resolve(root, 'tests/import-emulator/empty.ts') }],
  },
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['tests/blog-people/**/*.test.ts'],
    env: {
      BLOG_EDITORS: 'owner@example.com',
      WEB_PUBLIC_ORIGIN: 'https://www.example.test',
      WEB_ORDER_SECRET: 'test-order-secret-test-order-secret-0123',
    },
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
