import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { GapPanel, PageHeader, Panel } from '../../../ui';

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
        info={
          <>
            <strong>Discount codes are not scoped per audience</strong>
            <p>
              They are Stripe promotion codes, and a Stripe promotion code belongs to the Stripe
              account rather than to a catalogue. There is one list, on{' '}
              <Link href={ROUTES.discountCodes}>Ticket Setup › Discount Codes</Link>, and it applies
              wherever Checkout accepts a code.
            </p>
          </>
        }
        links={[
          <Link key="d" href={ROUTES.discountCodes}>
            Discount Codes (all audiences)
          </Link>,
          <Link key="t" href="/tickets/sponsor-ticket-setup/sponsor-tickets">
            Sponsor Tickets
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where a sponsor code is created</h2>
        <p className="body-2" style={{ marginTop: 0 }}>
          On <Link href={ROUTES.discountCodes}>Ticket Setup › Discount Codes</Link>, with the one
          list every checkout reads. A returning-sponsor rate is usually better expressed as a
          negotiated figure on an invoice than as a coupon: the amount is agreed in a conversation,
          and an account-wide code cannot be restricted to the sponsor it was agreed with.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
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
      </GapPanel>
    </>
  );
}
