/**
 * Which Checkout sessions are ours to fulfil.
 *
 * The webhook receives every `checkout.session.completed` in the Stripe
 * account, not only the ones the tickets page created. A Payment Link made in
 * the Stripe dashboard produces the same event, and until 2026-10-03 the
 * webhook fulfilled it as a Main Conference ticket, because a missing
 * `ticketType` fell back to that name. A $175 payment on 2026-10-01 became a
 * full registration, an account, a directory entry and a welcome email that
 * way. The owner's rule since then: a ticket comes only from buying it on the
 * website.
 *
 * ── How "ours" is told ──────────────────────────────────────────────────────
 *
 * By a marker our code sets, never by what is missing. `startCheckout` writes
 * `source: 'kgc-web'` into the session metadata from 2026-10-03. Sessions it
 * created before that carry no `source`, but every one of them carries `tier`
 * and `ticketType`, which it has set since 2026-08-16. So:
 *
 *   - `source === 'kgc-web'` with a tier and a ticket name: ours.
 *   - no `source`, with a tier and a ticket name: ours, from before the marker.
 *     A session lives at most 24 hours, so this branch only matters for a day
 *     after the deploy, but there is no harm in keeping it.
 *   - anything else, including a `source` somebody else set: not ours.
 *
 * Both fields are required even with the marker, because fulfilment needs
 * them: without the tier there is no catalogue entry or counter, and without
 * the name there is nothing honest to print on the badge.
 *
 * Plain functions with no Firestore or Stripe import, so the tickets page, the
 * webhook and the tests share one definition.
 */
export const CHECKOUT_SOURCE = 'kgc-web';

export interface WebsiteCheckout {
  tierId: string;
  ticketType: string;
}

export function websiteCheckout(
  metadata: Record<string, string> | null | undefined,
): WebsiteCheckout | null {
  if (!metadata) return null;
  const source = metadata.source?.trim();
  if (source && source !== CHECKOUT_SOURCE) return null;

  const tierId = metadata.tier?.trim();
  const ticketType = metadata.ticketType?.trim();
  if (!tierId || !ticketType) return null;

  return { tierId, ticketType };
}
