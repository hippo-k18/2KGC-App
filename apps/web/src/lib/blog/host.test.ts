import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isBlogHost, mainSiteLink, mainSiteOrigin, MAIN_SITE_ROUTES, passesThrough } from './host';

describe('blog host routing', () => {
  it('knows every top-level page of the main site, so none is mistaken for a post', () => {
    const app = join(import.meta.dirname, '..', '..', 'app');
    const dirs = readdirSync(app, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('[') && !d.name.startsWith('(') && !d.name.startsWith('_'))
      .map((d) => d.name)
      .filter((n) => !['blog', 'blog-media', 'api'].includes(n));
    expect([...MAIN_SITE_ROUTES].sort()).toEqual(dirs.sort());
  });
  it('recognises the blog host', () => {
    expect(isBlogHost('blog.knowledgegraph.tech')).toBe(true);
    expect(isBlogHost('blog.localhost:3210')).toBe(true);
    expect(isBlogHost('staging.knowledgegraph.tech')).toBe(false);
    expect(isBlogHost(null)).toBe(false);
  });
  it('lets assets and uploads through untouched', () => {
    expect(passesThrough('/_next/static/x.js')).toBe(true);
    expect(passesThrough('/blog-media/abc.jpg')).toBe(true);
    expect(passesThrough('/favicon.png')).toBe(true);
    expect(passesThrough('/some-post')).toBe(false);
  });
});

describe('mainSiteOrigin', () => {
  const saved = { web: process.env.WEB_PUBLIC_ORIGIN, main: process.env.BLOG_MAIN_ORIGIN };
  afterEach(() => {
    for (const [k, v] of [['WEB_PUBLIC_ORIGIN', saved.web], ['BLOG_MAIN_ORIGIN', saved.main]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('follows WEB_PUBLIC_ORIGIN over BLOG_MAIN_ORIGIN, so the blog links to the host serving the site', () => {
    process.env.WEB_PUBLIC_ORIGIN = 'https://staging.knowledgegraph.tech/';
    process.env.BLOG_MAIN_ORIGIN = 'https://www.knowledgegraph.tech';
    expect(mainSiteOrigin()).toBe('https://staging.knowledgegraph.tech');
  });

  it('falls back to BLOG_MAIN_ORIGIN, then www', () => {
    delete process.env.WEB_PUBLIC_ORIGIN;
    process.env.BLOG_MAIN_ORIGIN = 'https://main.example';
    expect(mainSiteOrigin()).toBe('https://main.example');
    delete process.env.BLOG_MAIN_ORIGIN;
    expect(mainSiteOrigin()).toBe('https://www.knowledgegraph.tech');
  });
});

describe('mainSiteLink', () => {
  const saved = { blog: process.env.BLOG_ORIGIN, web: process.env.WEB_PUBLIC_ORIGIN };
  afterEach(() => {
    for (const [k, v] of [['BLOG_ORIGIN', saved.blog], ['WEB_PUBLIC_ORIGIN', saved.web]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('makes main-site pages absolute while the blog has its own host', () => {
    process.env.BLOG_ORIGIN = 'https://blog.knowledgegraph.tech';
    process.env.WEB_PUBLIC_ORIGIN = 'https://staging.knowledgegraph.tech';
    expect(mainSiteLink('/tickets')).toBe('https://staging.knowledgegraph.tech/tickets');
    expect(mainSiteLink('/learn?x=1#top')).toBe('https://staging.knowledgegraph.tech/learn?x=1#top');
    // The blog's own paths, absolute URLs and protocol-relative ones stay as they were.
    for (const href of ['/some-post', '/?tag=LLMs', 'https://example.com/a', '//cdn.example/x', '#top']) {
      expect(mainSiteLink(href)).toBe(href);
    }
  });

  it('leaves every link alone without BLOG_ORIGIN, where /blog is a main-site page', () => {
    delete process.env.BLOG_ORIGIN;
    expect(mainSiteLink('/tickets')).toBe('/tickets');
  });
});
