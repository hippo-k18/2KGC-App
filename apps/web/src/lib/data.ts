import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  SETTINGS_DEFAULTS,
  SETTINGS_KEYS,
  type AnnouncementDoc,
  type BoothDoc,
  type BrandingSettings,
  type ExhibitorDoc,
  type PageContentDoc,
  type PageContentKey,
  type PageContentValues,
  type SessionDoc,
  type SpeakerDoc,
  type SponsorDoc,
  type SponsorTier,
} from '@kgc/shared';
import { cache } from 'react';
import { db } from './firestore';

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
 * Every read below goes through `safely()`. Without it, a deployment whose
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
 * Keep only the stored fields whose shape matches the fallback's.
 *
 * ⚠️ Not defensive programming for its own sake. Settings documents written
 * before 2026-08-31 hold `null` for a cleared field, and a raw spread over the
 * defaults puts `null` where the type says `string` — which is how a page ends
 * up printing the word "null" to the public. The dashboard's
 * `apps/organizer/src/lib/settings.ts` `usable()` is the same four lines for
 * the same reason; this is the website's copy because the two apps are separate
 * installs and neither may import the other.
 *
 * `typeof` alone would let any object through an array field, so arrays are
 * checked structurally: an array field keeps the stored value only if every
 * element matches the first element of the fallback. A page whose deadline list
 * arrives half-malformed shows the constant, not a row reading "undefined".
 */
function usable<T extends object>(fallback: T, stored: unknown): Partial<T> {
  if (!stored || typeof stored !== 'object') return {};
  const shape = fallback as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    if (!(k in shape)) continue;
    const want = shape[k];

    if (Array.isArray(want)) {
      if (!Array.isArray(v)) continue;
      /*
       * An empty stored list falls back to the constant rather than emptying
       * the page. Every array these two stores hold is one where emptiness is
       * a regression and not a statement: a code of conduct that names nobody
       * to report to, a call page with the heading "Important dates" and
       * nothing under it. An organizer who wants a section gone needs a
       * control that says so, not a list they happened to clear.
       */
      if (v.length === 0) continue;
      const template = want[0] as unknown;
      if (template !== undefined && !v.every((el) => sameShape(template, el))) continue;
      out[k] = v;
      continue;
    }

    if (typeof v !== typeof want || v === null) continue;
    out[k] = v;
  }

  return out as Partial<T>;
}

/** Whether `value` carries every key of `template`, at the same primitive types. */
function sameShape(template: unknown, value: unknown): boolean {
  if (typeof template !== 'object' || template === null) return typeof value === typeof template;
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(template as Record<string, unknown>).every(
    ([k, t]) => typeof (value as Record<string, unknown>)[k] === typeof t,
  );
}

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

  return safely(
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
  return safely(
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
  sessionCount: number;
}

export async function listSpeakers(): Promise<SpeakerCard[]> {
  return safely('listSpeakers', async () => {
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
        sessionCount: s.sessionIds?.length ?? 0,
      };
    })
    // Surname-ish sort: the last whitespace-delimited word. Wrong for some
    // names, which is why it is a display nicety and not an identity claim.
    .sort((a, b) => {
      const key = (n: string) => n.split(/\s+/).pop()!.toLowerCase();
      return key(a.name).localeCompare(key(b.name)) || a.name.localeCompare(b.name);
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
  format: SessionDoc['format'];
  skillLevel?: SessionDoc['skillLevel'];
  speakerNames: string[];
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
  return safely('listAgenda', async () => {
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
        format: s.format,
        skillLevel: s.skillLevel,
        speakerNames: s.speakerNames ?? [],
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

export interface SponsorCard {
  id: string;
  name: string;
  tier: SponsorTier;
  website?: string;
  logoURL?: string;
}

const TIER_ORDER: Record<SponsorTier, number> = {
  platinum: 0,
  gold: 1,
  silver: 2,
  bronze: 3,
};

/**
 * How large each tier's logo renders, as a step from 1 to 3.
 *
 * These are not chosen — they are the `tier_size` map the live site's own
 * sponsor widget serves, and they are why Platinum reads as bought-bigger while
 * Silver and Bronze deliberately share a size. `.logo-row` turns a step into
 * pixels; see the sponsors block in `globals.css`.
 */
export const TIER_SIZE: Record<SponsorTier, 1 | 2 | 3> = {
  platinum: 3,
  gold: 2,
  silver: 1,
  bronze: 1,
};

/** `Oxford Semantic Technologies` → `oxford-semantic-technologies`. */
function logoSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Whova's own asset CDN, which is where the seed fixtures took the real 2026
 * logos from.
 *
 * ⚠️ A URL on this host must never reach a browser from a page we serve. Two
 * separate reasons, and either alone would be enough: it is a request to the
 * product this one replaces, made by a visitor to our public site and visible
 * in their network tab; and it is a hotlink to somebody else's bandwidth for an
 * asset we do not own, which they can break or swap at any time.
 *
 * The seed no longer writes these URLs into `logoURL` at all, so on freshly
 * seeded data this catches nothing. It stays for the two ways one can still
 * arrive: a Whova CSV imported through the dashboard's sponsor importer, and
 * the live project, which was seeded by an older build and still holds
 * eighteen of them. Dropping the URL falls through to our own copy, or to the
 * company's name — a visibly missing asset rather than a silent third-party
 * request.
 */
const FOREIGN_CDN = /^https?:\/\/[^/]*\bd1keuthy5s86c8\.cloudfront\.net\//i;

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
 * `FOREIGN_CDN` is checked first and unconditionally. A URL on that host must
 * never reach a browser from a page we serve, and "it is what the document
 * says" is not a reason to hotlink the product this one replaces. Dropping it
 * falls through to the local copy, which is why the public sponsor page looks
 * identical before and after this change even though its source changed.
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
  const uploaded = remote && !FOREIGN_CDN.test(remote) ? remote : undefined;
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
  return safely('listSponsors', async () => {
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
    .sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || a.name.localeCompare(b.name));
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
  { tier: SponsorTier; size: 1 | 2 | 3; sponsors: SponsorCard[] }[]
> {
  const all = await listSponsors();
  return (Object.keys(TIER_ORDER) as SponsorTier[])
    .map((tier) => ({
      tier,
      size: TIER_SIZE[tier],
      sponsors: all.filter((s) => s.tier === tier),
    }))
    .filter((band) => band.sponsors.length > 0);
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
  return safely('listExhibitorsByZone', async () => {
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

/** Headline numbers for the home page, counted from the real collections. */
export async function programmeCounts(): Promise<{ speakers: number; sessions: number; sponsors: number }> {
  return safely('programmeCounts', async () => {
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
