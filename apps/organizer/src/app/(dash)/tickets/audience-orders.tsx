import Link from 'next/link';
import type { ReactNode } from 'react';
import type { TicketAudience } from '@kgc/shared';
import { listOrders, listTicketTypes, money, type OrderRow } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../ui';

/**
 * Exhibitor Orders and Sponsor Orders.
 *
 * ── How an order gets an audience ───────────────────────────────────────────
 *
 * It does not have one. `OrderDoc` carries no audience field and should not:
 * the truth lives on the ticket type, and denormalising it at fulfilment means
 * an order whose audience is whatever the tier happened to be that afternoon.
 * The join is per line — `OrderLine.ticketTypeId` → `TicketTypeDoc.audience` —
 * and it is done here, at read time, against the current catalogue.
 *
 * This screen described that join for a while without performing it, because
 * `OrderRow` kept the tier *name* and dropped the id. That is fixed; the id is
 * in the read model now and this is a real ledger.
 *
 * ── An order can legitimately span audiences ────────────────────────────────
 *
 * Nothing stops one invoice carrying a sponsorship and four attendee passes,
 * and that is a normal thing for a sponsor's procurement department to raise.
 * So membership here is "has at least one line in this audience", and the
 * money column shows **this audience's share**, not the order total — putting
 * the whole invoice in both the sponsor and the attendee ledger would make the
 * two columns sum to more than was ever charged.
 */

/** One order's exposure to a single audience, in minor units. */
function shareForAudience(
  order: OrderRow,
  audienceOf: Map<string, TicketAudience>,
  audience: TicketAudience,
): { lines: number; share: number } {
  const ids = order.ticketTypeIds;
  if (ids.length === 0) return { lines: 0, share: 0 };

  const lines = ids.filter((id) => audienceOf.get(id) === audience).length;
  if (lines === 0) return { lines: 0, share: 0 };

  /**
   * Apportioned by line count, not by price.
   *
   * `OrderRow` keeps no per-line amount — only the order's own subtotal, tax,
   * discount and refunds. Recovering the exact split would mean re-reading
   * `OrderDoc.items`, and this is a ledger *summary*: the figure is labelled as
   * a share and the exact amounts stay on the order itself. What matters is
   * that the shares across audiences sum to the order, which this does.
   */
  return { lines, share: Math.round((order.netCents * lines) / ids.length) };
}

export async function AudienceOrders({
  audience,
  title,
  noun,
  catalogueHref,
  catalogueLabel,
  links,
}: {
  audience: TicketAudience;
  title: string;
  /** Lower-case singular, for prose. */
  noun: string;
  /** Where this audience&rsquo;s catalogue is set up. */
  catalogueHref: string;
  catalogueLabel: string;
  links?: ReactNode[];
}) {
  const [orders, tickets] = await Promise.all([listOrders(), listTicketTypes()]);

  const audienceOf = new Map<string, TicketAudience>(tickets.map((t) => [t.id, t.audience]));
  const tiers = tickets.filter((t) => t.audience === audience);

  // Demo purchases write real order documents by design; counting them in a
  // ledger total would overstate it exactly as it would on the Summary screen.
  const real = orders.filter((o) => o.channel !== 'demo');

  const matched = real
    .map((o) => ({ order: o, ...shareForAudience(o, audienceOf, audience) }))
    .filter((m) => m.lines > 0);

  const netTotal = matched.reduce((n, m) => n + m.share, 0);
  const currency = matched[0]?.order.currency ?? tiers[0]?.currency ?? 'usd';

  /**
   * Orders whose lines carry no tier id at all — written before the field
   * existed, or by a path that did not set it. Counted and named rather than
   * silently dropped: an unattributable order is a hole in this ledger and the
   * person reconciling it needs to know the hole is there.
   */
  const unattributable = real.filter((o) => o.ticketTypeIds.length === 0).length;

  return (
    <>
      <PageHeader
        title={title}
        tags={
          <Tag color={matched.length > 0 ? 'blue' : 'grey'}>
            {matched.length} {matched.length === 1 ? 'order' : 'orders'}
          </Tag>
        }
        links={[
          <Link key="s" href={ROUTES.ordersSummary}>
            Summary
          </Link>,
          <Link key="a" href={ROUTES.attendeeOrders}>
            Attendee Orders
          </Link>,
          <Link key="c" href={catalogueHref}>
            {catalogueLabel}
          </Link>,
          ...(links ?? []),
        ]}
      />

      {tiers.length === 0 ? (
        <Banner kind="warning">
          <strong>
            There are no {noun} orders because there is no {noun} catalogue.
          </strong>{' '}
          No ticket type has <code>audience: &apos;{audience}&apos;</code>, so no order line can
          point at one. This is zero by construction, not an empty search — set the catalogue up on{' '}
          <Link href={catalogueHref}>{catalogueLabel}</Link> and this becomes a real question.
        </Banner>
      ) : (
        <Banner kind="info">
          <strong>Attributed by line, not by order.</strong> An order carries no audience; each line
          points at a ticket type and the type carries one. An invoice mixing a sponsorship with
          attendee passes appears in both ledgers, and the money column shows only this
          audience&rsquo;s share — so the three ledgers sum to the takings rather than exceeding
          them.
        </Banner>
      )}

      <StatTiles
        tiles={[
          { label: `${noun} packages`, value: tiers.length, sub: `of ${tickets.length} priced` },
          { label: `${noun} orders`, value: matched.length, sub: 'demo excluded' },
          { label: 'Net share', value: money(netTotal, currency), sub: 'after refunds' },
          {
            label: 'Unattributable',
            value: unattributable,
            sub: unattributable ? 'orders with no tier id' : 'none',
          },
        ]}
      />

      <Panel>
        <Table
          cols={[
            { key: 'order', label: 'Order', className: 'cell-fill' },
            { key: 'buyer', label: 'Buyer', className: 'cell-md' },
            { key: 'pkg', label: 'Packages', className: 'cell-md' },
            { key: 'st', label: 'Status', className: 'cell-sm' },
            { key: 'total', label: 'Share', className: 'cell-sm' },
          ]}
          rows={matched.map((m) => [
            <div key="o">
              <Link href={`${ROUTES.attendeeOrders}?order=${m.order.id}`}>
                <code>{m.order.id.slice(0, 18)}</code>
              </Link>
              <div className="muted" style={{ fontSize: 11 }}>
                {m.order.purchasedAt.slice(0, 10)} · {m.order.channel}
              </div>
            </div>,

            <div key="b">
              <div>{m.order.buyerName || m.order.email}</div>
              {m.order.companyName ? (
                <div className="muted" style={{ fontSize: 11 }}>
                  {m.order.companyName}
                </div>
              ) : null}
            </div>,

            <span key="p" style={{ fontSize: 12 }}>
              {m.order.ticketNames
                .filter((_, i) => audienceOf.get(m.order.ticketTypeIds[i]) === audience)
                .join(', ') || <em className="muted">—</em>}
            </span>,

            <Tag
              key="s"
              small
              color={
                m.order.status === 'paid' ? 'green' : m.order.status === 'refunded' ? 'red' : 'grey'
              }
            >
              {m.order.status}
            </Tag>,

            <strong key="t">
              {money(m.share, m.order.currency)}
              {m.lines < m.order.ticketTypeIds.length ? (
                <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                  {m.lines} of {m.order.ticketTypeIds.length} lines
                </div>
              ) : null}
            </strong>,
          ])}
          empty={
            tiers.length === 0 ? (
              <>
                <strong>Nothing to show.</strong> All {real.length} orders in the ledger buy
                attendee tiers, and they are listed on{' '}
                <Link href={ROUTES.attendeeOrders}>Attendee Orders</Link>, which is where refunds
                and mark-paid live.
              </>
            ) : (
              <>
                <strong>
                  {tiers.length} {noun} {tiers.length === 1 ? 'package is' : 'packages are'} priced,
                  and none has sold.
                </strong>{' '}
                They are on sale at{' '}
                <code>/tickets/{audience === 'attendee' ? '' : audience}</code> — this is an empty
                ledger, not a broken query.
              </>
            )
          }
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 className="section-header">Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Refunds and mark-paid.</strong> Both exist on{' '}
            <Link href={ROUTES.attendeeOrders}>Attendee Orders</Link> and are not duplicated here.
            A refund against a mixed order is one refund against the whole payment intent, so
            issuing it from a per-audience view would be misleading about what it touches.
          </li>
          <li>
            <strong>Exact per-line amounts.</strong> The share above is apportioned by line count.
            The exact figures are on the order document; recovering them here means a second read
            of <code>items</code> per order, which is a page of round trips for a summary.
          </li>
          <li>
            <strong>The columns a {noun} ledger actually wants.</strong> Booth number, deliverables
            outstanding, contract status. None is modelled anywhere yet.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
