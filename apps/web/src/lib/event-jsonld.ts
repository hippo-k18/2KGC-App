import { EVENT, publicSiteOrigin } from '@kgc/shared';
import type { AgendaDay } from './data';
import type { Tier } from './tickets';

/**
 * `schema.org/Event` as JSON-LD, built from the same documents the page renders.
 *
 * ── What this is for, in one sentence ───────────────────────────────────────
 *
 * It is the difference between a search result that reads "Knowledge Graph
 * Conference 2027 — Five days of workshops, talks and…" and one that shows the
 * dates, the venue and a price. The dashboard's Tickets › Ticket Marketing ›
 * Event Listing screen makes the argument at length: there is no marketplace to
 * list a conference in here, so the only channels that make an event findable
 * by people not already looking for it are search, the field's own calendars
 * and other people's newsletters — and structured data is the whole of the
 * first one.
 *
 * ── Nothing in here is typed in ─────────────────────────────────────────────
 *
 * The dates come from the published programme, the price range from
 * `ticketTypes`, the attendance mode from whether any tier is virtual. That is
 * a deliberate constraint and not a flourish: a hand-written `startDate` is a
 * string nobody looks at again, and the failure mode of structured data is
 * silent — Google shows the wrong date to everyone and nothing on the site ever
 * looks broken. Deriving it means the JSON-LD cannot disagree with the page it
 * sits on, because they are reading the same documents.
 *
 * The one thing that has to be stated rather than derived is the venue's
 * address, and it is stated in `@kgc/shared` as `EVENT.venue` — the same string
 * the app and both websites print. There is no street-address field on any
 * document in this project, so the `PostalAddress` below carries the locality
 * and the region and stops there rather than inventing a postcode.
 *
 * ── The builder is pure, and that is the convention it is following ────────
 *
 * `eventJsonLd()` has no `server-only`, no `db()` and no environment read: it
 * takes the data as arguments and returns a plain object, so the arithmetic
 * (the timezone offsets in particular) can be reasoned about and, if it ever
 * earns it, tested — `AGENTS.md`'s `conflicts-core.ts` / `conflicts.ts` split.
 * The single impure thing this file needs, the site's own address, is
 * `canonicalOrigin()` at the bottom, kept apart for exactly that reason.
 */

/**
 * The offset, in minutes east of UTC, that `timeZone` was at `instant`.
 *
 * `longOffset` yields `GMT-04:00`, or a bare `GMT` at zero. Parsed rather than
 * computed because the alternative is shipping a copy of the tzdata rules, and
 * `Intl` already has them and keeps them current.
 */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(instant)
    .find((p) => p.type === 'timeZoneName')?.value;

  const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name ?? '');
  if (!m) return 0; // A bare `GMT`, or a format we do not recognise: treat as UTC.
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * `2027-05-05T09:00` in `America/New_York` → `2027-05-05T09:00:00-04:00`.
 *
 * ── Why the offset has to be resolved at all ────────────────────────────────
 *
 * `SessionDoc.startsAtLocal` is a wall clock with no offset on it, which is the
 * right way round for authoring (`AGENTS.md`: an organizer says "Tuesday at
 * 09:00 in New York") and useless to a consumer. schema.org takes ISO 8601, and
 * a bare `2027-05-05T09:00` is read as the *reader's* local time — so a crawler
 * in Dublin records a 09:00 keynote as happening at 04:00 New York time. That is
 * the same class of bug the agenda page's own docblock refuses to introduce by
 * rendering in the visitor's zone, one layer down.
 *
 * ── Two passes, and the hour they are for ───────────────────────────────────
 *
 * Finding the offset needs an instant, and the instant is what the offset is
 * needed to compute. The first pass reads the wall clock as if it were UTC,
 * which lands within a day of the truth — close enough to pick the right side
 * of a DST transition for every hour except the ones adjacent to it. The second
 * pass re-reads the offset at the corrected instant, which fixes those. On the
 * one nonexistent hour each spring the answer is the offset on the far side of
 * the gap, which is what every other implementation does with a wall clock that
 * never happened.
 */
export function localWallClockToIso(wallClock: string, timeZone: string): string {
  /*
   * ⚠️ The shape is checked before `Date.parse` sees it, and a `Number.isNaN`
   * guard is not a substitute. `Date.parse` is specified to accept
   * implementation-defined formats and V8 takes that seriously: measured,
   * `Date.parse('not-a-date:00Z')` returns **946684800000** — midnight on
   * 1 January 2000 — rather than `NaN`. Trusting it would emit a startDate for
   * a session whose wall clock is malformed, and structured data is exactly the
   * place a wrong date is never noticed, because no human reads it.
   */
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wallClock)) return '';

  const asIfUtc = Date.parse(`${wallClock}:00Z`);
  if (Number.isNaN(asIfUtc)) return '';

  const first = zoneOffsetMinutes(new Date(asIfUtc), timeZone);
  const offset = zoneOffsetMinutes(new Date(asIfUtc - first * 60_000), timeZone);

  const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');
  const abs = Math.abs(offset);
  return `${wallClock}:00${offset < 0 ? '-' : '+'}${pad(abs / 60)}:${pad(abs % 60)}`;
}

/** A JSON-LD node. Loose on purpose — this is serialised, never navigated. */
type JsonLd = Record<string, unknown>;

export interface EventJsonLdInput {
  /** The site's own origin, absolute. Every `url` and `image` below hangs off it. */
  origin: string;
  /** The page this block is embedded in, so `mainEntityOfPage` is honest. */
  pageUrl: string;
  /** The published programme, exactly as `/agenda` renders it. */
  agenda: AgendaDay[];
  /** The live catalogue. Empty when Firestore could not be reached. */
  tiers: Tier[];
  /** The organizer's `settings/branding.tagline`, already resolved with a fallback. */
  description: string;
  /**
   * Whether to emit one `subEvent` per published session.
   *
   * True on `/agenda`, which is the page that actually lists them, and false on
   * the homepage, which does not. Emitting seventy sessions into the homepage's
   * markup would be describing a page by its neighbour's contents.
   */
  includeSessions?: boolean;
}

/**
 * The event's first and last moment, taken from the programme itself.
 *
 * ⚠️ Returns `null` when nothing is published, and the caller must then emit no
 * JSON-LD at all. `startDate` is the one property Google requires on an Event,
 * and there is no honest substitute available: `SITE.datesLong` is the string
 * `'3–7 May 2027'`, a presentation value that `site.ts`'s own header explains is
 * deliberately not machine truth, and parsing an en dash out of marketing copy
 * to feed a crawler is how a site ends up advertising the wrong week. A search
 * result with no rich card is a smaller failure than one with wrong dates.
 */
function eventWindow(agenda: AgendaDay[]): { start: string; end: string } | null {
  /*
   * Only sessions whose wall clocks convert. One malformed record must not take
   * the whole block down — a conference losing its rich result because a single
   * session was imported with a bad time would be a wildly disproportionate
   * failure, and the remaining seventy still bound the week correctly.
   */
  const starts: string[] = [];
  const ends: string[] = [];
  for (const s of agenda.flatMap((d) => d.sessions)) {
    const start = localWallClockToIso(s.startsAtLocal, EVENT.timeZone);
    const end = localWallClockToIso(s.endsAtLocal, EVENT.timeZone);
    if (!start || !end) continue;
    starts.push(start);
    ends.push(end);
  }
  if (starts.length === 0) return null;

  /*
   * Compared as instants rather than as strings. Lexicographic order is
   * chronological for the bare `YYYY-MM-DDTHH:mm` wall clocks that `listAgenda`
   * sorts on, but these carry an offset — and across the spring transition
   * `…T01:30:00-05:00` sorts after `…T02:00:00-04:00` while happening before it.
   * Sorting the strings would put the conference's first moment in the wrong
   * place exactly once a year, which is the kind of bug that is found in March.
   */
  const byInstant = (a: string, b: string) => Date.parse(a) - Date.parse(b);
  return {
    start: starts.sort(byInstant)[0],
    end: ends.sort(byInstant)[ends.length - 1],
  };
}

/**
 * Where the conference is, as far as this project actually knows.
 *
 * `EVENT.venue` is `'Cornell Tech, Roosevelt Island, New York, NY'` — one
 * string, shared by the app and both websites so they cannot disagree. It is
 * split for the `PostalAddress` rather than being restated, because a second
 * copy of the venue is a second thing to update and the one that gets forgotten
 * is always the invisible one.
 */
function venue(): JsonLd {
  const parts = EVENT.venue.split(',').map((p) => p.trim());
  const region = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const locality = parts.length > 2 ? parts[parts.length - 2] : undefined;
  const street = parts.slice(0, Math.max(1, parts.length - 2)).join(', ');

  return {
    '@type': 'Place',
    name: EVENT.venue,
    address: {
      '@type': 'PostalAddress',
      // No postcode and no street number: nothing in this repo holds one, and
      // schema.org would rather have three true fields than five with two guesses.
      streetAddress: street,
      addressLocality: locality,
      addressRegion: region,
      addressCountry: 'US',
    },
  };
}

/**
 * One `Offer` per tier that a visitor could actually buy right now.
 *
 * ⚠️ **`onSale` is not decoration here.** `catalogue.ts` computes it from the
 * sales window and the remaining quantity, and a sold-out tier still renders on
 * `/tickets` because a ticket that vanishes reads as a bug. In structured data
 * the same row is a promise: `availability: InStock` against a sold-out tier is
 * a search result advertising something the checkout will refuse. So the
 * availability comes from the same field the disabled button does, and the two
 * cannot drift.
 *
 * `price` is `priceCents / 100` and the currency is upper-cased — Stripe stores
 * `usd` and schema.org wants ISO 4217's `USD`.
 */
function offers(tiers: Tier[], origin: string): JsonLd[] {
  return tiers.map((t) => ({
    '@type': 'Offer',
    name: t.name,
    price: (t.priceCents / 100).toFixed(2),
    priceCurrency: t.currency.toUpperCase(),
    availability: t.onSale
      ? 'https://schema.org/InStock'
      : 'https://schema.org/SoldOut',
    // The tier id travels in this query parameter already — it is what the
    // ticket cards link to and what `startCheckout` reads back.
    url: `${origin}/tickets?tier=${encodeURIComponent(t.id)}`,
  }));
}

/**
 * The whole programme as `subEvent`s, for the page that lists it.
 *
 * The speaker names are `SessionDoc.speakerNames`, the denormalised cache the
 * agenda card already prints. Nothing is *decided* from it — `AGENTS.md`'s rule
 * about those caches — and this is not deciding anything; it is publishing, in
 * a second format, exactly the names already visible on the page. A crawler and
 * a reader seeing different speakers for the same talk would be the defect.
 */
function sessionEvents(agenda: AgendaDay[], pageUrl: string): JsonLd[] {
  return agenda.flatMap((day) =>
    day.sessions.flatMap((s): JsonLd[] => {
      const startDate = localWallClockToIso(s.startsAtLocal, EVENT.timeZone);
      const endDate = localWallClockToIso(s.endsAtLocal, EVENT.timeZone);
      // A session whose wall clock will not parse is dropped rather than
      // published with an empty `startDate`. It still renders on the page, where
      // a person can see the times are wrong; a crawler cannot.
      if (!startDate || !endDate) return [];

      const node: JsonLd = {
        '@type': 'Event',
        name: s.title,
        startDate,
        endDate,
        eventStatus: 'https://schema.org/EventScheduled',
        // The day anchor the agenda page already renders, so a result deep-links
        // to the right part of the programme rather than to its top.
        url: `${pageUrl}#${day.day}`,
      };
      if (s.description) node.description = s.description;
      if (s.roomName) node.location = { '@type': 'Place', name: s.roomName };
      if (s.speakerNames.length > 0) {
        node.performer = s.speakerNames.map((name) => ({ '@type': 'Person', name }));
      }
      return [node];
    }),
  );
}

/**
 * Build the block, or return `null` when the programme cannot supply dates.
 *
 * The `@id` is the same on every page that emits this, so a crawler reading the
 * homepage and the agenda understands them as two descriptions of one event
 * rather than as two conferences with the same name.
 */
export function eventJsonLd(input: EventJsonLdInput): JsonLd | null {
  const window = eventWindow(input.agenda);
  if (!window) return null;

  const { origin, pageUrl, tiers, description } = input;

  /*
   * Derived, not declared. `Tier.inPerson` is a real field on every ticket type
   * and the virtual tier is the reason it exists; if the organizer stops selling
   * one, this drops to `OfflineEventAttendanceMode` on the next request without
   * anybody editing this file. With no catalogue at all — an unreachable
   * Firestore — the property is omitted rather than guessed.
   */
  const hasVirtual = tiers.some((t) => !t.inPerson);
  const hasInPerson = tiers.some((t) => t.inPerson);
  const attendanceMode =
    hasVirtual && hasInPerson
      ? 'https://schema.org/MixedEventAttendanceMode'
      : hasVirtual
        ? 'https://schema.org/OnlineEventAttendanceMode'
        : hasInPerson
          ? 'https://schema.org/OfflineEventAttendanceMode'
          : undefined;

  const node: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    '@id': `${origin}/#event`,
    name: EVENT.name,
    description,
    startDate: window.start,
    endDate: window.end,
    eventStatus: 'https://schema.org/EventScheduled',
    location: venue(),
    image: [`${origin}/hero-kgc.png`],
    url: `${origin}/`,
    mainEntityOfPage: pageUrl,
    organizer: {
      '@type': 'Organization',
      /*
       * The organization, which is not the edition. `EVENT.name` is
       * "Knowledge Graph Conference 2027" — correct for the event and wrong
       * here, because it says the 2027 conference organizes itself and it makes
       * the organizer a different entity every year, which is precisely what an
       * `Organization` is for denying. The year is stripped rather than a second
       * name being declared, so this cannot drift from `@kgc/shared`.
       */
      name: EVENT.name.replace(/\s+\d{4}$/, ''),
      url: EVENT.website,
    },
  };

  if (attendanceMode) node.eventAttendanceMode = attendanceMode;
  if (tiers.length > 0) node.offers = offers(tiers, origin);
  if (input.includeSessions) {
    const subEvents = sessionEvents(input.agenda, pageUrl);
    if (subEvents.length > 0) node.subEvent = subEvents;
  }

  /*
   * No `performer` on the event itself, and that is a decision rather than an
   * omission. `SPEAKERS_PAGE_SOURCE` in `site.ts` is `'2026-roster'` because the
   * `speakers` collection currently holds names `npm run seed` invented, and
   * `/speakers` deliberately renders last year's real people instead. Naming
   * fabricated individuals as performers of a real conference — in a format
   * built to be believed by machines and republished by them — is the worst
   * version of the defect that constant exists to prevent. The session-level
   * `performer` above is different: those names are on the page already.
   */
  return node;
}

/**
 * Serialise the block for a `<script type="application/ld+json">`.
 *
 * ⚠️ `<` is escaped. A title containing the six characters `</scr` + `ipt>`
 * would otherwise close the tag from inside a JSON string and everything after
 * it would be parsed as HTML — a script-injection hole opened by a session
 * title an organizer typed. `<` is valid JSON, valid JavaScript and
 * invisible to a JSON-LD parser, which is why it is the standard fix rather
 * than stripping the characters.
 */
export function jsonLdScript(node: JsonLd | null): string | null {
  if (!node) return null;
  return JSON.stringify(node).replace(/</g, '\\u003c');
}

/**
 * The site's own address, without a trailing slash.
 *
 * The same resolver `layout.tsx` uses for `metadataBase`, and deliberately so:
 * the Open Graph image and the JSON-LD `image` must resolve to the same host, or
 * a preview deployment advertises production's assets in one format and its own
 * in the other. `publicSiteOrigin()` reads the environment rather than the
 * request headers, so a page cached behind a proxy cannot mint a canonical URL
 * from a Host header somebody else chose.
 *
 * ⚠️ Its default is production and **must stay that way**. This function's
 * output is the `@id` and `url` of a `schema.org/Event` — the one format the
 * note above `eventJsonLd` argues is built to be believed by machines and
 * republished by them. It defaulted to `http://localhost:3200` until
 * 2026-09-01, so any deploy that forgot `WEB_PUBLIC_ORIGIN` was publishing
 * structured data pointing at the machine it was built on.
 */
export const canonicalOrigin = publicSiteOrigin;
