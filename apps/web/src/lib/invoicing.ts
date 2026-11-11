import 'server-only';

import type Stripe from 'stripe';
import { stripe } from './stripe';
import { raiseInvoiceWith, type InvoiceRequest, type InvoiceResult } from './invoice-core';

/**
 * Invoice a company instead of taking a card.
 *
 * This is the single largest gap in a B2B conference's payment story and it is
 * not a nicety. A researcher expensing $800 pays by card; a bank sending four
 * people does not — procurement issues a purchase order, finance pays against
 * an invoice on net-30 terms, and there is frequently no corporate card in the
 * building that will authorise a conference registration. An event that cannot
 * invoice loses exactly the delegates it most wants, and loses them silently,
 * because nobody emails to say "your checkout had no invoice option".
 *
 * Stripe Invoicing does this without a second processor: same account, same
 * dashboard, same payouts, same webhook stream. The buyer gets a hosted invoice
 * page they can hand to finance, pay by card or bank transfer, and download as
 * a PDF with a PO number on it.
 *
 * ── The rule that makes this safe ────────────────────────────────────────────
 *
 * An invoice is a *promise* to pay, and a promise is not a ticket. Fulfilment
 * still happens in the webhook, on `invoice.paid`, exactly as it does for a
 * card — never at the point the invoice is raised. Issuing a badge against an
 * unpaid invoice is how conferences end up chasing money from people who have
 * already attended, and it is a policy decision (a purchase order is often good
 * enough) rather than a technical one. If the conference decides a PO is
 * sufficient, that belongs in an organizer action that marks the invoice paid
 * out-of-band, not in this file quietly treating unpaid as paid.
 */

export type { BillingAddress, InvoiceRequest, InvoiceResult } from './invoice-core';
export { InvoiceError } from './invoice-core';

/**
 * Raise, finalise and send an invoice with the live client. The sequence, and
 * the clean-up when it fails, live in `invoice-core.ts` so they can be tested
 * against a fake one.
 */
export async function raiseInvoice(req: InvoiceRequest): Promise<InvoiceResult> {
  return raiseInvoiceWith(stripe(), req);
}

/**
 * The attendees an `invoice.paid` event should register.
 *
 * Reads back what `raiseInvoice` stashed in metadata. Returns an empty list
 * rather than throwing on anything unexpected: a malformed metadata blob must
 * not stop the webhook acknowledging, or Stripe retries it forever and
 * eventually disables the endpoint for every other event too.
 */
export function seatsFromInvoice(
  invoice: Stripe.Invoice,
): { name: string; email: string; ticketType: string }[] {
  const raw = invoice.metadata?.attendees;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { n?: string; e?: string; t?: string }[];
    return parsed
      .filter((x) => x.e)
      .map((x) => ({
        name: x.n ?? '',
        email: x.e as string,
        // No fallback tier. A seat that does not name its ticket is left for
        // an organizer to decide, not registered as Main Conference (T135, S11).
        ticketType: x.t?.trim() ?? '',
      }));
  } catch {
    console.error('[invoicing] unreadable attendee metadata on', invoice.id);
    return [];
  }
}
