import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listOrders, money } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Setup › 1.6 Abandoned Registration.
 *
 * ── This one is real, and the reason is worth recording ─────────────────────
 *
 * Stripe emits `checkout.session.expired` when a Checkout session is left
 * unpaid (24 hours by default), and the webhook in `apps/web` already handles
 * it: `cancelRegistrationByOrder({ reason: 'payment_failed' })` moves the order
 * to `cancelled`, so an abandonment stops saying `pending` for ever. Those
 * orders are visible in Attendee Orders under the `cancelled` filter. This
 * screen is that same set, framed as what it is.
 *
 * ── The catch that decides what can be built on top ─────────────────────────
 *
 * The card path writes **no order at checkout time** — an order document is
 * created at fulfilment, from the webhook. So when a session expires there is
 * usually nothing to update, and `cancelRegistrationByOrder` takes its
 * not-found branch: it writes the order anyway, deliberately, so the finance
 * trail is complete, with `email: ''` and `totalCents: 0`.
 *
 * That is why the rows below are mostly blank, and it is not a bug — it is the
 * consequence of never writing a buyer's details until they have paid. It does
 * mean recovery email cannot be sent from our own data: the address exists only
 * on the Stripe session. Whova can chase abandoners because Whova owns the form
 * from the first keystroke.
 */
export default async function AbandonedRegistrationPage() {
  await requireOrganizer();
  const orders = await listOrders();

  const abandoned = orders.filter((o) => o.status === 'cancelled');
  const withEmail = abandoned.filter((o) => o.email);
  const orphans = abandoned.length - withEmail.length;
  const pendingInvoices = orders.filter((o) => o.status === 'pending' && o.channel === 'invoice');

  return (
    <>
      <PageHeader
        title="1.6 Abandoned Registration"
        tags={<Tag color={abandoned.length > 0 ? 'orange' : 'grey'} fill="outline">{abandoned.length} cancelled</Tag>}
        links={[
          <Link key="o" href={`${ROUTES.attendeeOrders}?status=cancelled`}>
            Attendee Orders (cancelled)
          </Link>,
          <Link key="t" href={ROUTES.transactionHistory}>
            Transaction History
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Abandoned', value: abandoned.length, sub: 'expired or failed at Stripe' },
          {
            label: 'With a contactable address',
            value: withEmail.length,
            sub: `${orphans} placeholder${orphans === 1 ? '' : 's'} with no email`,
          },
          {
            label: 'Invoices still unpaid',
            value: pendingInvoices.length,
            sub: money(pendingInvoices.reduce((n, o) => n + o.totalCents, 0), pendingInvoices[0]?.currency ?? 'usd'),
          },
        ]}
      />

      <Banner kind="info">
        <strong>Abandonment is recorded, not recoverable.</strong> Stripe fires{' '}
        <code>checkout.session.expired</code> and the webhook marks the order <code>cancelled</code>{' '}
        — so nothing sits at <code>pending</code> for ever. But the card path writes no order until
        payment succeeds, so an expired session usually leaves a placeholder with no email and no
        amount. The buyer&rsquo;s address is on the Stripe session, not in this database.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Cancelled and expired orders</h2>
        <Table
          cols={[
            { key: 'e', label: 'Buyer', className: 'cell-md' },
            { key: 'c', label: 'Channel', className: 'cell-sm' },
            { key: 'a', label: 'Amount', className: 'cell-sm' },
            { key: 'w', label: 'Marked cancelled', className: 'cell-fill' },
          ]}
          rows={abandoned.slice(0, 25).map((o) => [
            o.email || <span key="e" className="muted">no address recorded</span>,
            o.channel,
            o.totalCents === 0 ? <span key="a" className="muted">—</span> : money(o.totalCents, o.currency),
            <span key="w">
              {o.refundedAt ? o.refundedAt.slice(0, 16).replace('T', ' ') : '—'}
              <div className="muted" style={{ fontSize: 12 }}>
                Stripe session <code>{o.externalId || '—'}</code>
              </div>
            </span>,
          ])}
          empty="Nothing abandoned. Either nobody has left a checkout open past its expiry, or no live traffic has reached Stripe yet."
        />
        {/*
          `refundedAt` is doing double duty here: `cancelRegistrationByOrder`
          stamps it on every terminal outcome, refund and expiry alike, so on
          these rows it means "when we found out", not "when money went back".
          Naming that is cheaper than a migration, and much cheaper than someone
          reading the column as a refund date in a finance review.
        */}
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          ⚠️ The timestamp comes from <code>refundedAt</code>, which the cancellation path stamps for
          every terminal outcome. On these rows it means <em>when Stripe told us</em>, not that
          anything was refunded — no money ever moved on an abandoned checkout.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The one recoverable case</h2>
        <p className="body-2">
          Unpaid <strong>invoices</strong> are different, and they are the abandonment worth
          chasing. An invoice writes its order at the moment it is raised, with the company, the
          billing contact, the PO number and the seat list — so there is a real person to email and a
          real amount to ask for. Those rows are in{' '}
          <Link href={ROUTES.attendeeOrders}>Attendee Orders</Link> as <code>pending</code> with the{' '}
          <code>invoice</code> channel, and Stripe sends its own reminders on a schedule set in the
          dashboard.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No recovery email.</strong> The sender exists and works; the addresses do not.
            Getting them would mean either capturing the email before redirecting to Stripe — which
            changes what this project stores about people who never buy — or reading expired
            sessions back from the Stripe API on a schedule.
          </li>
          <li>
            <strong>No funnel.</strong> Whova reports viewed → started → abandoned → completed. The
            first two are page analytics, and there is no analytics of any kind on the website.
          </li>
          <li>
            <strong>No cart to resume.</strong> A Checkout session cannot be reopened after it
            expires; recovery means a fresh session, which is a fresh link.
          </li>
        </ul>
      </Panel>
    </>
  );
}
