'use server';

import { redirect } from 'next/navigation';
import { tierById } from '@/lib/catalogue';
import { sendInvoiceRaised } from '@/lib/email';
import { raiseInvoice } from '@/lib/invoicing';
import { recordInvoiceOrder } from '@/lib/registrations';
import { stripeEnabled } from '@/lib/stripe';

/**
 * Requesting an invoice instead of paying by card.
 *
 * The order of operations here is the whole design, and it is deliberate:
 *
 *   1. price every seat **on the server**, from the tier id;
 *   2. raise and send the invoice through Stripe;
 *   3. record it as a `pending` order so the dashboard can chase it;
 *   4. email the requester what happens next.
 *
 * Nothing registers anybody. An invoice is a promise to pay, and fulfilment
 * waits for `invoice.paid` in the webhook. That is not caution for its own
 * sake: issuing badges against unpaid invoices is how conferences end up
 * chasing money from people who already attended and went home.
 *
 * Steps 3 and 4 are after the invoice exists and neither may undo it. If the
 * order write fails the company still has a real, payable invoice — and the
 * webhook writes the order when it clears anyway. Failing the whole request at
 * that point would tell the buyer nothing happened when something did.
 */

export interface InvoiceState {
  error?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Whova's own cap is 100 seats a form; this is a website, and ten is plenty. */
const MAX_SEATS = 10;

export async function requestInvoice(
  _prev: InvoiceState,
  form: FormData,
): Promise<InvoiceState> {
  if (!stripeEnabled()) {
    return {
      error:
        'Invoicing is not available on this deployment because no payment processor is ' +
        'configured. Email us and we will raise one by hand.',
    };
  }

  const companyName = String(form.get('company') ?? '').trim();
  const billingEmail = String(form.get('billingEmail') ?? '').trim();
  const purchaseOrder = String(form.get('po') ?? '').trim();
  const note = String(form.get('note') ?? '').trim();
  const daysUntilDue = Number(form.get('netDays') ?? 30);

  if (companyName.length < 2) return { error: 'Enter the company name to invoice.' };
  if (!EMAIL.test(billingEmail)) {
    return { error: 'Enter a valid billing email address — this is where the invoice goes.' };
  }
  if (![14, 30, 45, 60].includes(daysUntilDue)) return { error: 'Choose payment terms.' };

  /**
   * Seats arrive as three parallel arrays from repeated form fields. Rows where
   * every field is blank are dropped rather than rejected — the form renders
   * spare rows, and making someone delete empty ones to submit is hostile.
   */
  const names = form.getAll('seatName').map((v) => String(v).trim());
  const emails = form.getAll('seatEmail').map((v) => String(v).trim());
  const tierIds = form.getAll('seatTier').map((v) => String(v).trim());

  const rows = names
    .map((name, i) => ({ name, email: emails[i] ?? '', tierId: tierIds[i] ?? '' }))
    .filter((r) => r.name || r.email);

  if (rows.length === 0) return { error: 'Add at least one attendee.' };
  if (rows.length > MAX_SEATS) {
    return { error: `This form handles up to ${MAX_SEATS} attendees. Email us for larger groups.` };
  }

  for (const [i, r] of rows.entries()) {
    if (r.name.length < 2) return { error: `Attendee ${i + 1}: enter a full name.` };
    if (!EMAIL.test(r.email)) return { error: `Attendee ${i + 1}: enter a valid email address.` };
  }

  /**
   * Duplicate addresses are rejected rather than merged.
   *
   * A registration is keyed by email, so two seats with the same address are
   * one ticket — the company would be invoiced twice and get one badge. Better
   * to say so than to take the money.
   */
  const seen = new Set<string>();
  for (const r of rows) {
    const key = r.email.toLowerCase();
    if (seen.has(key)) return { error: `${r.email} appears twice. Each attendee needs their own address.` };
    seen.add(key);
  }

  /**
   * Price on the server, from the tier id. The form never posts an amount —
   * the same rule that governs Checkout, and for the same reason.
   */
  const seats: {
    name: string;
    email: string;
    ticketType: string;
    ticketTypeId: string;
    priceCents: number;
  }[] = [];

  // Captured from the tiers rather than assumed: an invoice mixing currencies
  // is not something Stripe will accept, and finding that out at
  // `finalizeInvoice` is a worse error message than finding it out here.
  let currency: string | undefined;

  for (const [i, r] of rows.entries()) {
    const tier = await tierById(r.tierId);
    if (!tier) return { error: `Attendee ${i + 1}: choose a ticket type.` };
    if (!tier.onSale) {
      return {
        error: `Attendee ${i + 1}: ${tier.name} is not available — ${(tier.unavailableReason ?? 'sales closed').toLowerCase()}.`,
      };
    }
    if (currency && currency !== tier.currency) {
      return { error: 'All attendees on one invoice must use the same currency.' };
    }
    currency ??= tier.currency;

    seats.push({
      name: r.name,
      email: r.email,
      ticketType: tier.name,
      ticketTypeId: tier.id,
      priceCents: tier.priceCents,
    });
  }

  const invoiceCurrency = currency ?? 'usd';

  let invoice;
  try {
    invoice = await raiseInvoice({
      billingEmail,
      companyName,
      seats,
      currency: invoiceCurrency,
      purchaseOrder: purchaseOrder || undefined,
      daysUntilDue,
      note: note || undefined,
    });
  } catch (err) {
    console.error('[invoice] Stripe invoice creation failed', err);
    return {
      error:
        'We could not raise the invoice. Nothing has been charged or committed — ' +
        'please try again, or email us and we will do it by hand.',
    };
  }

  // Everything past this point is bookkeeping on top of an invoice that already
  // exists and is already in the buyer's inbox. Neither failure may be reported
  // to the buyer as "it did not work", because it did.
  try {
    await recordInvoiceOrder({
      invoiceId: invoice.invoiceId,
      billingEmail,
      companyName,
      seats,
      currency: invoiceCurrency,
      totalCents: invoice.totalCents,
      hostedInvoiceUrl: invoice.hostedInvoiceUrl ?? undefined,
      invoicePdfUrl: invoice.pdfUrl ?? undefined,
      poNumber: purchaseOrder || undefined,
      dueAt: invoice.dueDate ? new Date(invoice.dueDate) : undefined,
    });
  } catch (err) {
    console.error('[invoice] could not record pending order for', invoice.invoiceId, err);
  }

  await sendInvoiceRaised({
    to: billingEmail,
    companyName,
    seatCount: seats.length,
    totalCents: invoice.totalCents,
    currency: invoiceCurrency,
    hostedInvoiceUrl: invoice.hostedInvoiceUrl ?? '',
    poNumber: purchaseOrder || undefined,
    dueDate: invoice.dueDate
      ? new Date(invoice.dueDate).toLocaleDateString('en-US', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : undefined,
  });

  /**
   * Straight to Stripe's hosted invoice page.
   *
   * Building our own confirmation screen would mean duplicating the amount, the
   * due date and the PO number — three chances to disagree with the invoice
   * that finance will actually pay. The hosted page *is* the confirmation, and
   * it has the Pay button on it.
   *
   * Outside the try blocks above: `redirect` signals by throwing.
   */
  redirect(invoice.hostedInvoiceUrl ?? '/tickets?invoiced=1');
}
