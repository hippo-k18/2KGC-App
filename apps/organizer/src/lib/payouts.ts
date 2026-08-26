import 'server-only';

import { recordError } from './errors';
import { stripe, stripeEnabled } from './stripe';

/**
 * The money on its way to KGC's bank, read from Stripe rather than guessed.
 *
 * ── Why this is a live API call and Pay › Balance is not ───────────────────
 *
 * Balance estimates net takings from our own order records, because that screen
 * answers "what did we sell?" and the orders are the authority on that. This
 * screen answers "what has actually landed in the bank?", and our records
 * cannot answer it at all: processing fees are charged against the payout, not
 * the order; disputes and refunds move money after the fact; and Stripe holds
 * new accounts on a rolling delay. Every one of those is invisible here and
 * known there.
 *
 * So this reads Stripe. A second locally-computed figure would disagree with
 * the bank statement, and the disagreement is the thing an organizer would then
 * spend an afternoon on.
 *
 * ── Read-only, and only ever read-only ─────────────────────────────────────
 *
 * Nothing in this module writes. Payout schedules, bank details and account
 * verification all live in Stripe's own dashboard behind Stripe's own auth,
 * which is where they belong — reproducing a bank-details form here would mean
 * this dashboard's session became sufficient to redirect a conference's income.
 */

export interface PayoutRow {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  /** ISO date the money is expected to land, or did. */
  arrivalDate: string;
  /** `standard` or `instant`. */
  method: string;
  /** Present on a failure — Stripe's own reason, which names the fix. */
  failureMessage?: string;
}

export interface PayoutSummary {
  /** Cleared and awaiting the next payout. */
  availableCents: number;
  /** Taken, not yet cleared. Stripe holds new accounts for days. */
  pendingCents: number;
  currency: string;
  payouts: PayoutRow[];
  /** Why there is nothing to show, when there is nothing to show. */
  unavailable?: string;
}

const EMPTY = (reason: string): PayoutSummary => ({
  availableCents: 0,
  pendingCents: 0,
  currency: 'usd',
  payouts: [],
  unavailable: reason,
});

/**
 * Balance and recent payouts.
 *
 * Never throws. ⚠️ A Stripe outage, a revoked key or a restricted key without
 * payout permission must not take a dashboard screen down — the reason is
 * returned and rendered, because "Stripe returned 401" is an answer an
 * organizer can act on and a stack trace is not.
 */
export async function payoutSummary(limit = 10): Promise<PayoutSummary> {
  if (!stripeEnabled()) {
    return EMPTY(
      'No Stripe key is configured on this deployment, so there is no account to read a balance from.',
    );
  }

  try {
    const client = stripe();
    const [balance, payouts] = await Promise.all([
      client.balance.retrieve(),
      client.payouts.list({ limit }),
    ]);

    /**
     * Summed across currencies, and the currency of the first bucket is
     * reported.
     *
     * KGC sells in one currency, so this is exact today. If it ever sells in
     * two, this figure becomes a nonsense sum — which is why the currency is
     * shown beside it rather than assumed, and why the screen says the
     * authority is Stripe's own dashboard.
     */
    const availableCents = balance.available.reduce((n, b) => n + b.amount, 0);
    const pendingCents = balance.pending.reduce((n, b) => n + b.amount, 0);

    return {
      availableCents,
      pendingCents,
      currency: balance.available[0]?.currency ?? 'usd',
      payouts: payouts.data.map((p) => ({
        id: p.id,
        amountCents: p.amount,
        currency: p.currency,
        status: p.status,
        // Stripe returns seconds; everything else in this dashboard is ISO.
        arrivalDate: new Date(p.arrival_date * 1000).toISOString(),
        method: p.method,
        failureMessage: p.failure_message ?? undefined,
      })),
    };
  } catch (err) {
    recordError('payouts.summary', err);
    return EMPTY(
      err instanceof Error
        ? `Stripe could not be reached: ${err.message}`
        : 'Stripe could not be reached.',
    );
  }
}
