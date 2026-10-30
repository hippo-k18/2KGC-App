import Link from 'next/link';
import { hubspotPersonKey } from '@kgc/scripts/src/lib/hubspot-sync';
import { currentAccess, requireOrganizer } from '@/lib/auth';
import { planReminders, type ReminderPlan } from '@/lib/checkout-reminder';
import { reminderCell } from '@/lib/checkout-reminder-core';
import { isAbandoned, listOrders, money } from '@/lib/commerce';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';
import { stampOfInstant } from '@/lib/time';
import { Banner, GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';
import { ReminderForm } from './reminder-form';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Setup › 1.6 Abandoned Registration.
 *
 * ── This one is real, and the reason is worth recording ─────────────────────
 *
 * Stripe emits `checkout.session.expired` when a Checkout session is left
 * unpaid (24 hours by default), and the webhook in `apps/web` already handles
 * it: `cancelUnpaidOrder` moves a pending order to `cancelled`, so an
 * abandonment stops saying `pending` for ever. A disputed sale is `cancelled`
 * too, and is left out here (`isAbandoned`). Those
 * orders are visible in Attendee Orders under the "Not completed" filter, which
 * is what the dashboard calls an unpaid `cancelled` order (T357). This screen is
 * that same set, framed as what it is.
 *
 * ── The catch that decides what can be built on top ─────────────────────────
 *
 * A **single-seat** card purchase writes no order at checkout time — the order
 * document is created at fulfilment, from the webhook. So when one of those
 * expires there is nothing to update, and `cancelUnpaidOrder` writes the order
 * anyway, deliberately, so the finance
 * trail is complete, with `email: ''` and `totalCents: 0`.
 *
 * ⚠️ A **multi-seat** cart is the exception, as of 2026-08-31. It writes a
 * `pending` order before the buyer is sent to Stripe, because the seat list has
 * to be recorded somewhere the webhook can read it and a Stripe metadata value
 * caps at 500 characters. So an abandoned group checkout arrives here with the
 * buyer's address, the seat names and the amount they were about to pay —
 * which is the only case on this screen that is actually followable up.
 *
 * Since T257 the stub also carries the address from the Stripe session, so
 * most rows have somebody to write to.
 *
 * ── The reminder (T363) ─────────────────────────────────────────────────────
 *
 * One automatic email to each person who left, off until an owner switches it
 * on. The rules are in `checkout-reminder-core.ts`; the panel below edits the
 * settings, sends a test and shows who is next and who is skipped.
 */
export default async function AbandonedRegistrationPage() {
  await requireOrganizer();
  const access = await currentAccess();
  const isOwner = Boolean(access?.roles.includes('owner'));
  const orders = await listOrders();
  let plan: ReminderPlan | null = null;
  try {
    plan = await planReminders();
  } catch (err) {
    recordError('checkout-reminder.plan', err);
  }

  const abandoned = orders.filter(isAbandoned);
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
              The payment page closes after 60 minutes. You can send each person one automatic
              reminder email, set up below.
            </p>
          </>
        }
        tags={<Tag color={abandoned.length > 0 ? 'orange' : 'grey'} fill="outline">{abandoned.length} not completed</Tag>}
        links={[
          <Link key="o" href={`${ROUTES.attendeeOrders}?status=not_completed`}>
            Attendee Orders (not completed)
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

      <ReminderPanel plan={plan} isOwner={isOwner} ownerEmail={access?.email ?? ''} />

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Orders not completed</h2>
        <Table
          cols={[
            { key: 'e', label: 'Buyer', className: 'cell-md' },
            { key: 'c', label: 'Channel', className: 'cell-sm' },
            { key: 'a', label: 'Amount', className: 'cell-sm' },
            { key: 'w', label: 'Closed', className: 'cell-fill' },
            { key: 'r', label: 'Reminded', className: 'cell-md' },
          ]}
          rows={abandoned.slice(0, 25).map((o) => [
            o.email || <span key="e" className="muted">no address recorded</span>,
            o.channel,
            o.totalCents === 0 ? <span key="a" className="muted">none</span> : money(o.totalCents, o.currency),
            <span key="w">
              {o.refundedAt ? stampOfInstant(o.refundedAt) : closedAt(o.id, plan)}
              {o.externalId ? (
                <div className="muted" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
                  Stripe reference {o.externalId}
                </div>
              ) : null}
            </span>,
            <RemindedCell key="r" orderId={o.id} email={o.email} plan={plan} />,
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
          No money moved on these orders. The time is when the checkout expired or failed, or the invoice was voided.
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

function RemindedCell({ orderId, email, plan }: { orderId: string; email: string; plan: ReminderPlan | null }) {
  if (!email || !plan) return <span className="muted">None</span>;
  const cell = reminderCell(orderId, plan.records.get(hubspotPersonKey(email)));
  if (!cell) return <span className="muted">None</span>;
  return (
    <span style={{ fontSize: 13 }}>
      {cell.text}
      {cell.at ? <div className="muted" style={{ fontSize: 12 }}>{stampOfInstant(new Date(cell.at).toISOString())}</div> : null}
    </span>
  );
}

/**
 * The reminder: settings (owners), then who is next and who is skipped, from
 * the same `planReminders()` the timer runs, so the screen cannot promise a
 * mail the run would not send.
 */
function ReminderPanel({ plan, isOwner, ownerEmail }: { plan: ReminderPlan | null; isOwner: boolean; ownerEmail: string }) {
  if (!plan) {
    return (
      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Reminder email</h2>
        <Banner kind="danger">The reminder settings could not be read just now. Reload the page to try again.</Banner>
      </Panel>
    );
  }
  const { settings, rows } = plan;
  const next = rows.filter((r) => r.decision.kind === 'wait' || r.decision.kind === 'send');
  const skipped = rows.filter((r) => r.decision.kind === 'skip');
  const at = (ms: number) => stampOfInstant(new Date(ms).toISOString());

  return (
    <Panel>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>
        Reminder email{' '}
        <Tag color={settings.enabled ? 'green' : 'grey'} small>
          {settings.enabled ? 'On' : 'Off'}
        </Tag>
      </h2>
      <p className="body-2" style={{ marginTop: 0 }}>
        {settings.enabled
          ? `On since ${settings.enabledAtMs ? at(settings.enabledAtMs) : 'now'}${settings.enabledBy ? `, switched on by ${settings.enabledBy}` : ''}. Each person who leaves the payment page gets one email ${settings.delayHours} hours later, unless they have bought a ticket since. Checked every 15 minutes.`
          : 'Off. Nothing is sent. When you switch it on, each person who leaves the payment page from then on gets one email, a set number of hours later, unless they have bought a ticket since.'}
      </p>

      {isOwner ? (
        <ReminderForm
          ownerEmail={ownerEmail}
          values={{
            enabled: settings.enabled,
            delayHours: settings.delayHours,
            subject: settings.subject,
            body: settings.body,
            replyTo: settings.replyTo,
            skipList: settings.skipList,
          }}
        />
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>Only an owner can change the reminder or send a test.</p>
      )}

      <h3 style={{ fontSize: 14, margin: '22px 0 8px' }}>Next to get it</h3>
      <Table
        cols={[
          { key: 'e', label: 'Who', className: 'cell-fill' },
          { key: 'c', label: 'Checkout closed', className: 'cell-md' },
          { key: 'd', label: 'Reminder due', className: 'cell-md' },
        ]}
        rows={next.map((r) => [
          <span key="e" style={{ overflowWrap: 'anywhere' }}>{r.email}</span>,
          at(r.decision.order.closedAtMs),
          r.decision.kind === 'wait' ? at(r.decision.dueAtMs) : 'On the next run',
        ])}
        empty={settings.enabled ? 'Nobody is waiting for a reminder.' : 'Nothing while the reminder is off.'}
      />

      <h3 style={{ fontSize: 14, margin: '22px 0 8px' }}>Skipped</h3>
      <Table
        cols={[
          { key: 'e', label: 'Who', className: 'cell-fill' },
          { key: 'c', label: 'Checkout closed', className: 'cell-md' },
          { key: 'w', label: 'Why', className: 'cell-md' },
        ]}
        rows={skipped.map((r) => [
          <span key="e" style={{ overflowWrap: 'anywhere' }}>{r.email}</span>,
          at(r.decision.order.closedAtMs),
          r.decision.kind === 'skip' ? r.decision.reason : '',
        ])}
        empty="Nobody is skipped."
      />
    </Panel>
  );
}

/**
 * When the checkout closed, for a row with no `refundedAt`: an expiry does not
 * stamp one, so the column was blank. The same time the reminder counts from.
 */
function closedAt(orderId: string, plan: ReminderPlan | null): string {
  const ms = plan?.orders.find((o) => o.id === orderId)?.closedAtMs;
  return ms ? stampOfInstant(new Date(ms).toISOString()) : '';
}
