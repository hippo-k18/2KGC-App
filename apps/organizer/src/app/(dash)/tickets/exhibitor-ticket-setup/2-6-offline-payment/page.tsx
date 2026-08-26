import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listOrders, listTicketTypes, money } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';
import { ManualOrderForm } from '../../manual-order-form';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › 2.6 Offline Payment.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 *
 * Exhibitor and sponsor money does not arrive by card. It arrives as a wire
 * with a reference nobody can match, or a cheque, or against a contract signed
 * before this ticketing system existed. A conference platform that cannot
 * express those is one an organizer keeps a spreadsheet beside — and the
 * spreadsheet is not in the ledger, does not print a badge, and does not send a
 * claim code.
 *
 * ── It issues a ticket against money nothing here can verify ────────────────
 *
 * That is the whole risk, and the mitigation is that it can never be quiet.
 * Every order this screen writes carries `channel: 'manual'`, the organizer's
 * name in `markedPaidBy`, and the reason in `outOfBandNote` — on the order
 * document, not only in the audit log, because the person asking "why is this
 * paid when Stripe has never heard of it?" is looking at the order.
 *
 * A reconciliation against Stripe will come up short by exactly the total of
 * these, and the table below is that total, so the shortfall is explainable
 * rather than alarming.
 */
export default async function OfflinePaymentPage() {
  await requireOrganizer();

  const [tickets, orders] = await Promise.all([listTicketTypes(), listOrders()]);
  const packages = tickets.filter((t) => t.audience === 'exhibitor');

  const manual = orders.filter((o) => o.channel === 'manual');
  const manualTotal = manual.reduce((n, o) => n + o.netCents, 0);
  const comps = manual.filter((o) => o.totalCents === 0).length;
  const currency = manual[0]?.currency ?? packages[0]?.currency ?? 'usd';

  return (
    <>
      <PageHeader
        title="2.6 Offline Payment"
        tags={<Tag color={manual.length > 0 ? 'orange' : 'grey'}>{manual.length} recorded</Tag>}
        links={[
          <Link key="t" href="/tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets">
            2.1 Exhibitor Tickets
          </Link>,
          <Link key="p" href="/tickets/exhibitor-ticket-setup/pre-paid-exhibitors">
            Pre-paid Exhibitors
          </Link>,
          <Link key="o" href={ROUTES.attendeeOrders}>
            Attendee Orders
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>This issues a ticket against money this system cannot see.</strong> Use it when a
        wire, a cheque or a contract has genuinely been honoured — never to &ldquo;get somebody
        in&rdquo; while payment is chased. Every order it writes is marked <code>manual</code>,
        names you, and carries your stated reason, so a Stripe reconciliation that comes up short
        by {money(manualTotal, currency)} has an explanation on this page.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Manual orders', value: manual.length, sub: 'all audiences' },
          { label: 'Recorded value', value: money(manualTotal, currency), sub: 'never seen by Stripe' },
          { label: 'Comps', value: comps, sub: 'recorded at zero' },
          { label: 'Exhibitor packages', value: packages.length, sub: 'available to record against' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Record a payment</h2>
        <ManualOrderForm
          packages={packages.map((p) => ({
            id: p.id,
            name: p.name,
            priceCents: p.priceCents,
            currency: p.currency,
          }))}
          audienceNoun="exhibitor"
          notePlaceholder="Wire ref 88123-A, received 14 Feb"
          compHint="Zero is allowed and produces a real ticket — use Pre-paid Exhibitors for a comp, so the reason reads correctly."
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Everything recorded off-platform</h2>
        <Table
          cols={[
            { key: 'b', label: 'Buyer', className: 'cell-md' },
            { key: 'p', label: 'Package', className: 'cell-md' },
            { key: 'a', label: 'Amount', className: 'cell-sm' },
            { key: 'w', label: 'Recorded by', className: 'cell-fill' },
          ]}
          rows={manual.map((o) => [
            <div key="b">
              <div>{o.buyerName || o.email}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {o.email}
                {o.companyName ? ` · ${o.companyName}` : ''}
              </div>
            </div>,

            <span key="p" style={{ fontSize: 12 }}>
              {o.ticketNames.join(', ') || '—'}
            </span>,

            <strong key="a">
              {o.totalCents === 0 ? (
                <Tag color="purple" small>
                  comp
                </Tag>
              ) : (
                money(o.netCents, o.currency)
              )}
            </strong>,

            <span key="w" className="muted" style={{ fontSize: 12 }}>
              {o.markedPaidBy ?? 'unknown'} · {o.purchasedAt.slice(0, 10)}
              {o.poNumber ? ` · PO ${o.poNumber}` : ''}
            </span>,
          ])}
          empty="Nothing has been recorded off-platform. Every order in the ledger came through Stripe or the demo path."
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No tax line.</strong> This system did not calculate one, and inventing a split
            would put a figure in a tax column that no return will ever agree with. Whatever tax
            applies was handled wherever the money was actually taken.
          </li>
          <li>
            <strong>No refund from here.</strong> There is no payment intent to refund against —
            the money came back the way it went out, and this system can only be told about it.
            Cancelling means editing the order, which is a Firebase console job on purpose.
          </li>
          <li>
            <strong>No bank reconciliation.</strong> Whova does not do this either. Matching a wire
            reference to an order is a finance system&rsquo;s job; the note field is where the
            reference lives so the match can be made by a human who has both open.
          </li>
          <li>
            <strong>No approval step.</strong> Any allowlisted organizer can record any amount. At
            a six-person conference a second signature is theatre; the audit entry is the control.
          </li>
        </ul>
      </Panel>
    </>
  );
}
