import { NextResponse, type NextRequest } from 'next/server';
import { isBlogHost, MAIN_SITE_ROUTES, passesThrough } from '@/lib/blog/host';
import { oldSiteTarget, PAST_SPEAKER_YEARS } from '@/lib/old-site';
import { REFERRAL_MAX_AGE, referralCookiesFrom } from '@/lib/referral-capture';

/**
 * This request's own origin. Not `nextUrl.origin`, which reports the droplet's
 * 127.0.0.1 as localhost, and not `x-forwarded-proto` first, which Next fills
 * in as `http` itself when Apache sends none. A configured origin for this
 * host wins.
 */
function selfOrigin(request: NextRequest): string {
  const host = request.headers.get('host') ?? 'localhost';
  for (const o of [process.env.WEB_PUBLIC_ORIGIN, process.env.BLOG_ORIGIN]) {
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
 * `/blog` when `BLOG_ORIGIN` names the blog host.
 */
/** The main site's origin, as the blog host links to it. */
const mainOrigin = () =>
  (process.env.BLOG_MAIN_ORIGIN ?? process.env.WEB_PUBLIC_ORIGIN ?? 'https://www.knowledgegraph.tech').replace(/\/$/, '');

/** The addresses people guess for the blog editor. All lead to its sign-in. */
const SIGN_IN_ALIASES = new Set(['/login', '/log-in', '/signin', '/sign-in', '/admin', '/editor', '/dashboard', '/wp-admin', '/wp-login.php']);

export function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const path = url.pathname;

  if (passesThrough(path)) return NextResponse.next();

  const blogHost = isBlogHost(request.headers.get('host'));
  const blogOrigin = process.env.BLOG_ORIGIN?.replace(/\/$/, '');
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
    if (target) {
      const to = blogOrigin && isBlogPath(target) ? `${blogOrigin}${target.slice(5) || '/'}` : `${selfOrigin(request)}${target}`;
      return NextResponse.redirect(to, 301);
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
    return withReferralCookies(url.searchParams, NextResponse.next());
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
    return NextResponse.redirect(`${main}${rest}${url.search}`, 307);
  }

  return NextResponse.next();
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
