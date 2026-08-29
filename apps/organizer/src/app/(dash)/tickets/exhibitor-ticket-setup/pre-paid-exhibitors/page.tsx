import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listBooths } from '@/lib/booths';
import { listOrders, listTicketTypes, money } from '@/lib/commerce';
import { listExhibitors } from '@/lib/exhibitors';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';
import { ManualOrderForm } from '../../manual-order-form';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › Pre-paid Exhibitors.
 *
 * ── The same write as 2.6, and a genuinely different situation ──────────────
 *
 * 2.6 Offline Payment records money that arrived by a route this system cannot
 * see. This screen records exhibitors who were **never going to buy through the
 * catalogue at all**: a package agreed in a contract signed before ticketing
 * existed, a community partner comped, a media partner exchanging a booth for
 * coverage. The distinction is not technical — the write is identical, and
 * shares one server action for exactly that reason — but the reason typed into
 * the note is different, and the note is the audit.
 *
 * ── What this screen adds over 2.6: the reconciliation ──────────────────────
 *
 * A pre-paid exhibitor is only half done when the order exists. They also need
 * an `exhibitors` record so the app lists them, and a booth so they know where
 * to stand. Nothing links those automatically — deliberately, because a webhook
 * choosing a corner booth for whoever paid first is not how a floor is sold —
 * so the table below is the reconciliation: which exhibitors have an order,
 * which have a space, and which have neither.
 */
export default async function PrePaidExhibitorsPage() {
  await requireOrganizer();

  const [tickets, orders, exhibitors, booths] = await Promise.all([
    listTicketTypes(),
    listOrders(),
    listExhibitors(),
    listBooths(),
  ]);

  const packages = tickets.filter((t) => t.audience === 'exhibitor');
  const packageIds = new Set(packages.map((p) => p.id));

  const exhibitorOrders = orders.filter(
    (o) => o.channel !== 'demo' && o.ticketTypeIds.some((id) => packageIds.has(id)),
  );

  /**
   * Match an exhibitor to an order by contact email, folded to lower case.
   *
   * The only join available, and an imperfect one — a booth bought by a
   * procurement address and staffed by a marketing contact will not match. That
   * is a real gap rather than a bug in this query, and the table names it as
   * "no order found" rather than implying the exhibitor has not paid.
   */
  const orderByEmail = new Map(exhibitorOrders.map((o) => [o.email.toLowerCase(), o]));
  const boothByExhibitor = new Map(
    booths.filter((b) => b.exhibitorId).map((b) => [b.exhibitorId as string, b]),
  );

  const rows = exhibitors.map((x) => ({
    exhibitor: x,
    order: x.contactEmail ? orderByEmail.get(x.contactEmail.toLowerCase()) : undefined,
    booth: boothByExhibitor.get(x.id),
  }));

  const withOrder = rows.filter((r) => r.order).length;
  const withBooth = rows.filter((r) => r.booth).length;
  const compedValue = exhibitorOrders
    .filter((o) => o.totalCents === 0)
    .reduce((n) => n + 1, 0);

  return (
    <>
      <PageHeader
        title="Pre-paid Exhibitors"
        tags={
          <Tag color={rows.length === withOrder ? 'green' : 'orange'} fill="outline">
            {withOrder}/{rows.length} reconciled
          </Tag>
        }
        links={[
          <Link key="m" href="/content/exhibitor-center/exhibitor-manager">
            Exhibitor Manager
          </Link>,
          <Link key="b" href="/tickets/exhibitor-ticket-setup/2-3-booth-selection">
            2.3 Booth Selection
          </Link>,
          <Link key="o" href="/tickets/exhibitor-ticket-setup/2-6-offline-payment">
            2.6 Offline Payment
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>A pre-paid exhibitor needs three things, and this screen tracks all three.</strong>{' '}
        An order, so the ledger and the badge exist. An <code>exhibitors</code> record, so the app
        lists them. A booth, so they know where to stand. None of the three creates the others —
        the table below is where a missing one shows up rather than being discovered at load-in.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Exhibitors', value: rows.length, sub: 'in the manager' },
          { label: 'With an order', value: withOrder, sub: 'matched by contact email' },
          { label: 'With a booth', value: withBooth, sub: 'allocated a space' },
          { label: 'Comped', value: compedValue, sub: 'recorded at zero' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Reconciliation</h2>
        <Table
          cols={[
            { key: 'x', label: 'Exhibitor', className: 'cell-md' },
            { key: 'o', label: 'Order', className: 'cell-md' },
            { key: 'b', label: 'Booth', className: 'cell-sm' },
            { key: 'p', label: 'Passes', className: 'cell-sm' },
            { key: 's', label: 'What is missing', className: 'cell-fill' },
          ]}
          rows={rows.map((r) => {
            const missing: string[] = [];
            if (!r.order) missing.push('no order');
            if (!r.booth) missing.push('no booth');
            if (r.exhibitor.overAllocated) missing.push('passes over-claimed');

            return [
              <div key="x">
                <Link href={`/content/exhibitor-center/exhibitor-manager?edit=${r.exhibitor.id}`}>
                  {r.exhibitor.name}
                </Link>
                <div className="muted" style={{ fontSize: 11 }}>
                  {r.exhibitor.contactEmail || <em>no contact email</em>} · {r.exhibitor.status}
                </div>
              </div>,

              r.order ? (
                <span key="o">
                  {r.order.totalCents === 0 ? (
                    <Tag color="purple" small>
                      comp
                    </Tag>
                  ) : (
                    money(r.order.netCents, r.order.currency)
                  )}
                  <div className="muted" style={{ fontSize: 11 }}>
                    {r.order.channel}
                    {r.order.markedPaidBy ? ` · ${r.order.markedPaidBy}` : ''}
                  </div>
                </span>
              ) : (
                <span key="o" className="muted">
                  —
                </span>
              ),

              r.booth ? (
                <Tag key="b" color={r.booth.status === 'assigned' ? 'green' : 'orange'} small>
                  {r.booth.number}
                </Tag>
              ) : (
                <span key="b" className="muted">
                  —
                </span>
              ),

              <span key="p" style={{ fontSize: 12 }}>
                {r.exhibitor.passesUsed}
                {typeof r.exhibitor.passesAllocated === 'number'
                  ? ` / ${r.exhibitor.passesAllocated}`
                  : ''}
              </span>,

              missing.length === 0 ? (
                <Tag key="s" color="green" small>
                  complete
                </Tag>
              ) : (
                <span key="s" className="muted" style={{ fontSize: 12 }}>
                  {missing.join(' · ')}
                </span>
              ),
            ];
          })}
          empty="No exhibitors yet. Add them in Exhibitor Manager, then record what they paid below."
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          Orders match on <strong>contact email</strong>. A package bought by a procurement address
          and staffed by a marketing contact will read as &ldquo;no order&rdquo; here — that is a
          missing link in the model rather than an unpaid exhibitor, and it is why this column says
          what it matched on.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Record a pre-paid or comped package</h2>
        <p className="body-2" style={{ marginTop: 0 }}>
          This writes exactly what a card purchase writes: a registration with a claim code, an
          order in the ledger, and an incremented sold counter. Enter <strong>0</strong> for a comp
          — a comped exhibitor gets a real badge, and a second code path to one is a second way for
          somebody to be turned away at the door.
        </p>
        <ManualOrderForm
          packages={packages.map((p) => ({
            id: p.id,
            name: p.name,
            priceCents: p.priceCents,
            currency: p.currency,
          }))}
          audienceNoun="exhibitor"
          notePlaceholder="Contract KGC-27-014, signed Nov 2026"
          compHint="Enter 0 for a comped or media-partner booth — it produces a real ticket."
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>An order does not create the exhibitor record.</strong> The two collections
            have no link. Creating one at fulfilment would mean the webhook inventing a company
            profile from a billing name, which is worse than an organizer typing it.
          </li>
          <li>
            <strong>Staff passes are not issued from here.</strong> Each package names a pass count
            in its inclusion list and nothing enforces it. Issuing them means one manual order per
            person, which works but does not scale past a handful — a bulk path is the obvious next
            piece.
          </li>
          <li>
            <strong>No exhibitor self-service portal.</strong> Whova sends exhibitors a personal
            link to complete their own profile, upload a logo and list booth staff. That needs the
            capability-token pattern (which exists, for order pages) plus Storage uploads (which do
            not).
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
