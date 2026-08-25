import Link from 'next/link';
import { requirePassphrase, requireOrganizer } from '@/lib/auth';
import { listOrders, money, type OrderRow } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { stripeEnabled, stripeIsLive, stripeInvoiceUrl, stripePaymentUrl } from '@/lib/stripe';
import {
  Banner,
  listParams,
  PageHeader,
  paginate,
  Pagination,
  Panel,
  PER_PAGE,
  SearchInput,
  sortRows,
  Table,
  Tag,
} from '../../../ui';
import { MarkPaidButton, RefundButton } from './order-actions';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Orders and Transactions › Attendee Orders.
 *
 * The ledger. Every order, what it was for, what state it is in, and — for the
 * ones where it applies — a refund.
 *
 * ── This screen shows buyer PII ─────────────────────────────────────────────
 *
 * Names, email addresses and company names, plus a button that moves money. It
 * is behind `requireOrganizer()` and, off localhost, a passphrase; the refund
 * itself asks for that passphrase again. That is the current ceiling of what
 * this dashboard's auth can offer, and it is documented as insufficient in
 * `lib/auth.ts` — Google SSO with enforced MFA is the shipping design.
 *
 * ── Filtering is in memory ──────────────────────────────────────────────────
 *
 * One equality query on `eventId`, then search and sort in the server
 * component. The emulator does not enforce composite indexes, so a Firestore
 * `where` + `orderBy` here would pass locally and fail in production — a bug
 * that has shipped twice on this project. A conference's orders are in the low
 * thousands.
 */

function statusTag(o: OrderRow) {
  if (o.status === 'paid' && o.markedPaidBy) {
    // Visibly distinct from an ordinary paid order, because it is: the money
    // has not arrived. An organizer reconciling against Stripe needs to see
    // that difference on the row, not by opening the audit log.
    return (
      <Tag color="purple" fill="outline">
        paid out of band
      </Tag>
    );
  }
  const color =
    o.status === 'paid'
      ? 'green'
      : o.status === 'refunded' || o.status === 'cancelled'
        ? 'red'
        : o.status === 'partially_refunded'
          ? 'orange'
          : 'grey';
  return (
    <Tag color={color} fill="outline">
      {o.status.replace('_', ' ')}
    </Tag>
  );
}

export default async function AttendeeOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const { page, sort, baseParams } = listParams(sp);

  const q = String(sp.q ?? '').trim().toLowerCase();
  const status = String(sp.status ?? '').trim();

  const all = await listOrders();

  const filtered = all.filter((o) => {
    if (status && o.status !== status) return false;
    if (!q) return true;
    return (
      o.email.toLowerCase().includes(q) ||
      (o.buyerName ?? '').toLowerCase().includes(q) ||
      (o.companyName ?? '').toLowerCase().includes(q) ||
      (o.poNumber ?? '').toLowerCase().includes(q) ||
      o.ticketNames.join(' ').toLowerCase().includes(q)
    );
  });

  const sorted = sortRows(filtered, sort.by, sort.dir, {
    purchased: (o) => o.purchasedAt,
    buyer: (o) => o.buyerName ?? o.email,
    total: (o) => o.totalCents,
    net: (o) => o.netCents,
    status: (o) => o.status,
  });

  const rows = paginate(sorted, page, PER_PAGE);
  const needsPassphrase = requirePassphrase();

  const counts = {
    all: all.length,
    paid: all.filter((o) => o.status === 'paid').length,
    pending: all.filter((o) => o.status === 'pending').length,
    refunded: all.filter((o) => o.status === 'refunded').length,
  };

  return (
    <>
      <PageHeader
        title="Attendee Orders"
        tags={
          stripeEnabled() ? (
            <Tag color={stripeIsLive() ? 'green' : 'orange'} fill="outline">
              {stripeIsLive() ? 'Stripe live' : 'Stripe test mode'}
            </Tag>
          ) : (
            <Tag color="grey">No Stripe key — refunds disabled</Tag>
          )
        }
        links={[
          <Link key="s" href={ROUTES.ordersSummary}>
            Summary
          </Link>,
          <Link key="t" href={ROUTES.transactionHistory}>
            Transaction History
          </Link>,
        ]}
      />

      {!stripeEnabled() && (
        <Banner kind="info">
          No <code>STRIPE_SECRET_KEY</code> is set on this deployment, so orders are read-only here.
          Refunds have to be issued from the Stripe dashboard.
        </Banner>
      )}

      <Panel>
        <div style={{ alignItems: 'center', display: 'flex', gap: 12, marginBottom: 12 }}>
          <SearchInput placeholder="Name, email, company, PO number…" />
          <span style={{ flex: 1 }} />
          {(
            [
              ['', `All ${counts.all}`],
              ['paid', `Paid ${counts.paid}`],
              ['pending', `Unpaid ${counts.pending}`],
              ['refunded', `Refunded ${counts.refunded}`],
            ] as const
          ).map(([value, label]) => {
            const p = new URLSearchParams(baseParams);
            if (value) p.set('status', value);
            else p.delete('status');
            p.delete('page');
            return (
              <Link
                key={value || 'all'}
                href={`?${p.toString()}`}
                style={{
                  fontSize: 12,
                  fontWeight: status === value ? 700 : 400,
                  textDecoration: 'none',
                }}
              >
                {label}
              </Link>
            );
          })}
        </div>

        <Table
          sort={sort}
          cols={[
            { key: 'buyer', label: 'Buyer', className: 'cell-fill', sortKey: 'buyer' },
            { key: 'ticket', label: 'Ticket', className: 'cell-md' },
            { key: 'total', label: 'Total', className: 'cell-sm', sortKey: 'total' },
            { key: 'net', label: 'Net', className: 'cell-sm', sortKey: 'net' },
            { key: 'status', label: 'Status', className: 'cell-sm', sortKey: 'status' },
            { key: 'when', label: 'Purchased', className: 'cell-sm', sortKey: 'purchased' },
            { key: 'act', label: '', className: 'cell-md' },
          ]}
          rows={rows.map((o) => [
            <div key="b">
              <div>{o.buyerName || <span className="muted">(no name)</span>}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {o.email}
              </div>
              {o.companyName && (
                <div className="muted" style={{ fontSize: 11 }}>
                  {o.companyName}
                  {o.poNumber ? ` · PO ${o.poNumber}` : ''}
                </div>
              )}
            </div>,

            <div key="t">
              <div style={{ fontSize: 13 }}>
                {o.ticketNames.length > 0 ? o.ticketNames.join(', ') : <span className="muted">—</span>}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                {o.channel === 'demo' ? (
                  <Tag color="grey" small>
                    test purchase
                  </Tag>
                ) : (
                  <>
                    {o.channel}
                    {o.seatCount > 1 ? ` · ${o.seatCount} seats` : ''}
                    {o.promotionCode ? ` · ${o.promotionCode}` : ''}
                  </>
                )}
              </div>
            </div>,

            <div key="tot">
              {money(o.totalCents, o.currency)}
              {o.taxCents > 0 && (
                <div className="muted" style={{ fontSize: 11 }}>
                  incl. {money(o.taxCents, o.currency)} tax
                </div>
              )}
            </div>,

            <div key="net">
              {o.refundedCents > 0 ? (
                <>
                  <strong>{money(o.netCents, o.currency)}</strong>
                  <div className="muted" style={{ fontSize: 11 }}>
                    −{money(o.refundedCents, o.currency)}
                  </div>
                </>
              ) : (
                money(o.netCents, o.currency)
              )}
            </div>,

            <div key="st">
              {statusTag(o)}
              {o.markedPaidBy && (
                <div className="muted" style={{ fontSize: 11 }}>
                  by {o.markedPaidBy}
                </div>
              )}
            </div>,

            <span key="w" className="muted" style={{ fontSize: 12 }}>
              {o.purchasedAt.slice(0, 10)}
            </span>,

            <div key="a" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {o.refundable && stripeEnabled() && (
                <RefundButton
                  orderId={o.id}
                  amountLabel={money(o.totalCents, o.currency)}
                  email={o.email}
                  needsPassphrase={needsPassphrase}
                  live={stripeIsLive()}
                />
              )}
              {o.channel === 'invoice' && o.status === 'pending' && (
                <MarkPaidButton
                  orderId={o.id}
                  amountLabel={money(o.totalCents, o.currency)}
                  companyName={o.companyName ?? o.email}
                  seatCount={o.seatCount}
                  needsPassphrase={needsPassphrase}
                />
              )}
              {o.hostedInvoiceUrl && (
                <a
                  href={o.hostedInvoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12 }}
                >
                  Invoice page ↗
                </a>
              )}
              {/*
                A deep link rather than a copied id. "Find this payment in
                Stripe" is the commonest thing an organizer wants from this
                screen and pasting a `pi_…` into a search box is friction that
                a href removes entirely.
              */}
              {o.stripePaymentIntentId && (
                <a
                  href={stripePaymentUrl(o.stripePaymentIntentId)}
                  target="_blank"
                  rel="noreferrer"
                  className="muted"
                  style={{ fontSize: 11 }}
                >
                  Stripe ↗
                </a>
              )}
              {o.stripeInvoiceId && !o.hostedInvoiceUrl && (
                <a
                  href={stripeInvoiceUrl(o.stripeInvoiceId)}
                  target="_blank"
                  rel="noreferrer"
                  className="muted"
                  style={{ fontSize: 11 }}
                >
                  Stripe invoice ↗
                </a>
              )}
            </div>,
          ])}
          empty={
            q || status
              ? 'No orders match that filter.'
              : 'No orders yet. The first ticket bought on the website appears here immediately.'
          }
        />

        <Pagination total={sorted.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
      </Panel>
    </>
  );
}
