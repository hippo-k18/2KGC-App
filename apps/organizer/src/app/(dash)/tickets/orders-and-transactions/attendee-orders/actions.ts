'use server';

import { revalidatePath } from 'next/cache';
import { reauthenticate, requireOrganizer } from '@/lib/auth';
import { appendAudit } from '@/lib/audit';
import { getOrder, money } from '@/lib/commerce';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';
import { stripe, stripeEnabled, stripeIsLive } from '@/lib/stripe';

/**
 * Refunding an order from the dashboard.
 *
 * ── Why this is the most carefully guarded action in the product ────────────
 *
 * Everything else here is recoverable. A mis-scheduled session gets moved back;
 * a wrong announcement is embarrassing but free. **A refund moves real money
 * out of the account and nothing in this product can bring it back** — reversing
 * one means asking the attendee to buy again, at whatever the price is now.
 *
 * Four guards, none of them decorative:
 *
 *   1. `requireOrganizer()` — an allowlisted, signed-in identity.
 *   2. `reauthenticate()` — the passphrase again, because an eight-hour session
 *      on an unattended registration-desk laptop is the normal state of a
 *      conference, and this button must not be one stray click away.
 *   3. A typed confirmation of the exact amount. Not a checkbox: a checkbox is
 *      muscle memory, whereas typing `1199.00` requires reading the number.
 *   4. An audit entry naming who did it, written before the refund is issued.
 *
 * ── What this deliberately cannot do ────────────────────────────────────────
 *
 * **Partial refunds.** Stripe supports them and this does not, because a
 * partial refund raises a question the UI cannot answer — does the attendee
 * still have a ticket? — and getting it wrong silently voids a badge. Full
 * refunds only; anything else is a job for the Stripe dashboard, by someone
 * who has thought about it.
 *
 * **Invoice refunds.** Refunding an invoice is a credit note, a different
 * Stripe API with different accounting consequences. `OrderRow.refundable`
 * excludes them rather than offering a button that fails.
 *
 * ── What happens after ──────────────────────────────────────────────────────
 *
 * Nothing here cancels the registration or emails the attendee. Stripe fires
 * `charge.refunded`, the website's webhook receives it, and *that* withdraws
 * the ticket and sends the notice. One code path for a refund issued here and
 * a refund issued from the Stripe dashboard directly — because both happen, and
 * two paths would eventually disagree about whether a badge still scans.
 */

export interface RefundState {
  ok?: boolean;
  message?: string;
  error?: string;
}

export async function refundOrderAction(
  _prev: RefundState,
  formData: FormData,
): Promise<RefundState> {
  const actor = await requireOrganizer();

  const orderId = String(formData.get('orderId') ?? '').trim();
  const passphrase = String(formData.get('passphrase') ?? '');
  const typedAmount = String(formData.get('confirmAmount') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  if (!orderId) return { error: 'No order specified.' };

  if (!stripeEnabled()) {
    return {
      error:
        'No Stripe key is configured on this deployment, so no refund can be issued from here. ' +
        'Use the Stripe dashboard.',
    };
  }

  if (!reauthenticate(passphrase)) {
    return { error: 'That passphrase is not correct. Nothing has been refunded.' };
  }

  const order = await getOrder(orderId);
  if (!order) return { error: 'That order no longer exists.' };

  if (!order.refundable) {
    // Spelled out rather than a flat refusal, because "why is this greyed out"
    // is otherwise a support question aimed at whoever built the screen.
    const why =
      order.status !== 'paid'
        ? `it is ${order.status}, not paid`
        : order.channel === 'demo'
          ? 'it is a test purchase and no money was taken'
          : order.channel === 'invoice'
            ? 'it is an invoice — refunding one is a credit note, which has to be done in Stripe'
            : 'it has no Stripe payment to refund against';
    return { error: `This order cannot be refunded here because ${why}.` };
  }

  /**
   * The typed amount must match to the cent.
   *
   * Accepts `1199`, `1199.00` and `$1,199.00`, because an organizer copying the
   * figure off the row above will bring the currency symbol with it and being
   * pedantic about that teaches nothing. What it will not accept is a different
   * number — which is the entire point.
   */
  const normalised = typedAmount.replace(/[$,\s]/g, '');
  const typedCents = Math.round(Number(normalised) * 100);
  if (!Number.isFinite(typedCents) || typedCents !== order.totalCents) {
    return {
      error: `Type the exact order total to confirm: ${money(order.totalCents, order.currency)}.`,
    };
  }

  try {
    /**
     * Audited *before* the call to Stripe, not after.
     *
     * If the refund succeeds and the process then dies, an audit written
     * afterwards would never exist and the money would have moved with no
     * record of who moved it. Written first, the worst case is an entry for a
     * refund that failed — which is noise, and noise is recoverable.
     */
    await appendAudit({
      actor,
      action: 'order.refund',
      targetPath: `orders/${order.id}`,
      targetId: order.id,
      before: { status: order.status, refundedCents: order.refundedCents },
      after: {
        status: 'refunded',
        refundedCents: order.totalCents,
        reason: reason || '(none given)',
        email: order.email,
        live: stripeIsLive(),
      },
    });

    await stripe().refunds.create({
      payment_intent: order.stripePaymentIntentId!,
      // Stripe's own enum. `requested_by_customer` is the honest default for a
      // conference — the alternatives are `duplicate` and `fraudulent`, and
      // mislabelling a refund as fraud affects the account's dispute metrics.
      reason: 'requested_by_customer',
      metadata: {
        kgcOrderId: order.id,
        kgcActor: actor,
        kgcReason: reason.slice(0, 400),
      },
    });
  } catch (err) {
    recordError('order.refund', err);
    return {
      error:
        err instanceof Error
          ? `Stripe refused the refund: ${err.message}`
          : 'The refund failed. Check the Stripe dashboard before trying again.',
    };
  }

  revalidatePath(ROUTES.attendeeOrders);
  revalidatePath(ROUTES.ordersSummary);
  revalidatePath(ROUTES.transactionHistory);

  return {
    ok: true,
    message:
      `Refunded ${money(order.totalCents, order.currency)} to ${order.email}. ` +
      'Their registration is withdrawn and they are emailed automatically when Stripe ' +
      'confirms it — usually within a few seconds. Refresh to see the status change.',
  };
}

/**
 * Accept a purchase order as payment for an invoice, out of band.
 *
 * This is the deliberate escape hatch `invoicing.ts` argues for. Some finance
 * departments genuinely will not pay before the event, and a conference that
 * refuses those delegates over process loses exactly the corporate bookings it
 * wants most.
 *
 * ⚠️ **It issues tickets against money that has not arrived.** That is the whole
 * point and it is also the risk, so it is an organizer's named decision rather
 * than something the code does quietly: `markedPaidBy` records who, the audit
 * log records when, and the orders screen shows the order as paid-out-of-band
 * rather than simply paid. Nothing else in the money path may promote an
 * invoice to `paid`.
 */
export interface MarkPaidState {
  ok?: boolean;
  message?: string;
  error?: string;
}

export async function markInvoicePaidAction(
  _prev: MarkPaidState,
  formData: FormData,
): Promise<MarkPaidState> {
  const actor = await requireOrganizer();

  const orderId = String(formData.get('orderId') ?? '').trim();
  const passphrase = String(formData.get('passphrase') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  if (!orderId) return { error: 'No order specified.' };
  if (!reauthenticate(passphrase)) {
    return { error: 'That passphrase is not correct. Nothing has changed.' };
  }
  if (note.length < 3) {
    // Required, because "why is this marked paid?" asked six months later has
    // no other answer, and "the PO is on file" is a sentence somebody must own.
    return { error: 'Say why — a PO number, or who authorised it. This is the only record.' };
  }

  const order = await getOrder(orderId);
  if (!order) return { error: 'That order no longer exists.' };
  if (order.channel !== 'invoice') return { error: 'Only invoices can be marked paid out of band.' };
  if (order.status !== 'pending') return { error: `That invoice is already ${order.status}.` };

  try {
    const { markInvoicePaidOutOfBand } = await import('@/lib/invoice-admin');
    const registered = await markInvoicePaidOutOfBand({ order, actor, note });

    await appendAudit({
      actor,
      action: 'invoice.markPaid',
      targetPath: `orders/${order.id}`,
      targetId: order.id,
      before: { status: 'pending' },
      after: {
        status: 'paid',
        note,
        registrationsCreated: registered.length,
        totalCents: order.totalCents,
      },
    });
  } catch (err) {
    recordError('invoice.markPaid', err);
    return { error: err instanceof Error ? err.message : 'Could not mark the invoice paid.' };
  }

  revalidatePath(ROUTES.attendeeOrders);
  revalidatePath(ROUTES.ordersSummary);

  return {
    ok: true,
    message:
      `Marked paid by ${actor}. Every attendee on the invoice now has a registration and ` +
      'has been emailed their claim code. The money is still outstanding in Stripe.',
  };
}
