import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/**
 * Same shape as `apps/organizer/next.config.ts`, and for the same reasons — see
 * the comments there. Both apps are self-contained (own lockfile, own
 * `node_modules`) and both consume `@kgc/shared` / `@kgc/scripts` as raw
 * TypeScript, so both need the same four accommodations.
 */
const nextConfig: NextConfig = {
  /** Own lockfile: Next's root heuristic would otherwise pick the repo root. */
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),

  /** The workspace packages ship raw `.ts`, so webpack has to compile them. */
  transpilePackages: ['@kgc/shared', '@kgc/scripts'],

  /**
   * The Admin SDK must never be bundled. Keeping it external means it is
   * `require()`d at runtime by the Node server and can never end up in a
   * browser chunk — which is the whole reason this site has no
   * `NEXT_PUBLIC_*` Firebase config either. `stripe` is server-side only here
   * (hosted Checkout, no Elements) so it gets the same treatment.
   */
  serverExternalPackages: ['firebase-admin', 'stripe'],

  /**
   * `@kgc/shared` is `"type": "module"`, so its `index.ts` re-exports carry
   * `.js` specifiers deliberately. TypeScript and Metro map them back to `.ts`;
   * webpack does not, so it is told to here. Without this the build fails with
   * "Can't resolve './models.js'" and the tempting fix — editing the shared
   * package — breaks `@kgc/scripts` at runtime instead.
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
