import { NextResponse, type NextRequest } from 'next/server';
import { separateBlogOrigin } from '@kgc/shared';
// Relative rather than `@/`, so `middleware.test.ts` can import this under
// Vitest, whose `@` is the Expo app's.
import { isBlogHost, mainSiteOrigin, MAIN_SITE_ROUTES, passesThrough, POSTS_OVER_OLD_SITE } from './lib/blog/host';
import { oldSitemap, oldSiteTarget, PAST_SPEAKER_YEARS, withQuery } from './lib/old-site';
import { REFERRAL_MAX_AGE, referralCookiesFrom } from './lib/referral-capture';
import { mainHostIndexable, NOINDEX_HEADER } from './lib/indexing-core';

/**
 * This request's own origin. Not `nextUrl.origin`, which reports the droplet's
 * 127.0.0.1 as localhost, and not `x-forwarded-proto` first, which Next fills
 * in as `http` itself when Apache sends none. A configured origin for this
 * host wins.
 */
function selfOrigin(request: NextRequest): string {
  const host = request.headers.get('host') ?? 'localhost';
  for (const o of [process.env.WEB_PUBLIC_ORIGIN, separateBlogOrigin()]) {
    try {
      if (o && new URL(o).host === host) return o.replace(/\/$/, '');
    } catch {}
  }
  return `${request.headers.get('x-forwarded-proto') ?? 'http'}://${host}`;
}

/**
 * Three jobs, in this order: the old WordPress addresses (one 301 each, see
 * `lib/old-site.ts`), trailing slashes (`skipTrailingSlashRedirect` hands them
 * here so an old address is one hop, not two), and the redirects half of
 * serving blog.knowledgegraph.tech; the rewrites are in `next.config.ts` (see
 * `lib/blog/host.ts` for why). Requests to any other host are untouched, except
 * `/blog` when `BLOG_ORIGIN` names the blog host. Without it the blog is `/blog`
 * here and the blog host only redirects (`movedBlog`).
 */
/** The main site's origin, as the blog host links to it. See `mainSiteOrigin`. */
const mainOrigin = mainSiteOrigin;

/** The addresses people guess for the blog editor. All lead to its sign-in. */
const SIGN_IN_ALIASES = new Set(['/login', '/log-in', '/signin', '/sign-in', '/admin', '/editor', '/dashboard', '/wp-admin', '/wp-login.php']);

export function middleware(request: NextRequest) {
  const res = route(request);
  const host = request.headers.get('host') ?? '';
  if (isBlogHost(host)) return res;
  // The main site stays out of search results until `SITE_INDEXABLE=true`
  // (see `lib/indexing-core.ts`). The blog host is never touched here.
  if (!mainHostIndexable(host, process.env.WEB_PUBLIC_ORIGIN)) {
    res.headers.set('X-Robots-Tag', NOINDEX_HEADER);
  }
  // On every main-site response, redirects included: an old address visited
  // with `?ref=` is a 301 whose target drops the query when the target names a
  // query of its own (`withQuery`), so the invite would be lost if only the
  // page that finally renders set the cookies.
  return withReferralCookies(request.nextUrl.searchParams, res);
}

function route(request: NextRequest): NextResponse {
  const url = request.nextUrl;
  const path = url.pathname;

  const blogHost = isBlogHost(request.headers.get('host'));
  const blogOrigin = separateBlogOrigin();
  if (blogHost && !blogOrigin) return movedBlog(request);

  // Before `passesThrough`, which lets every `/<name>.xml` through untouched.
  if (!blogHost && oldSitemap(path)) return NextResponse.redirect(`${selfOrigin(request)}/sitemap.xml`, 301);

  if (passesThrough(path)) return NextResponse.next();

  const bare = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const isBlogPath = (p: string) => p === '/blog' || p.startsWith('/blog/') || p.startsWith('/blog?');

  // An old speaker page is a `/blog/...` address that is not a post, so on the
  // blog host it goes to its page on the main site rather than to the blog.
  if (blogHost) {
    const target = oldSiteTarget(path);
    if (target?.startsWith('/past-speakers')) return NextResponse.redirect(`${mainOrigin()}${target}`, 301);
  }

  if (!blogHost) {
    // A year's list is `/past-speakers?year=2022`. `/past-speakers/2022` is the
    // address people guess, so it goes there, and a year there is no list for
    // goes to the whole list, either way in one hop.
    const yearPath = /^\/past-speakers\/(\d{4})$/.exec(bare);
    if (yearPath?.[1]) {
      const to = PAST_SPEAKER_YEARS.has(yearPath[1]) ? `/past-speakers?year=${yearPath[1]}` : '/past-speakers';
      return NextResponse.redirect(`${selfOrigin(request)}${to}`, 301);
    }
    if (bare === '/past-speakers' && url.searchParams.has('year') && !PAST_SPEAKER_YEARS.has(url.searchParams.get('year') ?? '')) {
      return NextResponse.redirect(`${selfOrigin(request)}/past-speakers`, 301);
    }

    // `/blog` targets go straight to the blog host, not through the 308 below,
    // so an old address is one hop.
    const target = oldSiteTarget(path);
    // Absolute targets (the archive) are already one hop.
    if (target && /^https?:\/\//.test(target)) return NextResponse.redirect(withQuery(target, url.search), 301);
    if (target) {
      const to = blogOrigin && isBlogPath(target) ? `${blogOrigin}${target.slice(5) || '/'}` : `${selfOrigin(request)}${target}`;
      return NextResponse.redirect(withQuery(to, url.search), 301);
    }
    if (blogOrigin && isBlogPath(bare)) {
      return NextResponse.redirect(`${blogOrigin}${bare.slice(5) || '/'}${url.search}`, 308);
    }
  }

  if (bare !== path) return NextResponse.redirect(`${selfOrigin(request)}${bare}${url.search}`, 308);

  if (!blogHost) {
    // `/register` is what people guess, and what Min's example link used. The
    // query string (an invite's `ref` and UTMs) goes along.
    if (path === '/register') return NextResponse.redirect(`${selfOrigin(request)}/tickets${url.search}`, 308);
    return NextResponse.next(); // referral cookies: see `middleware()`
  }

  if (SIGN_IN_ALIASES.has(path)) return NextResponse.redirect(`${blogOrigin ?? selfOrigin(request)}/write`, 307);

  // Old /blog links land on the same post without the prefix.
  if (isBlogPath(path)) {
    return NextResponse.redirect(`${blogOrigin ?? selfOrigin(request)}${path.slice(5) || '/'}${url.search}`, 308);
  }

  // The header's links to the rest of the site, and its logo (`/__site`), go
  // to the public site.
  const first = path.split('/')[1] ?? '';
  if (MAIN_SITE_ROUTES.has(first) || first === '__site') {
    const main = mainOrigin();
    const rest = first === '__site' ? path.slice(7) || '/' : path;
    // Permanent: these paths always belong to the main site. The menus link
    // there directly, so this only catches old or hand-typed links.
    return NextResponse.redirect(`${main}${rest}${url.search}`, 308);
  }

  return NextResponse.next();
}

/**
 * blog.knowledgegraph.tech once the blog is `/blog` on the main site
 * (`BLOG_ORIGIN` unset). Every address there is one 301 to its final address on
 * the main site, keeping the query (`?tag=`, `?category=`, `?page=`):
 *
 *   /                    → /blog
 *   /feed.xml            → /blog/feed.xml
 *   /write/…, sign-ins   → /blog/write/…
 *   /blog/…              → /blog/…   (old links that already had the prefix)
 *   /tickets, files…     → the same address, not under /blog (or its old-site target)
 *   an old WP address    → where it goes on the main site (`oldSiteTarget`)
 *   /<slug>              → /blog/<slug>
 *   anything else        → the same address
 *
 * The old-site map is read before a single segment is taken for a post, so
 * `/speakers-2021` or `/about-kgc` goes to its page rather than a missing post.
 * The archive posts whose slug is also an old address win over the map
 * (`POSTS_OVER_OLD_SITE`). A post written in the editor is not known here, so
 * any other single segment still goes under `/blog`. Only `/_next/` and `/api/`
 * are still served, for a page that was open when the blog moved.
 */
function movedBlog(request: NextRequest): NextResponse {
  const { pathname: path, search } = request.nextUrl;
  if (path.startsWith('/_next/') || path.startsWith('/api/')) return NextResponse.next();
  const bare = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const segments = bare.split('/').slice(1);
  const first = segments[0] ?? '';
  const go = (to: string, keepQuery = true) =>
    NextResponse.redirect(/^https?:\/\//.test(to) ? to : `${mainOrigin()}${to}${keepQuery ? search : ''}`, 301);

  if (bare === '/') return go('/blog');
  if (bare === '/feed.xml') return go('/blog/feed.xml');
  if (SIGN_IN_ALIASES.has(bare)) return go('/blog/write');
  if (first === 'write') return go(`/blog${bare}`);
  if (first === '__site') return go(bare.slice(7) || '/');
  if (first === 'blog') return oldTarget(bare) ?? go(bare);
  // `/speakers/<old-slug>` is a main-site route and an old speaker page.
  if (MAIN_SITE_ROUTES.has(first) || passesThrough(bare)) return oldTarget(bare) ?? go(bare);
  if (segments.length === 1 && POSTS_OVER_OLD_SITE.has(first)) return go(`/blog${bare}`);
  // `/category/kgc-2022` was only ever an address under `/blog`.
  return oldTarget(bare) ?? oldTarget(`/blog${bare}`) ?? go(segments.length === 1 ? `/blog${bare}` : bare);

  function oldTarget(p: string): NextResponse | null {
    const to = oldSiteTarget(p);
    return to ? go(to, false) : null;
  }
}

/**
 * Keep an attendee invite's `ref` and UTMs for checkout. See
 * `lib/referral-capture.ts`. The latest visit with a valid code wins, the same
 * last-touch rule the tracked-link cookie follows.
 */
function withReferralCookies(params: URLSearchParams, response: NextResponse): NextResponse {
  for (const { name, value } of referralCookiesFrom(params)) {
    response.cookies.set(name, value, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: REFERRAL_MAX_AGE,
    });
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.png).*)'],
};
