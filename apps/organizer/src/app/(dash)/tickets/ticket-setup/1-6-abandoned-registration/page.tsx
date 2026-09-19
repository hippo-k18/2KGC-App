import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listOrders, money } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

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
 * A **single-seat** card purchase writes no order at checkout time — the order
 * document is created at fulfilment, from the webhook. So when one of those
 * expires there is nothing to update, and `cancelRegistrationByOrder` takes its
 * not-found branch: it writes the order anyway, deliberately, so the finance
 * trail is complete, with `email: ''` and `totalCents: 0`.
 *
 * ⚠️ A **multi-seat** cart is the exception, as of 2026-08-31. It writes a
 * `pending` order before the buyer is sent to Stripe, because the seat list has
 * to be recorded somewhere the webhook can read it and a Stripe metadata value
 * caps at 500 characters. So an abandoned group checkout arrives here with the
 * buyer's address, the seat names and the amount they were about to pay —
 * which is the only case on this screen that is actually followable up.
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
        info={
          <>
            <strong>Checkouts that were started and not paid</strong>
            <p>
              A single-seat card checkout that expires leaves no email address, so most of these
              cannot be followed up. Recovery emails are not available yet.
            </p>
          </>
        }
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
          { label: 'Abandoned', value: abandoned.length, sub: 'expired or failed at checkout' },
          {
            label: 'With an email address',
            value: withEmail.length,
            sub: `${orphans} with no email`,
          },
          {
            label: 'Invoices still unpaid',
            value: pendingInvoices.length,
            sub: money(pendingInvoices.reduce((n, o) => n + o.totalCents, 0), pendingInvoices[0]?.currency ?? 'usd'),
          },
        ]}
      />

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
            o.totalCents === 0 ? <span key="a" className="muted">none</span> : money(o.totalCents, o.currency),
            <span key="w">
              {o.refundedAt ? o.refundedAt.slice(0, 16).replace('T', ' ') : ''}
              {o.externalId ? (
                <div className="muted" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
                  Stripe reference {o.externalId}
                </div>
              ) : null}
            </span>,
          ])}
          empty={<NotInputted what="abandoned checkouts" compact />}
        />
        {/*
          `refundedAt` is doing double duty here: `cancelRegistrationByOrder`
          stamps it on every terminal outcome, refund and expiry alike, so on
          these rows it means "when we found out", not "when money went back".
          Naming that is cheaper than a migration, and much cheaper than someone
          reading the column as a refund date in a finance review.
        */}
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          No money moved on these checkouts. The time is when the checkout expired or failed.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Unpaid invoices</h2>
        <p className="body-2">
          Unpaid invoices have a billing contact and an amount, so they can be followed up. Find
          them in <Link href={ROUTES.attendeeOrders}>Attendee Orders</Link> as pending invoice
          orders. Stripe sends its own reminders.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
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
      </GapPanel>
    </>
  );
}
