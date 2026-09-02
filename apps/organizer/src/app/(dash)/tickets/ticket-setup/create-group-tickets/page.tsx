import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listOrders, money } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Setup › Create Group Tickets.
 *
 * Group registration is not missing here — it is built, and it is built the way
 * a B2B conference actually needs it. A bank sending four people does not buy
 * four tickets on a card; procurement raises a purchase order and finance pays
 * an invoice. `apps/web/src/app/tickets/invoice` collects a seat list plus a
 * billing contact and a PO, `raiseInvoice()` turns it into one Stripe invoice
 * with a line per seat, and fulfilment happens on `invoice.paid` — never when
 * the invoice is raised.
 *
 * ── The card path takes a group too, as of 2026-08-31 ───────────────────────
 *
 * The Checkout session used to build one line item with `quantity: 1`, so three
 * colleagues on one card were three separate purchases. `/tickets` now asks for
 * a quantity and then for a name, an address and a ticket type per seat, and
 * groups them into Stripe line items with real quantities. The order it writes
 * is the *same shape* an invoice writes — one order, one `OrderLine` per seat —
 * which is why the table below counts both without knowing the difference.
 *
 * The reason a quantity had to bring a form with it is worth keeping: a
 * registration is keyed by email address, so three seats need three addresses
 * or the buyer pays three times for one badge.
 *
 * ── The one invariant worth repeating on this screen ────────────────────────
 *
 * An invoice is **one order with several `items`**, not one order per seat. Any
 * per-seat arithmetic that starts from a count of orders is wrong for exactly
 * these purchases, which are also the largest ones.
 *
 * What Whova has and this does not is a *discounted bundle* — "buy 5, pay for
 * 4" as a purchasable product. That is a genuine gap and is described below
 * rather than implied by a form.
 */
export default async function CreateGroupTicketsPage() {
  await requireOrganizer();
  const orders = await listOrders();

  /**
   * A group order is either an invoice or a card purchase with more than one
   * seat on it — the second half is new, and the screen would have been quietly
   * wrong without it: multi-seat card checkout writes `channel: 'checkout'`,
   * so filtering on the channel alone would have shown four colleagues on one
   * card as no group order at all.
   */
  const groups = orders.filter((o) => o.channel === 'invoice' || o.seatCount > 1);
  const seats = groups.reduce((n, o) => n + o.seatCount, 0);
  const paid = groups.filter((o) => o.status === 'paid');
  /**
   * Outstanding money, which is an invoice thing and not a card thing. A
   * `pending` card order is an abandoned cart — nobody owes anything on it and
   * counting it here would inflate what finance is chasing. Abandoned
   * Registration is the screen that wants those.
   */
  const unpaid = groups.filter((o) => o.status === 'pending' && o.channel === 'invoice');
  const currency = groups[0]?.currency ?? 'usd';

  return (
    <>
      <PageHeader
        title="Create Group Tickets"
        tags={<Tag color="green" fill="outline">Invoice and card groups are live</Tag>}
        links={[
          <Link key="c" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
          <Link key="o" href={ROUTES.attendeeOrders}>
            Attendee Orders
          </Link>,
          <Link key="d" href={ROUTES.discountCodes}>
            Discount Codes
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Group orders', value: groups.length, sub: 'invoiced or multi-seat, all statuses' },
          { label: 'Seats on them', value: seats, sub: 'one order line each' },
          { label: 'Paid', value: paid.length, sub: 'fulfilled on payment' },
          {
            label: 'Awaiting payment',
            value: money(
              unpaid.reduce((n, o) => n + o.totalCents, 0),
              currency,
            ),
            sub: `${unpaid.length} invoices`,
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Group orders</h2>
        <Table
          cols={[
            { key: 'c', label: 'Company', className: 'cell-md' },
            { key: 's', label: 'Seats', className: 'cell-sm' },
            { key: 't', label: 'Total', className: 'cell-sm' },
            { key: 'st', label: 'Status', className: 'cell-fill' },
          ]}
          rows={groups.slice(0, 25).map((o) => [
            <span key="c">
              {o.companyName || o.buyerName || o.email}
              {o.poNumber ? <span className="muted"> · PO {o.poNumber}</span> : null}
            </span>,
            o.seatCount,
            money(o.totalCents, o.currency),
            <span key="st">
              <Tag color={o.status === 'paid' ? 'green' : o.status === 'pending' ? 'orange' : 'red'}>
                {o.status.replace('_', ' ')}
              </Tag>
              {o.hostedInvoiceUrl ? (
                <>
                  {' '}
                  <a href={o.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                    invoice ↗
                  </a>
                </>
              ) : null}
            </span>,
          ])}
          empty="No group registrations yet. They arrive through the invoice form and through multi-seat checkout on the website."
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          Both forms buyers use are on the marketing site (<code>apps/web</code>, port 3200), not in
          this dashboard: <code>/tickets/invoice</code> for a PO and net terms,{' '}
          <code>/tickets</code> for a card. Seats come from <code>items</code> on the order
          document, not from a count of orders — six people are one row here and six registrations
          at the door.
        </p>
      </Panel>

      <Banner kind="info">
        <strong>Multi-seat card checkout is live.</strong> <code>/tickets</code> asks how many
        tickets and then asks for a name, an address and a ticket type per seat — the same three
        fields the invoice form has always posted, read by the same parser. Seats sharing a tier
        become one Stripe line item with a real quantity, so three colleagues on one card are one
        payment and one order with three <code>items</code>, and a booth plus two extra passes is
        one purchase rather than three. Ten seats a card; past that, the invoice form.
      </Banner>

      <Banner kind="info">
        <strong>Group discounts are Stripe promotion codes today.</strong> Checkout has{' '}
        <code>allow_promotion_codes</code> on, so a code created in Stripe applies to a group
        purchase without any coupon table in this repo. What that cannot do is price a bundle
        automatically —{' '}
        <Link href={ROUTES.discountCodes}>Discount Codes</Link> explains the split.
      </Banner>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No bundle product.</strong> Whova sells &ldquo;Team of 5&rdquo; as a ticket type
            with its own price and a seat count. Ours prices per seat and relies on a promotion code
            for the discount, which means the discount is a Stripe object nobody sees on this
            screen.
          </li>
          <li>
            <strong>No group organizer portal.</strong> The buyer cannot come back later to fill in
            a seat they left blank or swap a colleague — the seat list is fixed when the invoice is
            raised or the card is charged, and a change is an email to the organizers.
          </li>
          <li>
            <strong>Creating the invoice from here.</strong> It is raised from the public form. A
            dashboard-side &ldquo;invoice this company&rdquo; action is a real gap and a small one,
            since <code>raiseInvoice()</code> already exists.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
