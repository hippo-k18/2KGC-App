import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type GatheringDoc } from '@kgc/shared';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * Round tables and bookable meeting slots.
 *
 * One module for both because they are one shape — a title, a host, a room, a
 * time and a cap — differing in what they are called. Whova ships them as
 * separate products only because it grew them separately, and two collections
 * here would mean two capacity checks and two clash checks that drift.
 *
 * ── What this is honestly for ──────────────────────────────────────────────
 *
 * ⚠️ Nothing in the mobile app reads any of it. An attendee cannot browse
 * tables, join one, or request a meeting. What an organizer gets is the
 * artefact they actually produce by hand today: the printed table cards, the
 * room grid on the wall, the list the front desk works from. That is worth
 * having without an app; pretending it is a self-service feature would not be.
 */

export interface GatheringRow {
  id: string;
  kind: GatheringDoc['kind'];
  title: string;
  host: string;
  roomId?: string;
  roomName: string;
  day: string;
  startsAtLocal: string;
  endsAtLocal: string;
  capacity: number;
  attendees: string[];
  notes: string;
  status: GatheringDoc['status'];
  /** Capacity minus the people placed. Never negative on screen. */
  spare: number;
  full: boolean;
}

function toRow(id: string, g: GatheringDoc): GatheringRow {
  const attendees = g.attendees ?? [];
  const capacity = g.capacity ?? 0;
  return {
    id,
    kind: g.kind,
    title: g.title,
    host: g.host ?? '',
    roomId: g.roomId,
    roomName: g.roomName ?? '',
    day: g.day ?? '',
    startsAtLocal: g.startsAtLocal ?? '',
    endsAtLocal: g.endsAtLocal ?? '',
    capacity,
    attendees,
    notes: g.notes ?? '',
    status: g.status ?? 'planned',
    spare: Math.max(0, capacity - attendees.length),
    full: attendees.length >= capacity,
  };
}

/** Every gathering of one kind, in the order it happens. */
export async function listGatherings(kind: GatheringDoc['kind']): Promise<GatheringRow[]> {
  try {
    /**
     * One equality filter on `eventId`, sorted in memory — the same rule as
     * every other read in this app. The emulator does not enforce composite
     * indexes, so `where(eventId) + where(kind) + orderBy` would pass locally
     * and fail in production with `failed-precondition`, a bug that has already
     * shipped twice on this project.
     */
    const snap = await db().collection(COLLECTIONS.gatherings).where('eventId', '==', EVENT_ID).get();
    return snap.docs
      .map((d) => toRow(d.id, d.data() as GatheringDoc))
      .filter((g) => g.kind === kind)
      .sort(
        (a, b) =>
          a.day.localeCompare(b.day) ||
          a.startsAtLocal.localeCompare(b.startsAtLocal) ||
          a.title.localeCompare(b.title),
      );
  } catch (err) {
    recordError(`gatherings.list:${kind}`, err);
    return [];
  }
}

export type GatheringResult = { ok: true; message: string } | { ok: false; error: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function saveGathering(input: {
  id?: string;
  kind: GatheringDoc['kind'];
  title: string;
  host: string;
  roomId: string;
  roomName: string;
  day: string;
  startsAtLocal: string;
  endsAtLocal: string;
  capacity: number;
  notes: string;
  actor: string;
}): Promise<GatheringResult> {
  const title = input.title.trim();
  if (title.length < 3) return { ok: false, error: 'Give it a title — it prints on the table card.' };

  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 200) {
    return { ok: false, error: 'Capacity must be a whole number between 1 and 200.' };
  }

  if (input.startsAtLocal && !TIME.test(input.startsAtLocal)) {
    return { ok: false, error: 'Start time must be HH:MM, or blank.' };
  }
  if (input.endsAtLocal && !TIME.test(input.endsAtLocal)) {
    return { ok: false, error: 'End time must be HH:MM, or blank.' };
  }
  if (
    input.startsAtLocal &&
    input.endsAtLocal &&
    input.startsAtLocal >= input.endsAtLocal
  ) {
    return { ok: false, error: 'It has to start before it ends.' };
  }

  try {
    const col = db().collection(COLLECTIONS.gatherings);
    const ref = input.id ? col.doc(input.id) : col.doc();
    const existing = input.id ? (await ref.get()).data() : undefined;

    /**
     * Shrinking capacity below the number of people already placed is refused
     * rather than silently truncating the list. Somebody has been told they
     * have a seat.
     */
    const placed = ((existing as GatheringDoc | undefined)?.attendees ?? []).length;
    if (placed > input.capacity) {
      return {
        ok: false,
        error: `${placed} people are already placed here. Remove some before dropping the capacity to ${input.capacity}.`,
      };
    }

    await ref.set(
      {
        eventId: EVENT_ID,
        kind: input.kind,
        title,
        host: input.host.trim() || FieldValue.delete(),
        roomId: input.roomId || FieldValue.delete(),
        roomName: input.roomName || FieldValue.delete(),
        day: input.day || FieldValue.delete(),
        startsAtLocal: input.startsAtLocal || FieldValue.delete(),
        endsAtLocal: input.endsAtLocal || FieldValue.delete(),
        capacity: input.capacity,
        notes: input.notes.trim() || FieldValue.delete(),
        // Never written on an update: editing a room must not empty the table.
        ...(existing ? {} : { attendees: [], status: 'planned', createdAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await appendAudit({
      actor: input.actor,
      action: existing ? 'gathering.update' : 'gathering.create',
      targetPath: `${COLLECTIONS.gatherings}/${ref.id}`,
      targetId: ref.id,
      before: {},
      after: { kind: input.kind, title, capacity: input.capacity },
    });

    return { ok: true, message: existing ? `Updated “${title}”.` : `Added “${title}”.` };
  } catch (err) {
    recordError('gatherings.save', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save.' };
  }
}

/**
 * Place somebody, or take them off.
 *
 * ── The cap is enforced here and it is not theatre ─────────────────────────
 *
 * Everywhere else in this project capacity is an optimistic counter, on the
 * argument that two buyers racing across a Stripe redirect cannot be stopped
 * cheaply. This is different: the only writer is an organizer typing a name
 * into a form, so a transaction that refuses an over-full table costs one read
 * and prevents somebody being sent to a table with no chair.
 */
export async function placeAttendee(input: {
  id: string;
  name: string;
  remove?: boolean;
  actor: string;
}): Promise<GatheringResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Enter a name.' };

  const ref = db().collection(COLLECTIONS.gatherings).doc(input.id);

  try {
    const outcome = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false as const, error: 'That no longer exists.' };

      const g = snap.data() as GatheringDoc;
      if (g.eventId !== EVENT_ID) return { ok: false as const, error: 'Wrong event.' };

      const attendees = g.attendees ?? [];

      if (input.remove) {
        tx.update(ref, {
          attendees: attendees.filter((a) => a !== name),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { ok: true as const, message: `Removed ${name} from “${g.title}”.` };
      }

      // Case-insensitive, because "Ada Lovelace" and "ada lovelace" are one
      // person and two seats.
      if (attendees.some((a) => a.toLowerCase() === name.toLowerCase())) {
        return { ok: false as const, error: `${name} is already at “${g.title}”.` };
      }
      if (attendees.length >= (g.capacity ?? 0)) {
        return {
          ok: false as const,
          error: `“${g.title}” is full at ${g.capacity}. Raise the capacity or use another table.`,
        };
      }

      tx.update(ref, {
        attendees: [...attendees, name],
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { ok: true as const, message: `${name} is at “${g.title}”.` };
    });

    return outcome;
  } catch (err) {
    recordError('gatherings.place', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update.' };
  }
}

/** Cancel a table or slot. Never deleted — the plan is the record of what changed. */
export async function setGatheringStatus(input: {
  id: string;
  status: GatheringDoc['status'];
  actor: string;
}): Promise<GatheringResult> {
  try {
    await db()
      .collection(COLLECTIONS.gatherings)
      .doc(input.id)
      .update({ status: input.status, updatedAt: FieldValue.serverTimestamp() });

    await appendAudit({
      actor: input.actor,
      action: 'gathering.update',
      targetPath: `${COLLECTIONS.gatherings}/${input.id}`,
      targetId: input.id,
      before: {},
      after: { status: input.status },
    });

    return { ok: true, message: `Marked ${input.status}.` };
  } catch (err) {
    recordError('gatherings.status', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update.' };
  }
}

// ---------------------------------------------------------------------------
// Room clashes
// ---------------------------------------------------------------------------

/**
 * Two things in one room at the same time.
 *
 * Pure, and separate from the fetch for the reason `conflicts-core.ts` records:
 * `server-only` throws outside a Server Component, so anything with arithmetic
 * in it lives beside the fetch rather than inside it.
 *
 * Overlap is strict — a table ending at 14:00 and another starting at 14:00 do
 * not clash. Back-to-back is how a room is used, not a mistake.
 */
export function roomClashes(rows: GatheringRow[]): { a: GatheringRow; b: GatheringRow }[] {
  const clashes: { a: GatheringRow; b: GatheringRow }[] = [];

  const timed = rows.filter(
    (r) => r.status !== 'cancelled' && r.roomId && r.day && r.startsAtLocal && r.endsAtLocal,
  );

  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (a.roomId !== b.roomId || a.day !== b.day) continue;
      if (a.startsAtLocal < b.endsAtLocal && b.startsAtLocal < a.endsAtLocal) {
        clashes.push({ a, b });
      }
    }
  }

  return clashes;
}
