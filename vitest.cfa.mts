import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The Call for Abstracts write paths, against a real Firestore emulator.
 *
 * ── Why a config of its own, and why it has two projects ────────────────────
 *
 * This feature spans both websites — the public portal in `apps/web` writes the
 * submissions, the dashboard in `apps/organizer` writes the calls and the
 * decisions — and **both of them spell their own source root `@/`**. One alias
 * cannot mean two directories, so the suite is split into two Vitest projects
 * that differ in exactly that one line. They share the emulator and run in
 * sequence.
 *
 * `server-only` is stubbed for the reason `vitest.import-emulator.mts` gives:
 * the modules that hold the Firestore handle are the modules worth testing, and
 * a test against a re-implementation of a write path can agree with itself
 * while disagreeing with what ships. The stub is Node-side only — nothing here
 * bundles for a browser, so the marker has nothing to protect against.
 *
 * Run through the emulator, on an isolated port so it cannot collide with a
 * dev emulator on 8080 or with `test:programme-import` on 8099:
 *
 *   npm run test:cfa
 */
const empty = path.resolve(import.meta.dirname, 'tests/import-emulator/empty.ts');

/** Every project needs these; only the `@/` line differs. */
const shared = {
  /*
   * The token secret. `mintSubmissionToken` throws without one rather than
   * signing with a default, so the suite has to supply it — and the value is
   * the same dev secret `apps/web/.env.local.emulator` carries, so a link
   * minted by a test verifies in a hand-run dev server too.
   */
  env: {
    WEB_ORDER_SECRET: 'dev-only-order-secret-not-for-anything-real-0123456789',
    WEB_PUBLIC_ORIGIN: 'http://localhost:3200',
  },
  // Every case in a file shares one emulator database and clears it between
  // them, so two files must not run at once.
  fileParallelism: false,
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: [
            { find: /^server-only$/, replacement: empty },
            { find: /^@\//, replacement: path.resolve(import.meta.dirname, 'apps/web/src') + '/' },
          ],
        },
        test: { ...shared, name: 'cfa-portal', include: ['tests/cfa/portal.test.ts'] },
      },
      {
        resolve: {
          alias: [
            { find: /^server-only$/, replacement: empty },
            {
              find: /^@\//,
              replacement: path.resolve(import.meta.dirname, 'apps/organizer/src') + '/',
            },
          ],
        },
        test: { ...shared, name: 'cfa-organizer', include: ['tests/cfa/organizer.test.ts'] },
      },
    ],
  },
});
