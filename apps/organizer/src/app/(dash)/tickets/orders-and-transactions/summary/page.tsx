import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { money, salesSummary } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { stripeEnabled, stripeIsLive } from '@/lib/stripe';
import { Banner, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Orders and Transactions › Summary.
 *
 * The screen that answers "how are we doing", and the first one an organizer
 * opens on a Monday. Whova puts revenue, tickets sold and a sales-over-time
 * chart here; this reproduces the first two faithfully and renders the third as
 * a bar strip rather than a charting library, because one dependency for one
 * sparkline on one screen is a poor trade.
 *
 * ── Net leads, not gross ────────────────────────────────────────────────────
 *
 * Whova's tile says "Revenue" and shows gross. That is the number that flatters
 * and the wrong one to plan on: it counts money that has already gone back out
 * in refunds. Net leads here and gross sits beside it, which is a deliberate
 * departure and the reason it is labelled "Net revenue" rather than "Revenue" —
 * a differently-computed number under the same name is how two people end up
 * quoting different figures in the same meeting.
 *
 * ── Every figure comes from `orders` ────────────────────────────────────────
 *
 * Nothing here multiplies a price list by a headcount. That number would be
 * wrong the moment a discount code, a tax line or a partial refund existed —
 * and wrong *plausibly*, which is worse than obviously broken.
 */
export default async function OrdersSummaryPage() {
  await requireOrganizer();
  const s = await salesSummary();

  const peak = Math.max(1, ...s.daily.map((d) => d.netCents));

  return (
    <>
      <PageHeader
        title="Summary"
        tags={
          stripeEnabled() ? (
            <Tag color={stripeIsLive() ? 'green' : 'orange'} fill="outline">
              {stripeIsLive() ? 'Stripe live' : 'Stripe test mode'}
            </Tag>
          ) : (
            <Tag color="grey">No Stripe key</Tag>
          )
        }
        links={[
          <Link key="orders" href={ROUTES.attendeeOrders}>
            Attendee Orders
          </Link>,
          <Link key="tx" href={ROUTES.transactionHistory}>
            Transaction History
          </Link>,
          <Link key="tickets" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
        ]}
      />

      {s.demoOrders > 0 && (
        <Banner kind="warning">
          <strong>{s.demoOrders} test {s.demoOrders === 1 ? 'purchase' : 'purchases'}</strong> are
          excluded from every figure below. They were made with no payment processor configured, so
          no money was taken — but they wrote real registrations, and those attendees appear on the
          check-in list.
        </Banner>
      )}

      <StatTiles
        tiles={[
          {
            label: 'Net revenue',
            value: money(s.netCents, s.currency),
            sub: `${money(s.grossCents, s.currency)} gross · ${money(s.refundedCents, s.currency)} refunded`,
          },
          {
            label: 'Tickets sold',
            value: s.ticketsSold,
            sub: `${s.paidOrders} ${s.paidOrders === 1 ? 'order' : 'orders'}`,
          },
          {
            label: 'Refunded',
            value: s.refundedOrders,
            sub: s.refundedOrders === 0 ? 'none yet' : `${money(s.refundedCents, s.currency)} back`,
          },
          {
            label: 'Outstanding',
            value: money(s.outstandingCents, s.currency),
            sub: `${s.outstandingInvoices} unpaid ${s.outstandingInvoices === 1 ? 'invoice' : 'invoices'}`,
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Sales by ticket type</h2>
        <Table
          cols={[
            { key: 'name', label: 'Ticket', className: 'cell-fill' },
            { key: 'sold', label: 'Sold', className: 'cell-sm' },
            { key: 'refunded', label: 'Refunded', className: 'cell-sm' },
            { key: 'gross', label: 'Gross', className: 'cell-sm' },
            { key: 'net', label: 'Net', className: 'cell-sm' },
          ]}
          rows={s.byTier.map((t) => [
            t.name,
            t.sold,
            t.refunded === 0 ? <span className="muted">—</span> : t.refunded,
            <span key="g" className="muted">
              {money(t.grossCents, s.currency)}
            </span>,
            <strong key="n">{money(t.netCents, s.currency)}</strong>,
          ])}
          empty="No orders yet. Sales appear here the moment the first ticket is bought."
        />
        {/*
          Said explicitly because the arithmetic is genuinely approximate on
          multi-seat orders, and an organizer who spots a rounding discrepancy
          should find the reason here rather than assume the page is broken.
        */}
        {s.byTier.length > 0 && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
            An order covering several ticket types splits its total evenly between them, so
            per-tier figures can differ from the ledger by a few cents. The totals above are exact.
          </p>
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Net sales by day</h2>
        {s.daily.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            Nothing to plot yet.
          </p>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120, marginTop: 8 }}>
            {s.daily.map((d) => (
              <div
                key={d.date}
                title={`${d.date} — ${money(d.netCents, s.currency)} across ${d.orders} ${d.orders === 1 ? 'order' : 'orders'}`}
                style={{
                  background: 'var(--link)',
                  // A floor of 2px so a day with one small sale is still a
                  // visible mark rather than an invisible gap in the series.
                  height: `${Math.max(2, (d.netCents / peak) * 100)}%`,
                  flex: 1,
                  minWidth: 4,
                  borderRadius: '2px 2px 0 0',
                }}
              />
            ))}
          </div>
        )}
        {s.daily.length > 0 && (
          <div
            className="muted"
            style={{ display: 'flex', fontSize: 11, justifyContent: 'space-between', marginTop: 6 }}
          >
            <span>{s.daily[0].date}</span>
            <span>{s.daily[s.daily.length - 1].date}</span>
          </div>
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where the money went</h2>
        <Table
          cols={[
            { key: 'k', label: 'Line', className: 'cell-fill' },
            { key: 'v', label: 'Amount', className: 'cell-sm' },
          ]}
          rows={[
            ['Gross charged', money(s.grossCents, s.currency)],
            [
              'Discounts applied',
              s.discountCents === 0 ? <span className="muted">—</span> : `−${money(s.discountCents, s.currency)}`,
            ],
            [
              'Tax collected',
              s.taxCents === 0 ? (
                <span className="muted">— not enabled in Stripe</span>
              ) : (
                money(s.taxCents, s.currency)
              ),
            ],
            [
              'Refunded',
              s.refundedCents === 0 ? <span className="muted">—</span> : `−${money(s.refundedCents, s.currency)}`,
            ],
            [<strong key="k">Net</strong>, <strong key="v">{money(s.netCents, s.currency)}</strong>],
          ]}
        />
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
          Stripe&rsquo;s processing fees are not deducted here — they are charged against the payout,
          not the order, and only Stripe knows them. Expect roughly 2.9% + $0.30 per transaction.
        </p>
      </Panel>
    </>
  );
}
