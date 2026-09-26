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

  /**
   * The development tools indicator, off.
   *
   * It is the dark circle in the corner of every page on localhost. It never
   * ships — it is a development-only overlay and the deployed sites have never
   * carried it — but it looks exactly like a hosting badge stamped on the
   * corner of the site, and it was read as one. Nothing about the build
   * changes; the overlay is simply not drawn.
   */
  devIndicators: false,

  /**
   * Trailing slashes are stripped in `src/middleware.ts` instead, after the old
   * WordPress addresses (which all had one) are redirected. Next's own strip
   * runs first and would make every old address two hops.
   */
  skipTrailingSlashRedirect: true,

  /**
   * A long blog post's JSON can pass the 1 MB default. Images do not come
   * through actions (see `app/blog-media/upload/route.ts`).
   */
  experimental: { serverActions: { bodySizeLimit: '4mb' } },

  /**
   * blog.knowledgegraph.tech is this app's `/blog` routes. Before the filesystem
   * check, so the blog host's `/` is the blog and not the home page. Paths with
   * a dot are files in `public/` and pass through; post slugs never have one.
   * See `src/lib/blog/host.ts`.
   */
  async rewrites() {
    const has = [{ type: 'host' as const, value: 'blog\\..*' }];
    return {
      beforeFiles: [
        { source: '/', has, destination: '/blog' },
        { source: '/feed.xml', has, destination: '/blog/feed.xml' },
        { source: '/:path((?!_next/|api/|blog-media/|kgc/|email/|blog/|blog$)[^.]*)', has, destination: '/blog/:path' },
      ],
      afterFiles: [],
      fallback: [],
    };
  },

  /**
   * Where the build output goes, overridable.
   *
   * `npm run build` here overwrites the `.next` a dev server on :3200 is
   * serving from, and the symptom is not an error: the build succeeds, the dev
   * server keeps answering 200, and every page renders as unstyled HTML
   * because the CSS chunk it links to no longer exists. AGENTS.md documents it
   * as costing half an hour every time somebody rediscovers it. Setting
   * `WEB_DIST_DIR` builds somewhere else instead, so a production build can be
   * made and served beside a running dev server rather than on top of it.
   * Unset, which is every deploy, this is exactly what it always was.
   */
  distDir: process.env.WEB_DIST_DIR || '.next',

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

  /**
   * No `x-powered-by: Next.js`. It tells a scanner which exploits to try first
   * and tells a visitor nothing.
   */
  poweredByHeader: false,

  /**
   * Security headers, set by the app rather than by whatever serves it, so
   * they travel with it: Apache on the droplet adds none of these, and the
   * pre-publish gate found all three missing on staging.
   *
   * - HSTS: a browser that has seen the site once never tries plain HTTP again.
   * - nosniff: a file is only ever run as the type it was served as.
   * - Framing: `SAMEORIGIN` plus CSP `frame-ancestors 'self'` (the modern
   *   form; old browsers read the first). The checkout embedded invisibly in
   *   another site, under that site's buttons, is clickjacking. Nothing embeds
   *   this site in a frame, and embedding *other* things (the session video
   *   player) is not affected.
   * - The Stripe webhook is never cached by anything between Stripe and here.
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
      {
        source: '/api/stripe/webhook',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },

  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true }, // `npm run lint` runs it separately
};

export default nextConfig;
