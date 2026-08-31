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

/**
 * Tracks and speakers as pickable options, and nothing else.
 *
 * `listTracks()` and `listSpeakers()` below answer a *management* question —
 * how many sessions is this track on, does this speaker have a headshot — and
 * each of them reads the whole `sessions` collection a second time to do it.
 * That is right for the list screens they were written for and wrong for the
 * two callers here: the session editor renders these as dropdowns and its save
 * action resolves the chosen ids back to names for the denormalised caches, so
 * one save would otherwise cost two extra full-collection scans for counts
 * nobody looks at.
 *
 * Same shape and the same single-equality query as `listRooms()` above, for the
 * same reason: `where('eventId', '==', …)` alone is served by Firestore's
 * automatic single-field index, and adding an `orderBy` would need a composite
 * index the emulator would not miss and production would.
 */
export interface TrackOption {
  id: string;
  name: string;
  /** Optional in the model, and a track that has none clears the cached colour. */
  color?: string;
}

export async function listTrackOptions(): Promise<TrackOption[]> {
  const snap = await db().collection(COLLECTIONS.tracks).where('eventId', '==', EVENT_ID).get();
  return snap.docs
    .map((d) => {
      const t = d.data() as TrackDoc;
      return { id: d.id, name: t.name, color: t.color };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface SpeakerOption {
  id: string;
  name: string;
  /** Shown beside the name in the picker — two speakers can share a name. */
  company?: string;
  /** The inverse index the session editor has to keep in step. */
  sessionIds: string[];
}

export async function listSpeakerOptions(): Promise<SpeakerOption[]> {
  const snap = await db().collection(COLLECTIONS.speakers).where('eventId', '==', EVENT_ID).get();
  return snap.docs
    .map((d) => {
      const s = d.data() as SpeakerDoc;
      return { id: d.id, name: s.name, company: s.company, sessionIds: s.sessionIds ?? [] };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getRoom(id: string): Promise<WithId<RoomDoc> | null> {
  const doc = await db().collection(COLLECTIONS.rooms).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as RoomDoc) };
}

/**
 * A room with the numbers an organizer needs before moving anything.
 *
 * `RoomOption` deliberately stays two fields — it fills a `<select>` and
 * nothing else, and every session form in the dashboard calls it. This is the
 * shape the room editor needs: what is scheduled here, and whether anything
 * scheduled here claims more seats than the room has.
 */
export interface RoomRow extends RoomOption {
  building?: string;
  floor?: string;
  capacity?: number;
  /** Sessions scheduled in this room, and how many of those are published. */
  sessionCount: number;
  publishedCount: number;
  /**
   * Sessions whose stated capacity exceeds what the room seats. `conflicts.ts`
   * reports the same mismatch one session at a time; per room is the view you
   * want when deciding which talk to move.
   */
  overCapacityCount: number;
}

export async function listRoomRows(): Promise<RoomRow[]> {
  const [snap, sessions] = await Promise.all([
    db().collection(COLLECTIONS.rooms).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get(),
  ]);

  const docs = sessions.docs.map((d) => d.data() as SessionDoc);

  return snap.docs
    .map((d) => {
      const r = d.data() as RoomDoc;
      const here = docs.filter((s) => s.roomId === d.id);
      return {
        id: d.id,
        name: r.name,
        building: r.building,
        floor: r.floor,
        capacity: r.capacity,
        sessionCount: here.length,
        publishedCount: here.filter((s) => s.status === 'published').length,
        overCapacityCount:
          typeof r.capacity === 'number'
            ? here.filter((s) => typeof s.capacity === 'number' && s.capacity > r.capacity!).length
            : 0,
      };
    })
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

export async function getTrack(id: string): Promise<WithId<TrackDoc> | null> {
  const doc = await db().collection(COLLECTIONS.tracks).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as TrackDoc) };
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
  /**
   * The address the programme committee corresponds with. On the list so a row
   * can offer "Email speaker" without a second read — and so the absence of one
   * is visible, which is the reason a bio chase goes unanswered.
   */
  contactEmail?: string;
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
        contactEmail: s.contactEmail,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSpeaker(id: string): Promise<WithId<SpeakerDoc> | null> {
  const doc = await db().collection(COLLECTIONS.speakers).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as SpeakerDoc) };
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

/**
 * One sponsor, whole.
 *
 * `SponsorRow` deliberately reduces `offers` and `downloads` to counts, which is
 * right for a list and wrong for an editor: a form that loaded a count could
 * only ever write the array back empty. The editor reads the document.
 */
export async function getSponsor(id: string): Promise<WithId<SponsorDoc> | null> {
  const doc = await db().collection(COLLECTIONS.sponsors).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as SponsorDoc) };
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
const emailKey = (e: string | undefined) => (e ?? '').trim().toLowerCase();

export async function listAttendees(): Promise<AttendeeRow[]> {
  const [userSnap, regSnap] = await Promise.all([
    db().collection(COLLECTIONS.users).where('eventId', '==', EVENT_ID).select('email').get(),
    db()
      .collection(COLLECTIONS.registrations)
      .where('eventId', '==', EVENT_ID)
      .select('email')
      .get(),
  ]);

  const rows = new Map<string, AttendeeRow>();

  // Users first, so their profile fields are the richer starting point.
  for (const d of userSnap.docs) {
    const u = d.data() as UserDoc;
    rows.set(emailKey(u.email) || d.id, {
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
    const k = emailKey(r.email);
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

/**
 * Tickets, profiles, and how many of the first have become the second.
 *
 * ── Why this exists rather than dividing two counts ─────────────────────────
 *
 * The masthead used to read `users / registrations`, which is not a ratio at
 * all: a `users` document is anybody who has signed in, and organizers, staff
 * and comped speakers hold no ticket, so the numerator was never drawn from the
 * denominator. On seeded data plus the real accounts that came out as "51 have
 * signed in (102%)" — a percentage over 100 on every page of the dashboard.
 * `signedIn` here counts *registrations*, filtered from the same query that
 * produces `registrations`, so it cannot exceed it however the two collections
 * drift apart.
 *
 * ── Why the join is the email address and not `claimedByUid` ────────────────
 *
 * `RegistrationDoc.claimedByUid` exists for precisely this question, and it is
 * still the wrong field to ask. Two facts about the live data outrank the
 * model: the seed never writes it, and nothing creates `users/{uid}` on first
 * sign-in either, so the two signals disagree in both directions. Meanwhile
 * `listAttendees()` — and behind it the Attendees screen, the exports and the
 * analytics block — has always joined the two collections on the address. One
 * page load must not carry two definitions of "signed in", so this one adopts
 * theirs; the day something backfills `claimedByUid` for every holder, that
 * field becomes the cheaper join and both should move together.
 *
 * ── What it costs ──────────────────────────────────────────────────────────
 *
 * The two `count()` aggregates this replaces billed about one read each; two
 * documents-in-full queries bill one read per document, and the masthead is on
 * every screen. That is the price of an honest subset — an aggregate can size
 * each collection but cannot intersect them — and at this event's scale it is
 * the same pair of queries the Attendees screen already runs on the screen this
 * number has to agree with. If the ticket list ever outgrows that, the way out
 * is to backfill `claimedByUid` and count it with an aggregate, not to go back
 * to dividing two unrelated totals.
 *
 * Only the address is read, so `select('email')` is the trim that matters: it
 * stops the masthead pulling two full collections on every screen. It used to be
 * left off because the in-memory fixture store did not implement `select` and a
 * masthead that throws takes every screen with it. That store is gone.
 */
export async function adoptionCounts(): Promise<{
  registrations: number;
  users: number;
  signedIn: number;
}> {
  const [userSnap, regSnap] = await Promise.all([
    db().collection(COLLECTIONS.users).where('eventId', '==', EVENT_ID).select('email').get(),
    db()
      .collection(COLLECTIONS.registrations)
      .where('eventId', '==', EVENT_ID)
      .select('email')
      .get(),
  ]);

  const profiles = new Set(
    userSnap.docs.map((d) => emailKey((d.data() as UserDoc).email)).filter(Boolean),
  );

  return {
    registrations: regSnap.size,
    users: userSnap.size,
    signedIn: regSnap.docs.filter((d) => profiles.has(emailKey((d.data() as RegistrationDoc).email)))
      .length,
  };
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
