import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { GapPanel, PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › Discount Codes.
 *
 * ── Why this screen is a pointer rather than a copy ─────────────────────────
 *
 * Whova scopes a discount code to chosen ticket types, so a code can be
 * exhibitor-only, and that is why Whova has three of these screens. Ours cannot
 * be scoped that way: discount codes here are **Stripe promotion codes**, read
 * live from the Stripe account, and a Stripe promotion code belongs to the
 * account rather than to any audience. There is exactly one list, and it is the
 * same list on all three screens.
 *
 * Rendering that same list here a second time would be the worst option
 * available — it would look scoped, an organizer would create a code expecting
 * it to apply to exhibitors only, and Stripe would honour it at the attendee
 * checkout too. So this screen states the constraint and links to the one real
 * screen instead.
 */
export default async function ExhibitorDiscountCodesPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Discount Codes"
        info={
          <>
            <strong>One list of codes for every ticket</strong>
            <p>
              Codes are created on{' '}
              <Link href={ROUTES.discountCodes}>Ticket Setup › Discount Codes</Link> and work at
              every checkout.
            </p>
          </>
        }
        links={[
          <Link key="d" href={ROUTES.discountCodes}>
            Discount Codes (all audiences)
          </Link>,
          <Link key="t" href="/tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets">
            2.1 Exhibitor Tickets
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where an exhibitor code is created</h2>
        <p className="body-2" style={{ marginTop: 0 }}>
          On <Link href={ROUTES.discountCodes}>Ticket Setup › Discount Codes</Link>. A code works
          at every checkout, so it cannot be limited to exhibitors. For an exhibitor-only discount,
          agree the price and raise an invoice instead.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 className="section-header">Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Any code list of its own.</strong> Deliberately. A second table of the same
            Stripe codes under an exhibitor heading would imply a scope that does not exist.
          </li>
          <li>
            <strong>Codes only an exhibitor can redeem.</strong> Nothing checks who is redeeming.
            Stripe validates the code string and the cap; neither knows about audiences.
          </li>
          <li>
            <strong>An exhibitor checkout to redeem them at.</strong> The public site sells the
            attendee catalogue only, so an exhibitor-targeted code would have nowhere to be typed.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
