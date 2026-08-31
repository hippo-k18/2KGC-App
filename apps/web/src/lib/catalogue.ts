import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  type EntitlementDoc,
  type TicketAudience,
  type TicketTypeDoc,
} from '@kgc/shared';
import { db } from './firestore';
import { entitlementKinds } from './app-account-core';
import type { Tier } from './tickets';

/**
 * Reading the ticket catalogue out of Firestore.
 *
 * This is the only thing that turns a tier id into money. `startCheckout` looks
 * the price up through here from an id posted by the form, because a price in a
 * form field is a price the buyer can edit — the classic version of that bug
 * charges $1 for a $1,199 ticket.
 *
 * ── There is no fallback, on purpose ────────────────────────────────────────
 *
 * An empty `ticketTypes` collection throws rather than quietly reverting to a
 * hard-coded list. A stale fallback price is indistinguishable from a correct
 * one at the moment it is charged, and the person who finds out is the buyer's
 * finance department. `npm run seed` populates the collection; the fix for an
 * empty catalogue is to run it, not to guess.
 *
 * ── No composite index ──────────────────────────────────────────────────────
 *
 * One equality filter on `eventId`, sorted in memory. The emulator does not
 * enforce composite indexes, so `where(eventId) + orderBy(sortOrder)` would
 * pass locally and fail in production with `failed-precondition` — a bug that
 * has already shipped twice on this project. Four documents sort instantly.
 */

/** Firestore keeps no `undefined`; this drops the key instead of writing null. */
function optional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : value;
}

/**
 * Whether a tier can be bought right now, and if not, why.
 *
 * Evaluated at read time rather than stored, because "on sale" is a function of
 * the clock and a stored boolean is a boolean that needs a cron job to stay
 * true.
 */
function availability(t: TicketTypeDoc, now: Date): Pick<Tier, 'onSale' | 'unavailableReason'> {
  if (t.salesOpenAt && t.salesOpenAt.toDate() > now) {
    return { onSale: false, unavailableReason: 'Not on sale yet' };
  }
  if (t.salesCloseAt && t.salesCloseAt.toDate() < now) {
    return { onSale: false, unavailableReason: 'Sales closed' };
  }
  if (typeof t.quantityTotal === 'number' && (t.quantitySold ?? 0) >= t.quantityTotal) {
    return { onSale: false, unavailableReason: 'Sold out' };
  }
  return { onSale: true };
}

function toTier(id: string, t: TicketTypeDoc, now: Date): Tier {
  return {
    id,
    name: t.name,
    priceCents: t.priceCents,
    currency: t.currency,
    tagline: t.tagline ?? '',
    includes: t.includes ?? [],
    groups: optional(t.groups),
    featured: optional(t.featured),
    inPerson: t.inPerson ?? true,
    // Absent on documents written before the field existed; those are all
    // attendee tiers, which is the only slice that was sellable at the time.
    audience: t.audience ?? 'attendee',
    taxCode: t.taxCode ?? 'txcd_20030000',
    ...availability(t, now),
  };
}

async function loadAll(): Promise<{ id: string; doc: TicketTypeDoc }[]> {
  const snap = await db().collection(COLLECTIONS.ticketTypes).where('eventId', '==', EVENT_ID).get();
  return snap.docs.map((d) => ({ id: d.id, doc: d.data() as TicketTypeDoc }));
}

/**
 * The catalogue, or nothing — never a guess.
 *
 * ── Why this exists when `data.ts` already has `safely()` ──────────────────
 *
 * The public site's other reads degrade to an empty page when the database is
 * unreachable, because an unknown agenda is a state a conference genuinely has.
 * Prices are different in kind: a stale or invented figure is indistinguishable
 * from a correct one at the moment a card is charged, and the person who finds
 * out is the buyer's finance department.
 *
 * So `listTiers` still throws on an empty collection — that is a
 * misconfiguration and must be loud. What this adds is the narrower case of the
 * database being *unreachable*: no credentials, a network failure, a revoked
 * key. There the honest answer is "we cannot tell you the price right now",
 * which the tickets page renders as a closed state rather than a 500.
 *
 * ⚠️ The distinction that matters: this returns `null`, never an empty array.
 * A caller cannot mistake "the shop is closed" for "there are no tickets", and
 * `startCheckout` is unaffected — it reads a tier by id and still refuses an
 * unknown one, so nothing can be bought at a price this function did not
 * produce.
 */
export async function tiersOrNull(audience: TicketAudience = 'attendee'): Promise<Tier[] | null> {
  try {
    return await listTiers(audience);
  } catch (err) {
    console.error('[catalogue] could not read the catalogue; the page will say so', err);
    return null;
  }
}

/**
 * Every tier one audience may see, in catalogue order.
 *
 * Hidden tiers (`visible: false`) are excluded — that is how a comp rate or a
 * late speaker price exists without appearing on the public page — but they are
 * still purchasable by direct id through `tierById`, which is the point.
 *
 * ── Why the audience is a parameter rather than a constant ──────────────────
 *
 * This filtered to `attendee` unconditionally, which meant an exhibitor or
 * sponsor tier created in the dashboard had **no page anywhere that would sell
 * it**. The organizer could price a booth and nobody could buy one, and the
 * only symptom was an empty catalogue on a screen nobody had reason to open.
 * Exhibitor and sponsor registration are genuinely different conversations —
 * different copy, different questions, different audiences — so they are
 * different pages over the same price list, which is exactly what Whova does.
 *
 * A tier with no `audience` at all counts as an attendee tier: the field was
 * added after the first seed, and documents written before it must not vanish
 * from the page that has always sold them.
 */
export async function listTiers(audience: TicketAudience = 'attendee'): Promise<Tier[]> {
  const now = new Date();
  const rows = await loadAll();
  if (rows.length === 0) {
    throw new Error(
      'The `ticketTypes` collection is empty, so there is nothing to sell.\n' +
        'Run `npm run seed` (against the emulator) or `npm run seed -- --confirm-live`.\n' +
        'This throws rather than falling back to hard-coded prices on purpose: a stale ' +
        'price is indistinguishable from a correct one at the moment it is charged.',
    );
  }

  return rows
    .filter(({ doc }) => (doc.audience ?? 'attendee') === audience)
    .filter(({ doc }) => doc.visible !== false)
    .sort(
      (a, b) =>
        (a.doc.sortOrder ?? 0) - (b.doc.sortOrder ?? 0) || a.doc.name.localeCompare(b.doc.name),
    )
    .map(({ id, doc }) => toTier(id, doc, now));
}

/**
 * One tier by id, visible or not.
 *
 * Returns `undefined` for an unknown id rather than throwing, because the id
 * arrives from a query string and a form field — both attacker-controlled — and
 * "choose a ticket type" is the right answer to a bad one, not a 500.
 */
export async function tierById(id: string): Promise<Tier | undefined> {
  if (!id) return undefined;
  const doc = await db().collection(COLLECTIONS.ticketTypes).doc(id).get();
  if (!doc.exists) return undefined;
  const data = doc.data() as TicketTypeDoc;
  if (data.eventId !== EVENT_ID) return undefined;
  return toTier(doc.id, data, new Date());
}

/**
 * What fulfilment needs to know about a tier, in one read.
 *
 * Two questions get asked at the same moment and used to need two round trips:
 * how many seats are left (the capacity re-check on `invoice.paid` — an invoice
 * on net-30 terms can clear thirty days after the check at the point it was
 * raised, and a tier can sell out in between), and what the ticket unlocks
 * (`includesWorkshops` / `includesVideoLibrary`, which become
 * `users/{uid}/entitlements`).
 *
 * Deliberately not folded into `Tier`. That shape is passed to the client
 * checkout form as props, and neither the entitlement booleans nor the raw
 * capacity figures have any business in a browser chunk.
 */
export interface TierFulfilment {
  id: string;
  name: string;
  /** Undefined means unlimited capacity, which is the honest reading of an absent cap. */
  remaining?: number;
  onSale: boolean;
  unavailableReason?: string;
  entitlements: EntitlementDoc['kind'][];
}

export async function tierFulfilment(tierId: string): Promise<TierFulfilment | null> {
  if (!tierId) return null;
  const doc = await db().collection(COLLECTIONS.ticketTypes).doc(tierId).get();
  if (!doc.exists) return null;
  const t = doc.data() as TicketTypeDoc;
  if (t.eventId !== EVENT_ID) return null;

  const state = availability(t, new Date());
  return {
    id: doc.id,
    name: t.name,
    remaining:
      typeof t.quantityTotal === 'number'
        ? Math.max(0, t.quantityTotal - (t.quantitySold ?? 0))
        : undefined,
    entitlements: entitlementKinds(t),
    ...state,
  };
}

/**
 * Count a sale against a tier's capacity — or give a seat back.
 *
 * ⚠️ This is a **counter, not a reservation.** Firestore offers no way to hold a
 * seat across the Checkout redirect, so two buyers can both pass the capacity
 * check and both pay. At KGC's volumes the right response is a refund and an
 * apology; if a tier genuinely needs to stop selling, close it in the dashboard.
 *
 * Called from fulfilment, never from checkout creation — an abandoned Checkout
 * session must not consume a seat.
 *
 * `by` is negative on a **full** refund, which is what stops the counter being
 * the one-way ratchet audit B found: ten refunds used to consume ten seats for
 * ever, and no screen could correct it. A *partial* refund never gets here —
 * the attendee still holds a valid ticket, so the seat is still sold. The
 * caller owns the replay guard, because `increment` is not idempotent and this
 * function cannot see whether it has already run.
 */
export async function incrementSold(tierId: string, by = 1): Promise<void> {
  const { FieldValue } = await import('firebase-admin/firestore');
  try {
    await db()
      .collection(COLLECTIONS.ticketTypes)
      .doc(tierId)
      .update({ quantitySold: FieldValue.increment(by), updatedAt: FieldValue.serverTimestamp() });
  } catch (err) {
    // A tier deleted after the sale, most likely. The sale is real and the
    // registration is written; losing the counter must not fail fulfilment.
    console.error('[catalogue] could not increment quantitySold for', tierId, err);
  }
}
