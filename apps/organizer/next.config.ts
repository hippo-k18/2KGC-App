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
   * The development tools indicator, off.
   *
   * It is the dark circle in the corner of every screen on localhost. It never
   * ships — it is a development-only overlay and the deployed dashboard has
   * never carried it — but on a screen that is otherwise a one-to-one rebuild
   * of somebody else's product it reads as a badge somebody stamped on the
   * corner, and it was read as one. Nothing about the build changes.
   */
  devIndicators: false,

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

  /**
   * Server Action bodies up to 12 MB (Next's default is 1 MB), for the KGC |
   * Learn page editor's image upload, which takes photographs up to 10 MB and
   * resizes them on the server (T309). Every other upload still downsizes in
   * the browser and checks its own 900 KB cap in `upload-limits.ts`, so this
   * raises a ceiling none of them reach.
   */
  experimental: { serverActions: { bodySizeLimit: '12mb' } },

  /**
   * Where the build goes. `ORGANIZER_DIST_DIR` lets a test server build beside
   * a dev server that is already running here rather than on top of its
   * `.next` (AGENTS.md; `apps/web` has `WEB_DIST_DIR` for the same reason).
   * Unset, which is every deploy, this is `.next` as always.
   */
  distDir: process.env.ORGANIZER_DIST_DIR || '.next',

  /** No `x-powered-by: Next.js` on every response (T263). */
  poweredByHeader: false,

  /**
   * The same security headers as www (T263). www's HSTS `includeSubDomains`
   * does not cover this host until a browser has visited the apex, so a first
   * `http://` visit on conference Wi-Fi could be downgraded; this host now
   * sends its own. Framing is same-origin only: nothing outside should ever
   * show the dashboard in a frame, under its own buttons.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },

  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true }, // `npm run lint` runs it separately
};

export default nextConfig;
