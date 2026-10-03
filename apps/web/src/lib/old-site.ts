import { EXACT, SECTIONS } from './old-site-map';
import { OLD_TERMS_PATHS, termsPublished } from './terms-core';
import OLD_CONTENT from './old-content-redirects.json';
import PAST_SPEAKER_REDIRECTS from '../content/past-speakers/redirects.json';
import PAST_YEARS from '../content/past-speakers/years.json';

const PAST: Record<string, string> = PAST_SPEAKER_REDIRECTS;

/**
 * An old speaker address (`/blog/speakers/<slug>/`, or one of the year lists)
 * to its page under `/past-speakers`, or `null`. One entry per address, from
 * the WordPress export; see `lib/past-speakers.ts`.
 *
 * Its own function because the blog host needs it too: an old `/blog/...` link
 * that arrives there is otherwise sent to the blog, which has no such post.
 */
export function pastSpeakerTarget(path: string): string | null {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  // A year archive's later pages (`/blog/speakers-category/2022/page/3/`) go
  // where its first page goes.
  return PAST[p] ?? PAST[p.replace(/\/page\/\d+$/, '')] ?? null;
}

/** The years `/past-speakers/<year>` has a list for. */
export const PAST_SPEAKER_YEARS: ReadonlySet<string> = new Set(PAST_YEARS.map((y) => String(y.year)));

/**
 * Where an address from the old WordPress site goes on this one, or `null`
 * when the path is not an old address.
 *
 * knowledgegraph.tech ran on WordPress until 2026-09-26. Search engines, old
 * newsletters and other people's links still point at its 926 addresses, so
 * each one answers with a single 301 to the closest page here, which is the
 * redirect that passes its search standing on. The map is in `old-site-map.ts`;
 * the reasoning is in `docs/audit-2026-09-19/domain/MOVE-TO-DOMAIN.md`.
 *
 * A trailing slash is ignored, because every WordPress address had one.
 *
 * In order, first match wins:
 * 1. Old speaker pages and speaker year lists, to their page under
 *    `/past-speakers` (`pastSpeakerTarget`).
 * 2. `old-content-redirects.json`: one row per old address, from the SEO
 *    review's redirect-map.csv (`scripts/import-redirect-map.mjs` writes it).
 * 3. The feeds, to the blog's real feed rather than its home page, which feed
 *    readers cannot parse. `/blog/feed.xml`, which the middleware sends on to
 *    the blog host when the blog has one.
 * 4. Old content with a copy on archive.knowledgegraph.tech: sessions
 *    (`/blog/agenda/*`), 2019–2021 partner pages (`/blog/partners/*`) and 2019
 *    photos (`/blog/portfolio/*`) go to the same address there, with the
 *    trailing slash the archive serves without a second redirect. The section
 *    roots themselves are not on the archive (403), so they keep their hub.
 * 5. The hub map in `old-site-map.ts`.
 */
export const ARCHIVE_ORIGIN = 'https://archive.knowledgegraph.tech';
export const ARCHIVED_SECTIONS = ['/blog/agenda', '/blog/partners', '/blog/portfolio'];

const FEEDS = new Set(['/feed', '/blog/feed', '/comments/feed']);

export function oldSiteTarget(path: string, env: Record<string, string | undefined> = process.env): string | null {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  // The old terms pages go to /terms once it is published, and to /tickets
  // (Ted's entries in `old-site-map.ts`, left as they are) until then.
  if (OLD_TERMS_PATHS.has(p) && termsPublished(env)) return '/terms';
  const past = pastSpeakerTarget(p);
  if (past) return past;
  const listed = (OLD_CONTENT as Record<string, string>)[p];
  if (listed) return listed;
  if (FEEDS.has(p)) return '/blog/feed.xml';
  for (const prefix of ARCHIVED_SECTIONS) {
    if (p.startsWith(prefix + '/')) return `${ARCHIVE_ORIGIN}${p}/`;
  }
  if (p in EXACT) return EXACT[p];
  for (const [prefix, to] of SECTIONS) {
    if (p === prefix || p.startsWith(prefix + '/')) return to;
  }
  return null;
}

/**
 * The old WordPress (Yoast) sitemaps: `sitemap_index.xml` and every
 * `<type>-sitemap.xml` / `<type>-sitemap2.xml` it listed (page, post,
 * speaker, category and so on). They all go to this site's one `/sitemap.xml`
 * in a single 301, so a search engine or tool holding the old address finds
 * the new map (SEO review, 2026-09-28). `/sitemap.xml` itself is not matched.
 */
export const oldSitemap = (path: string): boolean =>
  /^\/(?:sitemap_index|[a-z0-9_]+(?:-[a-z0-9_]+)*-sitemap\d*)\.xml$/i.test(path);
