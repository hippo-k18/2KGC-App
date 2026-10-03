import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';
import { middleware } from '../../middleware';

/**
 * The middleware in both blog configurations: its own host (`BLOG_ORIGIN` set,
 * staging today) and `/blog` on the main site (unset, after the cutover).
 */
const WWW = 'https://www.knowledgegraph.tech';
const BLOG = 'https://blog.knowledgegraph.tech';

const saved = { blog: process.env.BLOG_ORIGIN, web: process.env.WEB_PUBLIC_ORIGIN };
afterEach(() => {
  for (const [k, v] of [['BLOG_ORIGIN', saved.blog], ['WEB_PUBLIC_ORIGIN', saved.web]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function hit(origin: string, path: string) {
  const url = new URL(path, origin);
  const res = middleware(new NextRequest(url, { headers: { host: url.host } }));
  return { status: res.status, location: res.headers.get('location'), rewrite: res.headers.get('x-middleware-rewrite') };
}

describe('blog at /blog on the main site (BLOG_ORIGIN unset)', () => {
  const setup = () => {
    delete process.env.BLOG_ORIGIN;
    process.env.WEB_PUBLIC_ORIGIN = WWW;
  };

  it('serves the blog, its listing and feed on the main host', () => {
    setup();
    for (const p of ['/blog', '/blog/some-post', '/blog?tag=LLMs', '/blog?category=KGC%20Talks&page=2', '/blog/feed.xml']) {
      const r = hit(WWW, p);
      expect(r.location, p).toBeNull();
      expect(r.status, p).toBe(200);
    }
  });

  it('sends every blog-host address to its new one on www in one 301', () => {
    setup();
    const cases: [string, string][] = [
      ['/', '/blog'],
      ['/some-post', '/blog/some-post'],
      ['/some-post/', '/blog/some-post'],
      ['/?tag=LLMs', '/blog?tag=LLMs'],
      ['/?category=KGC%20Talks&page=2', '/blog?category=KGC%20Talks&page=2'],
      ['/feed.xml', '/blog/feed.xml'],
      ['/write', '/blog/write'],
      ['/write/sign-in?email=a%40b.c', '/blog/write/sign-in?email=a%40b.c'],
      ['/login', '/blog/write'],
      ['/blog/some-post', '/blog/some-post'],
      ['/tickets', '/tickets'],
      ['/past-speakers/ora-lassila', '/past-speakers/ora-lassila'],
      ['/__site', '/'],
      ['/sitemap.xml', '/sitemap.xml'],
      ['/robots.txt', '/robots.txt'],
      ['/blog-media/abc.jpg', '/blog-media/abc.jpg'],
      // Old WordPress addresses under /blog go where they go on www.
      ['/blog/speakers/ora-lassila/', '/past-speakers/ora-lassila'],
      ['/blog/feed/', '/blog/feed.xml'],
    ];
    for (const [from, to] of cases) {
      const r = hit(BLOG, from);
      expect(r.status, from).toBe(301);
      expect(r.location, from).toBe(`${WWW}${to}`);
    }
  });

  it('sends old WordPress and past-speaker addresses on the blog host to their page, not under /blog', () => {
    setup();
    const cases: [string, string][] = [
      ['/speakers-2021/', '/past-speakers?year=2021'],
      ['/speakers-2021', '/past-speakers?year=2021'],
      ['/kgc-2023-speakers/', '/past-speakers?year=2023'],
      ['/conference-2019/speakers/', '/past-speakers?year=2019'],
      ['/speakers-2022-page', '/past-speakers?year=2022'],
      ['/about-kgc/', '/about'],
      ['/speakers/heather-hedden-2/', '/past-speakers/heather-hedden'],
      ['/category/kgc-2022', '/blog?category=KGC%202022'],
      // A post whose slug is also an old address stays the post.
      ['/call-for-speakers', '/blog/call-for-speakers'],
      // An unknown single segment may be a post written in the editor.
      ['/a-new-post', '/blog/a-new-post'],
      // Anything else unknown goes to the same address on www.
      ['/no/such/page/', '/no/such/page'],
    ];
    for (const [from, to] of cases) {
      const r = hit(BLOG, from);
      expect(r.status, from).toBe(301);
      expect(r.location, from).toBe(`${WWW}${to}`);
    }
  });

  it('lands old WordPress blog addresses on www in at most one hop', () => {
    setup();
    const slash = hit(WWW, '/blog/some-post/');
    expect(slash.location).toBe(`${WWW}/blog/some-post`);
    for (const p of ['/feed/', '/blog/feed/', '/comments/feed/']) {
      const r = hit(WWW, p);
      expect(r.status, p).toBe(301);
      expect(r.location, p).toBe(`${WWW}/blog/feed.xml`);
    }
    expect(hit(WWW, '/blog/category/kgc-2022/').location).toBe(`${WWW}/blog?category=KGC%202022`);
  });
});

describe('blog on its own host (BLOG_ORIGIN set), unchanged', () => {
  const setup = () => {
    process.env.BLOG_ORIGIN = BLOG;
    process.env.WEB_PUBLIC_ORIGIN = 'https://staging.knowledgegraph.tech';
  };

  it('sends /blog on the main host to the blog host', () => {
    setup();
    const r = hit('https://staging.knowledgegraph.tech', '/blog/some-post?x=1');
    expect(r.status).toBe(308);
    expect(r.location).toBe(`${BLOG}/some-post?x=1`);
  });

  it('serves posts on the blog host and sends main-site pages to the main site', () => {
    setup();
    expect(hit(BLOG, '/some-post').location).toBeNull();
    expect(hit(BLOG, '/tickets').location).toBe('https://staging.knowledgegraph.tech/tickets');
    expect(hit(BLOG, '/blog/some-post').location).toBe(`${BLOG}/some-post`);
  });

  it('points the old feeds at the blog host in one hop', () => {
    setup();
    for (const p of ['/feed/', '/comments/feed/']) expect(hit('https://staging.knowledgegraph.tech', p).location).toBe(`${BLOG}/feed.xml`);
  });
});
