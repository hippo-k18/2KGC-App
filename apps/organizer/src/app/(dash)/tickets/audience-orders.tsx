import Link from 'next/link';
import type { ReactNode } from 'react';
import type { TicketAudience } from '@kgc/shared';
import { listOrders, listTicketTypes, money } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, StatTiles, Table } from '../ui';

/**
 * Exhibitor Orders and Sponsor Orders.
 *
 * ── Why these screens are empty, stated as a derivation rather than a shrug ──
 *
 * An order carries no audience. `OrderDoc` has no such field, and the only path
 * from an order to one is per line: `OrderLine.ticketTypeId` → the ticket
 * type&rsquo;s `audience`. Two things follow, and the screen says both.
 *
 * First, the count here is zero *by construction*, not by filtering. If no
 * ticket type has this audience then no order line can point at one, so no
 * order can be for it. That is a stronger statement than &ldquo;we found
 * none&rdquo; and it is checked live against the catalogue rather than asserted.
 *
 * Second, if a tier for this audience ever does exist, this screen still could
 * not list its orders: `OrderRow` — the dashboard&rsquo;s read model — keeps
 * `ticketTypeName` and drops `ticketTypeId`, so the join has nothing to join on.
 * That branch is rendered too, because the day it becomes true is the day an
 * empty table would be a lie instead of a fact.
 */
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
  /** Where this audience&rsquo;s catalogue would be set up. */
  catalogueHref: string;
  catalogueLabel: string;
  links?: ReactNode[];
}) {
  const [orders, tickets] = await Promise.all([listOrders(), listTicketTypes()]);

  const tiers = tickets.filter((t) => t.audience === audience);
  // Demo purchases write real order documents by design; counting them in a
  // ledger total would overstate it exactly as it would on the Summary screen.
  const real = orders.filter((o) => o.channel !== 'demo');
  const attributable = tiers.length > 0;

  return (
    <>
      <PageHeader
        title={title}
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

      <Banner kind="warning">
        {attributable ? (
          <>
            <strong>
              {tiers.length} {noun} {tiers.length === 1 ? 'tier exists' : 'tiers exist'}, and this
              screen still cannot attribute orders to {noun}s.
            </strong>{' '}
            An order records no audience of its own. Deriving one means joining each line&rsquo;s{' '}
            <code>ticketTypeId</code> to the catalogue, and the read model this dashboard uses keeps
            only the tier <em>name</em>. The table below is empty because of that limitation, not
            because no such order exists.
          </>
        ) : (
          <>
            <strong>There are no {noun} orders because there is no {noun} catalogue.</strong> No
            ticket type has <code>audience: &apos;{audience}&apos;</code>, so no order line can
            point at one. This is zero by construction, not an empty search — set the catalogue up
            on <Link href={catalogueHref}>{catalogueLabel}</Link> and this becomes a real question.
          </>
        )}
      </Banner>

      <StatTiles
        tiles={[
          {
            label: `${noun} tiers`,
            value: tiers.length,
            sub: `of ${tickets.length} in the catalogue`,
          },
          { label: `${noun} orders`, value: 0, sub: attributable ? 'not attributable' : 'none possible' },
          {
            label: 'Orders in the ledger',
            value: real.length,
            sub: 'all audiences, demo excluded',
          },
        ]}
      />

      <Panel>
        <Table
          cols={[
            { key: 'order', label: 'Order', className: 'cell-fill' },
            { key: 'buyer', label: 'Buyer', className: 'cell-md' },
            { key: 'total', label: 'Total', className: 'cell-sm' },
          ]}
          rows={[]}
          empty={
            attributable ? (
              <>
                <strong>Nothing listed — and that is a limitation, not a finding.</strong> A {noun}{' '}
                order could exist now that a {noun} tier does. This screen cannot tell, because the
                read model keeps the tier <em>name</em> and drops <code>ticketTypeId</code>, so
                there is nothing to join the catalogue on. All {real.length} orders remain visible
                on <Link href={ROUTES.attendeeOrders}>Attendee Orders</Link>.
              </>
            ) : (
              <>
                <strong>Nothing to show.</strong> Every one of the {real.length} orders in the
                ledger buys an attendee tier, and all of them are listed on{' '}
                <Link href={ROUTES.attendeeOrders}>Attendee Orders</Link>, which is where refunds
                and mark-paid live. Together they total{' '}
                {money(
                  real.reduce((n, o) => n + o.netCents, 0),
                  real[0]?.currency ?? 'usd',
                )}{' '}
                net of refunds.
              </>
            )
          }
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 className="section-header">Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Audience on an order.</strong> Not modelled. Adding a denormalised field at
            fulfilment would be the cheap fix; joining through <code>ticketTypeId</code> is the
            correct one, because a tier can be re-pointed and an order should not silently change
            audience when it is.
          </li>
          <li>
            <strong>The columns an exhibitor or sponsor ledger actually wants.</strong> Booth
            number, company, deliverables outstanding. None of them is modelled anywhere.
          </li>
          <li>
            <strong>Refunds and mark-paid from this screen.</strong> Both exist, on{' '}
            <Link href={ROUTES.attendeeOrders}>Attendee Orders</Link>, and are not duplicated here
            where they would have nothing to act on.
          </li>
        </ul>
      </Panel>
    </>
  );
}
