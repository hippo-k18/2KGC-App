import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { stripeEnabled, stripeIsLive } from '@/lib/stripe';
import { Banner, PageHeader, Panel, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Pay › Billing Information.
 *
 * ── Nothing here is editable, and that is the safe answer ───────────────────
 *
 * This is where Whova keeps the card it charges you on and the bank account it
 * pays you into. Both live in Stripe for us, behind Stripe's own login and
 * their own two-factor.
 *
 * Putting a bank-account form on a dashboard whose only credential is a shared
 * passphrase would be the single worst security decision available in this
 * product — payout details are exactly what an attacker changes. So this screen
 * links out and explains, and every field is a deep link rather than an input.
 */
const SETTINGS = [
  {
    name: 'Bank account for payouts',
    why: 'The account ticket revenue lands in.',
    path: 'settings/payouts',
  },
  {
    name: 'Business details and verification',
    why: 'Legal name, address and the identity checks Stripe needs before it pays out.',
    path: 'settings/account',
  },
  {
    name: 'Tax registration and the event location',
    why: 'An event ticket is taxed where the event happens, not where the buyer lives.',
    path: 'settings/tax',
  },
  {
    name: 'Invoice branding',
    why: 'The logo and colours on the invoice PDF.',
    path: 'settings/branding',
  },
  {
    name: 'API keys and webhooks',
    why: 'What connects this dashboard and the website to Stripe. Changing a key stops ticket sales until the new one is in place.',
    path: 'apikeys',
  },
];

export default async function BillingInformationPage() {
  await requireOrganizer();
  const base = `https://dashboard.stripe.com/${stripeIsLive() ? '' : 'test/'}`;

  return (
    <>
      <PageHeader
        title="Billing Information"
        info={
          <>
            <strong>Edited in Stripe</strong>
            <p>
              Payout and tax details stay behind Stripe&rsquo;s own login and two-factor. Every row
              below opens Stripe.
            </p>
            {stripeEnabled() ? null : (
              <p>Stripe is not connected yet, so these links open an empty account.</p>
            )}
          </>
        }
        tags={
          stripeEnabled() ? (
            <Tag color={stripeIsLive() ? 'green' : 'orange'} fill="outline">
              {stripeIsLive() ? 'Stripe live' : 'Stripe test mode'}
            </Tag>
          ) : (
            <Tag color="grey">Stripe not connected</Tag>
          )
        }
        links={[
          <Link key="b" href="/pay/balance">
            Balance
          </Link>,
          <Link key="o" href={ROUTES.attendeeOrders}>
            Attendee orders
          </Link>,
        ]}
      />

      {/*
        Operational, and about money: an organizer who came here to change the
        bank account has to be told, before they hunt for a form, that the change
        happens in Stripe. The reasoning behind that — a shared passphrase is the
        wrong credential for a payout detail — is a caveat and sits in the `info`
        tip instead.
      */}
      <Banner kind="warning">
        <strong>Payout and tax details are edited in Stripe, not here.</strong> A change made there
        takes effect immediately. Every row below opens the {stripeIsLive() ? 'live' : 'test'}{' '}
        Stripe dashboard.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where each thing lives</h2>
        {SETTINGS.map((row) => (
          <div
            key={row.path}
            style={{
              alignItems: 'baseline',
              borderTop: '1px solid var(--hairline)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px 16px',
              padding: '12px 0',
            }}
          >
            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
              <strong>{row.name}</strong>
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                {row.why}
              </div>
            </div>
            <a href={`${base}${row.path}`} target="_blank" rel="noreferrer">
              Open in Stripe ↗
            </a>
          </div>
        ))}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What KGC pays</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
          Stripe takes roughly 2.9% + $0.30 per transaction. There is no monthly fee, no per-ticket
          fee and no platform fee on top.
        </p>
      </Panel>
    </>
  );
}
