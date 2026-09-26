import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBlogHost, MAIN_SITE_ROUTES, passesThrough } from './host';

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
