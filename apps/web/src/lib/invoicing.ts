import 'server-only';

import type Stripe from 'stripe';
import { stripe } from './stripe';

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

export interface InvoiceRequest {
  /** Who signs for it — finance, not necessarily the attendee. */
  billingEmail: string;
  companyName: string;
  /**
   * Attendees this invoice covers. One line item each, so seats are countable.
   *
   * `ticketTypeId` rides along so fulfilment can count the sale against the
   * right tier's capacity — the name alone is a display string and a renamed
   * tier would break the link.
   */
  seats: {
    name: string;
    email: string;
    ticketType: string;
    ticketTypeId: string;
    priceCents: number;
  }[];
  currency: string;
  /** Printed on the invoice; the single most common reason finance rejects one. */
  purchaseOrder?: string;
  /** Net terms. Thirty days is the default finance departments expect. */
  daysUntilDue?: number;
  /** Free text onto the invoice — VAT ID, cost centre, "Q3 training budget". */
  note?: string;
}

export interface InvoiceResult {
  invoiceId: string;
  /** The page to send finance. Pay, download PDF, view terms. */
  hostedInvoiceUrl: string | null;
  pdfUrl: string | null;
  totalCents: number;
  dueDate: string | null;
}

const DEFAULT_NET_DAYS = 30;

/**
 * Raise a draft invoice, then finalise and send it.
 *
 * Finalising is the step that makes it real and immutable; before that it can
 * be edited, after it cannot. Doing both here is deliberate — a draft invoice
 * sitting in the Stripe dashboard that nobody remembers to send is worse than
 * no invoice at all, because the buyer believes they are waiting on us.
 */
export async function raiseInvoice(req: InvoiceRequest): Promise<InvoiceResult> {
  const s = stripe();

  // One customer per billing email, reused. Creating a fresh customer per
  // invoice fragments a company's history across dozens of records and makes
  // "what has Acme bought" unanswerable in the dashboard.
  const existing = await s.customers.list({ email: req.billingEmail, limit: 1 });
  const customer =
    existing.data[0] ??
    (await s.customers.create({
      email: req.billingEmail,
      name: req.companyName,
      metadata: { kgcRole: 'invoice-billing-contact' },
    }));

  const invoice = await s.invoices.create({
    customer: customer.id,
    collection_method: 'send_invoice',
    days_until_due: req.daysUntilDue ?? DEFAULT_NET_DAYS,
    auto_advance: false,
    // Stripe prints this on the invoice and, crucially, on the PDF that goes
    // into an accounts-payable system.
    custom_fields: req.purchaseOrder
      ? [{ name: 'Purchase Order', value: req.purchaseOrder.slice(0, 30) }]
      : undefined,
    description: req.note,
    // Same reasoning as Checkout: admission is taxed where the event is.
    automatic_tax: { enabled: true },
    metadata: {
      kgcKind: 'group-registration',
      seats: String(req.seats.length),
      /**
       * A best-effort copy of the attendee list.
       *
       * ⚠️ Stripe caps a metadata value at 500 characters, so this truncates —
       * and a truncated JSON string does not parse. It is therefore **not** the
       * source of truth: `seatsFromOrder()` reads the order document, which has
       * no such limit, and this is only the fallback for an invoice raised
       * straight in the Stripe dashboard. Do not add a seat field here
       * expecting it to survive.
       */
      attendees: JSON.stringify(
        req.seats.map((x) => ({ n: x.name, e: x.email, t: x.ticketType })),
      ).slice(0, 480),
    },
  });

  for (const seat of req.seats) {
    await s.invoiceItems.create({
      customer: customer.id,
      invoice: invoice.id,
      currency: req.currency,
      // `amount`, not `unit_amount` — the pinned API version (2025-10-29)
      // dropped `unit_amount` from invoice items in favour of `amount` and a
      // `pricing` object. One seat per item, so the two are the same number.
      amount: seat.priceCents,
      description: `KGC 2027 — ${seat.ticketType} — ${seat.name} <${seat.email}>`,
      tax_code: 'txcd_20030000',
    });
  }

  const finalised = await s.invoices.finalizeInvoice(invoice.id as string);
  const sent = await s.invoices.sendInvoice(finalised.id as string);

  return {
    invoiceId: sent.id as string,
    hostedInvoiceUrl: sent.hosted_invoice_url ?? null,
    pdfUrl: sent.invoice_pdf ?? null,
    totalCents: sent.total ?? 0,
    dueDate: sent.due_date ? new Date(sent.due_date * 1000).toISOString() : null,
  };
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
        ticketType: x.t ?? 'Main Conference',
      }));
  } catch {
    console.error('[invoicing] unreadable attendee metadata on', invoice.id);
    return [];
  }
}
