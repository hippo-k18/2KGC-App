import type Stripe from 'stripe';

/**
 * The parts of pay-by-invoice that do not need a live Stripe key: the billing
 * address rules and the Stripe call sequence, with the client passed in.
 *
 * Kept free of `server-only` so the unit tests can drive `raiseInvoiceWith`
 * against a fake client. `invoicing.ts` is the server entry point and the only
 * place the real client is handed in.
 */

// ── Billing address ─────────────────────────────────────────────────────────

/**
 * Where the company is billed.
 *
 * Stripe Tax needs a location before it will finalize an invoice with
 * `automatic_tax` on, and until 2026-10-03 the form collected none: every new
 * billing customer got `customer_tax_location_invalid` at finalization and a
 * stranded draft. The full address, not just country and postcode, because
 * accounts payable expects one printed on a B2B invoice.
 */
export interface BillingAddress {
  line1: string;
  line2?: string;
  city: string;
  /** State, province or region. Required for the US and Canada. */
  state?: string;
  postalCode?: string;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string;
}

/**
 * Countries the form offers, as ISO 3166-1 alpha-2 codes. The names come from
 * `Intl.DisplayNames`, so this is the whole list to maintain.
 */
export const COUNTRIES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AR', 'AT', 'AU', 'AW', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BM', 'BN', 'BO', 'BR',
  'BS', 'BT', 'BW', 'BY', 'BZ', 'CA', 'CD', 'CF', 'CG', 'CH', 'CI', 'CL', 'CM',
  'CN', 'CO', 'CR', 'CV', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC',
  'EE', 'EG', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GQ', 'GR', 'GT', 'GU', 'GY', 'HK', 'HN',
  'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IQ', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KR', 'KW', 'KY', 'KZ', 'LA',
  'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD',
  'ME', 'MG', 'MK', 'ML', 'MM', 'MN', 'MO', 'MR', 'MT', 'MU', 'MV', 'MW', 'MX',
  'MY', 'MZ', 'NA', 'NE', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NZ', 'OM', 'PA',
  'PE', 'PG', 'PH', 'PK', 'PL', 'PR', 'PS', 'PT', 'PY', 'QA', 'RO', 'RS', 'RW',
  'SA', 'SB', 'SC', 'SE', 'SG', 'SI', 'SK', 'SL', 'SM', 'SN', 'SR', 'ST', 'SV',
  'SZ', 'TD', 'TG', 'TH', 'TJ', 'TL', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
  'UA', 'UG', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WS',
  'XK', 'YE', 'ZA', 'ZM', 'ZW',
] as const;

const COUNTRY_SET = new Set<string>(COUNTRIES);

/** The picker's options, English names sorted by name. Built on the server only. */
export function countryOptions(): { code: string; name: string }[] {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  return COUNTRIES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) =>
    a.name.localeCompare(b.name, 'en'),
  );
}

/**
 * Countries with no postal code system in general use, where the field is
 * optional. Everywhere else it is required: it is what Stripe Tax places a
 * buyer by inside a country, and the most common line missing from an address
 * finance sends back.
 */
const NO_POSTCODE = new Set([
  'AE', 'AG', 'AO', 'AW', 'BF', 'BI', 'BJ', 'BO', 'BS', 'BW', 'BZ', 'CD', 'CF',
  'CG', 'CI', 'CM', 'DJ', 'DM', 'ER', 'FJ', 'GA', 'GD', 'GH', 'GM', 'GQ', 'GY',
  'HK', 'IE', 'KI', 'KM', 'KN', 'ML', 'MO', 'MR', 'MW', 'NR', 'QA', 'RW', 'SB',
  'SC', 'SL', 'SR', 'ST', 'TD', 'TG', 'TL', 'TO', 'TT', 'TV', 'UG', 'VU', 'YE',
  'ZW',
]);

export function postalCodeRequired(country: string): boolean {
  return !NO_POSTCODE.has(country);
}

export function regionRequired(country: string): boolean {
  return country === 'US' || country === 'CA';
}

const US_ZIP = /^\d{5}(-\d{4})?$/;
const CA_POSTAL = /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/;
const MAX_LINE = 200;

export type AddressProblem =
  | 'line1'
  | 'city'
  | 'country'
  | 'state'
  | 'postal-missing'
  | 'postal-invalid'
  | 'too-long';

/**
 * Check and tidy an address as posted. Returns the cleaned address or the
 * first problem, in the order the fields appear on the form.
 */
export function validateBillingAddress(
  raw: Record<keyof BillingAddress, string | undefined>,
): { address: BillingAddress } | { problem: AddressProblem } {
  const clean = (v: string | undefined) => (v ?? '').trim().replace(/\s+/g, ' ');
  const line1 = clean(raw.line1);
  const line2 = clean(raw.line2);
  const city = clean(raw.city);
  const state = clean(raw.state);
  const country = clean(raw.country).toUpperCase();
  let postalCode = clean(raw.postalCode).toUpperCase();

  if ([line1, line2, city, state, postalCode].some((v) => v.length > MAX_LINE)) {
    return { problem: 'too-long' };
  }
  if (!COUNTRY_SET.has(country)) return { problem: 'country' };
  if (line1.length < 3) return { problem: 'line1' };
  if (city.length < 2) return { problem: 'city' };
  if (regionRequired(country) && state.length < 2) return { problem: 'state' };

  if (!postalCode) {
    if (postalCodeRequired(country)) return { problem: 'postal-missing' };
  } else if (country === 'US' && !US_ZIP.test(postalCode)) {
    return { problem: 'postal-invalid' };
  } else if (country === 'CA') {
    if (!CA_POSTAL.test(postalCode)) return { problem: 'postal-invalid' };
    postalCode = `${postalCode.replace(' ', '').slice(0, 3)} ${postalCode.replace(' ', '').slice(3)}`;
  } else if (postalCode.length > 12 || !/^[A-Z0-9][A-Z0-9 -]*$/.test(postalCode)) {
    return { problem: 'postal-invalid' };
  }

  return {
    address: {
      line1,
      line2: line2 || undefined,
      city,
      state: state || undefined,
      postalCode: postalCode || undefined,
      country,
    },
  };
}

/** What the buyer reads for each problem. */
export function addressProblemMessage(problem: AddressProblem, country: string): string {
  const us = country === 'US';
  switch (problem) {
    case 'country':
      return 'Choose the billing country.';
    case 'line1':
      return 'Enter the billing street address.';
    case 'city':
      return 'Enter the billing city.';
    case 'state':
      return us ? 'Enter the billing state.' : 'Enter the billing province.';
    case 'postal-missing':
      return us ? 'Enter the billing ZIP code.' : 'Enter the billing postal code.';
    case 'postal-invalid':
      return us ? 'Enter a valid ZIP code, like 10018.' : 'Enter a valid postal code.';
    case 'too-long':
      return 'One of the address lines is too long.';
  }
}

// ── Raising the invoice ─────────────────────────────────────────────────────

export interface InvoiceRequest {
  /** Who signs for it: finance, not necessarily the attendee. */
  billingEmail: string;
  companyName: string;
  /** Set on the Stripe customer before the invoice exists, for Stripe Tax. */
  address: BillingAddress;
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

/**
 * Why an invoice could not be raised. `address` means Stripe could not place
 * the billing address for tax, which the buyer can fix; `other` is anything
 * else, which they cannot.
 */
export class InvoiceError extends Error {
  constructor(
    readonly kind: 'address' | 'other',
    cause: unknown,
  ) {
    super(`invoice not raised (${kind})`, { cause });
    this.name = 'InvoiceError';
  }
}

/** The Stripe calls this file makes, so a test can stand in for the client. */
export type InvoiceStripe = Pick<Stripe, 'customers' | 'invoices' | 'invoiceItems'>;

const DEFAULT_NET_DAYS = 30;

function stripeAddress(a: BillingAddress): Stripe.AddressParam {
  return {
    line1: a.line1,
    line2: a.line2 ?? '',
    city: a.city,
    state: a.state ?? '',
    postal_code: a.postalCode ?? '',
    country: a.country,
  };
}

function isTaxLocationError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'customer_tax_location_invalid' || code === 'tax_location_invalid';
}

/**
 * Raise a draft invoice, then finalise and send it.
 *
 * Finalising is the step that makes it real and immutable; before that it can
 * be edited, after it cannot. Doing both here is deliberate — a draft invoice
 * sitting in the Stripe dashboard that nobody remembers to send is worse than
 * no invoice at all, because the buyer believes they are waiting on us.
 *
 * And for the same reason, a request that fails before the invoice is final
 * leaves nothing behind: the draft is deleted, and so is the customer if this
 * request created it. Until 2026-10-03 every failure stranded both.
 */
export async function raiseInvoiceWith(
  s: InvoiceStripe,
  req: InvoiceRequest,
): Promise<InvoiceResult> {
  const address = stripeAddress(req.address);

  // One customer per billing email, reused. Creating a fresh customer per
  // invoice fragments a company's history across dozens of records and makes
  // "what has Acme bought" unanswerable in the dashboard.
  //
  // The address goes on with `validate_location: 'immediately'`, so a location
  // Stripe Tax cannot place is refused here, before any invoice exists, rather
  // than at finalization. A refused update leaves an existing customer as it was.
  let customer: Stripe.Customer;
  let createdCustomer = false;
  try {
    const existing = await s.customers.list({ email: req.billingEmail, limit: 1 });
    if (existing.data[0]) {
      customer = await s.customers.update(existing.data[0].id, {
        address,
        tax: { validate_location: 'immediately' },
      });
    } else {
      customer = await s.customers.create({
        email: req.billingEmail,
        name: req.companyName,
        address,
        tax: { validate_location: 'immediately' },
        metadata: { kgcRole: 'invoice-billing-contact' },
      });
      createdCustomer = true;
    }
  } catch (err) {
    throw new InvoiceError(isTaxLocationError(err) ? 'address' : 'other', err);
  }

  let draftId: string | undefined;
  let finalised: Stripe.Invoice;
  try {
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
    draftId = invoice.id as string;

    for (const seat of req.seats) {
      await s.invoiceItems.create({
        customer: customer.id,
        invoice: draftId,
        currency: req.currency,
        // `amount`, not `unit_amount` — the pinned API version (2025-10-29)
        // dropped `unit_amount` from invoice items in favour of `amount` and a
        // `pricing` object. One seat per item, so the two are the same number.
        amount: seat.priceCents,
        description: `KGC 2027: ${seat.ticketType} · ${seat.name} <${seat.email}>`,
        tax_code: 'txcd_20030000',
      });
    }

    finalised = await s.invoices.finalizeInvoice(draftId);
  } catch (err) {
    await cleanUp(s, draftId, createdCustomer ? customer.id : undefined);
    throw new InvoiceError(isTaxLocationError(err) ? 'address' : 'other', err);
  }

  // Past this point the invoice is final and payable, and there is nothing to
  // undo. If Stripe's own email fails the buyer still lands on the hosted page,
  // and `sendInvoiceRaised` mails them its link, so the failure is logged
  // rather than reported as "nothing happened".
  let sent = finalised;
  try {
    sent = await s.invoices.sendInvoice(finalised.id as string);
  } catch (err) {
    console.error('[invoicing] finalized but Stripe could not email', finalised.id, err);
  }

  return {
    invoiceId: sent.id as string,
    hostedInvoiceUrl: sent.hosted_invoice_url ?? null,
    pdfUrl: sent.invoice_pdf ?? null,
    totalCents: sent.total ?? 0,
    dueDate: sent.due_date ? new Date(sent.due_date * 1000).toISOString() : null,
  };
}

/**
 * Remove what a failed request made. Each step is attempted on its own and a
 * failure is logged, never thrown: the buyer needs the original error, and a
 * leftover draft is something to find in the log, not a reason to hide it.
 */
async function cleanUp(s: InvoiceStripe, draftId?: string, customerId?: string) {
  if (draftId) {
    try {
      await s.invoices.del(draftId);
    } catch (err) {
      console.error('[invoicing] could not delete draft invoice', draftId, err);
    }
  }
  if (customerId) {
    try {
      await s.customers.del(customerId);
    } catch (err) {
      console.error('[invoicing] could not delete customer', customerId, err);
    }
  }
}
