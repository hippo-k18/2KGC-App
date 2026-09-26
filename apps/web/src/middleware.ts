import { NextResponse, type NextRequest } from 'next/server';
import { isBlogHost, MAIN_SITE_ROUTES, passesThrough } from '@/lib/blog/host';

/**
 * The redirects half of serving blog.knowledgegraph.tech; the rewrites are in
 * `next.config.ts` (see `lib/blog/host.ts` for why). Requests to any other host
 * are untouched, except `/blog` when `BLOG_ORIGIN` names the blog host.
 */
export function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const path = url.pathname;

  if (passesThrough(path)) return NextResponse.next();

  if (!isBlogHost(request.headers.get('host'))) {
    const blogOrigin = process.env.BLOG_ORIGIN?.replace(/\/$/, '');
    if (blogOrigin && (path === '/blog' || path.startsWith('/blog/'))) {
      return NextResponse.redirect(`${blogOrigin}${path.slice(5) || '/'}${url.search}`, 308);
    }
    return NextResponse.next();
  }

  // Old /blog links land on the same post without the prefix. Not built from
  // `nextUrl`, which reports the droplet's 127.0.0.1 as localhost.
  if (path === '/blog' || path.startsWith('/blog/')) {
    const origin =
      process.env.BLOG_ORIGIN?.replace(/\/$/, '') ??
      `${request.headers.get('x-forwarded-proto') ?? 'http'}://${request.headers.get('host')}`;
    return NextResponse.redirect(`${origin}${path.slice(5) || '/'}${url.search}`, 308);
  }

  // The header's links to the rest of the site, and its logo (`/__site`), go
  // to the public site. BLOG_MAIN_ORIGIN, because the app's own
  // WEB_PUBLIC_ORIGIN is staging while the new site is being tested.
  const first = path.split('/')[1] ?? '';
  if (MAIN_SITE_ROUTES.has(first) || first === '__site') {
    const main = (process.env.BLOG_MAIN_ORIGIN ?? process.env.WEB_PUBLIC_ORIGIN ?? 'https://www.knowledgegraph.tech').replace(/\/$/, '');
    const rest = first === '__site' ? path.slice(7) || '/' : path;
    return NextResponse.redirect(`${main}${rest}${url.search}`, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.png).*)'],
};
