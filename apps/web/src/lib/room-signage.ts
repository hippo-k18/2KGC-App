import 'server-only';

import { COLLECTIONS, EVENT_ID, type RoomDoc, type SessionDoc } from '@kgc/shared';
import { db } from './firestore';
import type { SignageSession } from './room-signage-core';

/**
 * The programme for one room, for the sign outside its door.
 *
 * ── Why this reads the room document at all ────────────────────────────────
 *
 * `SessionDoc` already caches `roomName`, so the sessions alone would render a
 * heading. They would also render a heading for a room id nobody has ever
 * created, spelled into the address bar, and the whole page would look correct.
 * Reading the room is how `/rooms/nope` becomes a 404 instead of an empty sign
 * with a plausible name on it, and it is one document.
 *
 * ── Published only, filtered in memory ─────────────────────────────────────
 *
 * One equality filter on `eventId`, everything else discarded after the fetch:
 * `where('eventId') + where('roomId')` is a composite index, the emulator does
 * not enforce index configuration, and AGENTS.md records two screens that
 * shipped broken exactly that way. Drafts and cancelled sessions are dropped
 * here rather than on the page, because a sign outside a room is the last
 * surface that should advertise a talk the programme has pulled.
 */
export interface RoomSignage {
  roomId: string;
  roomName: string;
  building?: string;
  floor?: string;
  sessions: SignageSession[];
}

export async function roomSignage(roomId: string): Promise<RoomSignage | null> {
  const [roomDoc, snap] = await Promise.all([
    db().collection(COLLECTIONS.rooms).doc(roomId).get(),
    db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get(),
  ]);

  if (!roomDoc.exists) return null;
  const room = roomDoc.data() as RoomDoc;
  if (room.eventId !== EVENT_ID) return null;

  const sessions = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as SessionDoc) }))
    .filter(
      (s) => s.roomId === roomId && s.status === 'published' && !s.deletedAt,
    )
    .map(
      (s): SignageSession => ({
        id: s.id,
        title: s.title,
        startsAtLocal: s.startsAtLocal,
        endsAtLocal: s.endsAtLocal,
        day: s.day,
        speakerNames: s.speakerNames ?? [],
        trackName: s.primaryTrackName,
      }),
    );

  return {
    roomId,
    roomName: room.name,
    building: room.building,
    floor: room.floor,
    sessions,
  };
}

/** Every room that has a published session in it, for the index of signs. */
export async function listSignageRooms(): Promise<{ id: string; name: string; sessions: number }[]> {
  const [roomSnap, sessionSnap] = await Promise.all([
    db().collection(COLLECTIONS.rooms).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get(),
  ]);

  const live = sessionSnap.docs
    .map((d) => d.data() as SessionDoc)
    .filter((s) => s.status === 'published' && !s.deletedAt);

  return roomSnap.docs
    .map((d) => ({
      id: d.id,
      name: (d.data() as RoomDoc).name,
      sessions: live.filter((s) => s.roomId === d.id).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
