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
 */

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
}

export interface SponsorCard {
  id: string;
  name: string;
  tier: SponsorTier;
  website?: string;
  logoURL?: string;
}

const TIER_ORDER: Record<SponsorTier, number> = {
  diamond: 0,
  platinum: 1,
  gold: 2,
  silver: 3,
  startup: 4,
};

export async function listSponsors(): Promise<SponsorCard[]> {
  const snap = await db().collection(COLLECTIONS.sponsors).where('eventId', '==', EVENT_ID).get();

  return snap.docs
    .map((d) => {
      const s = d.data() as SponsorDoc;
      return { id: d.id, name: s.name, tier: s.tier, website: s.website, logoURL: s.logoURL };
    })
    .sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || a.name.localeCompare(b.name));
}

/** Headline numbers for the home page, counted from the real collections. */
export async function programmeCounts(): Promise<{ speakers: number; sessions: number; sponsors: number }> {
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
}
