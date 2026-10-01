/**
 * The blog lives at blog.knowledgegraph.tech, served by this same app from its
 * `/blog` routes. The rewrites are in `next.config.ts` and the redirects in
 * `middleware.ts`; this file holds the facts they and the pages share. No
 * `server-only`: the middleware imports it.
 *
 * Why not rewrite in middleware: on the droplet the server binds 127.0.0.1,
 * NextURL reports that as localhost, and Next then treats a middleware rewrite
 * as another origin and proxies it as a fresh HTTP request with the Host
 * changed. Config rewrites happen in-process and keep the Host header.
 *
 * On the blog host:
 *   /                  → /blog
 *   /<slug>            → /blog/<slug>
 *   /write/...         → /blog/write/...   (the editor)
 *   /blog/...          → redirect, dropping /blog, so old links still land
 *   /about, /tickets…  → redirect to the main site, since the header links there
 *
 * Everywhere else, `/blog/...` is served as it always was, unless `BLOG_ORIGIN`
 * is set, in which case it redirects to the blog host.
 */

export const isBlogHost = (host: string | null | undefined) => /^blog\./i.test(host ?? '');

/**
 * The main site's top-level routes. On the blog host these redirect to the main
 * site, and every other first segment is taken to be a post slug.
 * `host.test.ts` checks this list against `src/app`, so a new page cannot be
 * left out and silently read as a missing blog post.
 */
export const MAIN_SITE_ROUTES = new Set([
  'about', 'agenda', 'announcements', 'call-for-posters', 'checkout', 'code-of-conduct',
  'community', 'consent', 'documents', 'exhibitor', 'exhibitors', 'hcls',
  'kgc-lifetime-achievement-awards', 'learn', 'order', 'past-speakers', 'previous-events', 'privacy', 'r',
  'review', 'rooms', 'search', 'speaker', 'speakers', 'sponsor', 'startup-pitch', 'submit',
  'team', 'ticket', 'tickets', 'u',
]);

/** Paths that pass through untouched on either host. */
export const passesThrough = (path: string) =>
  path.startsWith('/_next/') ||
  path.startsWith('/api/') ||
  path.startsWith('/blog-media/') ||
  path.startsWith('/kgc/') ||
  path.startsWith('/email/') ||
  /^\/[^/]+\.(png|jpe?g|gif|svg|ico|webp|txt|xml|webmanifest)$/i.test(path);

/**
 * The main site's origin, as the blog host links to it: `WEB_PUBLIC_ORIGIN`
 * (staging today, www after the cutover), then `BLOG_MAIN_ORIGIN`, then www.
 *
 * `WEB_PUBLIC_ORIGIN` comes first so the blog's menu always points at the host
 * that is actually serving this app. While www was back on WordPress after the
 * rollback, `BLOG_MAIN_ORIGIN=www` sent blog readers who clicked About or
 * Learn to WordPress, which answers an unknown path with its latest post (SEO
 * review, 2026-09-28).
 */
export const mainSiteOrigin = () =>
  (process.env.WEB_PUBLIC_ORIGIN ?? process.env.BLOG_MAIN_ORIGIN ?? 'https://www.knowledgegraph.tech').replace(
    /\/$/,
    '',
  );

/**
 * A link a blog page renders, made absolute when it points at a main-site page
 * and the blog has its own host (`BLOG_ORIGIN`). Then `/learn` in a post goes
 * straight to the main site's `/learn` instead of through the blog host's
 * redirect. Anything else (the blog's own paths, absolute URLs, anchors) is
 * returned as it was.
 */
export function mainSiteLink(href: string): string {
  if (!process.env.BLOG_ORIGIN || !href.startsWith('/') || href.startsWith('//')) return href;
  const first = href.slice(1).split(/[/?#]/)[0] ?? '';
  return MAIN_SITE_ROUTES.has(first) ? `${mainSiteOrigin()}${href}` : href;
}
