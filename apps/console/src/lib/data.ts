import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  type AnnouncementDoc,
  type RoomDoc,
  type SessionDoc,
  type SpeakerDoc,
  type SponsorDoc,
  type SponsorTier,
  type TrackDoc,
  type UserDoc,
  type WithId,
} from '@kgc/shared';
import { db } from './firestore';

/**
 * Every read the console does. All of it runs on the server with the Admin SDK
 * — there is no Firebase client in this app at all, so there is nothing for a
 * browser chunk to leak.
 *
 * `eventId` comes from `@kgc/shared` and is never spelled as a literal
 * (DECISIONS.md D5); it leads every query for the same reason it leads every
 * composite index.
 */

/** A plain object safe to hand to a client component — no Timestamps, no class instances. */
export interface SessionRow {
  id: string;
  title: string;
  day: string;
  startsAtLocal: string;
  endsAtLocal: string;
  roomId?: string;
  roomName?: string;
  primaryTrackName?: string;
  speakerNames: string[];
  status: SessionDoc['status'];
  format: SessionDoc['format'];
}

function toRow(id: string, s: SessionDoc): SessionRow {
  return {
    id,
    title: s.title,
    day: s.day,
    startsAtLocal: s.startsAtLocal,
    endsAtLocal: s.endsAtLocal,
    roomId: s.roomId,
    roomName: s.roomName,
    primaryTrackName: s.primaryTrackName,
    speakerNames: s.speakerNames ?? [],
    status: s.status,
    format: s.format,
  };
}

/**
 * All sessions for the event, every status, sorted by local start.
 *
 * Sorting happens in memory on purpose. `where(eventId) + orderBy(startsAt)`
 * needs a composite index that `firestore.indexes.json` does not have — the
 * four `sessions` indexes it does have all pin `status` as well, because the
 * attendee app only ever asks for published ones. The emulator does not enforce
 * indexes, so that query would work here and fail with `failed-precondition`
 * against the real project; AGENTS.md records that exact bug shipping twice.
 * Seventy-two documents sort in microseconds, so the index is not worth adding
 * until the console has a reason to page.
 */
export async function listSessions(): Promise<SessionRow[]> {
  const snap = await db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get();
  return snap.docs
    .map((d) => toRow(d.id, d.data() as SessionDoc))
    .sort((a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal) || a.title.localeCompare(b.title));
}

export async function getSession(id: string): Promise<WithId<SessionDoc> | null> {
  const doc = await db().collection(COLLECTIONS.sessions).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as SessionDoc) };
}

export interface RoomOption {
  id: string;
  name: string;
}

export async function listRooms(): Promise<RoomOption[]> {
  const snap = await db().collection(COLLECTIONS.rooms).where('eventId', '==', EVENT_ID).get();
  return snap.docs
    .map((d) => ({ id: d.id, name: (d.data() as RoomDoc).name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  authorId: string;
  push: boolean;
  createdAt: string | null;
}

export async function listAnnouncements(limit = 25): Promise<AnnouncementRow[]> {
  const snap = await db()
    .collection(COLLECTIONS.announcements)
    .where('eventId', '==', EVENT_ID)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snap.docs.map((d) => {
    const a = d.data() as AnnouncementDoc;
    return {
      id: d.id,
      title: a.title,
      body: a.body,
      authorId: a.authorId,
      push: a.push,
      createdAt: a.createdAt ? a.createdAt.toDate().toISOString() : null,
    };
  });
}

/**
 * The four reads below all follow the same shape as `listSessions()`, and for
 * the same reason: a single `where('eventId', '==', …)` equality is served by
 * Firestore's automatic single-field index, so it needs no entry in
 * `firestore.indexes.json`. The moment an `orderBy` joins it, it needs a
 * composite index that this repo does not declare — and the emulator would not
 * tell us, because it does not enforce indexes. AGENTS.md records that exact
 * bug shipping twice. At 11 tracks, 50 speakers, 15 sponsors and 50 attendees,
 * sorting in memory costs nothing and cannot fail in production.
 */

export interface TrackRow {
  id: string;
  name: string;
  color?: string;
  description?: string;
  /** Sessions cross-listed into this track, and how many of those are published. */
  sessionCount: number;
  publishedCount: number;
  /** True when this track is the one shown on the session's agenda card. */
  primaryCount: number;
}

export async function listTracks(): Promise<TrackRow[]> {
  const [snap, sessions] = await Promise.all([
    db().collection(COLLECTIONS.tracks).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get(),
  ]);

  const docs = sessions.docs.map((d) => d.data() as SessionDoc);

  return snap.docs
    .map((d) => {
      const t = d.data() as TrackDoc;
      const inTrack = docs.filter((s) => (s.trackIds ?? []).includes(d.id));
      return {
        id: d.id,
        name: t.name,
        color: t.color,
        description: t.description,
        sessionCount: inTrack.length,
        publishedCount: inTrack.filter((s) => s.status === 'published').length,
        primaryCount: inTrack.filter((s) => s.primaryTrackName === t.name).length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface SpeakerRow {
  id: string;
  name: string;
  title?: string;
  company?: string;
  hasBio: boolean;
  hasPhoto: boolean;
  sessionCount: number;
  /** Titles of the sessions this speaker is on, for the list. */
  sessionTitles: string[];
  /** Set when the speaker also holds a ticket, so the two identities join up. */
  userId?: string;
}

export async function listSpeakers(): Promise<SpeakerRow[]> {
  const [snap, sessions] = await Promise.all([
    db().collection(COLLECTIONS.speakers).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get(),
  ]);

  const titleById = new Map(sessions.docs.map((d) => [d.id, (d.data() as SessionDoc).title]));

  return snap.docs
    .map((d) => {
      const s = d.data() as SpeakerDoc;
      const ids = s.sessionIds ?? [];
      return {
        id: d.id,
        name: s.name,
        title: s.title,
        company: s.company,
        hasBio: Boolean(s.bio && s.bio.trim()),
        hasPhoto: Boolean(s.photoURL),
        sessionCount: ids.length,
        sessionTitles: ids.map((id) => titleById.get(id) ?? id),
        userId: s.userId,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface SponsorRow {
  id: string;
  name: string;
  tier: SponsorTier;
  website?: string;
  description?: string;
  boothLocation?: string;
  hasLogo: boolean;
  offerCount: number;
  downloadCount: number;
}

/** Whova orders tiers by value and that ordering drives three surfaces (§9.2). */
export const TIER_ORDER: SponsorTier[] = ['diamond', 'platinum', 'gold', 'silver', 'startup'];

export async function listSponsors(): Promise<SponsorRow[]> {
  const snap = await db().collection(COLLECTIONS.sponsors).where('eventId', '==', EVENT_ID).get();
  return snap.docs
    .map((d) => {
      const s = d.data() as SponsorDoc;
      return {
        id: d.id,
        name: s.name,
        tier: s.tier,
        website: s.website,
        description: s.description,
        boothLocation: s.boothLocation,
        hasLogo: Boolean(s.logoURL),
        offerCount: s.offers?.length ?? 0,
        downloadCount: s.downloads?.length ?? 0,
      };
    })
    .sort(
      (a, b) =>
        TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.name.localeCompare(b.name),
    );
}

export interface AttendeeRow {
  uid: string;
  name: string;
  email: string;
  title?: string;
  company?: string;
  roles: string[];
  onboarded: boolean;
  visibleInDirectory: boolean;
  messagingEnabled: boolean;
  interests: string[];
}

export async function listAttendees(): Promise<AttendeeRow[]> {
  const snap = await db().collection(COLLECTIONS.users).where('eventId', '==', EVENT_ID).get();
  return snap.docs
    .map((d) => {
      const u = d.data() as UserDoc;
      return {
        uid: d.id,
        name: u.name,
        email: u.email,
        title: u.title,
        company: u.company,
        roles: u.roles ?? [],
        onboarded: Boolean(u.onboarded),
        visibleInDirectory: Boolean(u.visibleInDirectory),
        messagingEnabled: Boolean(u.messagingEnabled),
        interests: u.interests ?? [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function countWhereEvent(collection: string): Promise<number> {
  const snap = await db().collection(collection).where('eventId', '==', EVENT_ID).count().get();
  return snap.data().count;
}

export interface AuditRow {
  id: string;
  actor: string;
  action: string;
  targetPath: string;
  at: string | null;
  changed: string[];
}

export async function recentAudit(limit = 15): Promise<AuditRow[]> {
  // No `where(eventId)` here: ordering by `at` alongside it would need a
  // composite index this repo does not declare, and there is exactly one event.
  const snap = await db().collection(COLLECTIONS.auditLog).orderBy('at', 'desc').limit(limit).get();
  return snap.docs.map((d) => {
    const e = d.data() as {
      actor: string;
      action: string;
      targetPath: string;
      at?: { toDate(): Date };
      after?: Record<string, unknown>;
    };
    return {
      id: d.id,
      actor: e.actor,
      action: e.action,
      targetPath: e.targetPath,
      at: e.at ? e.at.toDate().toISOString() : null,
      changed: Object.keys(e.after ?? {}),
    };
  });
}
