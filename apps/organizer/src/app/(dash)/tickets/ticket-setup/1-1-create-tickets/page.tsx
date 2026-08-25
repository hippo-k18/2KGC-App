import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes, money } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, EmptyState, PageHeader, Panel, ProgressBar, Table, Tag } from '../../../ui';
import { toggleTicketVisibilityAction } from './actions';
import { TicketForm } from './ticket-form';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Setup › 1.1 Create Tickets.
 *
 * Whova numbers this screen and so do we — the Tickets tab is a sequenced
 * setup flow in their product ("Step 1", "Step 2", "Step 3") and renumbering it
 * would be exactly the kind of tidier-but-unfamiliar change the rebuild is
 * meant to avoid.
 *
 * ── What is real here ───────────────────────────────────────────────────────
 *
 * These documents *are* the price list. The website reads `ticketTypes` to
 * decide what to sell and Stripe Checkout is handed `priceCents` from the same
 * document — so an edit here changes what the next buyer pays, immediately, with
 * no deploy. That is the point of the screen and also the reason every save is
 * audited.
 *
 * ── What Whova has that this does not ───────────────────────────────────────
 *
 * Ticket add-ons, group tickets, question forms and invite-only ticketing are
 * all separate nav items and all unbuilt; they render the honest gap note. This
 * screen deliberately does not hint at them.
 */
export default async function CreateTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string }>;
}) {
  await requireOrganizer();
  const { edit, new: creating } = await searchParams;

  const tickets = await listTicketTypes();
  const editing = edit ? tickets.find((t) => t.id === edit) : undefined;
  const showForm = Boolean(creating) || Boolean(editing);

  const totalSold = tickets.reduce((n, t) => n + t.quantitySold, 0);

  return (
    <>
      <PageHeader
        title="1.1 Create Tickets"
        tags={<Tag color="blue">{tickets.length} types</Tag>}
        actions={
          !showForm ? (
            <Link href="?new=1" className="whova-btn-main">
              + Create ticket
            </Link>
          ) : (
            <Link href={ROUTES.createTickets} className="whova-btn-main secondary">
              Back to list
            </Link>
          )
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

      {showForm ? (
        <Panel>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>
            {editing ? `Edit ${editing.name}` : 'New ticket type'}
          </h2>
          {editing && editing.quantitySold > 0 && (
            <Banner kind="info">
              <strong>{editing.quantitySold} of these have already been sold.</strong> Changing the
              price affects future purchases only — past orders keep the amount they were charged.
            </Banner>
          )}
          <TicketForm existing={editing} />
        </Panel>
      ) : (
        <Panel>
          {tickets.length === 0 ? (
            <EmptyState
              icon="◇"
              action={
                <Link href="?new=1" className="whova-btn-main">
                  Create the first ticket
                </Link>
              }
            >
              <strong>Nothing is on sale.</strong>
              <p className="muted" style={{ marginTop: 6 }}>
                The website has nothing to sell until a ticket type exists here — its tickets page
                will show an error rather than guess at a price. Run <code>npm run seed</code> to
                restore the four standard tiers, or create one now.
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
                  { key: 'act', label: '', className: 'cell-sm' },
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
                        {t.salesOpenAt?.slice(0, 10) ?? 'now'} → {t.salesCloseAt?.slice(0, 10) ?? 'no end'}
                      </>
                    ) : (
                      'always'
                    )}
                  </span>,

                  <div key="a" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <Link href={`?edit=${t.id}`} style={{ fontSize: 12 }}>
                      Edit
                    </Link>
                    {/*
                      A form rather than a link, because toggling visibility is a
                      write — and a GET that changes state is one prefetch away
                      from taking a ticket off sale by accident.
                    */}
                    <form action={toggleTicketVisibilityAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button
                        type="submit"
                        style={{
                          background: 'none',
                          border: 0,
                          color: 'var(--link)',
                          cursor: 'pointer',
                          fontSize: 12,
                          padding: 0,
                        }}
                      >
                        {t.visible ? 'Hide' : 'Show'}
                      </button>
                    </form>
                  </div>,
                ])}
              />

              <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>
                {totalSold} {totalSold === 1 ? 'ticket' : 'tickets'} sold across all types. There is
                no delete: orders reference a ticket type by id, and removing one would leave those
                orders pointing at nothing. Hide it instead.
              </p>
            </>
          )}
        </Panel>
      )}
    </>
  );
}
