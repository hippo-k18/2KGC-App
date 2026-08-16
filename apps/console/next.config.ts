import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * This app has its own lockfile and its own `node_modules`, so Next's
   * heuristic picks the repo-root lockfile and warns. The console is
   * self-contained by design — it is not a member of the root npm workspace —
   * so the tracing root is this directory.
   */
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),

  /**
   * `@kgc/shared` and `@kgc/scripts` are workspace packages published as raw
   * TypeScript (their `main` points straight at `src/`), so Next has to compile
   * them rather than treat them as prebuilt node_modules.
   */
  transpilePackages: ['@kgc/shared', '@kgc/scripts'],

  /**
   * The Admin SDK must never be bundled — it is a native-ish Node package with
   * dynamic requires, and bundling it is also the first step down the road that
   * ends with a credential in a client chunk. Keeping it external means it is
   * `require()`d at runtime by the Node server and can never be reached from a
   * browser chunk at all.
   */
  serverExternalPackages: ['firebase-admin'],

  /**
   * `@kgc/shared` is `"type": "module"`, so its `index.ts` re-exports carry `.js`
   * specifiers — deliberately, per the comment in that file: Node's ESM resolver
   * rejects extensionless relative imports, and dropping them breaks the seed
   * scripts. TypeScript and Metro map them back to `.ts` on their own; webpack
   * does not, so it is told to here. Without this the console fails to build
   * with "Can't resolve './models.js'" and the tempting "fix" is to edit the
   * shared package, which would break `@kgc/scripts` at runtime instead.
   */
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },

  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true }, // `npm run lint` runs it separately
};

export default nextConfig;
