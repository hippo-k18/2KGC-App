import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes, money, soldCountLedger } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import {
  Banner,
  EmptyState,
  GapPanel,
  PageHeader,
  Panel,
  ProgressBar,
  Table,
  Tag,
} from '../../../ui';
import { toggleTicketVisibilityAction } from './actions';
import { SoldCountForm } from './sold-count-form';
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

  const [all, ledger] = await Promise.all([listTicketTypes(), soldCountLedger()]);

  /**
   * The list is the attendee catalogue; the editor is universal.
   *
   * Whova's 1.1 is the attendee flow — exhibitor and sponsor packages have
   * their own numbered trees, and mixing all three into one table makes "how
   * many tickets do we sell?" unanswerable. But there is exactly one ticket
   * editor in this dashboard, so `editing` looks in the full catalogue: the
   * Edit links on 2.1 Exhibitor Tickets and Sponsor Tickets land here, and the
   * save action preserves `audience` so a round trip does not reclassify them.
   */
  const tickets = all.filter((t) => t.audience === 'attendee');
  const editing = edit ? all.find((t) => t.id === edit) : undefined;
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
          {editing && editing.audience !== 'attendee' && (
            /*
              Arrived from 2.1 Exhibitor Tickets or Sponsor Tickets. Saying so
              matters because the surrounding screen is titled "1.1 Create
              Tickets" and every other tier on it is an attendee tier — an
              organizer who does not notice which record they opened is one Save
              away from editing the wrong price list.
            */
            <Banner kind="info">
              <strong>This is a {editing.audience} package, not an attendee ticket.</strong> It
              sells at <code>/tickets/{editing.audience}</code> and stays a {editing.audience}{' '}
              package when you save — the Audience field below is what decides that.
            </Banner>
          )}
          {editing && editing.quantitySold > 0 && (
            <Banner kind="info">
              <strong>{editing.quantitySold} of these have already been sold.</strong> Changing the
              price affects future purchases only — past orders keep the amount they were charged.
            </Banner>
          )}
          {/*
            The oversell window, stated where the cap is set.

            Capacity is checked when an invoice is raised and not again when it
            is paid, so seats on an unpaid invoice are spoken for without being
            counted. On net-30 terms that is thirty days in which a capped tier
            can be sold out from under one, and the oversell arrives as a fait
            accompli. Nothing in this app can close that window — the re-check
            belongs in the webhook — but the arithmetic can at least be on the
            screen where the cap is typed.
          */}
          {editing &&
            editing.quantityTotal !== undefined &&
            (ledger.outstanding.get(editing.id) ?? 0) > 0 &&
            editing.quantitySold + (ledger.outstanding.get(editing.id) ?? 0) >
              editing.quantityTotal && (
              <Banner kind="warning">
                <strong>
                  {ledger.outstanding.get(editing.id)} more seats are on invoices that have been
                  raised and not paid.
                </strong>{' '}
                {editing.quantitySold} sold plus those exceeds the cap of {editing.quantityTotal}.
                Capacity is checked when an invoice is raised, not when it is paid, so every one of
                them will register on payment whatever this cap says.
              </Banner>
            )}
          <TicketForm existing={editing} />
          {editing && (
            <SoldCountForm
              id={editing.id}
              name={editing.name}
              stored={editing.quantitySold}
              ledger={ledger.sold.get(editing.id) ?? 0}
            />
          )}
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
                    {/*
                      The counter against the ledger. It only appears when the
                      two disagree, because on a healthy catalogue this column
                      should be a number and not a reconciliation.
                    */}
                    {(ledger.sold.get(t.id) ?? 0) !== t.quantitySold && (
                      <div style={{ color: 'var(--danger)', fontSize: 11 }}>
                        orders say {ledger.sold.get(t.id) ?? 0}
                      </div>
                    )}
                  </div>,

                  /*
                    The event's wall clock, not the server's. Slicing the UTC
                    instant printed the wrong day for any window closing after
                    20:00 Eastern — and "sales close 30 April" that is really
                    1 May is the kind of wrong that surfaces in an argument
                    with a buyer.
                  */
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

      {/*
        What this editor writes, and where it lands.

        This panel used to list seven fields that saved correctly and reached
        nothing, each with the file and line of the missing half. All seven were
        built on 2026-08-31 and the list is gone rather than ticked off — a gap
        note that outlives its gap is the thing this flag exists to prevent.

        What remains is genuinely not a `/tickets` problem, so it is stated as
        one item rather than seven.
      */}
      <GapPanel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What a tier still cannot express</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Every field on this form now reaches the public site, the order ledger or both.
          Price, currency, the grouped &ldquo;what&rsquo;s included&rdquo; list, the sales
          window, the highlight, the tagline, sold-out state and both entitlements were
          the seven gaps here and are closed.
        </p>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
          <li>
            <strong>An add-on is still not a product — but a second ticket is.</strong>{' '}
            The Checkout session no longer builds one line item with{' '}
            <code>quantity: 1</code>. It groups the seats on a purchase by tier and gives
            each group a real Stripe quantity, so several tiers go on one payment and any
            of them can be bought more than once. The combinatorial price list is gone:
            a workshop day sold beside a conference ticket is two line items, not a
            &ldquo;conference + workshop&rdquo; tier.
            <br />
            What that does <em>not</em> reach is an extra bought for somebody who already
            holds a ticket — a dinner place, a t-shirt.{' '}
            <code>RegistrationDoc.ticketType</code> is a single string and a registration
            is keyed by email, so a second tier bought against the same address renames
            their ticket rather than adding to it. Every seat on a purchase has to be a
            different person. Selling a genuine add-on needs a purchasable thing that is
            not a seat, which <code>TicketTypeDoc</code> does not model.
          </li>
          <li>
            <strong>No min or max per order, no fee model, no refund policy field.</strong>{' '}
            Three things Whova&rsquo;s tier editor has that <code>TicketTypeDoc</code> does
            not model at all. Adding a control here would be adding a field nothing reads.
          </li>
          <li>
            <strong>A tier cannot be archived.</strong> There is deliberately no delete
            (orders reference tiers, and history must not rewrite), and{' '}
            <em>hide</em> covers most of it — but the catalogue grows forever, and a
            long-finished 2026 tier still appears in every dashboard table.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
