import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listBooths } from '@/lib/booths';
import { listOrders, listTicketTypes, money } from '@/lib/commerce';
import { listExhibitors } from '@/lib/exhibitors';
import { ROUTES } from '@/lib/nav';
import {
  Banner,
  GapPanel,
  NotInputted,
  PageHeader,
  Panel,
  ProgressBar,
  StatTiles,
  Table,
  Tag,
} from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › 2.5 Ticket Add-ons.
 *
 * ── There is no add-on model, and for exhibitors that matters less ─────────
 *
 * `ticket-add-ons` on the attendee side sets out why: nothing in the data model
 * is purchasable except a ticket type, and a real add-on needs its own capacity
 * and its own entitlement written at fulfilment. Both are still true.
 *
 * One third of it is not, as of 2026-08-31: the Checkout session no longer
 * builds a single line item. It groups the seats on a purchase by tier and
 * gives each group a real Stripe quantity, so **a booth and two extra passes
 * are one purchase**, priced as two line items. What it cannot do is sell
 * something to a person who already holds a ticket — a registration is keyed by
 * email and carries one `ticketType`, so every seat on a purchase has to be a
 * different person. For exhibitor extras that is exactly right, because an
 * extra pass *is* a person.
 *
 * What is different here is that **an exhibitor add-on is usually just a
 * cheaper package**. An extra staff pass, a power upgrade, a furniture bundle:
 * each has a price, no dependency on the parent purchase, and no combinatorial
 * explosion — which is the problem add-ons exist to solve and which exhibitor
 * extras do not have. Priced as its own `audience: 'exhibitor'` tier, an extra
 * is on sale at `/tickets/exhibitor` today with no new code at all.
 *
 * So this screen does two real things rather than describing a gap: it lists
 * the low-priced exhibitor tiers that are functioning as extras, and it shows
 * the one entitlement that genuinely is not enforced anywhere — staff passes.
 *
 * ── Staff passes are prose, and that is the finding ────────────────────────
 *
 * Every exhibitor package names a pass count in its inclusion list. Nothing
 * reads it. `ExhibitorDoc.passesAllocated` is set by hand and `passesUsed` is
 * counted; the two disagreeing is discovered at the desk on the morning of day
 * one, by somebody expecting a badge that was never allocated.
 */

/** Below this, an exhibitor tier is an extra rather than a package. */
const EXTRA_THRESHOLD_CENTS = 100_000;

export default async function ExhibitorAddOnsPage() {
  await requireOrganizer();

  const [tickets, orders, exhibitors, booths] = await Promise.all([
    listTicketTypes(),
    listOrders(),
    listExhibitors(),
    listBooths(),
  ]);

  const exhibitorTiers = tickets.filter((t) => t.audience === 'exhibitor');
  const packages = exhibitorTiers.filter((t) => t.priceCents >= EXTRA_THRESHOLD_CENTS);
  const extras = exhibitorTiers.filter((t) => t.priceCents < EXTRA_THRESHOLD_CENTS);

  const extraIds = new Set(extras.map((t) => t.id));
  const extraSales = orders
    .filter((o) => o.channel !== 'demo' && o.status !== 'cancelled')
    .flatMap((o) => o.ticketTypeIds.filter((id) => extraIds.has(id)));

  const allocated = exhibitors.reduce((n, x) => n + (x.passesAllocated ?? 0), 0);
  const used = exhibitors.reduce((n, x) => n + x.passesUsed, 0);
  const over = exhibitors.filter((x) => x.overAllocated);

  const boothed = new Set(booths.filter((b) => b.exhibitorId).map((b) => b.exhibitorId));

  return (
    <>
      <PageHeader
        title="2.5 Ticket Add-ons"
        info={
          <>
            <strong>An extra is a low-priced exhibitor ticket</strong>
            <p>
              Sell a staff pass or a power upgrade as its own exhibitor ticket. Buying a pass does
              not change an exhibitor&rsquo;s pass allocation. Set that in Exhibitor Manager.
            </p>
          </>
        }
        tags={
          over.length > 0 ? (
            <Tag color="red" fill="solid">
              {over.length} over-allocated
            </Tag>
          ) : (
            <Tag color="blue">{extras.length} extras priced</Tag>
          )
        }
        links={[
          <Link key="t" href="/tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets">
            2.1 Exhibitor Tickets
          </Link>,
          <Link key="m" href="/content/exhibitor-center/exhibitor-manager">
            Exhibitor Manager
          </Link>,
          <Link key="a" href="/tickets/ticket-setup/ticket-add-ons">
            Attendee add-ons
          </Link>,
        ]}
      />

      {over.length > 0 && (
        <Banner kind="warning">
          <strong>
            {over.length} {over.length === 1 ? 'exhibitor has' : 'exhibitors have'} claimed more
            staff passes than their package allows.
          </strong>{' '}
          Correct the allocation on{' '}
          <Link href="/content/exhibitor-center/exhibitor-manager">Exhibitor Manager</Link> or
          record the extra passes as a purchase.
        </Banner>
      )}

      <StatTiles
        tiles={[
          { label: 'Extras priced', value: extras.length, sub: `under ${money(EXTRA_THRESHOLD_CENTS)}` },
          { label: 'Extras sold', value: extraSales.length, sub: 'cancelled orders excluded' },
          { label: 'Passes allocated', value: allocated, sub: `${used} claimed` },
          {
            label: 'Over-allocated',
            value: over.length,
            sub: over.length ? 'more claimed than allowed' : 'none',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Extras on sale</h2>
        {extras.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 0 }}>
            No extras yet. To sell an extra staff pass or a power upgrade, create it in{' '}
            <Link href={`${ROUTES.createTickets}?audience=exhibitor`}>Create Tickets</Link> with a
            price under {money(EXTRA_THRESHOLD_CENTS)}.
          </p>
        ) : (
          <Table
            cols={[
              { key: 'n', label: 'Extra', className: 'cell-fill' },
              { key: 'p', label: 'Price', className: 'cell-sm' },
              { key: 's', label: 'Sold', className: 'cell-sm' },
              { key: 'v', label: 'Listed', className: 'cell-sm' },
            ]}
            rows={extras.map((t) => [
              <div key="n">
                <div>{t.name}</div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {t.tagline || <em>no tagline</em>}
                </div>
              </div>,
              money(t.priceCents, t.currency),
              t.quantitySold,
              t.visible ? (
                <Tag key="v" color="green" small>
                  yes
                </Tag>
              ) : (
                <Tag key="v" color="grey" small>
                  link only
                </Tag>
              ),
            ])}
          />
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Staff passes</h2>
        <p className="body-2" style={{ marginTop: 0 }}>
          Pass allocations are set by hand in Exhibitor Manager. The pass count written in a
          package is not applied for you, so check each exhibitor below.
        </p>
        <Table
          cols={[
            { key: 'x', label: 'Exhibitor', className: 'cell-md' },
            { key: 'b', label: 'Booth', className: 'cell-sm' },
            { key: 'p', label: 'Passes', className: 'cell-md' },
            { key: 's', label: '', className: 'cell-fill' },
          ]}
          rows={exhibitors.map((x) => [
            <div key="x">
              <Link href={`/content/exhibitor-center/exhibitor-manager?edit=${x.id}`}>{x.name}</Link>
              <div className="muted" style={{ fontSize: 11 }}>
                {x.status}
              </div>
            </div>,

            boothed.has(x.id) ? (
              <Tag key="b" color="green" small>
                allocated
              </Tag>
            ) : (
              <span key="b" className="muted" style={{ fontSize: 12 }}>
                none
              </span>
            ),

            <div key="p">
              <div style={{ fontSize: 13 }}>
                {x.passesUsed}
                {typeof x.passesAllocated === 'number' ? ` / ${x.passesAllocated}` : ''}
              </div>
              {typeof x.passesAllocated === 'number' && x.passesAllocated > 0 && (
                <ProgressBar pct={Math.min(100, (x.passesUsed / x.passesAllocated) * 100)} />
              )}
            </div>,

            x.overAllocated ? (
              <span key="s" style={{ color: 'var(--danger)', fontSize: 12 }}>
                {x.passesUsed - (x.passesAllocated ?? 0)} more claimed than the package allows. Sell
                them an extra pass or raise the allocation.
              </span>
            ) : typeof x.passesAllocated !== 'number' ? (
              <span key="s" className="muted" style={{ fontSize: 12 }}>
                No allocation recorded
              </span>
            ) : (
              <span key="s" className="muted" style={{ fontSize: 12 }}>
                {x.passesAllocated - x.passesUsed} unclaimed
              </span>
            ),
          ])}
          empty="No exhibitors yet"
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What each package promises</h2>
        <Table
          cols={[
            { key: 'n', label: 'Package', className: 'cell-md' },
            { key: 'p', label: 'Price', className: 'cell-sm' },
            { key: 'i', label: 'What’s included', className: 'cell-fill' },
          ]}
          rows={packages.map((t) => [
            t.name,
            money(t.priceCents, t.currency),
            <span key="i" className="muted" style={{ fontSize: 12 }}>
              {(t.includes ?? []).join(' · ') || <em>nothing listed</em>}
            </span>,
          ])}
          empty={<NotInputted what="exhibitor packages" compact />}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Nothing links a pass purchase to an exhibitor.</strong> Buying an extra pass
            produces an attendee registration and does not raise{' '}
            <code>passesAllocated</code> on anybody — an organizer has to do that by hand on
            Exhibitor Manager.
          </li>
          <li>
            <strong>No per-extra capacity beyond the tier&rsquo;s own.</strong>{' '}
            <code>quantityTotal</code> works, and like every capacity here it is a counter rather
            than a reservation — two exhibitors can buy the last power upgrade.
          </li>
          <li>
            <strong>No post-purchase upsell.</strong> An exhibitor who wants a third pass in April
            buys it as a fresh purchase. There is no flow anywhere that charges somebody who already
            holds a ticket.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
