import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel } from '../../../ui';

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
        links={[
          <Link key="d" href={ROUTES.discountCodes}>
            Discount Codes (all audiences)
          </Link>,
          <Link key="t" href="/tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets">
            2.1 Exhibitor Tickets
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
            A separate code list per audience, each code restricted to chosen ticket types, with a
            redemption cap, a date window and a percentage or fixed amount. That per-tier
            restriction is the entire reason the screen exists three times.
          </dd>
          <dt>We would need</dt>
          <dd>
            Per-tier restriction, which Stripe expresses as a coupon limited to specific{' '}
            <code>price</code> objects. This project creates no durable Stripe Prices — Checkout is
            handed <code>price_data</code> built from <code>ticketTypes</code> at session time — so
            restricting a coupon to a tier means giving every tier a Stripe Price first. A day or
            two, and it changes the money path, which is the part carrying the most tests.
          </dd>
          <dt>Read</dt>
          <dd>
            <code>apps/organizer/src/lib/discount-codes.ts</code> for what is actually read from
            Stripe, and <code>SETUP-PAYMENTS.md</code> for the account it reads.
          </dd>
        </dl>
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
