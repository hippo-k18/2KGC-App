'use client';

import { useMemo, useState } from 'react';

export interface SpeakerTile {
  id: string;
  name: string;
  /** Where they work. Rendered on its own line, as the live page does. */
  company?: string;
  /** Their job title. Its own line under the company. */
  role?: string;
  photoURL?: string;
  /** Intrinsic size of a local portrait, so the box is reserved before it loads. */
  width?: number;
  height?: number;
}

/** Initials for the fallback portrait. Two at most, so the circle stays legible. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/* ------------------------------------------------------------ sort & search */

/**
 * How the "All N Speakers" grid may be ordered.
 *
 * ⚠️ `roster` is the default and must stay the default. Everything else on this
 * page is a deliberate one-to-one copy of Whova's speaker widget, which has no
 * sort control at all — so the page has to look untouched until somebody uses
 * this one. More concretely: the published order is load-bearing data, not a
 * presentation detail. `speakers-2026.ts` preserves Whova's own `display_dict`
 * sequence verbatim "quirks and all", including the `(Phil) (Meredith)` row
 * that sorts first and that any honest surname sort quietly moves, and
 * `SpeakerDoc.displayOrder` exists so an organizer can set that sequence by
 * hand in Speaker Manager. Making a sort the default would throw away the one
 * ordering somebody actually chose.
 */
export type SpeakerSort =
  | 'roster'
  | 'last-asc'
  | 'last-desc'
  | 'first-asc'
  | 'company-asc'
  | 'title-asc';

export const SPEAKER_SORTS: { value: SpeakerSort; label: string }[] = [
  { value: 'roster', label: 'Roster order' },
  { value: 'last-asc', label: 'Last name (A–Z)' },
  { value: 'last-desc', label: 'Last name (Z–A)' },
  { value: 'first-asc', label: 'First name (A–Z)' },
  { value: 'company-asc', label: 'Company (A–Z)' },
  { value: 'title-asc', label: 'Job title (A–Z)' },
];

/**
 * Compare the way a human reading a delegate list would.
 *
 * `localeCompare` rather than `<`, because this roster is `Bergström`,
 * `Kovač` and `Tomás` — a code-point sort files every one of them after `Z`,
 * which on a page whose entire purpose is "find the person you came for" is a
 * bug you only notice if you happen to be looking for Anahita Pakiman. `base`
 * sensitivity folds accents and case together so `Ö` sorts with `O`.
 */
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

/**
 * The last whitespace-separated word.
 *
 * Not a real surname parser, and deliberately not one: `van der Berg` and
 * `Bin Salman` would both need a particle list that is wrong for somebody in
 * every language it covers. This is the same rule `makeSpeakers()` in
 * `fixtures.ts` already sorts the seeded roster by, so the two agree — and the
 * cost of it being wrong is one card a few positions from where you expected.
 */
const surname = (name: string) => name.trim().split(/\s+/).pop() ?? '';
const forename = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/**
 * Sort a missing company or title to the very end, never to the front.
 *
 * 11 of the 137 published speakers have no company and 13 have no job title, so
 * this is the common case rather than an edge one. An empty string sorts before
 * `Amazon` in every collator, which would open "Company (A–Z)" with eleven
 * cards showing no company at all — indistinguishable from the sort being
 * broken.
 */
function byOptional(a: string | undefined, b: string | undefined): number {
  const left = a?.trim();
  const right = b?.trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return collator.compare(left, right);
}

/**
 * Order a copy of the list.
 *
 * Every branch falls back to the full-name comparison, so a sort never has ties
 * it resolves arbitrarily: two people at the same company appear in the same
 * order on every render and on every machine. `Array.prototype.sort` has been
 * stable since ES2019 and the input order would have done, but relying on that
 * would mean "Company (A–Z)" silently re-shuffles its ties the day the roster
 * order changes upstream.
 */
export function sortSpeakers(speakers: SpeakerTile[], sort: SpeakerSort): SpeakerTile[] {
  if (sort === 'roster') return speakers;

  const byName = (a: SpeakerTile, b: SpeakerTile) => collator.compare(a.name, b.name);
  const next = [...speakers];

  switch (sort) {
    case 'last-asc':
      return next.sort((a, b) => collator.compare(surname(a.name), surname(b.name)) || byName(a, b));
    case 'last-desc':
      return next.sort((a, b) => collator.compare(surname(b.name), surname(a.name)) || byName(a, b));
    case 'first-asc':
      return next.sort(
        (a, b) => collator.compare(forename(a.name), forename(b.name)) || byName(a, b),
      );
    case 'company-asc':
      return next.sort((a, b) => byOptional(a.company, b.company) || byName(a, b));
    case 'title-asc':
      return next.sort((a, b) => byOptional(a.role, b.role) || byName(a, b));
  }
}

/**
 * Lowercase and strip accents, so typing `Bergstrom` finds `Bergström`.
 *
 * Somebody searching for a speaker they heard named aloud, or whose name they
 * are copying off a badge, cannot be assumed to have an `ö` to hand. This is
 * the same NFKD fold `ids.ts` uses to build document slugs.
 */
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

/** Name or company, substring, accent-insensitive. Empty query matches all. */
export function filterSpeakers(speakers: SpeakerTile[], query: string): SpeakerTile[] {
  const needle = fold(query.trim());
  if (!needle) return speakers;
  return speakers.filter(
    (s) => fold(s.name).includes(needle) || fold(s.company ?? '').includes(needle),
  );
}

/**
 * One card. Exported because the "Our First Speakers" block on `/speakers`
 * renders the same card in a different container, and two copies of this markup
 * would drift apart the first time either one is touched.
 */
export function SpeakerCard({
  speaker: s,
  /**
   * The lead five on `/speakers` are the first thing on the page and one of
   * them is the LCP element, so they load eagerly. Everything in the grid below
   * stays lazy — 132 portraits fetched at once is the whole point of the "show
   * more".
   */
  eager = false,
}: {
  speaker: SpeakerTile;
  eager?: boolean;
}) {
  return (
    <article className="speaker-tile">
      {s.photoURL ? (
        /*
         * A plain <img>: portraits come from the conference database and, for
         * the imported set, from arbitrary upstream hosts. `next/image` would
         * need every one of those hosts in `images.remotePatterns`, and a
         * speaker added in the console with a new host would render a 400
         * instead of a face.
         */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="speaker-portrait"
          src={s.photoURL}
          alt=""
          width={s.width ?? 200}
          height={s.height ?? 200}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : undefined}
        />
      ) : (
        <div className="speaker-portrait is-fallback" aria-hidden="true">
          {initials(s.name)}
        </div>
      )}
      <h3 className="speaker-name">{s.name}</h3>
      {s.company ? <p className="speaker-org">{s.company}</p> : null}
      {s.role ? <p className="speaker-role">{s.role}</p> : null}
    </article>
  );
}

/**
 * The speaker grid, framed the way the live `2026-speakers` page frames it: a
 * large circular portrait centred over a centred name, company and role, on a
 * pale card with no border.
 *
 * ## Why there is a "show more" rather than all of them
 *
 * Forty-five cards is about four thousand pixels of scrolling before anything
 * else on the page exists, and the live page solves it the same way. The first
 * batch is a screen and a half; the rest arrive on request.
 *
 * The hidden speakers are **not rendered and then hidden** — they are absent
 * from the DOM until asked for. Hiding them with CSS would keep them in the
 * accessibility tree and in the browser's in-page search, so a keyboard user
 * would tab into cards nobody can see. `aria-expanded` on the button and a live
 * count in its label are what make the state legible without sight.
 */
export function SpeakerGrid({
  speakers,
  initial = 12,
}: {
  speakers: SpeakerTile[];
  initial?: number;
}) {
  const [shown, setShown] = useState(initial);
  const visible = speakers.slice(0, shown);
  const remaining = speakers.length - visible.length;

  return (
    <>
      <div className="speaker-grid">
        {visible.map((s) => (
          <SpeakerCard key={s.id} speaker={s} />
        ))}
      </div>

      {remaining > 0 ? (
        <div className="speaker-more">
          <button
            type="button"
            className="btn btn-outline"
            aria-expanded={false}
            onClick={() => setShown((n) => n + initial)}
          >
            Show {Math.min(remaining, initial)} more
            <span className="sr-only"> speakers, {remaining} remaining</span>
          </button>
        </div>
      ) : speakers.length > initial ? (
        <div className="speaker-more">
          <button
            type="button"
            className="btn btn-ghost-quiet"
            aria-expanded
            onClick={() => setShown(initial)}
          >
            Show fewer
          </button>
        </div>
      ) : null}
    </>
  );
}

/**
 * The whole `/speakers` page body: the highlighted speakers under "Our First
 * Speakers", then one blue button.
 *
 * Pressing it folds the highlighted speakers into one searchable, sortable grid
 * with everybody else, highlighted first, under "All N Speakers". Leaving them in
 * a separate block above meant the search box could not find the five people most
 * likely to be searched for.
 *
 * As in `SpeakerGrid`, the rest are absent from the DOM until asked for rather
 * than hidden with CSS, so nothing tabs into a card nobody can see.
 */
export function ViewAllSpeakers({
  featured,
  speakers,
}: {
  /** The editorial highlights, in their own order. */
  featured: SpeakerTile[];
  /** Everyone else. */
  speakers: SpeakerTile[];
}) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<SpeakerSort>('roster');
  const [query, setQuery] = useState('');

  const everyone = useMemo(() => [...featured, ...speakers], [featured, speakers]);
  /*
   * Both derivations are memoised on the inputs that actually change them. The
   * grid is up to 137 cards and `sortSpeakers` copies the array, so without
   * this every keystroke in the search box would re-sort a list the sort had
   * nothing to do with.
   */
  const sorted = useMemo(() => sortSpeakers(everyone, sort), [everyone, sort]);
  const visible = useMemo(() => filterSpeakers(sorted, query), [sorted, query]);

  if (!everyone.length) {
    return (
      <>
        <h1 className="speakers-head">Our First Speakers</h1>
        <p className="notice">The speaker list is not published yet.</p>
      </>
    );
  }

  const searching = query.trim().length > 0;

  if (!open) {
    return (
      <>
        <h1 className="speakers-head">Our First Speakers</h1>
        {featured.length > 0 ? (
          /* Three across, then the remaining two centred beneath them. */
          <div className="featured-speakers">
            {featured.map((s) => (
              <SpeakerCard key={s.id} eager speaker={s} />
            ))}
          </div>
        ) : null}

        {speakers.length > 0 ? (
          <div className="speakers-more">
            <button
              type="button"
              className="btn btn-viewall"
              aria-expanded={false}
              onClick={() => setOpen(true)}
            >
              View All Speakers
              <span className="sr-only">, {everyone.length} in total</span>
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <h1 className="speakers-head">All {everyone.length} Speakers</h1>

      <div className="speaker-toolbar">
        <div className="speaker-tool">
          <label htmlFor="speaker-search">Search</label>
          <input
            id="speaker-search"
            type="search"
            value={query}
            placeholder="Name or company"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="speaker-tool">
          <label htmlFor="speaker-sort">Sort by</label>
          <select
            id="speaker-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SpeakerSort)}
          >
            {SPEAKER_SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/*
        * The result count is the only feedback a search gives. `polite` so it
        * waits for a pause in typing. It stays mounted and empties instead of
        * unmounting: a live region inserted at the moment its text changes is
        * not reliably announced.
        */}
      <p className="speaker-count" role="status" aria-live="polite">
        {searching
          ? `${visible.length} of ${everyone.length} ${visible.length === 1 ? 'speaker matches' : 'speakers match'} “${query.trim()}”`
          : ''}
      </p>

      {visible.length ? (
        <SpeakerGrid speakers={visible} initial={24} />
      ) : (
        <p className="notice">
          No speaker matches “{query.trim()}”.{' '}
          <button type="button" className="speaker-clear" onClick={() => setQuery('')}>
            Clear the search
          </button>{' '}
          to see all {everyone.length}.
        </p>
      )}
    </>
  );
}
