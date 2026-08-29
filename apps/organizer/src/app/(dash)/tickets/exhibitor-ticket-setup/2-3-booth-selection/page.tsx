import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listBooths, summarise } from '@/lib/booths';
import { listOrders, listTicketTypes } from '@/lib/commerce';
import { listExhibitors } from '@/lib/exhibitors';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';
import { releaseBoothAction, toggleBoothBlockedAction } from './actions';
import { AddBoothForm, AssignBoothForm } from './booth-forms';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › 2.3 Booth Selection.
 *
 * ── Why a booth is not a ticket type ────────────────────────────────────────
 *
 * Whova prices an exhibitor package per booth *size* and allocates a specific
 * space afterwards, and that separation is not an accident of their data model
 * — it is the shape of the problem. A catalogue is priced in the autumn; the
 * venue confirms a floor plan in the spring. So `ticketTypes` sells "a 3m × 2m
 * booth" and `booths` holds the particular one, and the join between them is
 * made by a person on this screen.
 *
 * ── The one place optimistic counting is not good enough ────────────────────
 *
 * Everywhere else in this project, capacity is a counter that two buyers can
 * both pass — the documented response being a refund and an apology. A booth
 * cannot work that way. Two companies who have shipped a stand across an ocean
 * for the same six square metres cannot both be refunded into being happy. So
 * `assignBooth` reads the booth inside a transaction and refuses an occupied
 * one, and this is the only allocation in the product that does.
 *
 * ── What this screen does not do ────────────────────────────────────────────
 *
 * There is no drawn floor plan. A plan is an image with coordinates on it, and
 * an image needs the Storage upload pipeline that `ROADMAP.md` records as
 * blocker 3. A table sorted by zone and number is what an organizer actually
 * works from at the allocation stage; the drawing matters to the exhibitor,
 * and the exhibitor is not looking at this screen.
 */
export default async function BoothSelectionPage() {
  await requireOrganizer();

  const [booths, exhibitors, tickets, orders] = await Promise.all([
    listBooths(),
    listExhibitors(),
    listTicketTypes(),
    listOrders(),
  ]);

  const packages = tickets.filter((t) => t.audience === 'exhibitor');
  const packageName = new Map(packages.map((p) => [p.id, p.name]));
  const packageIds = new Set(packages.map((p) => p.id));

  /**
   * How many booth-shaped things have actually been bought.
   *
   * Counted from order *lines*, not orders: one exhibitor buying a booth and an
   * overflow table is two spaces to allocate from one order. Demo orders are
   * excluded for the same reason they are excluded from every takings figure —
   * no money moved, and allocating floor space against one would be allocating
   * it against nothing.
   */
  const boothSales = orders
    .filter((o) => o.channel !== 'demo' && o.status !== 'cancelled')
    .flatMap((o) => o.ticketTypeIds.filter((id) => packageIds.has(id)));

  const stats = summarise(booths, boothSales.length);

  const label = (status: string) =>
    status === 'assigned'
      ? ('green' as const)
      : status === 'held'
        ? ('orange' as const)
        : status === 'blocked'
          ? ('grey' as const)
          : ('blue' as const);

  return (
    <>
      <PageHeader
        title="2.3 Booth Selection"
        tags={
          <Tag color={stats.available > 0 ? 'green' : 'red'} fill="outline">
            {stats.available} free
          </Tag>
        }
        links={[
          <Link key="t" href="/tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets">
            2.1 Exhibitor Tickets
          </Link>,
          <Link key="m" href="/content/exhibitor-center/exhibitor-manager">
            Exhibitor Manager
          </Link>,
          <Link key="o" href="/tickets/orders-and-transactions/exhibitor-orders">
            Exhibitor Orders
          </Link>,
        ]}
      />

      {booths.length === 0 ? (
        <Banner kind="warning">
          <strong>The floor plan is empty.</strong> Add the spaces the venue has confirmed, below.
          Until then an exhibitor package sells a booth <em>size</em> and nothing records which
          particular booth anybody ends up in.
        </Banner>
      ) : stats.unallocatedSales > 0 ? (
        <Banner kind="warning">
          <strong>
            {stats.unallocatedSales} paid {stats.unallocatedSales === 1 ? 'package has' : 'packages have'}{' '}
            no space allocated.
          </strong>{' '}
          Somebody has bought a booth and does not yet know where it is. That is the number this
          screen exists to drive to zero.
        </Banner>
      ) : (
        <Banner kind="info">
          <strong>Every paid package has a space.</strong> Allocation is transactional — a booth
          already held or assigned to somebody else is refused rather than overwritten, because two
          companies in one space is not a problem a refund solves.
        </Banner>
      )}

      <StatTiles
        tiles={[
          { label: 'Spaces', value: stats.total, sub: `${stats.blocked} blocked` },
          { label: 'Available', value: stats.available, sub: 'sellable now' },
          { label: 'Held', value: stats.held, sub: 'promised, unpaid' },
          { label: 'Assigned', value: stats.assigned, sub: `${boothSales.length} sold` },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The floor</h2>
        <Table
          cols={[
            { key: 'n', label: 'Booth', className: 'cell-sm' },
            { key: 'z', label: 'Zone', className: 'cell-sm' },
            { key: 'p', label: 'Sold as', className: 'cell-md' },
            { key: 'o', label: 'Occupant', className: 'cell-fill' },
            { key: 's', label: 'Status', className: 'cell-sm' },
            { key: 'a', label: '', className: 'cell-sm' },
          ]}
          rows={booths.map((b) => [
            <div key="n">
              <strong>{b.number}</strong>
              <div className="muted" style={{ fontSize: 11 }}>
                {b.size}
              </div>
            </div>,

            <span key="z" className="muted" style={{ fontSize: 12 }}>
              {b.zone || '—'}
            </span>,

            <span key="p" style={{ fontSize: 12 }}>
              {b.ticketTypeId ? (
                (packageName.get(b.ticketTypeId) ?? (
                  /*
                    A tier id that no longer resolves. Named rather than blanked:
                    a booth pointing at a deleted package is a real thing to fix,
                    and an empty cell says nothing about it.
                  */
                  <span className="muted">
                    unknown tier <code>{b.ticketTypeId}</code>
                  </span>
                ))
              ) : (
                <span className="muted">—</span>
              )}
            </span>,

            <div key="o">
              {b.exhibitorName ? (
                <>
                  <Link href={`/content/exhibitor-center/exhibitor-manager?edit=${b.exhibitorId}`}>
                    {b.exhibitorName}
                  </Link>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {b.assignedBy ? `by ${b.assignedBy}` : ''}
                    {b.assignedAt ? ` · ${b.assignedAt.slice(0, 10)}` : ''}
                    {b.orderId ? ` · order ${b.orderId.slice(0, 12)}` : ' · no order'}
                  </div>
                </>
              ) : b.note ? (
                <span className="muted">{b.note}</span>
              ) : (
                <span className="muted">—</span>
              )}
            </div>,

            <Tag key="s" small color={label(b.status)}>
              {b.status}
            </Tag>,

            <div key="a" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {b.exhibitorId ? (
                <form action={releaseBoothAction}>
                  <input type="hidden" name="boothId" value={b.id} />
                  <button type="submit" className="linkish">
                    Release
                  </button>
                </form>
              ) : (
                <form action={toggleBoothBlockedAction}>
                  <input type="hidden" name="boothId" value={b.id} />
                  <input type="hidden" name="blocked" value={b.status === 'blocked' ? '0' : '1'} />
                  <input
                    type="hidden"
                    name="note"
                    value={b.status === 'blocked' ? '' : 'Blocked from the dashboard'}
                  />
                  <button type="submit" className="linkish">
                    {b.status === 'blocked' ? 'Unblock' : 'Block'}
                  </button>
                </form>
              )}
            </div>,
          ])}
          empty="No booths yet. Add the first one below."
        />
      </Panel>

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          marginTop: 16,
        }}
      >
        <Panel>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Allocate a space</h2>
          <AssignBoothForm booths={booths} exhibitors={exhibitors} />
        </Panel>

        <Panel>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Add a space</h2>
          <AddBoothForm packages={packages.map((p) => ({ id: p.id, name: p.name }))} />
        </Panel>
      </div>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No drawn floor plan.</strong> Whova&rsquo;s version is an uploaded image with
            clickable regions. That needs the Storage upload pipeline{' '}
            <code>ROADMAP.md</code> records as blocker 3, plus coordinates per booth — the model has
            room for them and nothing writes them.
          </li>
          <li>
            <strong>Exhibitors cannot pick their own space.</strong> In Whova a booth is chosen at
            checkout, which means inventory has to be held across the Stripe redirect. Nothing here
            can hold anything across that redirect, which is the same reason ticket capacity is a
            counter — so allocation happens after the sale, by a person.
          </li>
          <li>
            <strong>Nothing links a purchase to a booth automatically.</strong> The order id field
            above is typed in. Doing it at fulfilment means the webhook choosing a space, and a
            webhook choosing a corner booth for whoever paid first is not how a floor is sold.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
