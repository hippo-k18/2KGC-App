import Link from 'next/link';
import type { ReactNode } from 'react';
import type { TicketAudience } from '@kgc/shared';
import { listTicketTypes, money } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, EmptyState, PageHeader, Panel, ProgressBar, Table, Tag } from '../ui';

/**
 * The exhibitor and sponsor ticket catalogues.
 *
 * Whova ships three parallel catalogue screens — 1.1 Create Tickets, 2.1
 * Exhibitor Tickets, Sponsor Tickets — and they are the same screen three
 * times over a different slice of one price list. `TicketTypeDoc.audience`
 * already models exactly that slice, so this is one component the two unbuilt
 * catalogues share rather than two more copies of the attendee screen that
 * would drift apart the first time a column changed.
 *
 * ── Why these are read-only ─────────────────────────────────────────────────
 *
 * There is exactly one ticket editor in this dashboard, on 1.1 Create Tickets,
 * and its save action writes `audience: 'attendee'` as a literal. Opening an
 * exhibitor tier in it and pressing Save would therefore move that tier into
 * the attendee catalogue — silently, with the form showing nothing about it.
 * An Edit link here would be a trap, so there is not one, and the gap note on
 * each page says why in plain words.
 */

/** The public site sells one audience. Stated here once, cited by both pages. */
export const PUBLIC_SITE_NOTE = (
  <>
    <code>apps/web/src/lib/catalogue.ts</code> filters the catalogue to{' '}
    <code>audience === &apos;attendee&apos;</code> before rendering, so a tier listed below would
    not appear on the public tickets page even if it existed — nothing would sell it.
  </>
);

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

      <Banner kind="warning">
        <strong>Nothing sells {noun} tickets yet.</strong> {PUBLIC_SITE_NOTE}
      </Banner>

      <Panel>
        {tickets.length === 0 ? (
          <EmptyState icon="◇">
            <strong>
              No ticket type in the catalogue has <code>audience: &apos;{audience}&apos;</code>.
            </strong>
            <p className="muted" style={{ marginTop: 6 }}>
              All {all.length} tiers in <code>ticketTypes</code> are attendee tiers — that is what{' '}
              <code>npm run seed</code> writes and it is the only value the ticket form can produce.
              Creating a {noun} tier today means writing the document by hand, and it would still
              have no buyer-facing page.
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
                  {t.salesOpenAt || t.salesCloseAt ? (
                    <>
                      {t.salesOpenAt?.slice(0, 10) ?? 'now'} →{' '}
                      {t.salesCloseAt?.slice(0, 10) ?? 'no end'}
                    </>
                  ) : (
                    'always'
                  )}
                </span>,
              ])}
            />
            <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>
              Read-only. The rows are real documents from <code>ticketTypes</code>; there is no Edit
              link because the only ticket editor in this dashboard rewrites <code>audience</code>{' '}
              to <code>attendee</code> on save.
            </p>
          </>
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 className="section-header">Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Creating or editing a {noun} tier.</strong> The form on{' '}
            <Link href={ROUTES.createTickets}>1.1 Create Tickets</Link> hard-codes{' '}
            <code>audience: &apos;attendee&apos;</code> in its save action. Pointing it at a {noun}{' '}
            tier would convert that tier on save, so it is not pointed here at all. An audience
            selector in that one action is the smallest change that would open this screen up.
          </li>
          <li>
            <strong>A place to buy one.</strong> The website builds its tickets page from the
            attendee slice only, and Checkout is handed line items from that same list. A {noun}{' '}
            catalogue with no purchase route is a price list, not a product.
          </li>
          <li>
            <strong>Anything past the price.</strong> Whova attaches question forms, add-ons and —
            for exhibitors — booth inventory to these tiers. Each of those is its own nav item and
            its own unbuilt screen; none of them is implied by the table above.
          </li>
          {notBuilt}
        </ul>
      </Panel>
    </>
  );
}
