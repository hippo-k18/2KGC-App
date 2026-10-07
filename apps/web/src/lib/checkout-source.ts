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
 *   - anything else is not ours, including a session with a tier and a ticket
 *     name but no `source`. That branch accepted sessions from before the
 *     marker; a session lives 24 hours and the marker went live on
 *     2026-10-03, so no such session can still complete, and the account is
 *     shared with other things that take money (T142), where somebody could
 *     set a `tier` without meaning a ticket. A refund or dispute of a sale from
 *     before the marker is recognised by our own order record instead (see
 *     `paymentTarget` in the webhook).
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
  if (metadata.source?.trim() !== CHECKOUT_SOURCE) return null;

  const tierId = metadata.tier?.trim();
  const ticketType = metadata.ticketType?.trim();
  if (!tierId || !ticketType) return null;

  return { tierId, ticketType };
}

/**
 * Whether an invoice was raised by the ticketing code (`raiseInvoice`).
 *
 * The same idea for invoices. The Stripe account also invoices sponsors and
 * others by hand, and an invoice is only ever a ticket purchase when our code
 * raised it. `source: 'kgc-web'` is written from T142; `kgcKind:
 * 'group-registration'` has been written since invoicing existed (2026-08-24),
 * so every invoice our code ever raised carries one or the other. The webhook
 * also accepts an invoice it has an order record for, which `raiseInvoice`'s
 * caller writes. Attendee-shaped metadata alone means nothing (T142).
 */
export function ticketingInvoice(metadata: Record<string, string> | null | undefined): boolean {
  if (!metadata) return false;
  return metadata.source?.trim() === CHECKOUT_SOURCE || metadata.kgcKind?.trim() === 'group-registration';
}
