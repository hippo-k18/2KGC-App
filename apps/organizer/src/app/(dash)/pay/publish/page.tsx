import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { money, salesSummary } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { stripeEnabled, stripeIsLive } from '@/lib/stripe';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Pay › Publish — which is Whova's name for sales tax settings.
 *
 * ── Why this is a link and not a form ───────────────────────────────────────
 *
 * Whova is the merchant of record, so Whova collects tax and needs you to tell
 * it your rates. We are not: Stripe is, `automatic_tax` is already enabled on
 * every Checkout session and invoice, and every line carries Stripe's ticketing
 * tax code. A tax form in this dashboard would be a second set of rates that
 * disagrees with the ones actually applied at checkout, and the disagreement
 * would surface as a filing problem months later.
 *
 * ── The thing that is easy to get backwards ─────────────────────────────────
 *
 * An event ticket is taxed **where the event happens**, not where the buyer
 * lives. That is unlike almost everything else Stripe Tax handles, and getting
 * it wrong still produces a plausible number on the invoice — which is what
 * makes it dangerous. KGC is at Cornell Tech on Roosevelt Island, so the
 * jurisdiction is New York, and a buyer in Berlin owes New York's treatment
 * rather than German VAT. This is set in Stripe by declaring the event
 * location; without it Stripe taxes by billing address, which is the wrong
 * answer computed correctly.
 *
 * `SETUP-PAYMENTS.md` §5 is the full checklist.
 */
const STEPS: { name: string; detail: string; path?: string }[] = [
  {
    name: 'Tickets are marked as event admission',
    detail: 'Sent to Stripe on every checkout and invoice.',
  },
  {
    name: 'Billing address collected',
    detail: 'Required at checkout. Stripe needs it to work out tax.',
  },
  {
    name: 'Turn on tax and set the event location',
    detail: 'Done in Stripe. Until the location is set, Stripe taxes by billing address.',
    path: 'settings/tax',
  },
  {
    name: 'New York registration',
    detail: 'Stripe warns when sales cross a threshold. Whether to register is a question for an accountant.',
    path: 'tax/registrations',
  },
];

export default async function PublishTaxPage() {
  await requireOrganizer();
  const s = await salesSummary();
  const live = stripeIsLive();
  const dash = (path: string) => `https://dashboard.stripe.com/${live ? '' : 'test/'}${path}`;

  return (
    <>
      <PageHeader
        title="Publish"
        info={
          <>
            <strong>Sales tax</strong>
            <p>Stripe computes and collects the tax, so there are no rates to type here.</p>
            {stripeEnabled() ? null : (
              <p>Stripe is not connected yet, so nothing has been taxed.</p>
            )}
          </>
        }
        actions={
          <a href={dash('settings/tax')} target="_blank" rel="noreferrer" className="whova-btn-main secondary">
            Stripe Tax settings ↗
          </a>
        }
        links={[
          <Link key="b" href="/pay/balance">
            Balance
          </Link>,
          <Link key="o" href={ROUTES.ordersSummary}>
            Orders Summary
          </Link>,
          <Link key="i" href="/pay/billing-information">
            Billing Information
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>An event ticket is taxed where the event happens, not where the buyer lives.</strong>{' '}
        KGC is at Cornell Tech, Roosevelt Island, so New York rules apply to every buyer. Until the
        event location is set in Stripe, Stripe taxes by billing address instead.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Tax collected', value: money(s.taxCents, s.currency), sub: 'as recorded on orders' },
          { label: 'Gross sales', value: money(s.grossCents, s.currency), sub: `${s.paidOrders} orders` },
          {
            label: 'Effective rate',
            value: s.grossCents === 0 ? '—' : `${((s.taxCents / s.grossCents) * 100).toFixed(1)}%`,
            sub: 'tax ÷ gross',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Tax setup</h2>
        {STEPS.map((row) => (
          <div
            key={row.name}
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
                {row.detail}
              </div>
            </div>
            {row.path ? (
              <a href={dash(row.path)} target="_blank" rel="noreferrer">
                Open in Stripe ↗
              </a>
            ) : (
              <Tag color="green" fill="outline">
                Done
              </Tag>
            )}
          </div>
        ))}
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          Links open the {live ? 'live' : 'test'} Stripe dashboard.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No tax rates or exemption rules.</strong> Stripe computes tax and is the only
            system that knows what was actually charged. A rate typed here would be a second,
            wronger source of truth.
          </li>
          <li>
            <strong>No tax-exempt handling.</strong> Universities and non-profits routinely claim
            exemption; that means collecting and storing an exemption certificate, which is a
            document-retention job, not a checkbox.
          </li>
          <li>
            <strong>No filing or remittance.</strong> Stripe Tax reports; somebody still files.
            &ldquo;Take this one to an accountant&rdquo; is <code>SETUP-PAYMENTS.md</code>&rsquo;s
            own advice and it stands.
          </li>
          <li>
            <strong>The tax figure above is what our orders recorded</strong>, not what Stripe will
            report at filing time — the same caveat as <Link href="/pay/balance">Balance</Link>.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
