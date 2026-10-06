import 'server-only';

import { randomUUID } from 'node:crypto';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, publicSiteOrigin } from '@kgc/shared';
import { ensureRegistration, extraTierById, extraVerdictFor } from '@kgc/scripts/src/lib/fulfilment';
import { extraRefusalForOrganizer } from './extras';
import { sendPurchaseConfirmation } from '@kgc/scripts/src/lib/email';
import { mintOrderToken } from '@kgc/scripts/src/lib/order-token';
import { appendAudit } from './audit';
import { getTicketType } from './commerce';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * Recording a payment this system never took.
 *
 * A cheque. A wire that arrived by BACS with a reference nobody can match. A
 * booth comped to a community partner. A sponsorship agreed in a contract
 * signed six months before the ticketing existed. Every conference has these,
 * and a ticketing system that cannot express them is one an organizer works
 * around with a spreadsheet — which is worse, because the spreadsheet is not in
 * the ledger and the badge does not print from it.
 *
 * ── This issues a ticket against money the system cannot see ────────────────
 *
 * That is the entire point and also the whole risk. It is the same escape hatch
 * as `markInvoicePaidOutOfBand`, and it is kept accountable the same way:
 *
 *   `channel: 'manual'` and `provider: 'manual'` mark it in every export, so a
 *   reconciliation against Stripe does not silently come up short by the amount
 *   of these.
 *
 *   `markedPaidBy` names the organizer on the order document, so the ledger can
 *   say "recorded by …" rather than plain "paid".
 *
 *   `outOfBandNote` carries the *reason* — a cheque number, a contract
 *   reference — on the document rather than only in the audit log, because the
 *   person asking "why is this paid when Stripe has never heard of it?" is
 *   looking at the order.
 *
 *   The audit entry records who and when.
 *
 * ── A comp is a manual order at zero, not a special case ────────────────────
 *
 * `amountCents: 0` is a legitimate manual order and produces exactly the same
 * registration, claim code and confirmation email as a paid one. Modelling
 * comps separately would mean a second path to a badge, and the day the two
 * paths disagree is the day somebody with a genuine ticket cannot get in.
 *
 * ── Order of operations ─────────────────────────────────────────────────────
 *
 * The order, then the registration, then the counter, then the email. The
 * order goes first because creating it is what makes a double-submit one order
 * (see below). Every failure mode in that sequence is recoverable and none of
 * them is "somebody believes they have a ticket and does not": an order whose
 * registration failed shows on the ledger with no attendee, a lost counter
 * increment is a display figure, and a failed email is visible in `emailLog`.
 */

export interface ManualOrderInput {
  email: string;
  name: string;
  /** The tier being recorded. Its price is the default, not the amount. */
  ticketTypeId: string;
  /**
   * What actually arrived, in minor units. Not read from the tier: the whole
   * reason this path exists is that the amount is frequently *not* the list
   * price — a negotiated sponsorship, a comp at zero, a partner rate.
   */
  amountCents: number;
  /** Cheque number, wire reference, contract id. Required; this is the audit. */
  note: string;
  companyName?: string;
  poNumber?: string;
  /** Skip the confirmation email — for a backfill of somebody already told. */
  silent?: boolean;
  actor: string;
  /**
   * One per form load, posted back with the form. Pressing the button twice
   * sends the same one, so a nervous double-submit records one order; filling
   * the form in again is a new one, and records a second order.
   */
  requestId?: string;
}

export interface ManualOrderResult {
  ok: boolean;
  message?: string;
  error?: string;
  orderId?: string;
  registrationId?: string;
  claimCode?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * `"1499"`, `"1,499.00"`, `"$1499"` → cents. `""` and `"0"` → 0.
 *
 * Returns null rather than NaN for anything unparseable, because an amount that
 * silently becomes zero is a package that was silently comped.
 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isFinite(cents) ? cents : null;
}

export async function recordManualOrder(input: ManualOrderInput): Promise<ManualOrderResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (!EMAIL.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (name.length < 2) return { ok: false, error: 'Enter the attendee’s full name.' };
  if (!input.note.trim()) {
    return {
      ok: false,
      error:
        'Say why this is being recorded. A cheque number, a wire reference, a contract id. ' +
        'This is the only record that the money is real.',
    };
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    return { ok: false, error: 'The amount must be a whole number of cents, or zero for a comp.' };
  }

  const tier = await getTicketType(input.ticketTypeId);
  if (!tier) return { ok: false, error: 'Choose a package that still exists in the catalogue.' };

  /**
   * Workshops goes on the person's Main Conference badge, as on the website:
   * it is refused for an address with no Main Conference, for Virtual, and for
   * All Access, which includes it already (owner, 2026-10-06).
   */
  const extra = await extraTierById(db(), tier.id);
  if (extra) {
    const verdict = await extraVerdictFor(db(), email, extra);
    if (!verdict.ok) return { ok: false, error: extraRefusalForOrganizer(extra.tier, email, verdict.reason, verdict.heldName, extra.byName) };
  }

  /**
   * The order id is one per submission, not one per person and package.
   *
   * It used to be `manual_{tierId}_{email}`, so a second manual order for the
   * same person and package (a second payment, a second seat) overwrote the
   * first: its amount and note were replaced and the first payment's record
   * was gone (T135, S8/TK-283). Now each form load carries its own
   * `requestId`, so a double-click is still one order and a genuinely second
   * order is a second document. Orders recorded under the old id keep it.
   */
  const request = input.requestId && /^[A-Za-z0-9-]{8,64}$/.test(input.requestId) ? input.requestId : randomUUID();
  const orderId = `manual_${request}`;
  const orderRef = db().collection(COLLECTIONS.orders).doc(orderId);
  const already = { ok: true, orderId, message: `That order was already recorded for ${email}. Nothing was changed.` };
  if ((await orderRef.get()).exists) return already;

  /**
   * Capacity, as the website checks it. This path used to issue a ticket
   * against a sold-out package without a word (T135, S8). An organizer who
   * means to go over raises the capacity first, which leaves a record of it.
   */
  if (typeof tier.quantityTotal === 'number' && (tier.quantitySold ?? 0) >= tier.quantityTotal) {
    return {
      ok: false,
      error: `${tier.name} is sold out (${tier.quantitySold ?? 0} of ${tier.quantityTotal}). Raise its capacity first if this order should go ahead.`,
    };
  }

  try {
    /**
     * The order first, with `create`, which fails if the document exists. That
     * is the double-submit guard: two posts of the same form race here, one
     * wins, and only the winner registers, counts and emails.
     */
    try {
      await orderRef.create({
        eventId: EVENT_ID,
        externalId: orderId,
        provider: 'manual',
        channel: 'manual',
        email,
        buyerName: name,
        ...(input.companyName ? { companyName: input.companyName.trim() } : {}),
        status: 'paid',
        items: [
          {
            ticketTypeId: tier.id,
            ticketTypeName: tier.name,
            quantity: 1,
            unitPriceCents: input.amountCents,
          },
        ],
        subtotalCents: input.amountCents,
        // No tax line. This system did not calculate one and inventing a split
        // would put a number in a tax column that no return will ever agree
        // with — whatever tax applies was handled wherever the money was taken.
        taxCents: 0,
        discountCents: 0,
        totalCents: input.amountCents,
        currency: tier.currency,
        ...(input.poNumber ? { poNumber: input.poNumber.trim() } : {}),
        registrationIds: [],
        markedPaidBy: input.actor,
        markedPaidAt: Timestamp.now(),
        outOfBandNote: input.note.trim(),
        purchasedAt: Timestamp.now(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      // ALREADY_EXISTS: the other post of a double-submit got here first.
      if ((err as { code?: unknown }).code === 6) return already;
      throw err;
    }

    /**
     * Then the registration. `ensureRegistration` lives in `@kgc/scripts` and
     * is shared with the website's webhook: one implementation owns `qrSecret`
     * and `claimCode`, and a second copy would mean a badge that stops scanning
     * while somebody is holding it at the desk.
     *
     * With this order as its purchase, like every other path that takes money:
     * somebody who already holds a paid ticket gets a second, separate ticket
     * rather than having theirs rewritten to this package with two orders
     * pointing at one badge (T135B, N1).
     */
    const reg = await ensureRegistration(db(), {
      email,
      name,
      ticketType: tier.name,
      purchase: { orderId, seat: 0 },
      ticketTypeId: tier.id,
    });
    await orderRef.update({
      registrationIds: [reg.registrationId],
      // Workshops added to an existing badge: see `OrderDoc.extraRegistrationIds`.
      ...(reg.extra?.extendedOnly ? { extraRegistrationIds: [reg.registrationId] } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });

    /**
     * The sold counter, once per order. A double-submit of the same form
     * returned above, so a nervous organizer pressing the button twice cannot
     * sell out a capped tier.
     */
    try {
      await db()
        .collection(COLLECTIONS.ticketTypes)
        .doc(tier.id)
        .update({ quantitySold: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
    } catch (err) {
      // The sale is real and the registration is written. Losing the display
      // counter must not fail the action.
      recordError('manualOrder.increment', err);
    }

    await appendAudit({
      actor: input.actor,
      action: 'order.manual',
      targetPath: `${COLLECTIONS.orders}/${orderId}`,
      targetId: orderId,
      before: {},
      after: {
        email,
        ticketType: tier.name,
        totalCents: input.amountCents,
        note: input.note.trim(),
        comp: input.amountCents === 0,
      },
    });

    /**
     * The email last, and it can never throw upward.
     *
     * `sendPurchaseConfirmation` logs its own failures to `emailLog` and returns
     * — so a bad address cannot undo a registration that is already correct.
     */
    if (!input.silent) {
      const origin = publicSiteOrigin();

      await sendPurchaseConfirmation(db(), {
        to: reg.email,
        name: reg.name ?? name,
        ticketType: reg.extra?.label || (reg.ticketType ?? tier.name),
        ...(reg.extra?.extendedOnly && !reg.extra.refused ? { addedExtra: reg.extra.name } : {}),
        amountCents: input.amountCents,
        currency: tier.currency,
        orderUrl: `${origin}/order/${mintOrderToken({ rid: reg.registrationId })}`,
        claimCode: reg.claimCode,
        orderId,
        registrationId: reg.registrationId,
      });
    }

    return {
      ok: true,
      orderId,
      registrationId: reg.registrationId,
      claimCode: reg.claimCode,
      message:
        `Recorded ${tier.name} for ${email}${input.amountCents === 0 ? ' as a comp' : ''}` +
        (reg.extra?.extendedOnly ? `, added to their existing ticket (${reg.extra.label}).` : '.') +
        (input.silent ? ' No email was sent.' : ' A confirmation has been sent.'),
    };
  } catch (err) {
    recordError('manualOrder.record', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not record the order.' };
  }
}
