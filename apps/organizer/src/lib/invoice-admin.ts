import 'server-only';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@kgc/shared';
import { ensureRegistration } from '@kgc/scripts/src/lib/fulfilment';
import { sendPurchaseConfirmation } from '@kgc/scripts/src/lib/email';
import { mintOrderToken } from '@kgc/scripts/src/lib/order-token';
import type { OrderRow } from './commerce';
import { db } from './firestore';

/**
 * Accepting a purchase order as payment, out of band.
 *
 * ⚠️ **This issues tickets against money that has not arrived.** That is the
 * entire point of it and also the whole risk. Some finance departments will not
 * pay before an event under any circumstances, and a conference that refuses
 * those delegates over process loses exactly the corporate bookings it wants
 * most — so the escape hatch has to exist. What it must never be is *quiet*.
 *
 * Three things keep it accountable, and all three are load-bearing:
 *
 *   `markedPaidBy` names the organizer on the order document itself, so the
 *   orders screen can show "paid out of band by …" rather than plain "paid".
 *
 *   The audit entry (written by the caller) records when and why.
 *
 *   The Stripe invoice is **left open**. Nothing here tells Stripe the money
 *   arrived, because it has not — the invoice stays outstanding in Stripe's own
 *   reporting and in the payout figures, which is the truth. If it is later
 *   paid for real, `invoice.paid` fires and the webhook converges on the same
 *   order document; `markInvoiceOrderPaid` merges, so nothing is lost.
 *
 * ── Order of operations ─────────────────────────────────────────────────────
 *
 * Registrations first, then the order flip, then emails. If this dies partway,
 * the failure modes are all recoverable and none of them is "somebody thinks
 * they have a ticket and does not": registrations are idempotent, so re-running
 * converges; an order still marked `pending` shows up on the outstanding list
 * and can be re-run; and an email that never went is visible in `emailLog`.
 */
export async function markInvoicePaidOutOfBand(input: {
  order: OrderRow;
  actor: string;
  note: string;
}): Promise<string[]> {
  const { order, actor, note } = input;

  const orderRef = db().collection(COLLECTIONS.orders).doc(order.id);
  const snap = await orderRef.get();
  if (!snap.exists) throw new Error('That order no longer exists.');

  const seats = (snap.data()?.items ?? []) as {
    ticketTypeName: string;
    attendeeName?: string;
    attendeeEmail?: string;
  }[];

  const payable = seats.filter((s) => s.attendeeEmail);
  if (payable.length === 0) {
    throw new Error(
      'This invoice lists no attendees with email addresses, so there is nobody to register. ' +
        'Add them in Stripe and re-raise it, or register them by hand.',
    );
  }

  const registrationIds: string[] = [];
  const minted: { email: string; name: string; ticketType: string; rid: string; code: string }[] =
    [];

  for (const seat of payable) {
    const result = await ensureRegistration(db(), {
      email: seat.attendeeEmail as string,
      name: seat.attendeeName ?? '',
      ticketType: seat.ticketTypeName,
    });
    registrationIds.push(result.registrationId);
    minted.push({
      email: result.email,
      name: result.name ?? '',
      ticketType: result.ticketType ?? seat.ticketTypeName,
      rid: result.registrationId,
      code: result.claimCode,
    });
  }

  await orderRef.update({
    status: 'paid',
    registrationIds,
    markedPaidBy: actor,
    markedPaidAt: Timestamp.now(),
    // Kept on the document rather than only in the audit log, because the
    // person asking "why is this paid when Stripe says it isn't?" is looking at
    // the order, not at the audit trail.
    poNumber: order.poNumber,
    outOfBandNote: note,
    updatedAt: FieldValue.serverTimestamp(),
  });

  /**
   * Emails last, and each one independently.
   *
   * `sendPurchaseConfirmation` never throws — it logs failures to `emailLog` —
   * so one bad address cannot stop the rest of a company's delegates being
   * told. The registrations already exist either way.
   */
  const origin = (process.env.WEB_PUBLIC_ORIGIN ?? 'https://www.knowledgegraph.tech').replace(
    /\/$/,
    '',
  );

  for (const m of minted) {
    await sendPurchaseConfirmation(db(), {
      to: m.email,
      name: m.name,
      ticketType: m.ticketType,
      // Their share of what the company owes. The attendee did not pay this and
      // does not need a figure to reconcile — but a receipt with no amount on
      // it reads as broken, so it shows the per-seat price.
      amountCents: Math.round(order.totalCents / payable.length),
      currency: order.currency,
      orderUrl: `${origin}/order/${mintOrderToken({ rid: m.rid, demo: false })}`,
      claimCode: m.code,
      orderId: order.id,
      registrationId: m.rid,
    });
  }

  return registrationIds;
}
