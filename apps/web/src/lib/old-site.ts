import { EXACT, SECTIONS } from './old-site-map';
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
 */
export function oldSiteTarget(path: string): string | null {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const past = pastSpeakerTarget(p);
  if (past) return past;
  if (p in EXACT) return EXACT[p];
  for (const [prefix, to] of SECTIONS) {
    if (p === prefix || p.startsWith(prefix + '/')) return to;
  }
  return null;
}
