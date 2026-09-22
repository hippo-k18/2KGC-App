import type { Metadata } from 'next';
import Link from 'next/link';
import {
  agendaSpeakers,
  brandingSettings,
  listAgenda,
  listPublicDocuments,
  listTracks,
  type AgendaDay,
  type AgendaSession,
  type PublicDocument,
  siteEvent,
} from '@/lib/data';
import { FocusOnHash } from '@/components/focus-on-hash';
import { tiersOrNull } from '@/lib/catalogue';
import { canonicalOrigin, eventJsonLd, jsonLdScript } from '@/lib/event-jsonld';
import { formatDayHeading, SITE } from '@/lib/site';
import { AgendaList } from './agenda-list';

export const metadata: Metadata = {
  title: 'Agenda',
  description: 'The full five-day programme for the Knowledge Graph Conference 2027.',
};

/**
 * The programme, read from the `sessions` collection and grouped by day.
 *
 * Times shown are the stored wall clock, which is already local to the venue
 * (`SessionDoc.startsAtLocal`, interpreted against `TIME_ZONE`). Nothing here
 * touches the visitor's own zone: an agenda that silently renders in the
 * reader's timezone is how someone in London turns up to a 09:00 keynote at
 * 14:00. The zone is stated on the page instead.
 *
 * ── `?day=` and `?track=`, and why they are links rather than a widget ──────
 *
 * Whova needs a second hosted page for a filtered agenda because their hosted
 * pages take no parameters; the dashboard's Special-Purpose Agenda screen makes
 * that comparison and generates exactly these URLs so an organizer can hand a
 * partner "just the Healthcare track" or "just Monday". Until now nothing here
 * read them, so every one of those links went to the unfiltered page — a
 * dashboard printing URLs that do not do what they say.
 *
 * The filter is applied on the server and the controls are ordinary anchors, so
 * a filtered agenda is a real address: it survives a paste into an email, a
 * printed QR code and a crawler, and it needs no JavaScript at all. A client
 * component with state would give the same visible result and none of that.
 */
export const dynamic = 'force-dynamic';

/**
 * `?day=x&day=y` is a shape Next hands over as an array, and there is exactly
 * one sensible reading of it: the first value. Concatenating them would invent
 * a day, and refusing the whole request over a duplicated parameter punishes a
 * visitor for something a link generator did.
 */
function firstValue(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
}

/** Rebuild the query string with one parameter changed or cleared. */
function filterHref(
  current: { day?: string; track?: string; q?: string },
  patch: { day?: string | null; track?: string | null; q?: string | null },
) {
  const next = {
    day: patch.day === null ? undefined : (patch.day ?? current.day),
    track: patch.track === null ? undefined : (patch.track ?? current.track),
    // Carried through every chip. A search that is silently dropped the moment
    // somebody picks a day is a filter row that undoes the box above it.
    q: patch.q === null ? undefined : (patch.q ?? current.q),
  };
  const params = new URLSearchParams();
  if (next.day) params.set('day', next.day);
  if (next.track) params.set('track', next.track);
  if (next.q) params.set('q', next.q);
  const qs = params.toString();
  return qs ? `/agenda?${qs}` : '/agenda';
}

/**
 * Title, speaker, room and track, folded and case-insensitive.
 *
 * Searched on the server with the rest of the filtering, so a search is a real
 * address in the same way `?day=` and `?track=` are. The abstract is
 * deliberately not searched: a common word appears in most of them and the
 * result is a page that matches everything.
 */
function matchesQuery(session: AgendaSession, needle: string): boolean {
  if (!needle) return true;
  const hay = [session.title, session.roomName, session.trackName, ...session.speakerNames]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  return hay.includes(needle);
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ev = await siteEvent();
  const params = await searchParams;
  const dayParam = firstValue(params.day);
  const trackParam = firstValue(params.track);
  const qParam = firstValue(params.q);
  const needle = (qParam ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  const [allDays, tracks, tiers, branding, speakers, sessionDocuments] = await Promise.all([
    listAgenda(),
    listTracks(),
    tiersOrNull(),
    brandingSettings(),
    /*
     * The speaker records behind each session's `speakerIds`, so the detail
     * dialog can show a portrait and an affiliation rather than the
     * denormalised name string the list renders. One collection read, shared
     * with nothing else on this page.
     */
    agendaSpeakers(),
    /*
     * The handouts an organizer attached to a session — slides, a paper, the
     * dataset. `listPublicDocuments()` is already the unrestricted subset, so
     * grouping its rows here cannot leak a restricted one onto a session: a
     * restricted handout never reaches this page at all. See that function's
     * header for why that gate is upstream and has no parameter.
     */
    listPublicDocuments(),
  ]);

  const documentsBySession = new Map<string, PublicDocument[]>();
  for (const d of sessionDocuments) {
    if (!d.sessionId) continue;
    const list = documentsBySession.get(d.sessionId);
    if (list) list.push(d);
    else documentsBySession.set(d.sessionId, [d]);
  }

  const total = allDays.reduce((n, d) => n + d.sessions.length, 0);

  /*
   * Both filters, applied in that order, and days that empty out are dropped.
   *
   * A day heading over no sessions is worse than an absent day: it reads as a
   * conference with a blank Wednesday rather than as a track that does not meet
   * on Wednesday.
   */
  const days: AgendaDay[] = allDays
    .filter((d) => !dayParam || d.day === dayParam)
    .map((d) => ({
      day: d.day,
      sessions: d.sessions
        .filter((s) => !trackParam || s.trackIds.includes(trackParam))
        .filter((s) => matchesQuery(s, needle)),
    }))
    .filter((d) => d.sessions.length > 0);

  const shown = days.reduce((n, d) => n + d.sessions.length, 0);
  const filtered = Boolean(dayParam || trackParam || qParam);

  /*
   * The names for the filters actually in force.
   *
   * ⚠️ These can be `undefined` while the parameter is set, and that is the
   * interesting case rather than an edge one: a track deleted after a partner
   * printed the link, or a day that never had sessions. The page says so below
   * instead of silently rendering the whole programme — a filter that quietly
   * stops filtering is the failure this feature exists to end, and a partner
   * embedding "their" slice would never notice they were publishing everybody's.
   */
  const trackName = tracks.find((t) => t.id === trackParam)?.name;
  const dayName = allDays.some((d) => d.day === dayParam) ? formatDayHeading(dayParam!) : undefined;

  /*
   * The structured data describes the *whole* conference, built from `allDays`
   * rather than the filtered view. A crawler following `/agenda?track=x` must
   * not be told the event is one afternoon long, and the block carries the same
   * `@id` on every page that emits it so all of them describe one event.
   */
  const ld = jsonLdScript(
    eventJsonLd({
      origin: canonicalOrigin(),
      pageUrl: `${canonicalOrigin()}/agenda`,
      agenda: allDays,
      tiers: tiers ?? [],
      event: ev,
      description: branding.tagline || SITE.tagline,
      includeSessions: true,
    }),
  );

  return (
    <section>
      {ld && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      )}
      <div className="wrap">
        <p className="eyebrow">{ev.datesLong}</p>
        <h1>Agenda</h1>
        <p className="lede">
          {total} published sessions across {allDays.length} days at {ev.venue}. All times are
          local to the venue ({ev.timeZone.replace('_', ' ')}). The programme firms up through the
          spring; the <Link href="/tickets">KGC app</Link> keeps your own schedule in sync.
        </p>

        {allDays.length === 0 ? (
          <p className="notice" style={{ marginTop: 28 }}>
            The programme is still being assembled. <Link href="/speakers">Speakers</Link> are being
            announced as they are confirmed.
          </p>
        ) : (
          <>
            {/*
              Two rows of links, one per parameter, each keeping the other
              parameter's value. Rendered even when nothing is filtered, because
              a control that only appears once you have used it cannot be found.
            */}
            {/* Spacing lives in `.agenda-filters`, not here. An inline style
                beats any stylesheet rule, so a `marginTop: 28` on this element
                could only be overridden at a phone width with `!important`. */}
            {/*
              A real box, because the magnifier in the header points here.
              It used to land on the top of this page with nothing to type in,
              so the one control on the site that looks like a search did
              nothing but reload the agenda.

              A plain GET form: no script, and the result is an address that
              survives a paste. Outside `.agenda-filters` because on a phone
              that element is `display: contents` and the Day row sticks to the
              header as its first child.
            */}
            <form className="agenda-search" role="search" action="/agenda" method="get">
              <label className="sr-only" htmlFor="agenda-search">
                Search the programme
              </label>
              <input
                id="agenda-search"
                type="search"
                name="q"
                defaultValue={qParam ?? ''}
                placeholder="Search sessions, speakers and rooms"
                autoComplete="off"
              />
              {dayParam ? <input type="hidden" name="day" value={dayParam} /> : null}
              {trackParam ? <input type="hidden" name="track" value={trackParam} /> : null}
              <button type="submit" className="btn btn-primary">
                Search
              </button>
            </form>
            {/* The caret, for somebody who arrived here by pressing a magnifier. */}
            <FocusOnHash id="agenda-search" />

            <div className="agenda-filters">
              <div className="filter-row">
                <span className="filter-label" id="filter-day">
                  Day
                </span>
                <div className="filter-options" role="group" aria-labelledby="filter-day">
                  <Link
                    href={filterHref({ day: dayParam, track: trackParam, q: qParam }, { day: null })}
                    className="filter-chip"
                    aria-current={!dayParam ? 'true' : undefined}
                  >
                    All days
                  </Link>
                  {allDays.map((d) => (
                    <Link
                      key={d.day}
                      href={filterHref({ day: dayParam, track: trackParam, q: qParam }, { day: d.day })}
                      className="filter-chip"
                      aria-current={dayParam === d.day ? 'true' : undefined}
                    >
                      {formatDayHeading(d.day)}
                    </Link>
                  ))}
                </div>
              </div>

              {tracks.length > 0 && (
                <div className="filter-row">
                  {/* The count is the second half of the cue the fade on the
                      row gives: twelve tracks and one chip in view says the
                      rest are off to the right. */}
                  <span className="filter-label" id="filter-track">
                    Track ({tracks.length})
                  </span>
                  <div className="filter-options" role="group" aria-labelledby="filter-track">
                    <Link
                      href={filterHref({ day: dayParam, track: trackParam, q: qParam }, { track: null })}
                      className="filter-chip"
                      aria-current={!trackParam ? 'true' : undefined}
                    >
                      All tracks
                    </Link>
                    {tracks.map((t) => (
                      <Link
                        key={t.id}
                        href={filterHref({ day: dayParam, track: trackParam, q: qParam }, { track: t.id })}
                        className="filter-chip"
                        aria-current={trackParam === t.id ? 'true' : undefined}
                        style={t.color ? ({ '--track': t.color } as React.CSSProperties) : undefined}
                      >
                        {t.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {filtered && (
              <p className="filter-summary">
                Showing <strong>{shown}</strong> of {total} sessions
                {dayName ? ` on ${dayName}` : ''}
                {/* The parameter is echoed when it matched nothing, so a partner
                    debugging a link can see which value the page was given. */}
                {dayParam && !dayName ? ` for day “${dayParam}”` : ''}
                {trackName ? ` in ${trackName}` : ''}
                {trackParam && !trackName ? ` in track “${trackParam}”` : ''}
                {qParam ? ` matching “${qParam}”` : ''}.{' '}
                <Link href="/agenda">Show the whole programme</Link>
              </p>
            )}

            {days.length === 0 ? (
              <p className="notice" style={{ marginTop: 12 }}>
                Nothing in the published programme matches
                {qParam ? ` “${qParam}”` : ' that filter'}.{' '}
                <Link href="/agenda">See all {total} sessions</Link>.
              </p>
            ) : (
              <>
                {/*
                  The jump-to-day nav only earns its space when there is more
                  than one day on the page. With `?day=` in force it would be a
                  row of one anchor pointing at the heading directly beneath it.
                */}
                {days.length > 1 && (
                  <nav className="day-nav" aria-label="Jump to day">
                    {days.map((d) => (
                      <a key={d.day} href={`#${d.day}`}>
                        {formatDayHeading(d.day)}
                      </a>
                    ))}
                  </nav>
                )}

                {/*
                  The rows and the detail dialog they open. The day heading is
                  formatted here and handed down rather than re-derived in the
                  client component, so `formatDayHeading` and the locale data
                  behind it stay on the server, and the dialog's own "Tuesday 4
                  May, 09:00 to 09:45" line reads from the same string as the
                  heading it was opened under.
                */}
                <AgendaList
                  days={days.map((d) => ({
                    day: d.day,
                    heading: formatDayHeading(d.day),
                    sessions: d.sessions,
                  }))}
                  speakers={speakers}
                  documentsBySession={Object.fromEntries(documentsBySession)}
                  origin={canonicalOrigin()}
                />
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
