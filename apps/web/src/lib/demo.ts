import 'server-only';

/**
 * Demo mode.
 *
 * The conference is being shown before it is being sold: there is no Stripe
 * account, no merchant of record and no intention of taking a card. What the
 * room needs to see is the *whole* path — choose a tier, pay, get a claim code,
 * watch the sale appear on the organizer's revenue screen a second later — so
 * the payment step has to complete rather than be skipped.
 *
 * So in demo mode the pay button approves. The registration and the order are
 * byte-for-byte what a Stripe purchase writes, with two deliberate exceptions
 * that make it impossible to mistake for revenue:
 *
 *   `channel: 'demo'`  — survives into every export and every dashboard row.
 *   the card fields    — never leave the browser, never reach a server action.
 *
 * It is a separate flag rather than "Stripe is unconfigured" on purpose. Those
 * are different states: an unconfigured production site should refuse to sell,
 * not quietly hand out free tickets. `DEMO_MODE=1` is a thing somebody has to
 * type, and its absence fails closed.
 */
export function demoMode(): boolean {
  return process.env.DEMO_MODE === '1';
}
