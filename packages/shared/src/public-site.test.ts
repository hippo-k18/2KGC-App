import { describe, expect, it } from 'vitest';
import { blogPublicOrigin, separateBlogOrigin } from './public-site';

describe('separateBlogOrigin', () => {
  const www = 'https://www.knowledgegraph.tech';

  it('is the blog host while BLOG_ORIGIN names one', () => {
    const env = { BLOG_ORIGIN: 'https://blog.knowledgegraph.tech/', WEB_PUBLIC_ORIGIN: 'https://staging.knowledgegraph.tech' };
    expect(separateBlogOrigin(env)).toBe('https://blog.knowledgegraph.tech');
    expect(blogPublicOrigin(env)).toBe('https://blog.knowledgegraph.tech');
  });

  it('is unset when BLOG_ORIGIN is unset, empty or names the main site', () => {
    for (const BLOG_ORIGIN of [undefined, '', ' ', www, `${www}/blog`, 'https://WWW.knowledgegraph.tech/']) {
      const env = { BLOG_ORIGIN, WEB_PUBLIC_ORIGIN: www };
      expect(separateBlogOrigin(env), String(BLOG_ORIGIN)).toBeUndefined();
      expect(blogPublicOrigin(env)).toBe(`${www}/blog`);
    }
  });

  it('falls back to www/blog with nothing configured', () => {
    expect(separateBlogOrigin({})).toBeUndefined();
    expect(blogPublicOrigin({})).toBe(`${www}/blog`);
  });
});
