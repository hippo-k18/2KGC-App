import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listDiscountCodes, type DiscountCodeRow } from '@/lib/discount-codes';
import { ROUTES } from '@/lib/nav';
import { stripeEnabled, stripeIsLive } from '@/lib/stripe';
import { Banner, EmptyState, PageHeader, Panel, Table, Tag } from '../../../ui';
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

  if (!stripeEnabled()) {
    return (
      <>
        <PageHeader title="Discount Codes" tags={<Tag color="grey">no Stripe key</Tag>} />
        <Panel>
          <EmptyState icon="◌">
            <strong>Discount codes live in Stripe, and no Stripe key is configured.</strong>
            <p className="muted" style={{ marginTop: 6 }}>
              Codes are validated by Stripe at the moment of payment rather than stored here, so
              there is nothing to show without a key. Set <code>STRIPE_SECRET_KEY</code> — see{' '}
              <code>SETUP-PAYMENTS.md</code> §1.
            </p>
          </EmptyState>
        </Panel>
      </>
    );
  }

  let codes: DiscountCodeRow[] = [];
  let loadError: string | undefined;
  try {
    codes = await listDiscountCodes();
  } catch (err) {
    // Reading a third party can fail in ways Firestore does not. Say so rather
    // than rendering an empty table that reads as "you have no codes".
    loadError = err instanceof Error ? err.message : 'Stripe could not be reached.';
  }

  const live = codes.filter((c) => c.active).length;

  return (
    <>
      <PageHeader
        title="Discount Codes"
        tags={
          <Tag color={stripeIsLive() ? 'green' : 'orange'} fill="outline">
            {stripeIsLive() ? 'Stripe live' : 'Stripe test mode'}
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
          <strong>Could not read codes from Stripe.</strong> {loadError} This screen reads Stripe
          live rather than a local copy — nothing is wrong with your codes, only with reading them.
        </Banner>
      )}

      <Banner kind="info">
        Codes are entered by the buyer on Stripe&rsquo;s checkout page and validated there. A code
        created here works immediately — there is nothing to publish and no cache to clear.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Create a code</h2>
        <CodeForm />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>
          Codes ({live} live of {codes.length})
        </h2>
        <Table
          cols={[
            { key: 'code', label: 'Code', className: 'cell-md' },
            { key: 'discount', label: 'Discount', className: 'cell-sm' },
            { key: 'used', label: 'Used', className: 'cell-sm' },
            { key: 'expires', label: 'Expires', className: 'cell-sm' },
            { key: 'status', label: 'Status', className: 'cell-sm' },
            { key: 'act', label: '', className: 'cell-sm' },
          ]}
          rows={codes.map((c) => [
            <code key="c" style={{ fontSize: 13, fontWeight: 600 }}>
              {c.code}
            </code>,
            <span key="d">{c.discount}</span>,
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
                  padding: 0,
                }}
              >
                {c.active ? 'Turn off' : 'Turn on'}
              </button>
            </form>,
          ])}
          empty="No discount codes yet. Speakers, sponsor allocations, early-bird and academic rates are the usual four."
        />
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>
          ⚠️ This lists every promotion code on the Stripe account, not only KGC&rsquo;s — nothing on
          a Stripe code scopes it to an event unless it was created here. Codes are deactivated
          rather than deleted, because Stripe keeps the code attached to every payment that used it.
        </p>
      </Panel>
    </>
  );
}
