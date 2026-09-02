import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes, money } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Setup › Ticket Add-ons.
 *
 * Whova's add-on is an optional extra bought alongside a ticket: a workshop
 * day, the gala dinner, a printed proceedings, a parking pass. It has its own
 * price and its own capacity, and it is not a ticket — you cannot attend on it.
 *
 * ── What this project does instead, and where that runs out ─────────────────
 *
 * KGC sells the workshops as a *tier*, not an add-on, and grants access through
 * the `includesWorkshops` entitlement. That works as long as the extras nest
 * neatly inside a price ladder. It stops working the moment two extras are
 * independent — dinner and workshops — because a tier per combination is a
 * combinatorial price list, which is exactly the problem add-ons exist to solve.
 */
export default async function TicketAddOnsPage() {
  await requireOrganizer();
  const tiers = await listTicketTypes();

  return (
    <>
      <PageHeader
        title="Ticket Add-ons"
        tags={<Tag color="grey">No add-on model</Tag>}
        links={[
          <Link key="c" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
          <Link key="m" href="/attendees/ticket-session-mapping">
            Ticket Session Mapping
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Entitlements that exist today</h2>
        <p className="body-2">
          There are exactly two, and they are booleans on the ticket type rather than products. Both
          are read as entitlements elsewhere in the dashboard, so they are not decorative.
        </p>
        <Table
          cols={[
            { key: 'n', label: 'Tier', className: 'cell-md' },
            { key: 'p', label: 'Price', className: 'cell-sm' },
            { key: 'w', label: 'Workshops', className: 'cell-sm' },
            { key: 'v', label: 'Video library', className: 'cell-fill' },
          ]}
          rows={tiers.map((t) => [
            t.name,
            money(t.priceCents, t.currency),
            t.includesWorkshops ? <Tag key="w" color="green" small>yes</Tag> : <span key="w" className="muted">—</span>,
            t.includesVideoLibrary ? <Tag key="v" color="green" small>yes</Tag> : <span key="v" className="muted">—</span>,
          ])}
          empty="No ticket types. Run `npm run seed` — the catalogue has no hard-coded fallback."
        />
      </Panel>

      <Banner kind="info">
        <strong>An add-on is not a discount code.</strong> Discount codes change what a purchase
        costs; an add-on changes what it contains. Stripe owns the first (
        <Link href={ROUTES.discountCodes}>Discount Codes</Link>) and this repo owns the second — so
        add-ons cannot be borrowed from Stripe the way promotions were.
      </Banner>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What it would take</h2>
        <p className="body-2">
          An <code>addOns</code> collection with a price and an optional capacity, a multi-select on
          the public form, extra line items on the Checkout session, and — the part that is easy to
          forget — the entitlement written onto the registration at fulfilment, because that is
          what the door and the app read. One of those four is now free: the Checkout session
          already builds several line items with real quantities, because multi-seat checkout
          needed that anyway. The other three are the work, and the fourth is the one that decides
          whether it is correct.
        </p>
        <p className="body-2">
          Capacity is the subtle half. A gala dinner with 200 seats needs the same sold-out check
          the ticket catalogue already does in <code>availability()</code>, and needs it to be
          correct under concurrent purchase — which the ticket path handles by counting on the
          server at fulfilment rather than trusting a client.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No add-on products.</strong> Nothing in the data model is purchasable except a
            ticket type, and nothing on an order distinguishes an extra from a seat.
          </li>
          <li>
            <strong>No per-add-on capacity or reporting.</strong> A caterer asking &ldquo;how many
            for dinner&rdquo; would be answered by counting a tier, which is only right while dinner
            maps to a tier.
          </li>
          <li>
            <strong>No post-purchase upsell.</strong> Whova lets an attendee add the dinner a week
            later. That is a second checkout against an existing registration, and there is no flow
            anywhere that charges an attendee who already holds a ticket.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
