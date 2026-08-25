import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  type AnnouncementDoc,
  type RegistrationDoc,
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
  /**
   * The logo itself, not just whether one exists.
   *
   * `hasLogo` alone was enough while every sponsor was missing one; now that all
   * eighteen have logos the column would read "yes" eighteen times and tell an
   * organizer nothing. A thumbnail lets them see at a glance that a logo is the
   * right one, the right way up and not a 4:1 wordmark squeezed into a square —
   * which is what they actually open this page to check.
   */
  logoURL?: string;
  hasLogo: boolean;
  offerCount: number;
  downloadCount: number;
  /**
   * The person the sponsorship team actually deals with. Added when Message
   * Sponsors needed somewhere to send to — a sponsor record that describes a
   * logo but not a relationship cannot be contacted, and chasing a missing logo
   * is the commonest reason to try.
   */
  contactName?: string;
  contactEmail?: string;
}

/** Whova orders tiers by value and that ordering drives three surfaces (§9.2). */
export const TIER_ORDER: SponsorTier[] = ['platinum', 'gold', 'silver', 'bronze'];

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
        logoURL: s.logoURL,
        hasLogo: Boolean(s.logoURL),
        contactName: s.contactName,
        contactEmail: s.contactEmail,
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
  /** Absent until they sign in — a ticket holder who has not is still an attendee. */
  uid?: string;
  name: string;
  email: string;
  title?: string;
  company?: string;
  roles: string[];
  onboarded: boolean;
  visibleInDirectory: boolean;
  messagingEnabled: boolean;
  interests: string[];

  /** True when a `users` profile exists — i.e. they have opened the app. */
  signedIn: boolean;
  /** Present for anyone holding a ticket. Absent for staff added by hand. */
  registrationId?: string;
  ticketType?: string;
  /** `cancelled` after a refund. A cancelled ticket must stay visible. */
  registrationStatus?: RegistrationDoc['status'];
}

/**
 * Every attendee: ticket holders **and** signed-in users, merged.
 *
 * ── Why this is a union and not just `users` ────────────────────────────────
 *
 * This read `users` alone, which meant somebody who bought a ticket five
 * minutes ago was **invisible on the Attendees screen until they opened the
 * app**. Measured on seeded data plus one live purchase: 51 ticket holders, 50
 * rows. The missing one was the person who had just paid.
 *
 * That is the wrong way round. Whova's attendee list *is* the registration
 * list, and the organizer's question in the fortnight before doors open is
 * "who is coming, and have they got the app yet?" — which needs both halves.
 * Reading `users` answered only the second.
 *
 * ── Joined on the email address ─────────────────────────────────────────────
 *
 * `registrations` is keyed by an opaque server-minted id and `users` by Firebase
 * uid, so email is the only join key the two share — which is precisely why
 * `registrationId(email)` is derived from a normalised address in the first
 * place. Both sides are lower-cased here rather than trusted: the importer
 * normalises, but a `users` document written by the app on first sign-in
 * carries whatever Firebase Auth had.
 *
 * ── Both directions ─────────────────────────────────────────────────────────
 *
 * A registration with no user is a ticket holder who has not signed in. A user
 * with no registration is staff, a speaker with a comp, or a seeded demo
 * account. Both are attendees and both appear; the `signedIn` and `ticketType`
 * columns say which is which rather than one of them being silently dropped.
 */
export async function listAttendees(): Promise<AttendeeRow[]> {
  const [userSnap, regSnap] = await Promise.all([
    db().collection(COLLECTIONS.users).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.registrations).where('eventId', '==', EVENT_ID).get(),
  ]);

  const key = (e: string | undefined) => (e ?? '').trim().toLowerCase();
  const rows = new Map<string, AttendeeRow>();

  // Users first, so their profile fields are the richer starting point.
  for (const d of userSnap.docs) {
    const u = d.data() as UserDoc;
    rows.set(key(u.email) || d.id, {
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
      signedIn: true,
    });
  }

  for (const d of regSnap.docs) {
    const r = d.data() as RegistrationDoc;
    const k = key(r.email);
    const existing = rows.get(k);

    if (existing) {
      // Attach the ticket to the profile that already exists.
      existing.registrationId = d.id;
      existing.ticketType = r.ticketType;
      existing.registrationStatus = r.status;
      continue;
    }

    /**
     * A ticket holder with no profile yet. Everything a profile would supply is
     * genuinely unknown rather than defaulted to something flattering —
     * `visibleInDirectory: false` because there is no directory projection to
     * be in, not because they opted out.
     */
    rows.set(k || d.id, {
      name: r.name ?? '(no name yet)',
      email: r.email,
      roles: [],
      onboarded: false,
      visibleInDirectory: false,
      messagingEnabled: false,
      interests: [],
      signedIn: false,
      registrationId: d.id,
      ticketType: r.ticketType,
      registrationStatus: r.status,
    });
  }

  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
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
