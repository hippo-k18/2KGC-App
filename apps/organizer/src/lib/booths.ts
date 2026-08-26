import 'server-only';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type BoothDoc } from '@kgc/shared';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * The exhibition floor plan.
 *
 * A `ticketTypes` entry sells "a 3m × 2m booth"; a `booths` document is the
 * particular space an exhibitor ends up standing in. The two are deliberately
 * separate because they are decided months apart — the catalogue is priced
 * before the venue confirms a plan.
 *
 * ── Assignment is a transaction, and here that is not decorative ────────────
 *
 * Booth allocation is the one place in this project where the optimistic
 * counter pattern used for ticket capacity is genuinely not good enough. A
 * ticket oversold by one is a refund and an apology; a booth sold twice is two
 * companies who have shipped a stand to New York for the same six square
 * metres, and there is no apology for that on the morning of day one. So the
 * write reads the booth inside a transaction and refuses if it is already
 * taken, rather than checking first and writing after.
 */

export interface BoothRow {
  id: string;
  number: string;
  size: string;
  zone: string;
  ticketTypeId?: string;
  exhibitorId?: string;
  exhibitorName?: string;
  orderId?: string;
  status: BoothDoc['status'];
  note?: string;
  assignedAt?: string;
  assignedBy?: string;
}

function iso(t: { toDate(): Date } | undefined): string | undefined {
  try {
    return t?.toDate().toISOString();
  } catch {
    return undefined;
  }
}

function toRow(id: string, b: BoothDoc): BoothRow {
  return {
    id,
    number: b.number || id,
    size: b.size ?? '',
    zone: b.zone ?? '',
    ticketTypeId: b.ticketTypeId,
    exhibitorId: b.exhibitorId,
    exhibitorName: b.exhibitorName,
    orderId: b.orderId,
    status: b.status ?? 'available',
    note: b.note,
    assignedAt: iso(b.assignedAt),
    assignedBy: b.assignedBy,
  };
}

/**
 * Every booth, in floor-plan order.
 *
 * Sorted by zone then number, and the number sort is *natural* — `A2` before
 * `A10`, which a plain string sort gets backwards. Nobody reading a floor plan
 * thinks of A10 as coming before A2, and a list that disagrees with the sign on
 * the wall is a list people stop trusting.
 */
export async function listBooths(): Promise<BoothRow[]> {
  try {
    const snap = await db().collection(COLLECTIONS.booths).where('eventId', '==', EVENT_ID).get();
    return snap.docs
      .map((d) => toRow(d.id, d.data() as BoothDoc))
      .sort(
        (a, b) =>
          a.zone.localeCompare(b.zone) ||
          a.number.localeCompare(b.number, undefined, { numeric: true }),
      );
  } catch (err) {
    recordError('booths.list', err);
    return [];
  }
}

export interface BoothSummary {
  total: number;
  available: number;
  held: number;
  assigned: number;
  blocked: number;
  /** Booth-shaped ticket sales with no space allocated yet. The actionable number. */
  unallocatedSales: number;
}

export function summarise(booths: BoothRow[], boothSalesCount: number): BoothSummary {
  const by = (s: BoothDoc['status']) => booths.filter((b) => b.status === s).length;
  return {
    total: booths.length,
    available: by('available'),
    held: by('held'),
    assigned: by('assigned'),
    blocked: by('blocked'),
    /**
     * Never negative. More assigned booths than sales is a legitimate state —
     * an organizer allocating a space to a comped exhibitor, or to themselves —
     * and rendering "-2 unallocated" would read as a bug rather than as that.
     */
    unallocatedSales: Math.max(0, boothSalesCount - by('assigned')),
  };
}

export type BoothResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Put an exhibitor in a booth, or hold it for them.
 *
 * `hold` and `assign` write the same fields and differ only in status, because
 * the difference is about money rather than about space: a held booth is
 * promised and unpaid. Modelling them as one write keeps "who is in A12?"
 * answerable without checking two places.
 */
export async function assignBooth(input: {
  boothId: string;
  exhibitorId: string;
  exhibitorName: string;
  orderId?: string;
  hold: boolean;
  actor: string;
}): Promise<BoothResult> {
  const { boothId, exhibitorId, exhibitorName, orderId, hold, actor } = input;

  const boothRef = db().collection(COLLECTIONS.booths).doc(boothId);

  try {
    const outcome = await db().runTransaction(async (tx) => {
      const snap = await tx.get(boothRef);
      if (!snap.exists) return { ok: false as const, error: `Booth ${boothId} does not exist.` };

      const booth = snap.data() as BoothDoc;
      if (booth.eventId !== EVENT_ID) {
        return { ok: false as const, error: `Booth ${boothId} belongs to another event.` };
      }

      /**
       * Refusing to move an occupant is the point of the transaction.
       *
       * Re-assigning the *same* exhibitor is allowed and is how a hold is
       * converted to an assignment once payment lands — otherwise the organizer
       * would have to release and re-assign, and the gap between those two
       * writes is exactly when somebody else takes the space.
       */
      if (
        (booth.status === 'assigned' || booth.status === 'held') &&
        booth.exhibitorId &&
        booth.exhibitorId !== exhibitorId
      ) {
        return {
          ok: false as const,
          error: `${booth.number} is already ${booth.status} to ${booth.exhibitorName ?? booth.exhibitorId}. Release it first.`,
        };
      }

      if (booth.status === 'blocked') {
        return {
          ok: false as const,
          error: `${booth.number} is blocked${booth.note ? ` — ${booth.note}` : ''}. Unblock it before assigning.`,
        };
      }

      tx.update(boothRef, {
        exhibitorId,
        exhibitorName,
        // Firestore rejects `undefined`; delete the key instead so a booth
        // assigned by hand does not carry a stale order id from a previous
        // occupant.
        orderId: orderId ?? FieldValue.delete(),
        status: hold ? 'held' : 'assigned',
        assignedAt: Timestamp.now(),
        assignedBy: actor,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { ok: true as const, number: booth.number };
    });

    if (!outcome.ok) return outcome;

    /**
     * The denormalised label on the exhibitor, written outside the transaction.
     *
     * `ExhibitorDoc.boothNumber` is display-only — the app's exhibitor list
     * prints it and nothing decides anything from it — so a failure here leaves
     * the allocation correct and one label stale, which is recoverable. Putting
     * it inside the transaction would make a missing exhibitor document abort a
     * booth assignment that is otherwise perfectly valid.
     */
    try {
      await db()
        .collection(COLLECTIONS.exhibitors)
        .doc(exhibitorId)
        .update({ boothNumber: outcome.number, updatedAt: FieldValue.serverTimestamp() });
    } catch (err) {
      recordError('booths.assign.denormalise', err);
    }

    await appendAudit({
      actor,
      action: hold ? 'booth.hold' : 'booth.assign',
      targetPath: `${COLLECTIONS.booths}/${boothId}`,
      targetId: boothId,
      before: {},
      after: { exhibitorId, exhibitorName, orderId: orderId ?? null, status: hold ? 'held' : 'assigned' },
    });

    return {
      ok: true,
      message: hold
        ? `${outcome.number} is held for ${exhibitorName}. It is off the available list but not counted as sold.`
        : `${outcome.number} is assigned to ${exhibitorName}.`,
    };
  } catch (err) {
    recordError('booths.assign', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not assign the booth.' };
  }
}

/** Empty a booth. The exhibitor's denormalised label is cleared too. */
export async function releaseBooth(boothId: string, actor: string): Promise<BoothResult> {
  const ref = db().collection(COLLECTIONS.booths).doc(boothId);

  try {
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: `Booth ${boothId} does not exist.` };
    const booth = snap.data() as BoothDoc;

    await ref.update({
      exhibitorId: FieldValue.delete(),
      exhibitorName: FieldValue.delete(),
      orderId: FieldValue.delete(),
      assignedAt: FieldValue.delete(),
      assignedBy: FieldValue.delete(),
      status: 'available',
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (booth.exhibitorId) {
      try {
        await db()
          .collection(COLLECTIONS.exhibitors)
          .doc(booth.exhibitorId)
          .update({ boothNumber: '', updatedAt: FieldValue.serverTimestamp() });
      } catch (err) {
        recordError('booths.release.denormalise', err);
      }
    }

    await appendAudit({
      actor,
      action: 'booth.release',
      targetPath: `${COLLECTIONS.booths}/${boothId}`,
      targetId: boothId,
      before: { exhibitorId: booth.exhibitorId ?? null, status: booth.status },
      after: { status: 'available' },
    });

    return { ok: true, message: `${booth.number} is free again.` };
  } catch (err) {
    recordError('booths.release', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not release the booth.' };
  }
}

/**
 * Take a space off the floor plan, or put it back.
 *
 * A pillar, a fire exit, the AV desk. Blocking is separate from assigning
 * because the reason matters: an organizer looking at "18 of 34 available" needs
 * to know whether the missing sixteen are sold or unsellable.
 */
export async function setBoothBlocked(input: {
  boothId: string;
  blocked: boolean;
  note: string;
  actor: string;
}): Promise<BoothResult> {
  const { boothId, blocked, note, actor } = input;
  const ref = db().collection(COLLECTIONS.booths).doc(boothId);

  try {
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: `Booth ${boothId} does not exist.` };
    const booth = snap.data() as BoothDoc;

    if (blocked && booth.exhibitorId) {
      return {
        ok: false,
        error: `${booth.number} is occupied by ${booth.exhibitorName ?? booth.exhibitorId}. Release it before blocking it.`,
      };
    }

    await ref.update({
      status: blocked ? 'blocked' : 'available',
      note: blocked && note ? note : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await appendAudit({
      actor,
      action: blocked ? 'booth.block' : 'booth.unblock',
      targetPath: `${COLLECTIONS.booths}/${boothId}`,
      targetId: boothId,
      before: { status: booth.status },
      after: { status: blocked ? 'blocked' : 'available', note: note || null },
    });

    return {
      ok: true,
      message: blocked ? `${booth.number} is off the floor plan.` : `${booth.number} is sellable again.`,
    };
  } catch (err) {
    recordError('booths.block', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update the booth.' };
  }
}

/**
 * Create a booth, or overwrite one that already exists.
 *
 * The number is the id, so re-adding `A12` edits `A12` rather than producing a
 * second one. That is what makes a floor plan safe to paste in twice.
 */
export async function upsertBooth(input: {
  number: string;
  size: string;
  zone: string;
  ticketTypeId?: string;
  actor: string;
}): Promise<BoothResult> {
  const number = input.number.trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,12}$/.test(number)) {
    return { ok: false, error: 'A booth number is letters, digits and hyphens — up to twelve.' };
  }
  if (!input.size.trim()) return { ok: false, error: 'Give the booth a size, as printed on the plan.' };

  try {
    const ref = db().collection(COLLECTIONS.booths).doc(number);
    const existed = (await ref.get()).exists;

    await ref.set(
      {
        eventId: EVENT_ID,
        number,
        size: input.size.trim(),
        zone: input.zone.trim(),
        ticketTypeId: input.ticketTypeId || FieldValue.delete(),
        // Never written on an update: overwriting a booth's size must not
        // silently evict the exhibitor standing in it.
        ...(existed ? {} : { status: 'available', createdAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await appendAudit({
      actor: input.actor,
      action: existed ? 'booth.update' : 'booth.create',
      targetPath: `${COLLECTIONS.booths}/${number}`,
      targetId: number,
      before: {},
      after: { number, size: input.size, zone: input.zone },
    });

    return { ok: true, message: existed ? `Updated ${number}.` : `Added ${number}.` };
  } catch (err) {
    recordError('booths.upsert', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save the booth.' };
  }
}
