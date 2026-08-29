import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Setup › 1.7 Registration Settings.
 *
 * Whova's version is a settings bag: when registration opens and closes, how
 * many tickets exist, whether a waitlist takes over, whether transfers are
 * allowed.
 *
 * Three of those are already enforced here, and they are enforced in the place
 * that matters — `catalogue.ts`'s `availability()`, evaluated at read time on
 * every request rather than stored as a boolean that needs a cron job to stay
 * true. `startCheckout` then refuses a tier that is not on sale, so the rule
 * holds even for someone who kept an old page open.
 *
 * The point of this screen is to show which settings are real, per tier, rather
 * than to offer a form for settings that would change nothing.
 */
export default async function RegistrationSettingsPage() {
  await requireOrganizer();
  const tiers = await listTicketTypes();

  const fmt = (iso?: string) => (iso ? iso.slice(0, 10) : '—');

  return (
    <>
      <PageHeader
        title="1.7 Registration Settings"
        links={[
          <Link key="c" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
          <Link key="p" href="/tickets/ticket-setup/1-4-registration-pages">
            Registration Pages
          </Link>,
          <Link key="a" href="/tickets/ticket-setup/1-6-abandoned-registration">
            Abandoned Registration
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>These settings live on the ticket type, not on the event.</strong> Sales windows,
        capacity and visibility are per tier, checked on every catalogue read and again at checkout —
        so closing a tier closes it for someone who kept the page open. Edit them in{' '}
        <Link href={ROUTES.createTickets}>Create Tickets</Link>.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Per-tier settings that are enforced</h2>
        <Table
          cols={[
            { key: 'n', label: 'Tier', className: 'cell-md' },
            { key: 'o', label: 'Opens', className: 'cell-sm' },
            { key: 'c', label: 'Closes', className: 'cell-sm' },
            { key: 'q', label: 'Capacity', className: 'cell-sm' },
            { key: 'v', label: 'Catalogue', className: 'cell-fill' },
          ]}
          rows={tiers.map((t) => [
            t.name,
            fmt(t.salesOpenAt),
            fmt(t.salesCloseAt),
            typeof t.quantityTotal === 'number' ? (
              <span key="q">
                {t.quantitySold}/{t.quantityTotal}
              </span>
            ) : (
              <span key="q" className="muted">
                unlimited
              </span>
            ),
            t.visible ? (
              <Tag key="v" color="green" small>
                listed
              </Tag>
            ) : (
              <Tag key="v" color="grey" small>
                link only
              </Tag>
            ),
          ])}
          empty="No ticket types — run `npm run seed`. An empty catalogue throws rather than charging a stale price."
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          Sold-out is <code>quantitySold &gt;= quantityTotal</code>, and <code>quantitySold</code> is
          incremented server-side at fulfilment — not from a client, and not from a count of orders
          that would double-count a partially refunded one.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Event-level settings that have no home</h2>
        <Table
          cols={[
            { key: 's', label: 'Setting', className: 'cell-md' },
            { key: 'n', label: 'Where it would have to live', className: 'cell-fill' },
          ]}
          rows={[
            [
              'Waitlist when sold out',
              'A collection of hopefuls plus a rule for who gets released capacity. Sold-out today is a dead end with a message.',
            ],
            [
              'Ticket transfer to another person',
              'The registration is keyed by a hash of the email address, so a transfer is a new registration and a revoked qrSecret — not an edit. Worth designing before it is needed at the door.',
            ],
            [
              'Refund policy and self-service refunds',
              'Refunds are issued by an organizer from Attendee Orders. Letting an attendee trigger one needs a policy window and an authenticated path from the app, which does not exist.',
            ],
            [
              'Registration cut-off for the whole event',
              'Would be one date rather than four. Today closing registration means setting a close date on each tier.',
            ],
          ]}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No form on this screen, on purpose.</strong> The fields it would edit belong to
            the ticket type and are edited where the ticket type is. A second editor is a second
            answer to &ldquo;when does the early-bird close&rdquo;.
          </li>
          <li>
            <strong>No waitlist, no transfers, no attendee-initiated refunds.</strong> Each is a
            policy decision first and a screen second.
          </li>
          <li>
            <strong>No event-wide registration switch.</strong> There is a{' '}
            <code>settings</code> collection that could hold one, but nothing on the purchase path
            reads it, and a switch that does not switch anything is worse than none.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
