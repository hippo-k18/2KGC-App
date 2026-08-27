import type { Metadata } from 'next';
import Link from 'next/link';
import { tiersOrNull } from '@/lib/catalogue';
import { SITE } from '@/lib/site';
import { stripeEnabled } from '@/lib/stripe';
import { InvoiceForm } from './invoice-form';

/**
 * Tickets › Invoice a company.
 *
 * A separate page rather than a tab on the checkout form, because the two
 * flows have different buyers. Checkout is one person paying for themselves in
 * ninety seconds; this is somebody assembling a list of colleagues and a PO
 * number, probably across two sittings. Sharing a form would make both worse.
 */

/**
 * Reads the live ticket catalogue, so it cannot be prerendered — same rule as
 * every other Firestore-backed page here. Without this the build tries to reach
 * the database and fails with `ECONNREFUSED` on a machine with no emulator.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Invoice a company — ${SITE.name}`,
  description:
    'Register a group for the Knowledge Graph Conference and pay by invoice on net terms, with a purchase order number.',
};

export default async function InvoicePage() {
  const tiers = (await tiersOrNull()) ?? [];

  return (
    <>
      <section className="band band-navy">
        <div className="wrap">
          <p className="kicker">Tickets</p>
          <h1>Invoice a company</h1>
          <p className="lede" style={{ maxWidth: 620 }}>
            Registering several people, or paying through procurement? We&rsquo;ll raise a proper
            invoice with a purchase order number on it, payable by card or bank transfer.
          </p>
        </div>
      </section>

      <section className="band">
        <div className="wrap" style={{ display: 'grid', gap: 40, gridTemplateColumns: 'minmax(0,1fr)' }}>
          {!stripeEnabled() && (
            <p className="notice warn">
              <strong>Test mode.</strong> No payment processor is configured on this deployment, so
              invoices cannot be raised here. On the live site this form emails a payable Stripe
              invoice.
            </p>
          )}

          <div style={{ display: 'grid', gap: 36, gridTemplateColumns: 'minmax(0,420px) minmax(0,1fr)' }}>
            <div>
              <InvoiceForm tiers={tiers} />
            </div>

            <div>
              <h2 style={{ fontSize: '1.25rem' }}>How it works</h2>
              <ol style={{ lineHeight: 1.7, paddingLeft: '1.1rem' }}>
                <li>
                  You list who&rsquo;s coming and who pays. Nothing is charged and nobody is
                  registered yet.
                </li>
                <li>
                  We raise the invoice through Stripe and email it to your billing contact, with the
                  PO number printed on the PDF.
                </li>
                <li>
                  Finance pays it by card or bank transfer, on the terms you chose.
                </li>
                <li>
                  <strong>When it clears</strong>, every attendee on the invoice gets their own
                  confirmation email with a claim code for the app.
                </li>
              </ol>

              {/*
                Stated plainly rather than buried, because it is the one thing
                that surprises people — and the surprise otherwise happens at
                the registration desk, which is the worst possible place.
              */}
              <p className="notice" style={{ marginTop: 18 }}>
                <strong>Tickets are issued on payment, not on the invoice.</strong> If your finance
                team needs longer than the event allows, email us — we&rsquo;d rather sort it out in
                advance than have somebody arrive without a badge.
              </p>

              <h3 style={{ fontSize: '1.05rem', marginTop: 26 }}>Prefer to pay by card?</h3>
              <p>
                For one or two people, <Link href="/tickets#buy">the normal checkout</Link> is
                faster — you&rsquo;ll have a ticket in about a minute.
              </p>

              <h3 style={{ fontSize: '1.05rem', marginTop: 26 }}>Larger groups</h3>
              <p>
                This form handles up to ten people. For more than that, or for a sponsor allocation,
                email us and we&rsquo;ll set it up directly.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
