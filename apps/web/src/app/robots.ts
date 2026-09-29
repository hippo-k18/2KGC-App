import type { MetadataRoute } from 'next';
import { requestHost } from '@/lib/indexing';

export const dynamic = 'force-dynamic';

/** Open on the real site and the blog, closed everywhere else. See `lib/indexing.ts`. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const { origin, blog, indexable } = await requestHost();
  if (!indexable) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Private pages: capability links, the blog editor, checkout internals.
      // `/tickets/checkout` and the other two are listed themselves: a rule for
      // `/checkout/` does not match `/tickets/checkout`. Robots rules are
      // prefixes, so each also covers its `?tier=` variants.
      disallow: blog
        ? ['/write']
        : ['/api/', '/order/', '/ticket/', '/checkout/', '/tickets/checkout', '/tickets/exhibitor', '/tickets/invoice', '/consent/', '/speaker/', '/review/', '/u/', '/r/'],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
