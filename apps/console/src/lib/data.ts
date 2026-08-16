import 'server-only';

import { COLLECTIONS, EVENT_ID, type AnnouncementDoc, type RoomDoc, type SessionDoc, type WithId } from '@kgc/shared';
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
