import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  SETTINGS_DEFAULTS,
  SETTINGS_KEYS,
  type AnnouncementDoc,
  type BoothDoc,
  type BrandingSettings,
  type CallMilestone,
  type DocumentDoc,
  type ExhibitorDoc,
  type PageContentDoc,
  type PageContentKey,
  type PageContentValues,
  type PageDoc,
  type SessionDoc,
  type SpeakerDoc,
  type SponsorDoc,
  type SponsorTier,
  type TrackDoc,
  type EventBasics,
  type EventType,
  type SponsorTierDef,
  DEFAULT_SPONSOR_TIERS,
  groupSponsorsByTier,
  resolveEventBasics,
  resolveSponsorTiers,
  servableLogoURL,
  sortPages,
  tierRank,
  tierSize,
  usable,
} from '@kgc/shared';
import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { db } from './firestore';
import { SITE } from './site';

/**
 * Every read the public site does.
 *
 * Two rules govern all of it.
 *
 * **`eventId` leads every query**, from `@kgc/shared`, never as a string
 * literal — so KGC 2028 is a constant change rather than a grep.
 *
 * **No query here may require a composite index.** Each one is a single
 * equality filter and the ordering happens in memory. This is not a style
 * preference: the emulator does not enforce indexes, so `where(eventId) +
 * orderBy(startsAt)` passes locally and fails in production with
 * `failed-precondition`. That exact bug has shipped twice on this project, and
 * this app cannot fix it when it does — `firestore.indexes.json` is outside
 * its scope. Forty-five speakers and seventy-odd sessions sort in
 * microseconds; the index is not worth the risk.
 *
 * Everything returned is a plain serialisable object — no `Timestamp`
 * instances — so it can cross into a client component without ceremony.
 *
 * ── A database that cannot be reached is an empty page, not a 500 ──────────
 *
 * Every read below goes through `safely()`, or through `shared()`, which is
 * `safely()` with a cache in front of it. Without either, a deployment whose
 * credentials are missing or whose project is unreachable returns a 500 on the
 * homepage, the agenda and the sponsor page — which is what happened on
 * production, and it is a much worse failure than it needs to be. The
 * programme genuinely being unknown is a state this site can render: each page
 * already has an empty state, because a conference has an empty agenda for
 * months before it has a full one.
 *
 * ⚠️ **`catalogue.ts` deliberately does NOT do this.** Prices are the one
 * thing that must never degrade quietly: a page that renders a stale or
 * invented price is indistinguishable from a correct one at the moment a card
 * is charged. It still throws, and the tickets page fails loudly. That
 * asymmetry is the point — an empty speaker list is a gap, a wrong price is a
 * chargeback.
 */

/**
 * Run a read, and treat any failure as "nothing to show".
 *
 * The error is logged with the caller's name, because "the agenda is empty" and
 * "the agenda could not be loaded" look identical to a visitor and must not
 * look identical in a log.
 */
async function safely<T>(what: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (err) {
    console.error(`[data] ${what} failed; rendering the empty state instead`, err);
    return fallback;
  }
}

/**
 * How long one read may be shared between visitors, in seconds.
 *
 * ── Why this number and not a larger one ────────────────────────────────────
 *
 * Every page on this site declared `force-dynamic`, so each visit re-rendered
 * from scratch and queried Firestore again — with nothing cached anywhere, by
 * anybody, ever. Measured on the live site, the agenda took 0.81 to 0.95
 * seconds to first byte against 0.06 for a page that read nothing. A
 * conference programme does not change between two people loading it a second
 * apart, and the database was answering as though it might.
 *
 * A minute is the ceiling an organizer's expectation sets: they edit a session
 * in the dashboard, switch to the site and look. Anything longer than that
 * reads as a broken save, and this project has shipped enough of those.
 *
 * ⚠️ **Thirty, not sixty, because the two caches stack.** A page that declares
 * `revalidate = 60` re-renders at most once a minute, and the render it does
 * makes its reads through this cache — which may itself hand back a value that
 * is already most of a window old. So a sixty-second page over a sixty-second
 * read is a change that can take a hundred and twenty seconds to appear, not
 * sixty. Measured, not reasoned: a page published through the dashboard showed
 * up thirty-five seconds later with both windows at sixty, and the worst case
 * was twice the number either one of them named. Thirty here and thirty on the
 * routes puts the ceiling back at one minute, which is what was promised.
 *
 * ⚠️ What is deliberately NOT cached: `listAnnouncements` and the room signage
 * read. Those two are the live surfaces — a wall panel in a foyer, a sign
 * outside a room — and they already re-read themselves every sixty seconds
 * through `AutoRefresh`. Caching them would add a second minute of staleness to
 * the one they already carry, on exactly the screens where being a minute
 * behind is the whole failure. They stay per-request and cost one query each
 * per sign per minute.
 */
const SHARED_SECONDS = 30;

/**
 * Every shared read carries this tag as well as its own.
 *
 * Nothing calls `revalidateTag` today: the dashboard is a separate deployment
 * and reaching this one needs an endpoint and a shared secret, which is a
 * decision about how the two are wired rather than something to invent here.
 * The tag exists so that on-demand invalidation is a route handler away rather
 * than a re-plumbing of this file.
 */
export const SITE_CONTENT_TAG = 'site-content';

/**
 * A read whose answer may be handed to the next visitor as well.
 *
 * `safely()` with a cache in front of it, and the same contract: a database
 * that cannot be reached is an empty page and not a 500. The failure is thrown
 * inside the cached function and caught outside it, so a fallback is never
 * what gets stored — a minute of "the agenda is empty" because one query timed
 * out would be a far worse bargain than the one this is making.
 *
 * ⚠️ `what` is the cache key, so it has to vary with every argument the read
 * depends on. `pageContent` and `getPublicPage` both take one and both fold it
 * into the key; a key that ignores an argument serves one page's body under
 * another page's address.
 */
async function shared<T>(
  what: string,
  read: () => Promise<T>,
  fallback: T,
  seconds: number = SHARED_SECONDS,
): Promise<T> {
  try {
    return await unstable_cache(read, ['site', what], {
      revalidate: seconds,
      tags: [SITE_CONTENT_TAG, what],
    })();
  } catch (err) {
    console.error(`[data] ${what} failed; rendering the empty state instead`, err);
    return fallback;
  }
}

/*
 * `usable()` used to be declared here, and a second time in
 * `apps/organizer/src/lib/settings.ts`, both guarding the same defect and both
 * justified by a comment saying the two apps are separate installs and neither
 * may import the other. They both depend on `@kgc/shared`, so that was never
 * true, and the copies had already drifted — this one checked arrays and the
 * dashboard's did not. It now lives in `packages/shared/src/usable.ts`.
 */

/**
 * `settings/branding`, as the organizer's Branding Center saved it.
 *
 * ── Why this site is the surface that can read it at all ────────────────────
 *
 * `settings` is written by one install and meant to be read by three, and
 * until now was read by none — task 4.1. This site is the achievable half: it
 * renders on the server with the Admin SDK, which bypasses `firestore.rules`
 * entirely, so no rule and no deploy stands between a saved value and a
 * rendered one. The app cannot say the same — the rules name `logistics` and
 * only `logistics` on the client read path, and widening that is a decision
 * rather than a wiring job (see `SETTINGS_REGISTER` in `@kgc/shared`).
 *
 * ⚠️ **When a field of this bag gets a renderer, flip its entry in
 * `SETTINGS_REGISTER` to `live`.** Five dashboard screens generate their "where
 * does this reach" tables from that register, so an unflipped entry means the
 * organizer is told their setting reaches nothing while it is on the page in
 * front of a visitor. `hashtag` is still `pending` here on purpose: nothing
 * prints one, and a reader with no renderer is the defect the register exists
 * to catch.
 *
 * `cache()` because the root layout needs this twice per request — once in
 * `generateMetadata()` for the OG description and once in the tree for the
 * footer — and one document should not be fetched twice to answer one page.
 */
export const brandingSettings = cache(async function brandingSettings(): Promise<BrandingSettings> {
  const defaults = SETTINGS_DEFAULTS.branding;

  return shared(
    'brandingSettings',
    async () => {
      const doc = await db().collection(COLLECTIONS.settings).doc(SETTINGS_KEYS.branding).get();
      const data = doc.data() as { eventId?: string; values?: unknown } | undefined;
      if (!doc.exists || data?.eventId !== EVENT_ID) return { ...defaults };
      return { ...defaults, ...usable(defaults, data.values) };
    },
    { ...defaults },
  );
});

/**
 * Which programme pages the organizers have switched on, under Marketing >
 * Event Website. Both start off. A hidden page redirects to /previous-events
 * (old WordPress addresses land on it) and nothing on the site links to it.
 */
export async function siteVisibility(): Promise<{ agenda: boolean; speakers: boolean }> {
  const b = await brandingSettings();
  return { agenda: b.showAgenda, speakers: b.showSpeakers };
}

/**
 * The event's name, dates, time zone, venue and type, as Content > Basics saved
 * them, resolved over the constants `SITE` is built from.
 *
 * Server components read this where they used to read `SITE.name`,
 * `SITE.datesLong`, `SITE.venue` and `SITE.timeZone`. Client components cannot
 * read Firestore and stay on `SITE`, the same split `supportEmail` has. With
 * nothing saved, or the database unreachable, this returns exactly what `SITE`
 * says.
 */
export const eventBasics = cache(async function eventBasics(): Promise<EventBasics> {
  return shared(
    'eventBasics',
    async () => {
      const doc = await db().collection(COLLECTIONS.settings).doc(SETTINGS_KEYS.event).get();
      const data = doc.data() as { eventId?: string; values?: unknown } | undefined;
      if (!doc.exists || data?.eventId !== EVENT_ID) return resolveEventBasics(null);
      return resolveEventBasics(usable(SETTINGS_DEFAULTS.event, data.values));
    },
    resolveEventBasics(null),
  );
});

/** What `siteEvent()` hands a page: the saved basics in the shape `SITE` has. */
export interface SiteEvent extends EventBasics {
  /** The short venue line. The saved venue once one is saved, else `SITE.venueShort`. */
  venueShort: string;
  /** The event type, only when an organizer has chosen one. */
  savedEventType?: EventType;
}

/**
 * `eventBasics()` with the one field `SITE` has and the settings do not.
 *
 * `SITE.venueShort` is a hand-shortened form of the constant venue. Once an
 * organizer saves a venue of their own there is nothing to shorten it to, so the
 * saved venue is used in both places.
 */
export const siteEvent = cache(async function siteEvent(): Promise<SiteEvent> {
  const basics = await eventBasics();
  return {
    ...basics,
    venueShort: basics.venue === SITE.venue ? SITE.venueShort : basics.venue,
    savedEventType: basics.eventTypeSaved ? basics.eventType : undefined,
  };
});

/**
 * The editable copy of one prose page, merged field by field over the page's
 * own constants.
 *
 * ── The fallback is an argument, not a lookup ───────────────────────────────
 *
 * `fallback` is required, and it is the page's existing hardcoded copy, living
 * in the file that renders it. That is not ceremony: it means there is no code
 * path — empty collection, wrong `eventId`, unreachable database, a document
 * holding `null` where a string belongs — in which this returns something a
 * page could render blank. A code of conduct with no text is worse than a code
 * of conduct nobody has edited, and this signature is what makes the blank
 * version unrepresentable rather than merely unlikely.
 *
 * It is also why the shared package holds the *shapes* and not the copy:
 * `site.ts` already argues that presentation strings do not belong in
 * `@kgc/shared`, and "March 25, 2027" is a presentation string.
 *
 * ── No index, and none needed ───────────────────────────────────────────────
 *
 * A `doc().get()` by id, not a query — so unlike every other read in this file
 * it cannot acquire a composite-index dependency later by having a `where`
 * added to it. That is deliberate: the page id is the document id.
 */
export async function pageContent<K extends PageContentKey>(
  key: K,
  fallback: PageContentValues[K],
): Promise<PageContentValues[K]> {
  return shared(
    `pageContent:${key}`,
    async () => {
      const doc = await db().collection(COLLECTIONS.pageContent).doc(key).get();
      const data = doc.data() as PageContentDoc<K> | undefined;
      if (!doc.exists || data?.eventId !== EVENT_ID) return { ...fallback };
      return { ...fallback, ...usable(fallback as object, data.values) } as PageContentValues[K];
    },
    { ...fallback },
  );
}

/**
 * The dated lines of a call page that are safe to print.
 *
 * ── Why this is needed now and was not before ───────────────────────────────
 *
 * `usable()` validates a stored array against the *first element of the
 * fallback*, so a half-malformed deadline list used to fall back to the page's
 * own constant. Both call pages now ship `dates: []` — because the constants
 * they used to ship were the 2026 deadlines shifted a year and nobody had
 * confirmed them, and a plausible invented date is the one thing those pages
 * must not print. An empty fallback leaves `usable()` no template to check
 * against, so the check moves here, to the last moment before render.
 *
 * A row missing either half is dropped rather than printed: a deadline with no
 * date and a date with no deadline are both worse than a shorter list.
 */
export function callMilestones(dates: CallMilestone[]): CallMilestone[] {
  return (Array.isArray(dates) ? dates : []).filter((d): d is CallMilestone => {
    const row = d as Partial<CallMilestone> | null;
    return (
      !!row &&
      typeof row.when === 'string' &&
      row.when.trim() !== '' &&
      typeof row.what === 'string' &&
      row.what.trim() !== ''
    );
  });
}

export interface SpeakerCard {
  id: string;
  name: string;
  title?: string;
  company?: string;
  bio?: string;
  photoURL?: string;
  linkedin?: string;
  x?: string;
  website?: string;
  /** Whova's "Our First Speakers" highlight, now an editable field. */
  featured?: boolean;
  /** Ascending publication order. Absent everywhere means "no editorial order". */
  displayOrder?: number;
  /** Intrinsic portrait size, so the box is reserved before the image loads. */
  photoWidth?: number;
  photoHeight?: number;
}

export async function listSpeakers(): Promise<SpeakerCard[]> {
  return shared('listSpeakers', async () => {
  const snap = await db().collection(COLLECTIONS.speakers).where('eventId', '==', EVENT_ID).get();

  return snap.docs
    .map((d) => {
      const s = d.data() as SpeakerDoc;
      return {
        id: d.id,
        name: s.name,
        title: s.title,
        company: s.company,
        bio: s.bio,
        photoURL: s.photoURL,
        linkedin: s.social?.linkedin,
        x: s.social?.x,
        website: s.social?.website,
        featured: s.featured,
        displayOrder: s.displayOrder,
        photoWidth: s.photoWidth,
        photoHeight: s.photoHeight,
      };
    })
    /*
     * `displayOrder` first, surname second.
     *
     * The surname sort is the fallback and was for a long time the only rule:
     * the last whitespace-delimited word, lower-cased — wrong for some names,
     * which is why it is a display nicety and not an identity claim.
     *
     * It stopped being sufficient when the published 2026 roster was imported.
     * That roster arrived in Whova's own `display_dict` order, nominally by
     * last name but with quirks a re-sort silently corrects — `(Phil)
     * (Meredith)` sorts first there and nowhere else. Re-deriving the order
     * would have been a visible change to a page whose whole requirement was
     * not to change, so the order came with the data.
     *
     * A speaker created in the dashboard has no `displayOrder` and sorts after
     * everyone who has one, by surname, rather than jumping to the front.
     */
    .sort((a, b) => {
      const surname = (n: string) => n.split(/\s+/).pop()!.toLowerCase();
      const rank = (s: SpeakerCard) => s.displayOrder ?? Number.MAX_SAFE_INTEGER;
      return (
        rank(a) - rank(b) ||
        surname(a.name).localeCompare(surname(b.name)) ||
        a.name.localeCompare(b.name)
      );
    });
  }, []);
}

export interface Announcement {
  id: string;
  /** The headline. This is what the strip under the header shows. */
  title: string;
  body: string;
  /** Epoch milliseconds, so nothing crosses into a client component as a `Timestamp`. */
  createdAtMs: number;
}

/**
 * Organizer broadcasts, newest first.
 *
 * ── Why the website reads this at all ───────────────────────────────────────
 *
 * The strip under the header used to be `ANNOUNCEMENT` in `lib/site.ts` — one
 * hand-edited string, changed by a deploy. Meanwhile the dashboard's Send
 * Announcement button writes this collection and the app reads it three ways,
 * so "keynote moved to Bloomberg 165" reached every phone and no browser. The
 * constant survives as the fallback, because a conference with no announcements
 * yet is the normal state for most of the year and an empty strip is worse than
 * a standing line.
 *
 * Only the title is returned to the strip's caller. The body is a paragraph and
 * the strip is 13.5px uppercase read in passing at walking speed; putting a
 * paragraph in it would make the announcement less legible, not more.
 *
 * `limit` is small on purpose: the loop is duplicated to scroll seamlessly, so
 * every item is rendered twice, and an announcement from three days ago is not
 * news.
 */
export async function listAnnouncements(limit = 3): Promise<Announcement[]> {
  // Per-request, deliberately. See SHARED_SECONDS: this is the wall board.
  return safely('listAnnouncements', async () => {
    const snap = await db()
      .collection(COLLECTIONS.announcements)
      .where('eventId', '==', EVENT_ID)
      .get();

    return snap.docs
      .map((d) => {
        const a = d.data() as AnnouncementDoc;
        return {
          id: d.id,
          title: a.title,
          body: a.body,
          // A document written outside the dashboard may have no timestamp at
          // all; ordering it last is better than throwing on the homepage.
          createdAtMs: a.createdAt?.toMillis?.() ?? 0,
        };
      })
      .filter((a) => a.title)
      .sort((a, b) => b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id))
      .slice(0, limit);
  }, []);
}

export interface AgendaSession {
  id: string;
  title: string;
  description?: string;
  day: string;
  startsAtLocal: string;
  endsAtLocal: string;
  roomName?: string;
  trackName?: string;
  trackColor?: string;
  /**
   * Every track the session is cross-listed in, not just the primary one.
   *
   * ⚠️ `trackName` above is the *cached* name of the primary track only, and
   * `/agenda?track=` must not filter on it. Programme chairs cross-list talks
   * — `SessionDoc.trackIds` is plural and says so — so a Healthcare talk whose
   * primary track is Ontology Engineering is genuinely in both. Matching on the
   * displayed chip would drop it from the Healthcare slice, and the partner who
   * was handed that link would never know which sessions they were missing.
   */
  trackIds: string[];
  format: SessionDoc['format'];
  skillLevel?: SessionDoc['skillLevel'];
  /**
   * The speaker documents this session points at.
   *
   * This is the link; `speakerNames` below is the cache. Anything that needs a
   * portrait, a job title or a bio resolves these against `agendaSpeakers()`,
   * because a name is not a key and two speakers on the 2026 roster share one.
   */
  speakerIds: string[];
  /**
   * The same people as `speakerIds`, pre-rendered.
   *
   * ⚠️ Display-only, and kept here so the agenda *list* still renders from one
   * query — see the known-gaps note in AGENTS.md about `SessionDoc`'s
   * denormalised caches. Never decide anything from it, and never join on it.
   */
  speakerNames: string[];
  /**
   * The speaker's deck, once there is one.
   *
   * `SessionDoc.slidesUrl` had no reader anywhere in this project until the
   * speaker portal started collecting it — an organizer could import one and
   * nothing would ever show it, which is the defect class AGENTS.md counts. It
   * is rendered in the session dialog rather than on the card because a talk
   * with slides is not more important than one without, and a link on every row
   * would say otherwise.
   */
  slidesUrl?: string;
  /**
   * That there is something to watch, and whether it needs a particular ticket.
   *
   * The three display-only flags off `SessionDoc`, carried so an agenda row can
   * say "Live now" without a read per session — which is the whole reason they
   * are denormalised onto the session at all (see `SessionDoc.streamState`).
   *
   * ⚠️ They say a talk is live. They do not say **where**, and nothing derived
   * from them may. The stream and recording URLs live in
   * `sessions/{id}/watch/{stream|recording}`, are gated by ticket type, and are
   * read on the session page alone. If a field ever appears here holding a URL,
   * that is the gate being undone: every visitor to `/agenda` receives this
   * object.
   */
  streamState?: 'scheduled' | 'live' | 'ended';
  hasRecording?: boolean;
  watchRestricted?: boolean;
}

export interface AgendaDay {
  /** `YYYY-MM-DD`, in the event's own zone — already derived server-side. */
  day: string;
  sessions: AgendaSession[];
}

/**
 * The published programme, grouped by day.
 *
 * Note the filter: `status === 'published'` is applied **in memory**, not as a
 * second `where`. A `where('eventId') + where('status')` pair is a composite
 * index, and see the note at the top of this file about why that is a
 * production-only failure. Drafts are a handful of documents; discarding them
 * after the fetch costs nothing and cannot fail in production.
 */
export async function listAgenda(): Promise<AgendaDay[]> {
  return shared('listAgenda', async () => {
  const snap = await db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get();

  const sessions = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as SessionDoc) }))
    .filter((s) => s.status === 'published' && !s.deletedAt)
    .map(
      (s): AgendaSession => ({
        id: s.id,
        title: s.title,
        description: s.description,
        day: s.day,
        startsAtLocal: s.startsAtLocal,
        endsAtLocal: s.endsAtLocal,
        roomName: s.roomName,
        trackName: s.primaryTrackName,
        trackColor: s.primaryTrackColor,
        trackIds: s.trackIds ?? [],
        format: s.format,
        skillLevel: s.skillLevel,
        speakerIds: s.speakerIds ?? [],
        speakerNames: s.speakerNames ?? [],
        slidesUrl: s.slidesUrl,
        streamState: s.streamState,
        hasRecording: s.hasRecording,
        watchRestricted: s.watchRestricted,
      }),
    );

  const byDay = new Map<string, AgendaSession[]>();
  for (const s of sessions) {
    const bucket = byDay.get(s.day);
    if (bucket) bucket.push(s);
    else byDay.set(s.day, [s]);
  }

  return [...byDay.entries()]
    .map(([day, list]) => ({
      day,
      // `startsAtLocal` is a fixed-width `YYYY-MM-DDTHH:mm` string, so a
      // lexicographic compare is also a chronological one.
      sessions: list.sort(
        (a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal) || a.title.localeCompare(b.title),
      ),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
  }, []);
}

/**
 * Every speaker, keyed by the id a session's `speakerIds` holds.
 *
 * The agenda's session detail resolves each `AgendaSession.speakerIds` entry
 * through this map, so the whole programme's speakers cost one read rather than
 * one per session.
 *
 * ── A missing key means no speaker document, and that is the point ──────────
 *
 * **An id with no entry is absent from this object, not present and empty.**
 * Nothing is invented to stand in for it. That distinction is load-bearing: a
 * speaker can be deleted while the sessions that name them stay behind —
 * Firestore has no cascade and this project has no referential integrity — and
 * "we hold no record of this person" has to stay distinguishable from "this
 * person's bio is blank", which is the common case (see below). So
 * `speakers[id]` is `undefined` for the former and a `SpeakerCard` with no
 * `bio` for the latter, and a caller that renders them the same way is making a
 * choice rather than being handed one.
 *
 * ── What the speaker data actually contains, measured 2026-09-13 ───────────
 *
 * Against the live project, `kgc-2027`: 137 speakers, of which **none has a
 * `bio` at all** — the 2026 roster the importer read has no bio field and
 * nobody has typed one into Speaker Manager since. 124 have a `photoURL` and
 * 13 do not; 124 have a `title`, 126 a `company`. So a detail view built on
 * this renders a name, usually a portrait, usually a job title, and — until
 * someone writes them — no bios. Do not build a layout that only works when the
 * bio is there, and do not tell anyone this page shows bios; it shows the ones
 * that exist, which is currently zero.
 *
 * On the session side: 83 of 85 published sessions carry `speakerIds`, the two
 * without are both receptions, all 136 references resolve today, and no session
 * has `speakerNames` without the matching ids.
 *
 * ── One read, shared ────────────────────────────────────────────────────────
 *
 * This is `listSpeakers()` reshaped, not a second query. `/agenda` already
 * fetches four collections in one `Promise.all` on a `force-dynamic` page;
 * adding a fifth full-collection read to answer a question an existing one
 * already answers is the wrong trade. It inherits that function's sort, which
 * is irrelevant to a lookup and harmless.
 *
 * ⚠️ `listSpeakers()` is **not** memoised — `brandingSettings` is the only
 * `cache()`d read in this file — so a page that called both would read the
 * `speakers` collection twice. No page does today. `cache()` here rather than
 * on `listSpeakers()` deliberately: it makes repeat calls within one render
 * free without changing what `/speakers` or the dashboard exports do.
 */
export const agendaSpeakers = cache(async function agendaSpeakers(): Promise<
  Record<string, SpeakerCard>
> {
  // Not `shared()`: it is a reshape of `listSpeakers()`, which is cached
  // already. Caching it again would store the same forty-five speakers twice
  // under two keys, with two expiries that can disagree.
  return safely(
    'agendaSpeakers',
    async () => Object.fromEntries((await listSpeakers()).map((s) => [s.id, s])),
    {},
  );
});

export interface TrackCard {
  /** The document id. This is what `/agenda?track=` carries. */
  id: string;
  name: string;
  color?: string;
}

/**
 * The programme's tracks, for the filter row on `/agenda`.
 *
 * ── Why the id and not the name is the query parameter ──────────────────────
 *
 * The dashboard's Special-Purpose Agenda screen generates the links a partner
 * is given — `/agenda?track={t.id}` — so the id is already the contract, and it
 * is the right half of the choice anyway: a track gets renamed the week before
 * the event ("Healthcare" becomes "Healthcare & Life Sciences") and every
 * printed link built on the name dies with the rename, silently, by matching
 * nothing.
 *
 * Sorted by name rather than by any stored order. `TrackDoc` has no ordering
 * field, and inventing one from the document id would put the filter row in
 * whatever sequence the importer happened to write.
 */
export async function listTracks(): Promise<TrackCard[]> {
  return shared('listTracks', async () => {
    const snap = await db().collection(COLLECTIONS.tracks).where('eventId', '==', EVENT_ID).get();

    return snap.docs
      .map((d) => {
        const t = d.data() as TrackDoc;
        return { id: d.id, name: t.name, color: t.color };
      })
      .filter((t) => t.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);
}

export interface PublicDocument {
  id: string;
  title: string;
  description?: string;
  url: string;
  kind: DocumentDoc['kind'];
  /** The link's host, printed on the card — see the note below about off-site links. */
  host: string;
  /**
   * The session this handout belongs to, if the organizer attached it to one.
   *
   * Carried rather than filtered on, so that `/documents` still lists every
   * public handout and the agenda can pick out the ones for a given talk. A
   * deck is not less public for being about a session.
   */
  sessionId?: string;
}

/**
 * The handouts anyone may read: `documents` with **no** ticket restriction.
 *
 * ── `visibleToTicketTypes` is filtered here, on the server, and that is the
 *    entire point of this function ────────────────────────────────────────────
 *
 * `DocumentDoc.visibleToTicketTypes` exists so a workshop dataset can be
 * restricted to the people who paid for the workshop. The obvious shape for a
 * public page — fetch the collection, render every row, hide the restricted
 * ones with a class — publishes exactly the documents the field exists to
 * withhold: the URLs are in the HTML, in the page source, in the crawler's copy
 * and in the reader's "view source". A restricted deck leaked that way is
 * leaked permanently, because these are links to files somebody else is
 * hosting and this repo cannot revoke them.
 *
 * So the gate is here, before the data leaves the server: a document with a
 * non-empty `visibleToTicketTypes` is not returned at all, and there is no
 * argument, no flag and no query parameter that makes it return one. The page
 * literally cannot render what it never received. **If you add a parameter to
 * this function, you have re-opened that hole.**
 *
 * ⚠️ Absence is not restriction. `visibleToTicketTypes` is `string[]` on the
 * model but a document written before the field existed, or written by
 * something other than the dashboard, may not carry it at all — and `undefined`
 * has no `.length`. Reading it as `?? []` would treat a missing field as "open
 * to everyone", which is the wrong way for this default to fail. The check
 * below therefore demands a real array that is really empty, so anything
 * malformed stays off the page.
 *
 * `status === 'published'` is the second gate and is applied in memory for the
 * reason at the top of this file: a `where('eventId') + where('status')` pair
 * needs a composite index, which the emulator does not enforce and which would
 * fail only in production.
 */
export async function listPublicDocuments(): Promise<PublicDocument[]> {
  return shared('listPublicDocuments', async () => {
    const snap = await db()
      .collection(COLLECTIONS.documents)
      .where('eventId', '==', EVENT_ID)
      .get();

    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as DocumentDoc) }))
      .filter(
        (d) =>
          d.status === 'published' &&
          Array.isArray(d.visibleToTicketTypes) &&
          d.visibleToTicketTypes.length === 0 &&
          typeof d.url === 'string' &&
          d.url.length > 0 &&
          Boolean(d.title),
      )
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title))
      .map(
        (d): PublicDocument => ({
          id: d.id,
          title: d.title,
          description: d.description,
          url: d.url,
          kind: d.kind ?? 'link',
          host: linkHost(d.url),
          ...(d.sessionId ? { sessionId: d.sessionId } : {}),
        }),
      );
  }, []);
}

// ---------------------------------------------------------------------------
// Custom pages
// ---------------------------------------------------------------------------

export interface PublicPage {
  id: string;
  title: string;
  slug: string;
  /** Markdown, in the subset `@kgc/shared`'s `parseRichText` understands. */
  body: string;
  summary?: string;
}

function toPublicPage(id: string, p: PageDoc): PublicPage {
  return {
    id,
    title: p.title,
    slug: p.slug,
    body: p.body ?? '',
    ...(p.summary ? { summary: p.summary } : {}),
  };
}

/**
 * Whether a stored page is fit to serve.
 *
 * `published === true` rather than truthiness, for the reason
 * `listPublicDocuments` demands a real empty array: a page written before the
 * field existed carries `undefined`, and the wrong direction for that to fail
 * is "visible to the internet". A title and a body are the other two, because
 * there is nothing to render without them.
 */
function servablePage(p: PageDoc): boolean {
  return p.published === true && Boolean(p.title) && typeof p.body === 'string' && p.body.trim() !== '';
}

/**
 * The published pages, in the organizer's order.
 *
 * Filtered and sorted in memory for the reason at the top of this file: a
 * `where('eventId') + where('published')` pair needs a composite index, and the
 * emulator enforces neither its presence nor its absence, so an indexed query
 * passes every local run and fails in production with `failed-precondition`.
 */
export async function listPublicPages(): Promise<PublicPage[]> {
  return shared('listPublicPages', async () => {
    const snap = await db().collection(COLLECTIONS.pages).where('eventId', '==', EVENT_ID).get();

    return sortPages(
      snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as PageDoc) }))
        .filter(servablePage)
        .map((p) => ({ ...toPublicPage(p.id, p), order: p.order ?? 0 })),
    ).map(({ order: _order, ...page }) => page);
  }, []);
}

/**
 * One published page by its address, or `null`.
 *
 * The slug is a field rather than the document id — an organizer renaming a
 * page's address must not orphan every reference to the document inside this
 * database — so this is a query, not a `get`. Case is folded because the value
 * is typed from printed material, the same reason the branded slug is compared
 * that way, and because `normaliseSlug` stores only lower case anyway.
 *
 * ── Why it asks for the slug rather than reading the collection ─────────────
 *
 * `[slug]` is the root catch-all on this site, so **every** unknown URL lands
 * here before it 404s. This used to fetch every page of the event and scan the
 * result in memory; `generateMetadata` and the page body each call it, so one
 * request was two whole-collection reads, and anything walking `/aaa`, `/aab`,
 * … turned a 404 into a billed scan with nothing in front of it. Asking for
 * the one slug reads the documents that match, which for an unknown address is
 * none.
 *
 * The query is a single equality filter on `slug`, which needs no composite
 * index — the rule at the top of this file, and here it is also what keeps
 * `eventId` out of the query. A slug is unique within an event (`slugProblem`
 * enforces it) but not across events, so the event check stays, in memory, on
 * at most a handful of documents.
 *
 * `cache()` collapses the metadata call and the body call into one read per
 * request. It does not survive the request, which is right: a page published a
 * moment ago should appear on the next one.
 */
export const getPublicPage = cache(async function getPublicPage(
  slug: string,
): Promise<PublicPage | null> {
  const wanted = slug.trim().toLowerCase();
  if (wanted === '') return null;
  return shared(
    `getPublicPage:${wanted}`,
    async () => {
      const snap = await db()
        .collection(COLLECTIONS.pages)
        .where('slug', '==', wanted)
        .limit(5)
        .get();
      const found = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as PageDoc) }))
        .find((p) => p.eventId === EVENT_ID && servablePage(p));
      return found ? toPublicPage(found.id, found) : null;
    },
    null,
  );
});

/**
 * The host a document link points at, or `''` if it is not a URL at all.
 *
 * Printed on the card because **every document here is a link to something this
 * project does not host** — `DocumentDoc`'s own header says so, and nothing in
 * this repo uploads a file. A visitor about to click a 40MB PDF is entitled to
 * know it lives on a third-party CDN before they click it, and the dashboard
 * shows organizers the same column for the same reason.
 *
 * A malformed URL yields an empty host rather than throwing, and the page drops
 * the row instead of rendering a link to nowhere.
 */
function linkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export interface SponsorCard {
  id: string;
  name: string;
  tier: SponsorTier;
  website?: string;
  logoURL?: string;
}

/**
 * The tier list the organizer keeps on Sponsor Tiering, in rank order.
 *
 * It replaces two constants that used to sit here: a fixed order, and the logo
 * size per tier (Platinum 3, Gold 2, Silver 1, Bronze 1, the `tier_size` map the
 * live site's own sponsor widget serves). Those four are still what
 * `resolveSponsorTiers` returns when nothing is saved. `.logo-row` turns a size
 * step into pixels; see the sponsors block in `globals.css`.
 */
export const sponsorTierList = cache(async function sponsorTierList(): Promise<SponsorTierDef[]> {
  return shared(
    'sponsorTierList',
    async () => {
      const doc = await db().collection(COLLECTIONS.settings).doc(SETTINGS_KEYS.sponsorTiers).get();
      const data = doc.data() as { eventId?: string; values?: { tiers?: unknown } } | undefined;
      if (!doc.exists || data?.eventId !== EVENT_ID) return DEFAULT_SPONSOR_TIERS;
      return resolveSponsorTiers(data.values?.tiers);
    },
    DEFAULT_SPONSOR_TIERS,
  );
});

/** `Oxford Semantic Technologies` → `oxford-semantic-technologies`. */
function logoSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Which logo this site should serve for a company.
 *
 * ── An uploaded logo wins. It did not, and that was a bug ───────────────────
 *
 * This used to prefer `public/kgc/{dir}/{slug}.png` over whatever Firestore
 * held, for eighteen whitelisted slugs. Sponsor Manager gained a real upload on
 * 2026-08-31, and the result was a split: a logo an organizer uploaded reached
 * the app and reached the dashboard's own preview and **not** the public page
 * they uploaded it for. There is no way to debug that from the dashboard — the
 * upload succeeded, the image is right there in the form — so the whitelist had
 * to stop shadowing. Firestore now leads; the shipped file is what answers when
 * Firestore has nothing.
 *
 * The order is therefore: an uploaded (or hand-entered) URL, then our own
 * committed copy, then nothing, which renders the company's name.
 *
 * ── Except a Whova URL, which is dropped before it is considered ────────────
 *
 * `servableLogoURL()` is applied first and unconditionally. A URL on that host
 * must never reach a browser from anything we serve, and "it is what the
 * document says" is not a reason to hotlink the product this one replaces.
 * Dropping it falls through to the local copy, which is why the public sponsor
 * page looks identical before and after that rule existed even though its
 * source changed.
 *
 * The rule itself now lives in `@kgc/shared`, because the attendee app renders
 * the same `logoURL` into an `<Image>` and was hotlinking what this page
 * refused — see `logo-policy.ts`.
 *
 * Shared by sponsors and exhibitors. It was sponsor-only and inlined the
 * directory; exhibitors have exactly the same problem and copying it would have
 * been the second place to remember to add the CDN guard to.
 */
function selfHostedLogo(
  dir: string,
  slugs: ReadonlySet<string>,
  name: string,
  remote?: string,
): string | undefined {
  const uploaded = servableLogoURL(remote);
  if (uploaded) return uploaded;

  const slug = logoSlug(name);
  return slugs.has(slug) ? `/kgc/${dir}/${slug}.png` : undefined;
}

function localLogo(name: string, remote?: string): string | undefined {
  return selfHostedLogo('sponsors', SELF_HOSTED_LOGOS, name, remote);
}

/**
 * Which slugs actually exist in `public/kgc/sponsors/`.
 *
 * ⚠️ Read this as a **fallback set, not a whitelist**. It no longer overrides
 * anything: a sponsor with a logo in Firestore is served that logo, and this
 * set answers only for the ones without. Adding a slug here can never again
 * hide an organizer's upload — see `selfHostedLogo()` for why that mattered.
 *
 * Listed rather than probed: this runs per request on a server-rendered page,
 * and hitting the filesystem eighteen times to answer a question whose answer
 * only changes when someone commits a file would be the wrong trade. Add the
 * slug here when you add the file.
 */
const SELF_HOSTED_LOGOS = new Set([
  'abbvie',
  'accenture',
  'amazon-web-services',
  'bloomberg',
  'cloudera',
  'datahub',
  'fluree',
  'gdotv',
  'graphwise',
  'metaphacts',
  'neo4j',
  'oracle',
  'oxford-semantic-technologies',
  'process-tempo',
  'progress-software',
  'senzing',
  'stardog',
  'topquadrant',
]);

export async function listSponsors(): Promise<SponsorCard[]> {
  return shared('listSponsors', async () => {
  const tiers = await sponsorTierList();
  const snap = await db().collection(COLLECTIONS.sponsors).where('eventId', '==', EVENT_ID).get();

  return snap.docs
    .map((d) => {
      const s = d.data() as SponsorDoc;
      return {
        id: d.id,
        name: s.name,
        tier: s.tier,
        website: s.website,
        logoURL: localLogo(s.name, s.logoURL),
      };
    })
    .sort((a, b) => tierRank(tiers, a.tier) - tierRank(tiers, b.tier) || a.name.localeCompare(b.name));
  }, []);
}

/**
 * The same sponsors, grouped into tier bands in descending tier order.
 *
 * The homepage and the sponsor page both render tier-headed rows rather than one
 * flat grid, because that is what the live site does and because a flat grid
 * silently throws away the thing a sponsor paid for. Empty tiers are dropped, so
 * a conference with no Bronze sponsors shows no Bronze heading.
 */
export async function listSponsorsByTier(): Promise<
  { tier: SponsorTier; name: string; size: 1 | 2 | 3; sponsors: SponsorCard[] }[]
> {
  const [all, tiers] = await Promise.all([listSponsors(), sponsorTierList()]);
  return groupSponsorsByTier(tiers, all).map((g) => ({
    tier: g.tier.id,
    name: g.tier.name,
    size: tierSize(g.tier.size),
    sponsors: g.sponsors,
  }));
}

export interface ExhibitorCard {
  id: string;
  name: string;
  description?: string;
  website?: string;
  logoURL?: string;
  /**
   * Every booth this exhibitor actually holds, in floor-plan order. Plural
   * because a premium booth plus an overflow table is a normal package, and
   * `BoothDoc`'s own header says occupancy is a property of the space.
   */
  booths: { number: string; size: string }[];
}

export interface ExhibitorZone {
  /** The aisle or area, as the floor plan labels it. */
  zone: string;
  exhibitors: ExhibitorCard[];
}

/**
 * Which slugs exist in `public/kgc/exhibitors/`.
 *
 * ⚠️ Empty, and that is the current truth rather than an oversight: no
 * exhibitor in the live project has a `logoURL` at all, and nothing has yet
 * uploaded one — file upload is Wave 0's task 0.8 and does not exist. The set
 * is here so that the day a logo does arrive, the answer to "where do I put the
 * local copy?" is already written down and the CDN guard is already applied.
 * Add the slug here when you add the file.
 */
const SELF_HOSTED_EXHIBITOR_LOGOS = new Set<string>([]);

/**
 * The exhibition hall, grouped by aisle.
 *
 * ── Grouped by zone, because that is how the hall is walked ─────────────────
 *
 * Alphabetical would be the easy grouping and the wrong one. An attendee
 * reading this has a floor plan in front of them or is standing in the room;
 * "Catering aisle" and "Main aisle" are the labels on the walls, and a listing
 * ordered by them can be read from where the reader is standing. Within a zone
 * the order is booth number, which is the order the booths physically appear.
 *
 * ── `booths` is the truth about a booth number, not `exhibitors` ────────────
 *
 * `ExhibitorDoc.boothNumber` exists and is explicitly a denormalised display
 * label — `BoothDoc`'s header says so, and ⚠️ audit task 2.7 records that the
 * dashboard's exhibitor form takes it as *free text* and never touches
 * `booths`, so an exhibitor can currently claim a booth the floor plan shows as
 * free. This page therefore reads the number from the `booths` document that
 * names the exhibitor, which is the transactional, double-sell-proof side of
 * that split. An exhibitor whose typed `boothNumber` disagrees with the floor
 * plan is published with no number at all rather than with the wrong one —
 * sending an attendee to the wrong booth is worse than sending them to the hall
 * to look.
 *
 * ── Three filters, each of which is a claim about the world ────────────────
 *
 * `status === 'confirmed'` only. A `provisional` exhibitor has not signed, and
 * publishing them announces a commercial relationship that does not exist yet;
 * a `cancelled` one pulled out. Both are real states in the live data.
 *
 * Booth `status === 'assigned'` only. A `held` booth is promised in a sales
 * conversation and unpaid — printing its number publicly is how a space gets
 * sold twice.
 *
 * Two collections, two single-equality queries, sorted and joined in memory —
 * the rule at the top of this file. Fourteen booths and six exhibitors.
 */
export async function listExhibitorsByZone(): Promise<ExhibitorZone[]> {
  return shared('listExhibitorsByZone', async () => {
    const [exhibitorSnap, boothSnap] = await Promise.all([
      db().collection(COLLECTIONS.exhibitors).where('eventId', '==', EVENT_ID).get(),
      db().collection(COLLECTIONS.booths).where('eventId', '==', EVENT_ID).get(),
    ]);

    /** `exhibitorId` → the spaces they hold, and where those spaces are. */
    const boothsByExhibitor = new Map<string, { number: string; size: string; zone: string }[]>();
    for (const d of boothSnap.docs) {
      const b = d.data() as BoothDoc;
      if (b.status !== 'assigned' || !b.exhibitorId) continue;
      const list = boothsByExhibitor.get(b.exhibitorId) ?? [];
      list.push({ number: b.number, size: b.size, zone: b.zone ?? '' });
      boothsByExhibitor.set(b.exhibitorId, list);
    }

    const cards = exhibitorSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as ExhibitorDoc) }))
      .filter((e) => e.status === 'confirmed')
      .map((e) => {
        const held = (boothsByExhibitor.get(e.id) ?? []).sort((a, b) =>
          a.number.localeCompare(b.number),
        );
        return {
          card: {
            id: e.id,
            name: e.name,
            description: e.description,
            website: e.website,
            logoURL: selfHostedLogo(
              'exhibitors',
              SELF_HOSTED_EXHIBITOR_LOGOS,
              e.name,
              e.logoURL,
            ),
            booths: held.map((b) => ({ number: b.number, size: b.size })),
          },
          /*
           * The zone of the first booth they hold. An exhibitor with spaces in
           * two aisles is listed under the first, rather than twice — a
           * duplicate entry reads as a data fault, and their card names every
           * booth number anyway.
           */
          zone: held[0]?.zone ?? '',
        };
      });

    const byZone = new Map<string, ExhibitorCard[]>();
    for (const { card, zone } of cards) {
      const bucket = byZone.get(zone);
      if (bucket) bucket.push(card);
      else byZone.set(zone, [card]);
    }

    return [...byZone.entries()]
      .map(([zone, exhibitors]) => ({
        zone,
        exhibitors: exhibitors.sort(
          (a, b) =>
            (a.booths[0]?.number ?? '').localeCompare(b.booths[0]?.number ?? '') ||
            a.name.localeCompare(b.name),
        ),
      }))
      /*
       * Named zones alphabetically, and the unplaced group last whatever it is
       * called. A confirmed exhibitor with no booth assigned yet is a real and
       * temporary state — they have bought a package and the floor plan has not
       * caught up — so they belong on the page, at the end, under a heading
       * that says exactly that rather than under a blank one.
       */
      .sort((a, b) => (a.zone === '' ? 1 : b.zone === '' ? -1 : a.zone.localeCompare(b.zone)));
  }, []);
}

/**
 * Headline numbers for the home page, counted from the real collections.
 *
 * ⚠️ The speaker count and `/speakers` must stay the same set. Both are the
 * `speakers` collection filtered by `eventId` and nothing else, so the homepage
 * saying "137 Speakers" and the roster listing 137 people is not a coincidence
 * — it is the *only* reason two public pages of one site agree about how many
 * speakers there are. Adding a filter to `listSpeakers()` (published-only, say)
 * without adding it here makes the homepage overcount, and neither page can
 * tell. Change them together or give them one query.
 */
export async function programmeCounts(): Promise<{ speakers: number; sessions: number; sponsors: number }> {
  return shared('programmeCounts', async () => {
  const [speakers, sessions, sponsors] = await Promise.all([
    db().collection(COLLECTIONS.speakers).where('eventId', '==', EVENT_ID).count().get(),
    db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).count().get(),
    db().collection(COLLECTIONS.sponsors).where('eventId', '==', EVENT_ID).count().get(),
  ]);
  return {
    speakers: speakers.data().count,
    sessions: sessions.data().count,
    sponsors: sponsors.data().count,
  };
  }, { speakers: 0, sessions: 0, sponsors: 0 });
}
