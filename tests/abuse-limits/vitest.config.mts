import path from 'node:path';

import { defineConfig, type Plugin } from 'vitest/config';

/**
 * The abuse limits (T264) on every surface that mails a code or an email:
 * dashboard sign-in, the www ticket pass, the blog editor, the app OTP, the CFP
 * form and the invoice form. Real code from both apps against one Firestore
 * emulator on private ports (`firebase.abuse-limits-test.json`), with Resend
 * and Stripe replaced by stubs.
 *
 * `@/` resolves by which app the importing file belongs to, as in
 * `tests/blog-people`.
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
    include: ['tests/abuse-limits/**/*.test.ts'],
    env: {
      CONSOLE_SESSION_SECRET: 'test-console-secret-0123456789abcdef',
      CONSOLE_ALLOWLIST: 'owner@example.com',
      BLOG_EDITORS: 'editor@example.com',
      WEB_PUBLIC_ORIGIN: 'https://www.example.test',
      WEB_ORDER_SECRET: 'test-order-secret-test-order-secret-0123',
    },
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
