import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes, money } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { GapPanel, NotInputted, PageHeader, Panel, Table, Tag } from '../../../ui';

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
        info={
          <>
            <strong>Extras are part of a ticket</strong>
            <p>
              Add-ons sold on their own are not available yet. Workshops and the video library are
              switched on per ticket in Create Tickets.
            </p>
          </>
        }
        tags={<Tag color="grey">Not available yet</Tag>}
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
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What each ticket includes</h2>
        <p className="body-2">
          Add-ons sold on their own are not available yet. Two extras can be included in a ticket.
          Set them in <Link href={ROUTES.createTickets}>Create Tickets</Link>.
        </p>
        <Table
          cols={[
            { key: 'n', label: 'Ticket', className: 'cell-md' },
            { key: 'p', label: 'Price', className: 'cell-sm' },
            { key: 'w', label: 'Workshops', className: 'cell-sm' },
            { key: 'v', label: 'Video library', className: 'cell-fill' },
          ]}
          rows={tiers.map((t) => [
            t.name,
            money(t.priceCents, t.currency),
            t.includesWorkshops ? <Tag key="w" color="green" small>yes</Tag> : <span key="w" className="muted">no</span>,
            t.includesVideoLibrary ? <Tag key="v" color="green" small>yes</Tag> : <span key="v" className="muted">no</span>,
          ])}
          empty={<NotInputted what="ticket types" compact />}
        />
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
