import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { stripeEnabled, stripeIsLive } from '@/lib/stripe';
import { Banner, PageHeader, Panel, Table, Tag } from '../../ui';

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
export default async function BillingInformationPage() {
  await requireOrganizer();
  const base = `https://dashboard.stripe.com/${stripeIsLive() ? '' : 'test/'}`;

  return (
    <>
      <PageHeader
        title="Billing Information"
        tags={
          stripeEnabled() ? (
            <Tag color={stripeIsLive() ? 'green' : 'orange'} fill="outline">
              {stripeIsLive() ? 'Stripe live' : 'Stripe test mode'}
            </Tag>
          ) : (
            <Tag color="grey">No Stripe key</Tag>
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

      <Banner kind="warning">
        <strong>Payout and tax details are edited in Stripe, never here.</strong> This dashboard
        signs in with a shared passphrase and no per-person identity — changing a bank account
        behind that would be the easiest theft in the product. Stripe has its own login and
        enforces two-factor on exactly these screens, which is where they belong.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where each thing lives</h2>
        <Table
          cols={[
            { key: 'w', label: 'Setting', className: 'cell-md' },
            { key: 'd', label: 'Why it is there', className: 'cell-fill' },
            { key: 'l', label: '', className: 'cell-sm' },
          ]}
          rows={[
            [
              'Bank account for payouts',
              'The account ticket revenue lands in. Stripe enforces two-factor to change it.',
              <a key="l" href={`${base}settings/payouts`} target="_blank" rel="noreferrer">
                Open ↗
              </a>,
            ],
            [
              'Business details and verification',
              'Legal name, address and the identity checks Stripe needs before it will pay out at all.',
              <a key="l" href={`${base}settings/account`} target="_blank" rel="noreferrer">
                Open ↗
              </a>,
            ],
            [
              'Tax registration and the event location',
              'An event ticket is taxed where the event happens, not where the buyer lives. Setting the location is what makes that correct — see SETUP-PAYMENTS.md §5.',
              <a key="l" href={`${base}settings/tax`} target="_blank" rel="noreferrer">
                Open ↗
              </a>,
            ],
            [
              'Invoice branding',
              'The logo and colours on the invoice PDF a company forwards to its finance team.',
              <a key="l" href={`${base}settings/branding`} target="_blank" rel="noreferrer">
                Open ↗
              </a>,
            ],
            [
              'API keys and webhooks',
              'What connects this dashboard and the website to Stripe. Rotating a key here breaks both until the new one is deployed.',
              <a key="l" href={`${base}apikeys`} target="_blank" rel="noreferrer">
                Open ↗
              </a>,
            ],
          ]}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What KGC pays</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
          Nothing to a platform — that is the point of running this ourselves. Stripe takes roughly
          2.9% + $0.30 per transaction and nothing else: no monthly fee, no per-ticket fee, and no
          charge at all in a month with no sales. <code>PAYMENTS.md</code> works through the
          comparison that decided it, which came out at roughly $30,000 across a thousand tickets.
        </p>
      </Panel>
    </>
  );
}
