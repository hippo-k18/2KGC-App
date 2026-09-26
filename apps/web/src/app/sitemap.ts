import type { MetadataRoute } from 'next';
import { listPublicPages, siteVisibility } from '@/lib/data';
import { publicPosts } from '@/lib/blog/public';
import { requestHost } from '@/lib/indexing';

export const dynamic = 'force-dynamic';

/** The public pages that exist whatever the organizers have switched on. */
const PAGES = [
  '/', '/tickets', '/about', '/sponsor', '/exhibitors', '/announcements', '/documents', '/learn',
  '/hcls', '/call-for-posters', '/startup-pitch', '/community', '/team', '/previous-events',
  '/kgc-lifetime-achievement-awards', '/code-of-conduct', '/privacy',
];

/**
 * One sitemap per host: the blog's posts on blog.knowledgegraph.tech, the
 * site's pages everywhere else. Empty on a host that is not indexable, so the
 * disallow in `robots.ts` is not contradicted.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { origin, blog, indexable } = await requestHost();
  if (!indexable) return [];

  if (blog) {
    const posts = await publicPosts();
    return [
      { url: origin, changeFrequency: 'weekly', priority: 0.8 },
      ...posts.map((p) => ({ url: `${origin}/${p.slug}`, lastModified: p.date })),
    ];
  }

  const [show, pages] = await Promise.all([siteVisibility(), listPublicPages()]);
  const paths = [
    ...PAGES,
    ...(show.agenda ? ['/agenda'] : []),
    ...(show.speakers ? ['/speakers'] : []),
    ...pages.map((p) => `/${p.slug}`),
  ];
  return paths.map((p) => ({ url: p === '/' ? origin : origin + p, priority: p === '/' ? 1 : p === '/tickets' ? 0.9 : 0.6 }));
}
