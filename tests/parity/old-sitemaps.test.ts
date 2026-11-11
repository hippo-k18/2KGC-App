/** The old Yoast sitemaps redirect to `/sitemap.xml`; nothing else does. */
import { describe, expect, it } from 'vitest';
import { oldSitemap } from '../../apps/web/src/lib/old-site';

describe('old WordPress sitemaps', () => {
  it('matches the index and every <type>-sitemap.xml Yoast served', () => {
    for (const p of ['/sitemap_index.xml', '/page-sitemap.xml', '/post-sitemap.xml', '/speaker-sitemap.xml', '/speaker-sitemap2.xml', '/category-sitemap.xml', '/post_tag-sitemap.xml', '/author-sitemap.xml', '/kgc-speakers-sitemap.xml']) {
      expect(oldSitemap(p), p).toBe(true);
    }
  });

  it('leaves the new sitemap and everything else alone', () => {
    for (const p of ['/sitemap.xml', '/feed.xml', '/robots.txt', '/blog/sitemap.xml', '/page-sitemap.xml/extra', '/sitemap-index.xml']) {
      expect(oldSitemap(p), p).toBe(false);
    }
  });
});
