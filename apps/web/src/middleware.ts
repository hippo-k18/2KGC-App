import { NextResponse, type NextRequest } from 'next/server';
import { isBlogHost, MAIN_SITE_ROUTES, passesThrough } from '@/lib/blog/host';
import { oldSiteTarget } from '@/lib/old-site';

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
export function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const path = url.pathname;

  if (passesThrough(path)) return NextResponse.next();

  const blogHost = isBlogHost(request.headers.get('host'));
  const blogOrigin = process.env.BLOG_ORIGIN?.replace(/\/$/, '');
  const bare = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const isBlogPath = (p: string) => p === '/blog' || p.startsWith('/blog/') || p.startsWith('/blog?');

  if (!blogHost) {
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

  if (!blogHost) return NextResponse.next();

  // Old /blog links land on the same post without the prefix.
  if (isBlogPath(path)) {
    return NextResponse.redirect(`${blogOrigin ?? selfOrigin(request)}${path.slice(5) || '/'}${url.search}`, 308);
  }

  // The header's links to the rest of the site, and its logo (`/__site`), go
  // to the public site.
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
