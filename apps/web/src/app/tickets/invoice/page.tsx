import type { Metadata } from 'next';
import { termsPublished } from '@/lib/terms-core';
import Link from 'next/link';
import { tiersOrNull } from '@/lib/catalogue';
import { countryOptions } from '@/lib/invoice-core';
import { SITE } from '@/lib/site';
import { stripeEnabled } from '@/lib/stripe';
import { InvoiceForm } from './invoice-form';
import { TicketSalesClosed } from '../sales-closed';
import { ticketSalesOpen } from '@/lib/data';
import { HowItWorks } from './how-it-works';
import s from './invoice.module.css';

/**
 * Tickets › Pay by invoice.
 *
 * A separate page rather than a tab on the checkout form, because the two
 * flows have different buyers. Checkout is one person paying for themselves in
 * ninety seconds; this is somebody assembling a list of colleagues and a PO
 * number, probably across two sittings. Sharing a form would make both worse.
 *
 * ── The shape (T147) ────────────────────────────────────────────────────────
 *
 * The form used to sit in a 420px column beside a "How it works" essay, under
 * a navy hero, so the one thing on the page somebody came to do was its
 * narrowest part. It now follows `/tickets`: no hero, a short heading, and the
 * form across the content width in numbered sections, with the total and the
 * submit button in a rail that stays in view. What the essay said is four
 * short steps under the form.
 */

/** Per-request, and it has to be. Prices, for the reason `tickets/page.tsx` gives. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  // Checkout, not a landing page: the site-wide noindex goes away at cutover, this stays.
  robots: { index: false, follow: false },
  title: `Pay by invoice | ${SITE.name}`,
  description:
    'Register a group for the Knowledge Graph Conference and pay by invoice on net terms, with a purchase order number.',
};

export default async function InvoicePage() {
  if (!(await ticketSalesOpen())) return <TicketSalesClosed />;
  const tiers = (await tiersOrNull()) ?? [];
  /*
   * With invoicing closed the form is replaced by an email notice, and the
   * steps describe emailing us rather than a form that is not on the page.
   */
  const open = stripeEnabled();

  return (
    <div className={s.page}>
      <p className={s.back}>
        <Link href="/tickets" className="btn btn-ghost-quiet btn-sm">
          ← All tickets
        </Link>
      </p>

      <header className={s.head}>
        <h1 className={s.h1}>Pay by invoice</h1>
        <p className={s.orient}>
          For groups and procurement. We email an invoice with your PO number on it, payable by
          card or bank transfer.
        </p>
        <p className={s.orient}>
          Paying by card for one or two people? <Link href="/tickets/checkout">Checkout</Link> is
          faster.
        </p>
      </header>

      {open ? (
        <>
          <InvoiceForm tiers={tiers} countries={countryOptions()} termsPublished={termsPublished()} />
          <HowItWorks open />
        </>
      ) : (
        <div className={s.closedLayout}>
          <p className="notice">
            Invoicing is not open yet. Email{' '}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> who&rsquo;s coming and
            who pays, and we will raise one by hand. Ten people or a hundred, and sponsor
            allocations too.
          </p>
          <HowItWorks open={false} />
        </div>
      )}
    </div>
  );
}
