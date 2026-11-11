import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes, money } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { listMerchItems, merchPickup } from '@/lib/merch';
import { MERCH_PICKUP_NOTE } from '@kgc/shared';
import { MerchForm } from './merch-form';
import { seedMerchAction } from './actions';
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
 *
 * ── Merch (T380) ─────────────────────────────────────────────────────────────
 *
 * Socks and T-shirts are the one kind of add-on sold on their own: priced and
 * switched on here, bought at checkout beside a ticket or later on the
 * website's `/tickets/merch`, and picked up at the conference. The pickup list
 * below is what the merch desk hands over.
 */
export default async function TicketAddOnsPage() {
  await requireOrganizer();
  const [tiers, merch, pickup] = await Promise.all([listTicketTypes(), listMerchItems(), merchPickup()]);
  const onSale = merch.filter((m) => m.active).length;

  return (
    <>
      <PageHeader
        title="Ticket Add-ons"
        info={
          <>
            <strong>Merch and ticket extras</strong>
            <p>
              Merch is sold at checkout and to ticket holders from their ticket page. {MERCH_PICKUP_NOTE}{' '}
              Workshops and the video library are switched on per ticket in Create & Edit Tickets.
            </p>
          </>
        }
        tags={onSale > 0 ? <Tag color="green">{onSale} on sale</Tag> : <Tag color="grey">Merch off</Tag>}
        links={[
          <Link key="c" href={ROUTES.createTickets}>
            Create & Edit Tickets
          </Link>,
          <Link key="m" href="/attendees/ticket-session-mapping">
            Ticket Session Mapping
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Merch</h2>
        <p className="body-2">
          Shown at checkout and on the merch page only while switched on. Discount codes limited to
          tickets and the group rate do not apply to merch.
        </p>
        <Table
          cols={[
            { key: 'n', label: 'Item', className: 'cell-md' },
            { key: 'p', label: 'Price', className: 'cell-sm' },
            { key: 'o', label: 'Designs', className: 'cell-fill' },
            { key: 's', label: 'Sizes', className: 'cell-sm' },
            { key: 'a', label: 'Status', className: 'cell-sm' },
          ]}
          rows={merch.map((m) => [
            m.name,
            money(m.priceCents, m.currency),
            (m.options ?? []).map((o) => o.label).join(' · ') || <span key="o" className="muted">none</span>,
            (m.sizes ?? []).join(' ') || <span key="s" className="muted">one size</span>,
            m.active ? <Tag key="a" color="green" small>on sale</Tag> : <Tag key="a" color="grey" small>off</Tag>,
          ])}
          empty={
            <form action={seedMerchAction}>
              <NotInputted what="merch items" compact />
              <button type="submit" className="whova-btn-main secondary" style={{ marginTop: 8 }}>
                Add socks and the T-shirt (switched off)
              </button>
            </form>
          }
        />
        {merch.map((m) => (
          <details key={m.id} style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer' }}>Edit {m.name}</summary>
            <MerchForm item={m} />
          </details>
        ))}
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer' }}>Add an item</summary>
          <MerchForm />
        </details>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Merch pickup list</h2>
        <p className="body-2">
          From {pickup.orders} paid {pickup.orders === 1 ? 'order' : 'orders'}. Refunded and cancelled
          orders are left out. Each order&rsquo;s merch is on{' '}
          <Link href="/tickets/orders-and-transactions/attendee-orders">Attendee Orders</Link> and in its
          CSV export.
        </p>
        <Table
          cols={[
            { key: 'n', label: 'Item', className: 'cell-md' },
            { key: 'o', label: 'Design', className: 'cell-fill' },
            { key: 's', label: 'Size', className: 'cell-sm' },
            { key: 'q', label: 'Quantity', className: 'cell-sm' },
          ]}
          rows={pickup.rows.map((r) => [r.name, r.optionLabel ?? '', r.size ?? '', r.quantity])}
          empty={<NotInputted what="merch sold" compact />}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What each ticket includes</h2>
        <p className="body-2">
          Two extras can be included in a ticket.
          Set them in <Link href={ROUTES.createTickets}>Create & Edit Tickets</Link>.
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
            <strong>No add-on products besides merch.</strong> A dinner or parking pass would need its
            own item type with a capacity; merch has no capacity.
          </li>
          <li>
            <strong>No per-add-on capacity or reporting.</strong> A caterer asking &ldquo;how many
            for dinner&rdquo; would be answered by counting a tier, which is only right while dinner
            maps to a tier.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
