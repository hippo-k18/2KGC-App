import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  type SessionDoc,
  type SpeakerDoc,
  type SponsorDoc,
  type SponsorTier,
} from '@kgc/shared';
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

/**
 * The local copy of a sponsor's logo, if this site ships one.
 *
 * `logoURL` in Firestore is the absolute original, because the Expo app and the
 * console read the same document and a root-relative path is meaningless to
 * them. This site does better: it self-hosts all eighteen under
 * `public/kgc/sponsors/`, so it serves its own copy and makes no request to a
 * third-party CDN from a public page. Falls through to whatever Firestore holds
 * for any sponsor added later without a local file.
 */
function localLogo(name: string, remote?: string): string | undefined {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return SELF_HOSTED_LOGOS.has(slug) ? `/kgc/sponsors/${slug}.png` : remote;
}

/**
 * Which slugs actually exist in `public/kgc/sponsors/`.
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
