import { NextResponse, type NextRequest } from 'next/server';
import { BLOG_HOST_HEADER, isBlogHost, MAIN_SITE_ROUTES, passesThrough } from '@/lib/blog/host';

/**
 * Serves blog.knowledgegraph.tech from this app's `/blog` routes. The mapping
 * is described in `lib/blog/host.ts`. Requests to any other host are untouched,
 * except `/blog` when `BLOG_ORIGIN` names the blog host.
 */
export function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const path = url.pathname;
  const host = request.headers.get('host');

  if (passesThrough(path) && !(path === '/feed.xml' && isBlogHost(host))) return NextResponse.next();

  if (!isBlogHost(host)) {
    const blogOrigin = process.env.BLOG_ORIGIN?.replace(/\/$/, '');
    if (blogOrigin && (path === '/blog' || path.startsWith('/blog/'))) {
      return NextResponse.redirect(`${blogOrigin}${path.slice(5) || '/'}${url.search}`, 308);
    }
    if (!request.headers.has(BLOG_HOST_HEADER)) return NextResponse.next();
    // Only this function may say a request came in on the blog host.
    const headers = new Headers(request.headers);
    headers.delete(BLOG_HOST_HEADER);
    return NextResponse.next({ request: { headers } });
  }

  if (path === '/blog' || path.startsWith('/blog/')) {
    const to = url.clone();
    to.pathname = path.slice(5) || '/';
    return NextResponse.redirect(to, 308);
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

  const headers = new Headers(request.headers);
  headers.set(BLOG_HOST_HEADER, '1');
  const to = url.clone();
  to.pathname = path === '/' ? '/blog' : `/blog${path}`;
  return NextResponse.rewrite(to, { request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.png).*)'],
};
