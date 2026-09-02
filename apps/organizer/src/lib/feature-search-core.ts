/**
 * Matching and ranking for the feature search in the dark header.
 *
 * Pure and dependency-free, so it is tested from `tests/programme/` the same
 * way `conflicts-core.ts` and `pairings-core.ts` are. The component in
 * `src/app/(dash)/feature-search.tsx` only renders what this returns — ordering
 * this fiddly does not belong inside a React component where nothing can reach
 * it.
 *
 * It replaced a plain substring pass that ranked built screens first. That
 * sounded reasonable and was wrong for the query organizers actually type: a
 * single noun naming a *section*. Typing "ticket" put `Ticket Add-ons`,
 * `Payout` and `Summary` at the top and pushed `Tickets` itself off the list
 * entirely, because the nine top-level tabs are section headers served by the
 * catch-all and therefore not in `IMPLEMENTED`. Whether a screen is built is a
 * detail of *our* progress; it is not evidence about what the organizer meant.
 * So it is now the last tiebreaker rather than the first sort key, and how
 * closely the node's own title matches comes first.
 *
 * `built` sits below title length for the same reason. At equal rank and depth,
 * "ticket" ties `Ticket Setup` — a group header, so not in `IMPLEMENTED` —
 * against `Ticket Session Mapping`, a built leaf that happens to live under
 * Attendees. Sorting on built put the leaf second and the group fourth; the
 * shorter title is the better guess at which one the organizer meant, because
 * a short title under the section you just named is the section's own
 * scaffolding.
 *
 * Two normalisations, both paid for by real misses against the live tree:
 *
 *   - `&` is deleted rather than spaced, so `Session Q&A Manager` indexes as
 *     "session qa manager" and the query "qa" finds it. The old component's
 *     docblock claimed "qa" already worked. It did not — `qa` is not a
 *     substring of `q&a` — which is the "claims capabilities it does not have"
 *     defect AGENTS.md warns about, in the comment rather than the microcopy.
 *   - Every other separator run becomes a space *and* a separator-free variant
 *     is matched too, so `Add-ons` answers "add-ons", "add ons" and "addons",
 *     and `Call For Speakers/Abstracts` answers "abstracts".
 *
 * Aliases (`feature-search-aliases.ts`) are matched last of all, below every
 * title match, so adding a broad word there can never demote a screen the
 * organizer named directly. A hit that matched *only* through an alias reports
 * which word did it, because "why is Attendee Orders the answer to refund" is a
 * fair question and a search box that cannot answer it does not get trusted.
 */

import { ALIASES } from './feature-search-aliases';
import type { SearchEntry } from './nav';

export type { SearchEntry };

/** Shortest query that runs. One letter matches most of the tree and helps nobody. */
export const MIN_QUERY = 2;

/** Rows the dropdown will render. The rest are counted, not listed — see `total`. */
export const RESULT_LIMIT = 20;

/** Lowercase; drop `&`; reduce every other non-alphanumeric run to one space. */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The same string with the separators removed, so "addons" finds "Add-ons". */
export function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Why an entry is in the list. Lower is a better answer.
 *
 * `TRAIL` means the title does not match at all and the entry surfaced only
 * because an ancestor did — every screen under Tickets when you type "ticket".
 * Those are worth showing (they are the section's contents) but never above the
 * section itself.
 */
const Rank = {
  TITLE_EXACT: 0,
  TITLE_PREFIX: 1,
  /**
   * An alias the organizer typed *exactly* outranks a title that merely
   * contains the word. "booth" is the case that settled it: `Photo Booth`
   * contains it and `Exhibitor Manager` is aliased to it, and nobody typing
   * "booth" into an event dashboard wants the photo booth. Same for "schedule",
   * which otherwise landed on `1-1 Meeting Scheduler` rather than the agenda.
   */
  ALIAS_EXACT: 2,
  TITLE_CONTAINS: 3,
  ALIAS_CONTAINS: 4,
  TRAIL: 5,
} as const;

export interface Hit extends SearchEntry {
  /** The alias that found this, when nothing in the title or trail did. */
  via?: string;
}

export interface SearchResult {
  /** At most `limit` entries, best first. */
  hits: Hit[];
  /** Everything that matched, including what `limit` cut. */
  total: number;
}

/** Path depth, so `Tickets` outranks `Tickets › Ticket Setup › Ticket Add-ons`. */
function depth(path: string): number {
  return path.split('/').length;
}

interface Scored {
  entry: SearchEntry;
  rank: number;
  via?: string;
}

function score(
  entry: SearchEntry,
  query: string,
  words: string[],
  squashed: string,
): Scored | null {
  const title = normalise(entry.title);
  const titleSquashed = squash(entry.title);

  const aliases = ALIASES[entry.path] ?? [];

  if (title === query) return { entry, rank: Rank.TITLE_EXACT };
  if (title.startsWith(query)) return { entry, rank: Rank.TITLE_PREFIX };

  const exact = aliases.find((a) => normalise(a) === query);
  if (exact) return { entry, rank: Rank.ALIAS_EXACT, via: exact };

  if (words.every((w) => title.includes(w)) || titleSquashed.includes(squashed)) {
    return { entry, rank: Rank.TITLE_CONTAINS };
  }

  // Aliases before the trail: "refund" should reach Attendee Orders, not list
  // every screen that happens to sit under a section whose name contains it.
  //
  // The words are matched against the path's aliases *collectively*. Requiring
  // them all inside one alias string meant "export csv" found nothing, because
  // `export` and `csv` are two entries on the same screen — and the organizer
  // has no way to know they were written separately.
  const joined = normalise(aliases.join(' '));
  const spans = joined && words.every((w) => joined.includes(w));
  const run = aliases.find((a) => squashed.length >= MIN_QUERY && squash(a).includes(squashed));
  if (spans || run) {
    const via =
      run ??
      aliases.find((a) => words.every((w) => normalise(a).includes(w))) ??
      aliases.find((a) => words.some((w) => normalise(a).includes(w))) ??
      aliases[0];
    return { entry, rank: Rank.ALIAS_CONTAINS, via };
  }

  const trail = normalise(entry.trail);
  const trailSquashed = squash(entry.trail);
  const hay = `${trail} ${title}`;
  if (words.every((w) => hay.includes(w)) || `${trailSquashed}${titleSquashed}`.includes(squashed)) {
    return { entry, rank: Rank.TRAIL };
  }

  return null;
}

export function searchFeatures(
  entries: SearchEntry[],
  query: string,
  limit: number = RESULT_LIMIT,
): SearchResult {
  const q = normalise(query);
  if (q.length < MIN_QUERY) return { hits: [], total: 0 };

  const words = q.split(' ').filter(Boolean);
  const squashed = squash(query);

  const ranked = entries
    .map((e) => score(e, q, words, squashed))
    .filter((s): s is Scored => s !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        depth(a.entry.path) - depth(b.entry.path) ||
        a.entry.title.length - b.entry.title.length ||
        Number(b.entry.built) - Number(a.entry.built) ||
        a.entry.title.localeCompare(b.entry.title),
    );

  return {
    hits: ranked.slice(0, limit).map((s) => (s.via ? { ...s.entry, via: s.via } : s.entry)),
    total: ranked.length,
  };
}

/**
 * Split a title into runs so the matched part can be emboldened.
 *
 * Matching is done on the normalised form but the highlight has to land on the
 * *original* string, punctuation and capitals intact — the organizer reads
 * "Session Q&A Manager", not "session qa manager". Normalising is
 * character-preserving except that `&` disappears, so an index in the
 * normalised string can drift from the original by at most the ampersands
 * before it; rather than track that, this searches the original
 * case-insensitively and simply returns one un-highlighted run when the query
 * only matched after normalisation.
 */
export function highlight(title: string, query: string): { text: string; hit: boolean }[] {
  const words = normalise(query).split(' ').filter(Boolean);
  if (!words.length) return [{ text: title, hit: false }];

  const lower = title.toLowerCase();
  // Longest word first: for "ticket setup" highlight "setup" as a unit, not "s".
  const found = [...words]
    .sort((a, b) => b.length - a.length)
    .map((w) => ({ w, at: lower.indexOf(w) }))
    .filter((m) => m.at >= 0);
  if (!found.length) return [{ text: title, hit: false }];

  // Merge the spans so overlapping words do not produce nested markup.
  const spans = found
    .map((m) => [m.at, m.at + m.w.length] as const)
    .sort((a, b) => a[0] - b[0])
    .reduce<[number, number][]>((acc, [s, e]) => {
      const last = acc[acc.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e);
      else acc.push([s, e]);
      return acc;
    }, []);

  const out: { text: string; hit: boolean }[] = [];
  let cursor = 0;
  for (const [s, e] of spans) {
    if (s > cursor) out.push({ text: title.slice(cursor, s), hit: false });
    out.push({ text: title.slice(s, e), hit: true });
    cursor = e;
  }
  if (cursor < title.length) out.push({ text: title.slice(cursor), hit: false });
  return out;
}
