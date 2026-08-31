'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { roomId as mintRoomId } from '@kgc/scripts/src/lib/ids';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { getRoom } from '@/lib/data';
import { fanOutRoomRename, summariseFanOut } from '@/lib/denormalise';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';

/**
 * Spelled here rather than added to `ROUTES`, matching `exhibitor-manager`.
 * `ROUTES` names the screens several files revalidate; this one is revalidated
 * from exactly one place.
 */
const LOGISTICS_ROUTE = '/content/logistics-center';

/**
 * Create or edit one room.
 *
 * ── This is the highest-consequence editor of the three ─────────────────────
 *
 * `firestore.rules` has no `match /rooms/{…}` block at all, so the collection
 * is default-denied and **the attendee app cannot read it**. What a phone shows
 * is `SessionDoc.roomName`, a cached copy — and that cache is the only thing in
 * the entire product telling somebody which door to walk to. A rename that does
 * not fan out does not degrade a listing; it sends people to a room that no
 * longer has that name on it.
 *
 * So `fanOutRoomRename` runs on every name change, after the room document is
 * written, and what it reports is returned to the screen. `saveSessionAction`
 * already maintains the same cache from the other direction, when a session
 * moves room. The two together are what make `roomName` trustworthy.
 *
 * ── The route, and why the editor is on Logistics Center ────────────────────
 *
 * `nav.ts` is Whova's own tree and it has no rooms node: Logistics Center is
 * the leaf that owns the venue, and it is where the room count was already
 * displayed. Inventing `logistics-center/room-manager` would put a path in the
 * sidebar that Whova does not have, and `nav.ts` wins on IA questions.
 */
export interface RoomState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** `summariseFanOut` for the session caches this save rewrote. */
  fanOut?: string;
  /** False when a fan-out batch failed and some sessions still name the old room. */
  fanOutOk?: boolean;
}

export async function saveRoomAction(_prev: RoomState, formData: FormData): Promise<RoomState> {
  const actor = await requireOrganizer();

  const id = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const building = String(formData.get('building') ?? '').trim();
  const floor = String(formData.get('floor') ?? '').trim();
  const capacityRaw = String(formData.get('capacity') ?? '').trim();

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) {
    fieldErrors.name = 'Enter the room name exactly as it is signposted at the venue.';
  }

  const capacity = capacityRaw === '' ? undefined : Number(capacityRaw);
  if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1)) {
    fieldErrors.capacity = 'Seats must be a whole number, or blank if it is not known.';
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { error: 'Some fields need attention.', fieldErrors };
  }

  const existing = id ? await getRoom(id) : null;
  if (id && !existing) return { error: 'That room no longer exists.' };

  /**
   * The importer's own slug, minted once and never re-derived: `roomId(name)`
   * makes a room added here survive a later agenda re-import as the same
   * document, and `sessions.roomId` points at it, so a rename must not move it.
   */
  const docId = id || mintRoomId(name);
  if (!docId) return { error: 'That name produces an empty id. Use some letters or numbers.' };
  if (!id) {
    const clash = await getRoom(docId);
    if (clash) return { error: `“${clash.name}” already uses the id “${docId}”.` };
  }

  try {
    await db()
      .collection(COLLECTIONS.rooms)
      .doc(docId)
      .set(
        {
          eventId: EVENT_ID,
          name,
          // Cleared explicitly. With `ignoreUndefinedProperties` an emptied
          // field would silently keep its old value, and a stale seat count is
          // what the over-capacity warning would then be computed from.
          building: building || FieldValue.delete(),
          floor: floor || FieldValue.delete(),
          capacity: capacity ?? FieldValue.delete(),
          ...(existing ? {} : { createdAt: new Date() }),
          updatedAt: new Date(),
        },
        { merge: true },
      );
  } catch (err) {
    recordError('room.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save the room.' };
  }

  let fanOut: string | undefined;
  let fanOutOk = true;
  if (existing && existing.name !== name) {
    const result = await fanOutRoomRename(db(), docId, name);
    fanOut = summariseFanOut(result);
    fanOutOk = result.ok;
    if (!result.ok) recordError('room.fanOut', new Error(result.errors.join('; ')));
  }

  await appendAudit({
    actor,
    action: existing ? 'room.update' : 'room.create',
    targetPath: `${COLLECTIONS.rooms}/${docId}`,
    targetId: docId,
    before: existing
      ? {
          name: existing.name,
          building: existing.building ?? null,
          floor: existing.floor ?? null,
          capacity: existing.capacity ?? null,
        }
      : {},
    after: {
      name,
      building: building || null,
      floor: floor || null,
      capacity: capacity ?? null,
      ...(fanOut ? { sessionCaches: fanOut } : {}),
    },
  });

  revalidatePath(LOGISTICS_ROUTE);
  if (fanOut) {
    revalidatePath(ROUTES.sessionManager);
    revalidatePath(ROUTES.conflictCheck);
  }

  return {
    ok: true,
    message: existing ? `Saved ${name}.` : `Added ${name} as ${docId}.`,
    fanOut,
    fanOutOk,
  };
}
