import SPEAKERS_JSON from '../content/past-speakers/speakers.json';
import YEARS_JSON from '../content/past-speakers/years.json';

/**
 * The people who spoke at KGC from 2019 to 2024, from the old WordPress site.
 *
 * WordPress had a page for each of them at `/blog/speakers/<slug>/`, and those
 * pages rank in Google for the speakers' names. They are rebuilt here at
 * `/past-speakers/<slug>` so the rankings move with them, each old address
 * answering with one 301 to its new page (`old-site.ts`).
 *
 * The data is a one-off export, committed to the repo, so these pages are built
 * at deploy time and never ask WordPress or Firestore for anything. It is
 * written by `scripts/import-past-speakers.mjs` from the export in
 * `orchestrator/data/speakers/`, which is also where the photos are made small.
 * Nothing here is edited by hand: re-run the import instead.
 *
 * No `server-only`: the middleware (through `old-site.ts`) and the tests import
 * this file.
 */

export interface PastTalk {
  /** Missing on a few talks of speakers with several years. */
  year?: number;
  /** Missing when the old page had only a recording. */
  title?: string;
  /** The session's page on the old site, when it had one. See `archiveHref()`. */
  url?: string;
  /** The recording, on watch.knowledgegraph.tech or YouTube, when the old page had one. */
  videoUrl?: string;
  /** The talk's abstract, held to the same tags as `bioHtml`. */
  descriptionHtml?: string;
}

export interface PastSpeaker {
  slug: string;
  name: string;
  /** Job title. */
  title?: string;
  company?: string;
  /** Oldest first. Empty for the two the old site never gave a year. */
  years: number[];
  /** A path under `public/`, square, or null when the old page had no photo. */
  photo: string | null;
  photoWidth?: number;
  photoHeight?: number;
  /** The photographer, where the old media library named one. Shown with the photo. */
  photoCredit?: string;
  /**
   * The biography as HTML, already cut down by the export to p, a, strong, em,
   * ul, ol, li and br. `past-speakers.test.ts` holds it to that list, because
   * the page renders it as HTML.
   */
  bioHtml: string;
  talks: PastTalk[];
  links: { linkedin?: string; twitter?: string; website?: string };
  /** Its address on the old site, which now redirects here. */
  oldUrl: string;
  /** When WordPress last saved the page, for the sitemap. */
  modified?: string;
}

export interface PastYear {
  year: number;
  /** In the order the old year page listed them. */
  slugs: string[];
}

export const PAST_SPEAKERS: readonly PastSpeaker[] = SPEAKERS_JSON as PastSpeaker[];
export const PAST_YEARS: readonly PastYear[] = [...(YEARS_JSON as PastYear[])].sort((a, b) => b.year - a.year);

const BY_SLUG = new Map(PAST_SPEAKERS.map((s) => [s.slug, s]));

export const pastSpeaker = (slug: string) => BY_SLUG.get(slug);

/** A year as it appears in a URL: four digits, one of the years there is a list for. */
export function pastYear(value: string | null | undefined): PastYear | undefined {
  if (!value || !/^\d{4}$/.test(value)) return undefined;
  return PAST_YEARS.find((y) => y.year === Number(value));
}

/** Everyone for a year in the old page's order, or everyone by surname. */
export function pastSpeakersFor(year?: PastYear): PastSpeaker[] {
  if (year) return year.slugs.map((s) => BY_SLUG.get(s)).filter((s): s is PastSpeaker => !!s);
  return [...PAST_SPEAKERS].sort(
    (a, b) => collator.compare(surname(a.name), surname(b.name)) || collator.compare(a.name, b.name),
  );
}

const collator = new Intl.Collator('en', { sensitivity: 'base' });
const surname = (name: string) => name.trim().split(/\s+/).pop() ?? '';

/** Lowercase and without accents, so typing `Bergstrom` finds `Bergström`. */
export const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Where a talk links. The old session pages are not moving yet, and their www
 * addresses now redirect to `/previous-events`, so a talk links to the same
 * path on archive.knowledgegraph.tech, the static copy of the old site.
 */
export function archiveHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url, 'https://www.knowledgegraph.tech');
    if (/^(www\.)?knowledgegraph\.tech$/i.test(u.hostname)) {
      return `https://archive.knowledgegraph.tech${u.pathname}${u.search}${u.hash}`;
    }
    return u.href;
  } catch {
    return undefined;
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The biography as plain text, for the meta description. */
export function bioText(html: string): string {
  return html
    .replace(/<\/(p|li)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** "2021, 2022 and 2023". */
export function yearList(years: readonly number[]): string {
  if (years.length < 2) return years.join('');
  return `${years.slice(0, -1).join(', ')} and ${years[years.length - 1]}`;
}

/**
 * The meta description: the biography's first sentence, or a line built from
 * the facts when there is no biography. At most about 160 characters, cut at a
 * word.
 */
export function pastSpeakerDescription(s: PastSpeaker): string {
  const text = bioText(s.bioHtml);
  // A sentence ends at . ! or ? followed by a space and a capital, so "Dr. Smith"
  // and "e.g. graphs" do not cut it short.
  const first = text.match(/^.+?[.!?](?=\s+["“(]?[A-Z]|$)/)?.[0] ?? text;
  const fallback = s.years.length
    ? `${s.name} spoke at the Knowledge Graph Conference in ${yearList(s.years)}.`
    : `${s.name} spoke at the Knowledge Graph Conference.`;
  const out = first.length >= 40 ? first : fallback;
  if (out.length <= 160) return out;
  return `${out.slice(0, 157).replace(/\s+\S*$/, '')}…`;
}

/** "Chief Scientist, Example Labs", either half alone, or nothing. */
export const roleLine = (s: Pick<PastSpeaker, 'title' | 'company'>) =>
  [s.title, s.company].filter((v) => v?.trim()).join(', ');
