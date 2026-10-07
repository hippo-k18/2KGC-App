import type { MetadataRoute } from 'next';
import { separateBlogOrigin } from '@kgc/shared';
import { listPublicPages, siteVisibility } from '@/lib/data';
import { publicPosts } from '@/lib/blog/public';
import { requestHost } from '@/lib/indexing';
import { PAST_SPEAKERS, PAST_YEARS } from '@/lib/past-speakers';
import { termsPublished } from '@/lib/terms-core';

export const dynamic = 'force-dynamic';

/** The public pages that exist whatever the organizers have switched on. */
const PAGES = [
  '/', '/tickets', '/about', '/sponsor', '/exhibitors', '/announcements', '/documents', '/learn',
  '/hcls', '/call-for-posters', '/startup-pitch', '/community', '/team', '/previous-events',
  '/kgc-lifetime-achievement-awards', '/code-of-conduct', '/privacy',
];

/**
 * One sitemap per host: the blog's posts on blog.knowledgegraph.tech, the
 * site's pages everywhere else. Without a separate `BLOG_ORIGIN` the blog is
 * `/blog` here, so its home and posts join the site's map, and the blog host's
 * `/sitemap.xml` is a 301 to this one. Empty on a host that is not indexable, so the
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

  const [show, pages, posts] = await Promise.all([
    siteVisibility(),
    listPublicPages(),
    separateBlogOrigin() ? [] : publicPosts(),
  ]);
  const paths = [
    ...PAGES,
    ...(show.agenda ? ['/agenda'] : []),
    ...(show.speakers ? ['/speakers'] : []),
    ...pages.map((p) => `/${p.slug}`),
    // Only once the terms are published; until then `/terms` is a 404.
    ...(termsPublished() ? ['/terms'] : []),
  ];
  return [
    ...paths.map((p) => ({ url: p === '/' ? origin : origin + p, priority: p === '/' ? 1 : p === '/tickets' ? 0.9 : 0.6 })),
    // The pages rebuilt from the old site's speaker pages, which rank for the
    // speakers' names. See `lib/past-speakers.ts`.
    { url: `${origin}/past-speakers`, priority: 0.5 },
    ...PAST_YEARS.map((y) => ({ url: `${origin}/past-speakers?year=${y.year}`, priority: 0.4 })),
    ...PAST_SPEAKERS.map((s) => ({
      url: `${origin}/past-speakers/${s.slug}`,
      priority: 0.4,
      ...(s.modified ? { lastModified: s.modified } : {}),
    })),
    ...(separateBlogOrigin()
      ? []
      : [
          { url: `${origin}/blog`, changeFrequency: 'weekly' as const, priority: 0.8 },
          ...posts.map((p) => ({ url: `${origin}/blog/${p.slug}`, lastModified: p.date })),
        ]),
  ];
}
