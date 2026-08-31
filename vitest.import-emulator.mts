import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The programme importers, against a real Firestore emulator.
 *
 * A separate config because it needs two aliases the other suites must not
 * have. `@/` points at the dashboard rather than the app — the root config
 * points it at `app/src` — and `server-only` is stubbed out, because the module
 * under test is the one that holds the Firestore handle and therefore carries
 * that marker. Exercising the real writer is the point: a test against a copy
 * of the write path can agree with itself while disagreeing with what ships.
 *
 * Run through the emulator, and on an isolated port so it cannot collide with
 * one somebody else is already using:
 *
 *   firebase emulators:exec --only firestore --config firebase.import-test.json \
 *     "npx vitest run --config vitest.import-emulator.mts"
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: path.resolve(import.meta.dirname, 'tests/import-emulator/empty.ts') },
      { find: /^@\//, replacement: path.resolve(import.meta.dirname, 'apps/organizer/src') + '/' },
    ],
  },
  test: {
    // Named `import-emulator` rather than `programme-import` on purpose: the
    // root `npm test` filters by path prefix (`tests/programme`), and a
    // directory starting with that string is picked up by it — under the root
    // config, which has neither of the aliases below, so every file fails to
    // resolve. The scoping here is load-bearing too: without it Vitest walks the whole repo
    // and picks up the rules, functions and commerce suites, which need an auth
    // and a functions emulator this config does not start.
    include: ['tests/import-emulator/**/*.test.ts'],
    // The cases share one emulator database and clear it between them.
    fileParallelism: false,
  },
});
