import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes, money, salesSummary } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Attendee Customization › Ticket Tiering.
 *
 * ── Two different things are called "tiering" ───────────────────────────────
 *
 * 1. **Price tiers over time or volume** — early bird until March, then
 *    standard, then late. Whova switches the price automatically.
 * 2. **Entitlement tiers** — what each ticket gets you inside the event.
 *
 * This project has the second and not the first, and the distinction is easy to
 * lose because both are lists of prices. The entitlement half is real and load
 * bearing: `includesWorkshops` and `includesVideoLibrary` are read as
 * entitlements by other screens rather than inferred from marketing copy, which
 * is exactly the mistake `attendees/ticket-session-mapping` documents refusing
 * to make.
 *
 * The time-based half is fakeable today with a close date on one tier and an
 * open date on the next, and the reason that is not quite the same thing is
 * spelled out below rather than glossed.
 */
export default async function TicketTieringPage() {
  await requireOrganizer();
  const [tiers, sales] = await Promise.all([listTicketTypes(), salesSummary()]);
  const sold = (name: string) => sales.byTier.find((b) => b.name === name);

  return (
    <>
      <PageHeader
        title="Ticket Tiering"
        links={[
          <Link key="c" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
          <Link key="a" href="/tickets/attendee-customization/attendee-categories">
            Attendee Categories
          </Link>,
          <Link key="s" href={ROUTES.ordersSummary}>
            Orders Summary
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The ladder as it stands</h2>
        <Table
          cols={[
            { key: 'n', label: 'Tier', className: 'cell-md' },
            { key: 'p', label: 'Price', className: 'cell-sm' },
            { key: 's', label: 'Sold', className: 'cell-sm' },
            { key: 'e', label: 'Entitlements', className: 'cell-fill' },
          ]}
          rows={tiers.map((t) => [
            <span key="n">
              {t.name}
              <div className="muted" style={{ fontSize: 12 }}>{t.tagline || '—'}</div>
            </span>,
            money(t.priceCents, t.currency),
            sold(t.name)?.sold ?? 0,
            <span key="e">
              {t.inPerson ? <Tag color="blue" small>in person</Tag> : <Tag color="orange" small>remote</Tag>}{' '}
              {t.includesWorkshops ? <Tag color="green" small>workshops</Tag> : null}{' '}
              {t.includesVideoLibrary ? <Tag color="green" small>video library</Tag> : null}
            </span>,
          ])}
          empty="No ticket types — run `npm run seed`."
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          Sold counts come from order line items, not from multiplying a price by a headcount — a
          discount code or a partial refund makes the second number plausibly wrong, which is worse
          than obviously wrong.
        </p>
      </Panel>

      <Banner kind="warning">
        <strong>There is no automatic price change.</strong> A price is one number on the ticket
        type. Early bird is currently done by hand: close one tier, open another, and accept that
        the two are separate products in every report.
      </Banner>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Why two tiers is not the same as one tier that changes price</h2>
        <p className="body-2">
          Closing &ldquo;Early Bird&rdquo; and opening &ldquo;Standard&rdquo; gets the money right
          and the reporting wrong. They become two rows everywhere — the sales summary, the tier
          breakdown, the exports — so &ldquo;how many main-conference tickets have we sold&rdquo;
          needs somebody to remember to add two numbers, forever. Whova&rsquo;s version keeps one
          product with a schedule of prices, which is a small data-model change (a price list with
          dates) and a large reporting difference.
        </p>
        <p className="body-2">
          The volume-based variant — first 50 at one price — is harder than it looks for the same
          reason capacity is: the switch has to happen server-side at fulfilment, not when the page
          renders, or two people who load the page at the same time see the same last cheap seat.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No scheduled or volume-triggered pricing.</strong> One price per ticket type,
            changed by editing it.
          </li>
          <li>
            <strong>No editing from this screen.</strong> Tiers are created and edited in{' '}
            <Link href={ROUTES.createTickets}>Create Tickets</Link>; this is the read-only view of
            how the ladder is shaped.
          </li>
          <li>
            <strong>Entitlements are two booleans, not a list.</strong> Anything beyond workshops
            and the video library needs the add-on model, which does not exist — see{' '}
            <Link href="/tickets/ticket-setup/ticket-add-ons">Ticket Add-ons</Link>. The video
            library itself is sold on two tiers and served by nothing.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
