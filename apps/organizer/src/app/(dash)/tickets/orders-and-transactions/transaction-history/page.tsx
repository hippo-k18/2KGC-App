import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listOrders, money, recentEmails } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { stripeInvoiceUrl, stripePaymentUrl } from '@/lib/stripe';
import { listParams, PageHeader, paginate, Pagination, Panel, PER_PAGE, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Orders and Transactions › Transaction History.
 *
 * The raw log, in the order things happened — which is what you actually want
 * when somebody disputes a charge, or asks why they were emailed twice, or
 * insists they never got a confirmation.
 *
 * Deliberately different from Attendee Orders: that screen is one row per
 * *order* and answers "what has this person bought". This one is one row per
 * *event* — a purchase, a refund, an email — and answers "what happened, and
 * when". Merging them into a sortable table would lose the second question,
 * which is the one asked under pressure.
 *
 * ── Email sends are here too ────────────────────────────────────────────────
 *
 * "I never got my confirmation" is the single commonest support question a
 * conference gets, and without a record the only possible answer is a shrug.
 * With one it becomes "sent at 14:02, check spam" or "our provider rejected
 * that address" — both of which end the conversation.
 */

type Entry = {
  at: string;
  kind: 'purchase' | 'refund' | 'invoice-raised' | 'email';
  who: string;
  what: string;
  detail?: string;
  amount?: string;
  href?: string;
  tone: 'green' | 'red' | 'orange' | 'grey' | 'blue' | 'purple';
};

export default async function TransactionHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const { page, baseParams } = listParams(sp);

  const [orders, emails] = await Promise.all([listOrders(), recentEmails(200)]);

  const entries: Entry[] = [];

  for (const o of orders) {
    if (o.channel === 'invoice' && o.status === 'pending') {
      entries.push({
        at: o.purchasedAt,
        kind: 'invoice-raised',
        who: o.companyName ?? o.email,
        what: `Invoice raised — ${o.seatCount} ${o.seatCount === 1 ? 'seat' : 'seats'}`,
        detail: o.poNumber ? `PO ${o.poNumber}` : undefined,
        amount: money(o.totalCents, o.currency),
        href: o.stripeInvoiceId ? stripeInvoiceUrl(o.stripeInvoiceId) : undefined,
        tone: 'orange',
      });
    } else {
      entries.push({
        at: o.purchasedAt,
        kind: 'purchase',
        who: o.buyerName || o.email,
        what:
          o.ticketNames.length > 0
            ? o.ticketNames.join(', ')
            : o.channel === 'demo'
              ? 'Test purchase'
              : 'Purchase',
        detail: o.markedPaidBy ? `marked paid by ${o.markedPaidBy}` : o.channel,
        amount: money(o.totalCents, o.currency),
        href: o.stripePaymentIntentId ? stripePaymentUrl(o.stripePaymentIntentId) : undefined,
        tone: o.channel === 'demo' ? 'grey' : o.markedPaidBy ? 'purple' : 'green',
      });
    }

    /**
     * A refund is its own entry, timestamped when the money went back rather
     * than when it was taken. That ordering is the whole point of this screen:
     * a refund three weeks after a purchase belongs three weeks later in the
     * log, not folded into the row above it.
     */
    if (o.refundedCents > 0) {
      entries.push({
        at: o.refundedAt ?? o.purchasedAt,
        kind: 'refund',
        who: o.buyerName || o.email,
        what: o.status === 'partially_refunded' ? 'Partial refund' : 'Refund',
        detail:
          o.status === 'partially_refunded'
            ? 'ticket still valid'
            : 'registration cancelled',
        amount: `−${money(o.refundedCents, o.currency)}`,
        href: o.stripePaymentIntentId ? stripePaymentUrl(o.stripePaymentIntentId) : undefined,
        tone: 'red',
      });
    }
  }

  for (const e of emails) {
    entries.push({
      at: e.at,
      kind: 'email',
      who: e.to,
      what: e.subject,
      detail:
        e.status === 'sent'
          ? e.template
          : e.status === 'skipped'
            ? (e.reason ?? 'not sent')
            : (e.error ?? 'failed'),
      tone: e.status === 'sent' ? 'blue' : e.status === 'skipped' ? 'grey' : 'red',
    });
  }

  entries.sort((a, b) => b.at.localeCompare(a.at));
  const rows = paginate(entries, page, PER_PAGE);

  const failedEmails = emails.filter((e) => e.status === 'failed').length;
  const skippedEmails = emails.filter((e) => e.status === 'skipped').length;

  return (
    <>
      <PageHeader
        title="Transaction History"
        tags={
          failedEmails > 0 ? (
            <Tag color="red" fill="outline">
              {failedEmails} email {failedEmails === 1 ? 'failure' : 'failures'}
            </Tag>
          ) : skippedEmails > 0 ? (
            <Tag color="grey" fill="outline">
              {skippedEmails} not sent — no email provider
            </Tag>
          ) : undefined
        }
        links={[
          <Link key="s" href={ROUTES.ordersSummary}>
            Summary
          </Link>,
          <Link key="o" href={ROUTES.attendeeOrders}>
            Attendee Orders
          </Link>,
        ]}
      />

      <Panel>
        <Table
          cols={[
            { key: 'when', label: 'When', className: 'cell-sm' },
            { key: 'kind', label: 'Event', className: 'cell-sm' },
            { key: 'who', label: 'Who', className: 'cell-md' },
            { key: 'what', label: 'What', className: 'cell-fill' },
            { key: 'amt', label: 'Amount', className: 'cell-sm' },
          ]}
          rows={rows.map((e) => [
            <span key="w" className="muted" style={{ fontSize: 12 }}>
              {e.at.slice(0, 10)}
              <br />
              {e.at.slice(11, 16)}
            </span>,
            <Tag key="k" color={e.tone} fill="outline" small>
              {e.kind === 'invoice-raised' ? 'invoice' : e.kind}
            </Tag>,
            <span key="o" style={{ fontSize: 13 }}>
              {e.who}
            </span>,
            <div key="t">
              <div style={{ fontSize: 13 }}>
                {e.href ? (
                  <a href={e.href} target="_blank" rel="noreferrer">
                    {e.what} ↗
                  </a>
                ) : (
                  e.what
                )}
              </div>
              {e.detail && (
                <div className="muted" style={{ fontSize: 11 }}>
                  {e.detail}
                </div>
              )}
            </div>,
            <span key="a" style={{ fontSize: 13 }}>
              {e.amount ?? <span className="muted">—</span>}
            </span>,
          ])}
          empty="Nothing has happened yet. Purchases, refunds and emails all appear here."
        />
        <Pagination total={entries.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />

        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>
          Email entries cover the most recent 200 sends. Orders are complete. Stripe&rsquo;s own
          dashboard is the authority on payouts and fees, which are charged against the payout
          rather than the order and are not visible here.
        </p>
      </Panel>
    </>
  );
}
