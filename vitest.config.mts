import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * One config for all three suites, which are run by path rather than by project:
 * `vitest run tests/rules` (the security boundary), `vitest run scripts/src`
 * (timezone derivation) and `vitest run app/src` (the agenda filter predicate).
 *
 * It exists only for the aliases. `app/src/lib/data/sessions.ts` imports its
 * neighbours through `@/`, which `tsc` reads from `app/tsconfig.json` and Metro
 * from `babel.config.js`; Vitest reads neither, so without this line the agenda
 * predicate is the one pure function in the app that cannot be tested where it
 * lives. The rules and scripts suites use no aliases and are unaffected.
 *
 * ── And `server-only`, which is a module that exists to throw ───────────────
 *
 * Next.js swaps it for an empty file under the `react-server` condition and
 * leaves it throwing everywhere else, which is exactly the point: a client
 * bundle that reaches for a credential fails to build. Vitest is neither, so
 * every module marked that way was unimportable, and the refund rules were
 * pinned by *re-implementing* the queries beside them in `tests/commerce` —
 * copies that agree with themselves for ever while the original drifts. That is
 * how the one path with money on it ended up with a test that could not fail.
 * Aliased to the package's own empty file, so the marker keeps its meaning for
 * the website's build and stops hiding the code from the emulator suite.
 *
 * `.mts` rather than `.ts` because the repo root has no `"type": "module"`, and
 * Vite's native config loader warns on ESM in a file it has to treat as CommonJS.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'app/src'),
      'server-only': path.resolve(import.meta.dirname, 'node_modules/server-only/empty.js'),
    },
  },
});
