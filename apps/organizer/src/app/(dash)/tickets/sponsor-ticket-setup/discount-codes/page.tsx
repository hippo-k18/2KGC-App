import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Sponsor Ticket Setup › Discount Codes.
 *
 * The same constraint as the exhibitor copy, and the same answer: our discount
 * codes are Stripe promotion codes, which belong to the Stripe account and not
 * to a catalogue, so there is one list and this is not it.
 *
 * Sponsorship makes the mismatch sharper rather than softer. A sponsor discount
 * is normally a negotiated figure on one contract, not a code somebody types —
 * so even the scoped version Whova offers would be the wrong tool here, and a
 * code list on this screen would be the wrong tool twice over.
 */
export default async function SponsorDiscountCodesPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Discount Codes"
        links={[
          <Link key="d" href={ROUTES.discountCodes}>
            Discount Codes (all audiences)
          </Link>,
          <Link key="t" href="/tickets/sponsor-ticket-setup/sponsor-tickets">
            Sponsor Tickets
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>Discount codes are not scoped per audience here.</strong> They are Stripe promotion
        codes, and a Stripe promotion code belongs to the Stripe account, not to a catalogue. There
        is one list, managed on{' '}
        <Link href={ROUTES.discountCodes}>Tickets › Ticket Setup › Discount Codes</Link>, and it
        applies wherever Checkout accepts a code.
      </Banner>

      <Panel>
        <h2 className="section-header">What Whova does here</h2>
        <dl className="gap-grid">
          <dt>Whova does</dt>
          <dd>
            A sponsor-only code list, each code restricted to chosen sponsor tiers, with a
            redemption cap and a date window — typically used for a returning-sponsor rate or an
            early-commitment discount.
          </dd>
          <dt>We would need</dt>
          <dd>
            Either per-tier Stripe coupons (which needs durable Stripe Prices per tier, a change to
            the money path), or — far more likely to be what KGC actually wants — a negotiated
            amount on a Stripe invoice, which needs no codes at all. Recording the agreed figure
            beats making the sponsor type a coupon.
          </dd>
          <dt>Read</dt>
          <dd>
            <code>apps/organizer/src/lib/discount-codes.ts</code>, and <code>PAYMENTS.md</code> for
            why invoicing exists alongside Checkout.
          </dd>
        </dl>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 className="section-header">Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Any code list of its own.</strong> Deliberately — a second table of the same
            account-wide Stripe codes under a sponsor heading would imply a scope that does not
            exist.
          </li>
          <li>
            <strong>Sponsor-only redemption.</strong> Stripe validates the code string and its cap.
            Nothing anywhere checks who is redeeming.
          </li>
          <li>
            <strong>A negotiated discount recorded against a sponsor.</strong> The closer fit for
            this event, and nothing models it: <code>sponsors</code> documents carry no commercial
            terms and no link to an order.
          </li>
        </ul>
      </Panel>
    </>
  );
}
