import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listDiscountCodes, type DiscountCodeRow } from '@/lib/discount-codes';
import { ROUTES } from '@/lib/nav';
import { listTicketTypes } from '@/lib/commerce';
import { discountsAreLive, discountsEnabled } from '@/lib/stripe';
import { Banner, EmptyState, NotInputted, PageHeader, Panel, Table, Tag } from '../../../ui';
import { toggleDiscountCodeAction } from './actions';
import { CodeForm } from './code-form';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Setup › Discount Codes.
 *
 * ── The only screen here that reads a third party live ──────────────────────
 *
 * Every other console screen reads Firestore. This one reads Stripe, because
 * Stripe is what validates a code at the moment of payment — against its own
 * redemption counters and expiry rules, which nothing here can see. A mirrored
 * copy in Firestore could only ever disagree, and the way it would disagree is
 * telling an organizer a code is exhausted while it still works.
 *
 * The cost is honest and worth stating: if Stripe is slow or down, this screen
 * is slow or down. Nothing else in the console is.
 */

function statusTag(c: DiscountCodeRow) {
  if (!c.active) return <Tag color="grey" fill="outline">inactive</Tag>;
  if (c.maxRedemptions && c.timesRedeemed >= c.maxRedemptions) {
    return <Tag color="orange" fill="outline">used up</Tag>;
  }
  if (c.expiresAt && new Date(c.expiresAt) < new Date()) {
    return <Tag color="orange" fill="outline">expired</Tag>;
  }
  return <Tag color="green" fill="outline">live</Tag>;
}

export default async function DiscountCodesPage() {
  await requireOrganizer();

  if (!discountsEnabled()) {
    return (
      <>
        <PageHeader
          title="Discount Codes"
          info={
            <>
              <strong>Waiting on Stripe</strong>
              <p>
                Codes are created and checked in Stripe, so the dashboard needs its discount key
                (<code>STRIPE_DISCOUNTS_KEY</code>) first. It is a restricted key that can write
                coupons, promotion codes and products, and nothing else.
              </p>
            </>
          }
          tags={<Tag color="grey">Stripe not connected</Tag>}
        />
        <Panel>
          <EmptyState icon="◌">
            <p className="empty-title">Discount codes need Stripe</p>
            <p className="empty-sub">Add the Stripe discount key to create and track codes.</p>
          </EmptyState>
        </Panel>
      </>
    );
  }

  let codes: DiscountCodeRow[] = [];
  let loadError: string | undefined;
  // Attendee tickets a code can be limited to. An add-on is left out because it
  // is never a line of its own at checkout; its bundle is listed instead. An
  // extra (Workshops) is a line of its own, so it is listed. A bundle with an
  // extra in it was retired when Workshops became its own ticket (2026-10-06)
  // and sells nothing, so a code limited to it could never apply.
  // Both reads at once: the page waited for Firestore before it asked Stripe.
  const [ticketRows, listed] = await Promise.all([
    listTicketTypes(),
    listDiscountCodes().then(
      (rows) => ({ rows }),
      (err: unknown) => ({ err }),
    ),
  ]);
  const tickets = ticketRows
    .filter((t) => t.audience === 'attendee' && (!t.addOnFor || t.kind === 'extra'))
    .filter((t) => !(t.bundleOf ?? []).some((id) => ticketRows.find((p) => p.id === id)?.kind === 'extra'))
    .map((t) => ({ id: t.id, name: t.name, hidden: !t.visible }));
  if ('rows' in listed) {
    codes = listed.rows;
  } else {
    // Reading a third party can fail in ways Firestore does not. Say so rather
    // than rendering an empty table that reads as "you have no codes".
    loadError = listed.err instanceof Error ? listed.err.message : 'Stripe could not be reached.';
  }

  const live = codes.filter((c) => c.active).length;

  return (
    <>
      <PageHeader
        title="Discount Codes"
        info={
          <>
            <strong>Codes are kept in Stripe</strong>
            <p>
              A code created here works at checkout right away. The list shows every code on the
              Stripe account.
            </p>
          </>
        }
        tags={
          <Tag color={discountsAreLive() ? 'green' : 'orange'} fill="outline">
            {discountsAreLive() ? 'Stripe live' : 'Stripe test mode'}
          </Tag>
        }
        links={[
          <Link key="t" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
          <Link key="o" href={ROUTES.attendeeOrders}>
            Attendee Orders
          </Link>,
        ]}
      />

      {loadError && (
        <Banner kind="danger">
          <strong>Could not read codes from Stripe.</strong> {loadError} Your codes are
          not affected.
        </Banner>
      )}

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Create a code</h2>
        <CodeForm tickets={tickets} />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>
          Codes ({live} live of {codes.length})
        </h2>
        <Table
          /*
           * Every fixed width here plus the one fill column has to fit the
           * panel. Seven fixed columns added up to 1,224px in a panel about
           * 1,120px wide, and the last column, the Turn off button, was pushed
           * past the panel's edge with only its first letter showing.
           */
          cols={[
            { key: 'code', label: 'Code', className: 'cell-mdsm' },
            { key: 'discount', label: 'Discount', className: 'cell-xsm' },
            { key: 'applies', label: 'Applies to', className: 'cell-fill' },
            { key: 'used', label: 'Used', className: 'cell-xsm' },
            { key: 'expires', label: 'Expires', className: 'cell-xsm' },
            { key: 'status', label: 'Status', className: 'cell-xsm' },
            { key: 'act', label: '', className: 'cell-xsm' },
          ]}
          rows={codes.map((c) => [
            <code key="c" style={{ fontSize: 13, fontWeight: 600 }}>
              {c.code}
            </code>,
            <span key="d">{c.discount}</span>,
            <span key="t" style={{ fontSize: 12 }}>
              {c.appliesTo.length ? c.appliesTo.join(', ') : 'All tickets'}
            </span>,
            <span key="u">
              {c.timesRedeemed}
              {c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''}
              {c.restrictions.length > 0 && (
                <div className="muted" style={{ fontSize: 11 }}>
                  {c.restrictions.join(' · ')}
                </div>
              )}
            </span>,
            <span key="e" className="muted" style={{ fontSize: 12 }}>
              {c.expiresAt ? c.expiresAt.slice(0, 10) : 'never'}
            </span>,
            statusTag(c),
            <form key="a" action={toggleDiscountCodeAction}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="active" value={String(c.active)} />
              {/*
                A form rather than a link: turning a code off is a write, and a
                GET that changes state is one link prefetch away from disabling
                a live discount by accident.
              */}
              <button
                type="submit"
                style={{
                  background: 'none',
                  border: 0,
                  color: 'var(--link)',
                  cursor: 'pointer',
                  fontSize: 12,
                  minHeight: 32,
                  padding: '0 6px',
                }}
              >
                {c.active ? 'Turn off' : 'Turn on'}
              </button>
            </form>,
          ])}
          empty={<NotInputted what="discount codes" compact />}
        />
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>
          This lists every code on the Stripe account, not only this event&rsquo;s. Codes can be
          turned off but not deleted.
        </p>
      </Panel>
    </>
  );
}
