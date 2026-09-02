import Link from 'next/link';
import type { ReactNode } from 'react';
import { publicSiteOrigin, type TicketAudience } from '@kgc/shared';
import { listTicketTypes, money } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, EmptyState, GapPanel, PageHeader, Panel, ProgressBar, Table, Tag } from '../ui';

/**
 * The exhibitor and sponsor ticket catalogues.
 *
 * Whova ships three parallel catalogue screens — 1.1 Create Tickets, 2.1
 * Exhibitor Tickets, Sponsor Tickets — and they are the same screen three
 * times over a different slice of one price list. `TicketTypeDoc.audience`
 * already models exactly that slice, so this is one component the two
 * catalogues share rather than two more copies of the attendee screen that
 * would drift apart the first time a column changed.
 *
 * ── These are editable now, and both halves of that had to be fixed ─────────
 *
 * This file used to argue, at length, that an Edit link here would be a trap:
 * the save action on 1.1 Create Tickets wrote `audience: 'attendee'` as a
 * literal, so opening an exhibitor tier in it and pressing Save silently moved
 * that tier into the attendee catalogue. That is fixed — the form carries the
 * field and an edit preserves whatever the tier already was.
 *
 * The second half was worse and less visible. `listTiers()` on the website
 * filtered to attendees unconditionally, so **nothing anywhere would sell an
 * exhibitor or sponsor tier**: an organizer could price a booth and no buyer
 * could reach it. `listTiers` now takes the audience as a parameter and
 * `/tickets/exhibitor` and `/tickets/sponsor` are real pages. Both fixes were
 * needed; either one alone leaves a price list nobody can buy from.
 */

/** Where this audience's tiers are actually sold. One place, cited by both pages. */
export const PUBLIC_PAGE: Record<TicketAudience, string> = {
  attendee: '/tickets',
  exhibitor: '/tickets/exhibitor',
  sponsor: '/tickets/sponsor',
};

export async function AudienceCatalogue({
  audience,
  title,
  noun,
  links,
  notBuilt,
}: {
  audience: TicketAudience;
  title: string;
  /** Lower-case singular, for prose: &ldquo;exhibitor&rdquo;. */
  noun: string;
  links?: ReactNode[];
  /** Audience-specific items appended to the shared &ldquo;Not built here&rdquo; list. */
  notBuilt?: ReactNode[];
}) {
  const all = await listTicketTypes();
  const tickets = all.filter((t) => t.audience === audience);

  /**
   * "Sells right now" is not "visible". A tier is buyable only if it is listed,
   * inside its sales window and not at capacity — the same three conditions
   * `apps/web`'s `availability()` evaluates at read time. Reproducing them here
   * rather than showing a `visible` count is the difference between a number an
   * organizer can act on and one that quietly disagrees with the live page.
   */
  const now = Date.now();
  const sellable = tickets.filter(
    (t) =>
      t.visible &&
      !(t.salesOpenAt && new Date(t.salesOpenAt).getTime() > now) &&
      !(t.salesCloseAt && new Date(t.salesCloseAt).getTime() < now) &&
      !(typeof t.quantityTotal === 'number' && t.quantitySold >= t.quantityTotal),
  ).length;

  // The dashboard and the website are separate deployments that share only a
  // database, so the dashboard cannot derive the site's origin — it is told,
  // through the one resolver in `@kgc/shared` that every link here goes through.
  const publicOrigin = publicSiteOrigin();

  return (
    <>
      <PageHeader
        title={title}
        tags={
          <Tag color={tickets.length > 0 ? 'blue' : 'grey'}>
            {tickets.length} {tickets.length === 1 ? 'type' : 'types'}
          </Tag>
        }
        links={[
          <Link key="a" href={ROUTES.createTickets}>
            Attendee tickets
          </Link>,
          <Link key="s" href={ROUTES.ordersSummary}>
            Summary
          </Link>,
          ...(links ?? []),
        ]}
      />

      {tickets.length === 0 ? (
        <Banner kind="warning">
          <strong>No {noun} package is priced yet.</strong> Create one in{' '}
          <Link href={ROUTES.createTickets}>1.1 Create Tickets</Link> with the audience set to{' '}
          <em>{audience}</em>, and it appears on <code>{PUBLIC_PAGE[audience]}</code> immediately.
        </Banner>
      ) : (
        <Banner kind="info">
          <strong>
            {sellable} of {tickets.length} sell right now at{' '}
            <a href={`${publicOrigin}${PUBLIC_PAGE[audience]}`} target="_blank" rel="noreferrer">
              {PUBLIC_PAGE[audience]}
            </a>
            .
          </strong>{' '}
          That page reads this list live — a price edited here is the price charged on the next
          request. Hidden tiers stay purchasable by direct link, which is how a negotiated rate
          works without a second code path.
        </Banner>
      )}

      <Panel>
        {tickets.length === 0 ? (
          <EmptyState icon="◇">
            <strong>
              No ticket type in the catalogue has <code>audience: &apos;{audience}&apos;</code>.
            </strong>
            <p className="muted" style={{ marginTop: 6 }}>
              {all.length} tiers exist in <code>ticketTypes</code> and none of them is a {noun}{' '}
              package. <code>npm run seed</code> writes three exhibitor and four sponsor tiers, so
              an empty list here usually means the seed has not been run against this database.
            </p>
            <p className="muted" style={{ marginTop: 6 }}>
              Otherwise, <Link href={ROUTES.createTickets}>create one</Link> and set{' '}
              <em>Audience</em> to {audience}.
            </p>
          </EmptyState>
        ) : (
          <>
            <Table
              cols={[
                { key: 'name', label: 'Ticket', className: 'cell-fill' },
                { key: 'price', label: 'Price', className: 'cell-sm' },
                { key: 'sold', label: 'Sold', className: 'cell-md' },
                { key: 'window', label: 'On sale', className: 'cell-md' },
                { key: 'edit', label: '', className: 'cell-xs' },
              ]}
              rows={tickets.map((t) => [
                <div key="n">
                  <div>
                    {t.name}{' '}
                    {!t.visible && (
                      <Tag color="grey" small>
                        hidden
                      </Tag>
                    )}
                    {t.featured && (
                      <Tag color="purple" small>
                        featured
                      </Tag>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {t.tagline || <em>no tagline</em>} · <code>{t.id}</code>
                  </div>
                </div>,

                <strong key="p">{money(t.priceCents, t.currency)}</strong>,

                <div key="s">
                  <div style={{ fontSize: 13 }}>
                    {t.quantitySold}
                    {t.quantityTotal ? ` / ${t.quantityTotal}` : ''}
                  </div>
                  {t.quantityTotal ? (
                    <ProgressBar pct={Math.min(100, (t.quantitySold / t.quantityTotal) * 100)} />
                  ) : (
                    <span className="muted" style={{ fontSize: 11 }}>
                      unlimited
                    </span>
                  )}
                </div>,

                <span key="w" className="muted" style={{ fontSize: 12 }}>
                  {t.salesOpenAtLocal || t.salesCloseAtLocal ? (
                    <>
                      {t.salesOpenAtLocal?.slice(0, 10) ?? 'now'} →{' '}
                      {t.salesCloseAtLocal?.slice(0, 10) ?? 'no end'}
                    </>
                  ) : (
                    'always'
                  )}
                </span>,

                <Link key="e" href={`${ROUTES.createTickets}?edit=${t.id}`}>
                  Edit
                </Link>,
              ])}
            />
            <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>
              Edit opens the one ticket editor this dashboard has, on 1.1 Create Tickets. It
              preserves <code>audience</code>, so saving a {noun} tier there leaves it a {noun}{' '}
              tier — which was not true until August 2026 and is the reason this screen was
              read-only for as long as it was.
            </p>
          </>
        )}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 className="section-header">Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>A dedicated {noun} editor.</strong> Edit above opens the attendee-shaped form
            on <Link href={ROUTES.createTickets}>1.1 Create Tickets</Link>. It saves correctly, but
            it has no field for the things only a {noun} package has — booth size, staff pass
            count, banner placement. Those live on other screens or nowhere.
          </li>
          <li>
            <strong>Anything past the price.</strong> Whova attaches question forms, add-ons and —
            for exhibitors — booth inventory to these tiers. Each is its own nav item; none of them
            is implied by the table above.
          </li>
          {notBuilt}
        </ul>
      </GapPanel>
    </>
  );
}
