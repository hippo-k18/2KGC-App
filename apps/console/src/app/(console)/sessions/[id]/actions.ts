'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, type PublishStatus, type SessionDoc } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { appendAudit, diff } from '@/lib/audit';
import { db } from '@/lib/firestore';
import { listRooms } from '@/lib/data';
import { deriveTimes } from '@/lib/time';
import { recordError } from '@/lib/errors';
import { roomChangePush } from '@/lib/push';

export interface SaveState {
  ok?: boolean;
  message?: string;
  error?: string;
  changed?: string[];
  /** Set when the seam would have sent a push, so the demo can point at it. */
  pushNote?: string;
}

const STATUSES: PublishStatus[] = ['draft', 'published', 'cancelled'];

/**
 * The demo path: an organizer changes a room on a laptop and a phone already
 * looking at that session updates within seconds.
 *
 * Three things make that work, and all three are load-bearing:
 *
 *  1. **One `update()` on the session document.** The attendee app is listening
 *     with `onSnapshot`; a single commit is a single snapshot, delivered in
 *     about a second. Splitting this into several writes (or deleting and
 *     recreating) makes the phone flicker through intermediate states, and a
 *     delete would also detach every saved-session reference — which is why
 *     `firestore.rules` refuses session deletes outright and why "unpublish"
 *     here is a `status` transition and nothing more.
 *
 *  2. **The derived time fields are recomputed server-side**, never taken from
 *     the form. `startsAtLocal` is the authoring truth; `startsAt`, `endsAt`
 *     and `day` follow from it in `America/New_York`. Writing a wall clock
 *     without re-deriving `day` moves a session on the phone's day tabs without
 *     moving it in the list, and nobody notices until they walk to an empty room.
 *
 *  3. **The audit entry is written after the commit, and cannot block it.**
 *
 * Fields this deliberately never writes: `replyCount`, `reactionCount`,
 * `upvoteCount`, poll `tallies`, `totalVotes` — those are function-owned
 * (DECISIONS.md D2) — and the denormalised caches it does not own
 * (`speakerNames`, `primaryTrackName`, `primaryTrackColor`), which belong to the
 * importer. `roomName` is the one cache the console must maintain, because the
 * console is what changes the room.
 */
export async function saveSessionAction(
  sessionId: string,
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const actor = await requireOrganizer();

  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const roomId = String(formData.get('roomId') ?? '').trim();
  const startsAtLocal = String(formData.get('startsAtLocal') ?? '').trim();
  const endsAtLocal = String(formData.get('endsAtLocal') ?? '').trim();
  const status = String(formData.get('status') ?? '').trim() as PublishStatus;

  if (!title) return { error: 'Title cannot be empty.' };
  if (!STATUSES.includes(status)) return { error: `Unknown status "${status}".` };

  const ref = db().collection(COLLECTIONS.sessions).doc(sessionId);

  try {
    // Rooms are read outside the transaction: Firestore requires all reads
    // before any write, and the room list is not part of the invariant.
    const rooms = await listRooms();
    const room = roomId ? rooms.find((r) => r.id === roomId) : undefined;
    if (roomId && !room) return { error: `No room with id "${roomId}".` };

    const outcome = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('That session no longer exists.');
      const before = snap.data() as SessionDoc;

      // Re-derived here, server-side, in the session's own zone. `deriveTimes`
      // throws on a malformed wall clock or an end at/before the start.
      const times = deriveTimes(startsAtLocal, endsAtLocal, before.timeZone);
      const rescheduled =
        times.startsAtLocal !== before.startsAtLocal || times.endsAtLocal !== before.endsAtLocal;

      // Typed loosely on purpose: `FieldValue.delete()` is a sentinel, not a
      // value of the modelled field type, and it is the only correct way to
      // clear an optional field — writing `undefined` under
      // `ignoreUndefinedProperties` silently leaves the old value in place.
      const patch: Record<string, unknown> = {
        title,
        description: description || FieldValue.delete(),
        roomId: room ? room.id : FieldValue.delete(),
        roomName: room ? room.name : FieldValue.delete(),
        status,
        startsAt: times.startsAt,
        endsAt: times.endsAt,
        startsAtLocal: times.startsAtLocal,
        endsAtLocal: times.endsAtLocal,
        day: times.day,
        updatedAt: FieldValue.serverTimestamp(),
      };

      // RFC 5545 SEQUENCE: bumping it on a reschedule is what lets an already
      // exported calendar entry update in place instead of appearing twice.
      if (rescheduled) patch.sequence = (before.sequence ?? 0) + 1;

      tx.update(ref, patch);

      const readable = diff(
        {
          title: before.title,
          description: before.description,
          roomId: before.roomId,
          roomName: before.roomName,
          startsAtLocal: before.startsAtLocal,
          endsAtLocal: before.endsAtLocal,
          day: before.day,
          status: before.status,
        },
        {
          title,
          description: description || undefined,
          roomId: room?.id,
          roomName: room?.name,
          startsAtLocal: times.startsAtLocal,
          endsAtLocal: times.endsAtLocal,
          day: times.day,
          status,
        },
      );

      return { readable, roomChanged: (before.roomId ?? '') !== (room?.id ?? ''), title };
    });

    if (outcome.readable.changed.length === 0) {
      return { ok: true, message: 'No changes to save.', changed: [] };
    }

    await appendAudit({
      actor,
      action: 'session.update',
      targetPath: `${COLLECTIONS.sessions}/${sessionId}`,
      targetId: sessionId,
      before: outcome.readable.before,
      after: outcome.readable.after,
    });

    let pushNote: string | undefined;
    if (outcome.roomChanged) {
      const result = await roomChangePush({
        sessionId,
        title: outcome.title,
        roomName: room?.name ?? 'no room',
      });
      pushNote = result.detail;
    }

    revalidatePath('/sessions');
    revalidatePath(`/sessions/${sessionId}`);
    revalidatePath('/war-room');

    return {
      ok: true,
      message: `Saved. Changed: ${outcome.readable.changed.join(', ')}.`,
      changed: outcome.readable.changed,
      pushNote,
    };
  } catch (err) {
    recordError(`session.update ${sessionId}`, err);
    return { error: err instanceof Error ? err.message : 'Save failed.' };
  }
}
