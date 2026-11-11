import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS, type OrderConfirmation, type OrderDoc, type TicketTypeDoc } from "@kgc/shared";

/**
 * Things a paid order must do exactly once, whichever path gets there first.
 *
 * An invoice can be settled twice over: an organizer marks it paid on the
 * dashboard, and Stripe's `invoice.paid` arrives later (or the other way
 * round, or more than once). A card purchase is fulfilled by the return
 * redirect and the webhook. The dashboard and the website cannot import each
 * other, so the rules both sides must agree on live here (T139).
 *
 * No Firestore sentinels: this package's `firebase-admin` is not the callers'
 * (AGENTS.md gotcha 8). Timestamps are numbers or native Dates.
 */

/** How many times one person's confirmation is tried. See `fulfil-order.ts`. */
export const CONFIRMATION_ATTEMPTS = 5;

/** How long a `pending` claim stands before another run may take it over. */
export const STALE_PENDING_MS = 5 * 60_000;

/** Refunded or cancelled: an order that issues and confirms nothing more. */
export function isSettledOrder(order: Pick<OrderDoc, "status"> | undefined): boolean {
  return order?.status === "refunded" || order?.status === "cancelled";
}

export function claimable(c: OrderConfirmation | undefined, now: number): boolean {
  if (!c) return true;
  if (c.state === "sent" || c.state === "skipped") return false;
  if (c.state === "pending") return now - c.at > STALE_PENDING_MS;
  return c.attempts < CONFIRMATION_ATTEMPTS;
}

/**
 * Claim `key` on the order's `confirmations` map in a transaction: the attempt
 * number if this caller is the one to send it, `null` if not. Throws when the
 * transaction fails; what to do then is the caller's decision.
 */
export async function claimOnOrder(
  store: Firestore,
  orderId: string,
  key: string,
  opts: { evenIfSettled?: boolean } = {},
): Promise<number | null> {
  const ref = store.collection(COLLECTIONS.orders).doc(orderId);
  return store.runTransaction(async (tx) => {
    const order = (await tx.get(ref)).data() as OrderDoc | undefined;
    // No confirmation for a ticket whose money has gone back (T135, TK-163).
    if (isSettledOrder(order) && !opts.evenIfSettled) return null;
    if (order?.confirmationsSent?.includes(key)) return null;
    const prev = order?.confirmations?.[key];
    if (!claimable(prev, Date.now())) return null;
    const attempts = (prev?.attempts ?? 0) + 1;
    tx.set(ref, { confirmations: { [key]: { state: "pending", at: Date.now(), attempts } } }, { merge: true });
    return attempts;
  });
}

/** Record what happened to a claimed send. A plain write: only the holder writes a pending entry. */
export async function settleOnOrder(
  store: Firestore,
  orderId: string,
  key: string,
  attempts: number,
  state: OrderConfirmation["state"],
): Promise<void> {
  await store
    .collection(COLLECTIONS.orders)
    .doc(orderId)
    .set({ confirmations: { [key]: { state, at: Date.now(), attempts } } }, { merge: true });
}

/**
 * Count an order's seats against their tiers, once for the life of the order.
 *
 * An invoice marked paid on the dashboard counted nothing, and the later
 * `invoice.paid` counted only the seats it created, which by then was none,
 * so those seats were never sold as far as capacity knew (T135B, N2). Both
 * paths now call this, and `seatsCountedAt` on the order, written in the same
 * transaction as the counts, makes the second call a no-op.
 *
 * An order already `paid` with no stamp and no `markedPaidBy` was paid by the
 * webhook before this existed, which counted its seats as it created them; it
 * is stamped and not counted again. Returns the number of seats counted.
 */
export async function countOrderSeatsOnce(
  store: Firestore,
  orderId: string,
  tierIds: string[],
): Promise<number> {
  const perTier = new Map<string, number>();
  for (const id of tierIds) if (id) perTier.set(id, (perTier.get(id) ?? 0) + 1);
  // Seats with no tier (an invoice raised in the Stripe dashboard) have no
  // counter to move, and the order may not exist yet to stamp.
  if (perTier.size === 0) return 0;

  const orderRef = store.collection(COLLECTIONS.orders).doc(orderId);
  return store.runTransaction(async (tx) => {
    const order = (await tx.get(orderRef)).data() as OrderDoc | undefined;
    const tiers = await Promise.all(
      [...perTier.keys()].map(async (id) => {
        const ref = store.collection(COLLECTIONS.ticketTypes).doc(id);
        return { id, ref, doc: (await tx.get(ref)).data() as TicketTypeDoc | undefined };
      }),
    );
    if (order?.seatsCountedAt) return 0;

    const now = new Date();
    const legacyWebhookCount = order?.status === "paid" && !order.markedPaidBy;
    let counted = 0;
    if (!legacyWebhookCount) {
      for (const t of tiers) {
        if (!t.doc) continue;
        const n = perTier.get(t.id) ?? 0;
        tx.update(t.ref, { quantitySold: (t.doc.quantitySold ?? 0) + n, updatedAt: now });
        counted += n;
      }
    }
    tx.set(orderRef, { seatsCountedAt: now }, { merge: true });
    return counted;
  });
}
