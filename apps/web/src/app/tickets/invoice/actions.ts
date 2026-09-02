'use server';

import { redirect } from 'next/navigation';
import { tierById } from '@/lib/catalogue';
import { sendInvoiceRaised } from '@/lib/email';
import { raiseInvoice } from '@/lib/invoicing';
import { recordInvoiceOrder } from '@/lib/registrations';
import { stripeEnabled } from '@/lib/stripe';
import { EMAIL, MAX_SEATS, collectSeats, validateSeats } from '../seats-core';

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
   * Seats arrive as three parallel arrays from repeated form fields — the same
   * three the card checkout posts, parsed and checked by the same code.
   *
   * The rules used to live here, privately: the ten-seat cap, the per-row
   * checks, and the one that matters most, that a duplicate address is refused
   * rather than merged because a registration is keyed by email and two seats
   * on one address are one badge. They moved to `seats-core.ts` when
   * `/tickets` grew a quantity of its own, because two forms that both sell
   * seats and each keep their own copy of that rule agree exactly until
   * somebody changes one of them — and the failure is a company invoiced for
   * four people who collects three badges.
   */
  const seatEmails = form.getAll('seatEmail');
  const seatTiers = form.getAll('seatTier');
  const rows = collectSeats(
    form.getAll('seatName').map((v, i) => ({
      name: String(v),
      email: String(seatEmails[i] ?? ''),
      tierId: String(seatTiers[i] ?? ''),
    })),
  );

  const problem = validateSeats(rows);
  if (problem) {
    switch (problem.kind) {
      case 'empty':
        return { error: 'Add at least one attendee.' };
      case 'too-many':
        return {
          error: `This form handles up to ${MAX_SEATS} attendees. Email us for larger groups.`,
        };
      case 'name':
        return { error: `Attendee ${problem.index + 1}: enter a full name.` };
      case 'email':
        return { error: `Attendee ${problem.index + 1}: enter a valid email address.` };
      case 'duplicate':
        return {
          error: `${problem.email} appears twice. Each attendee needs their own address.`,
        };
    }
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
