import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * One config for all three suites, which are run by path rather than by project:
 * `vitest run tests/rules` (the security boundary), `vitest run scripts/src`
 * (timezone derivation) and `vitest run app/src` (the agenda filter predicate).
 *
 * It exists only for the alias. `app/src/lib/data/sessions.ts` imports its
 * neighbours through `@/`, which `tsc` reads from `app/tsconfig.json` and Metro
 * from `babel.config.js`; Vitest reads neither, so without this line the agenda
 * predicate is the one pure function in the app that cannot be tested where it
 * lives. The rules and scripts suites use no aliases and are unaffected.
 *
 * `.mts` rather than `.ts` because the repo root has no `"type": "module"`, and
 * Vite's native config loader warns on ESM in a file it has to treat as CommonJS.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'app/src'),
    },
  },
});
