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
  publicSiteOrigin,
  tierRank,
} from '@kgc/shared';
import { auditPlace, auditSubject, namesARecord } from './audit-subject';
import { emailKey, mergeAttendees, type AttendeeRow } from './attendees-core';
import { recordError } from './errors';
import { sponsorTiers } from './event';
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

/**
 * A stored image path, as a URL this dashboard can actually load.
 *
 * ⚠️ `photoURL` is not always absolute. `scripts/src/import-speakers-2026.ts`
 * writes it as a **site-relative** path — `/kgc/speakers/jans-aasman.jpg` —
 * because the 124 headshots it imports are files checked into
 * `apps/web/public`. The website serves them from its own origin; the dashboard
 * is a different origin on a different port, so the browser resolves that same
 * path against :3100 and gets the dashboard's 404. Rendering the field verbatim
 * therefore shows a broken image for every imported speaker while the identical
 * value works on the public site, which is why nothing here noticed.
 *
 * `publicSiteOrigin()` is the resolver the order, unsubscribe and consent links
 * already go through, so there is one answer to "where is the website" rather
 * than a second one invented here. An already-absolute URL — a portrait
 * uploaded to Firebase Storage, a sponsor logo on Whova's CDN — is returned
 * untouched.
 */
export function imageSrc(stored?: string): string | undefined {
  const raw = stored?.trim();
  if (!raw) return undefined;
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(raw) || raw.startsWith('data:')) return raw;
  return `${publicSiteOrigin()}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

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
  /**
   * The five fields below are read by the session detail modal and by nothing
   * else on a list screen. They are on the row rather than behind a second
   * `getSession()` per session because the modal's content is rendered with the
   * page — a detail that arrived on click would need a client-side fetch, and
   * this app has no Firebase client at all.
   */
  description?: string;
  trackIds: string[];
  skillLevel?: SessionDoc['skillLevel'];
  speakerIds: string[];
  timeZone: string;
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
    description: s.description,
    trackIds: s.trackIds ?? [],
    skillLevel: s.skillLevel,
    speakerIds: s.speakerIds ?? [],
    timeZone: s.timeZone,
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

/**
 * The speaker as the session detail modal shows them: a face, a name, who they
 * work for, and their bio if there is one.
 *
 * Deliberately not `listSpeakers()`, which answers the *management* question
 * and reads the whole `sessions` collection a second time to count what each
 * speaker is on. Session Manager has already read every session, so paying for
 * that twice to fill a modal would be the same waste `listSpeakerOptions()`
 * exists to avoid — and deliberately not `SpeakerOption` either, because a
 * picker needs no portrait.
 */
export interface SpeakerCard {
  id: string;
  name: string;
  title?: string;
  company?: string;
  bio?: string;
  /** Already resolved by `imageSrc`, so a caller cannot forget to. */
  photoURL?: string;
}

export async function listSpeakerCards(): Promise<SpeakerCard[]> {
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
        photoURL: imageSrc(s.photoURL),
      };
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
  /**
   * The pin, as a 0–1 fraction of each axis of a floorplan image.
   *
   * Carried here so the Venue Map screen can say whether a room has been placed
   * rather than asserting that none has. Both are present or neither is: a pin
   * with one coordinate cannot be drawn, so a half-written pair reads as unset.
   */
  mapX?: number;
  mapY?: number;
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
      // Both or neither: a pin with one coordinate cannot be drawn, so a
      // half-written pair is reported as unset rather than as half-placed.
      const placed = typeof r.mapX === 'number' && typeof r.mapY === 'number';
      return {
        id: d.id,
        name: r.name,
        building: r.building,
        floor: r.floor,
        capacity: r.capacity,
        mapX: placed ? r.mapX : undefined,
        mapY: placed ? r.mapY : undefined,
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
  /**
   * The portrait itself, resolved by `imageSrc`, and the bio text — not just
   * whether each exists.
   *
   * `hasPhoto` alone was enough while this screen only ever drew a red or green
   * tag. The detail modal shows the likeness, which is the thing an organizer
   * opens a speaker to check: whether the face on the badge and the agenda is
   * the right person and the right way up.
   */
  photoURL?: string;
  bio?: string;
  social?: SpeakerDoc['social'];
  sessionCount: number;
  /**
   * The sessions this speaker presents, earliest first — the other half of the
   * link `SessionDoc.speakerIds` makes, which the detail modal reads back.
   * Titles alone would name the talks and not say when they are, and "are these
   * two of mine an hour apart" is the question that gets asked here.
   */
  sessions: { id: string; title: string; day: string; startsAtLocal: string }[];
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

  const sessionById = new Map(
    sessions.docs.map((d) => {
      const s = d.data() as SessionDoc;
      return [d.id, { id: d.id, title: s.title, day: s.day, startsAtLocal: s.startsAtLocal }];
    }),
  );

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
        photoURL: imageSrc(s.photoURL),
        bio: s.bio,
        social: s.social,
        sessionCount: ids.length,
        /*
         * A `sessionIds` entry with no session behind it is a dangling pointer
         * — the inverse index went out of step with the sessions themselves.
         * Dropping it would hide that; it is kept as a row carrying the id as
         * its title, which is what the old `sessionTitles` fallback did.
         */
        sessions: ids
          .map((id) => sessionById.get(id) ?? { id, title: id, day: '', startsAtLocal: '' })
          .sort((a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal)),
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

/**
 * Whova orders tiers by value and that ordering drives three surfaces (§9.2).
 * The order is the saved tier list from Sponsor Tiering: `sponsorTiers()` in
 * `lib/event.ts`.
 */
export async function listSponsors(): Promise<SponsorRow[]> {
  const tiers = await sponsorTiers();
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
        tierRank(tiers, a.tier) - tierRank(tiers, b.tier) || a.name.localeCompare(b.name),
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

export type { AttendeeRow };

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
  // Whole documents, not `select('email')`: the rows are built from every
  // profile and ticket field. `adoptionCounts()` below is the one that only
  // needs the address.
  const [userSnap, regSnap] = await Promise.all([
    db().collection(COLLECTIONS.users).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.registrations).where('eventId', '==', EVENT_ID).get(),
  ]);

  return mergeAttendees(
    userSnap.docs.map((d) => ({ id: d.id, data: d.data() as UserDoc })),
    regSnap.docs.map((d) => ({ id: d.id, data: d.data() as RegistrationDoc })),
  );
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
  /**
   * What the row is about, in words: the person's name, the session's title.
   *
   * `targetPath` is a Firestore path and `targetId` is a hash, so the table
   * used to say `registrations/reg_01e1621469460b03d253854f` and left the
   * organizer to guess who that was. Never null: `audit-subject.ts` has the
   * four places it comes from and the order they are tried in.
   */
  subject: string;
  at: string | null;
  changed: string[];
}

export async function recentAudit(limit = 15): Promise<AuditRow[]> {
  // No `where(eventId)` here: ordering by `at` alongside it would need a
  // composite index this repo does not declare, and there is exactly one event.
  const snap = await db().collection(COLLECTIONS.auditLog).orderBy('at', 'desc').limit(limit).get();
  const entries = snap.docs.map((d) => {
    const e = d.data() as {
      actor: string;
      action: string;
      targetPath: string;
      at?: { toDate(): Date };
      subject?: string;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    };
    return {
      id: d.id,
      actor: e.actor,
      action: e.action,
      targetPath: e.targetPath ?? '',
      // The entry's own `subject` if it has one, then `after` before `before`:
      // on a rename the new name is the one to show.
      named: (e.subject ?? '').trim() || auditSubject(e.after, e.before) || '',
      at: e.at ? e.at.toDate().toISOString() : null,
      changed: Object.keys(e.after ?? {}),
    };
  });

  const fromRecord = await namesOfChangedRecords(entries);

  return entries.map((e) => ({
    id: e.id,
    actor: e.actor,
    action: e.action,
    targetPath: e.targetPath,
    subject: e.named || fromRecord.get(e.targetPath) || auditPlace(e.targetPath),
    at: e.at,
    changed: e.changed,
  }));
}

/**
 * Reads back the records the entries without a name of their own point at.
 *
 * A cancel and a reinstate record `status` and nothing else, so there is no
 * name anywhere in the entry — but the registration still exists and still
 * knows whose it is. One `getAll` for the whole page, deduplicated, and at most
 * fifteen rows to begin with, so this is one round trip on a screen that
 * already makes nine.
 *
 * Failure is not surfaced. The names are the nicety here; the log is the point,
 * and a report screen that will not open because one lookup timed out is worse
 * than a row that says "A ticket holder".
 */
async function namesOfChangedRecords(
  entries: { action: string; targetPath: string; named: string }[],
): Promise<Map<string, string>> {
  const paths = [
    ...new Set(
      entries
        .filter((e) => !e.named && namesARecord(e.action, e.targetPath))
        .map((e) => e.targetPath),
    ),
  ];
  if (paths.length === 0) return new Map();

  try {
    const docs = await db().getAll(...paths.map((p) => db().doc(p)));
    const names = new Map<string, string>();
    for (const doc of docs) {
      const name = doc.exists ? auditSubject(doc.data()) : null;
      if (name) names.set(doc.ref.path, name);
    }
    return names;
  } catch (err) {
    recordError('audit subject lookup failed', err);
    return new Map();
  }
}
