import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { money, salesSummary } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { stripeIsLive } from '@/lib/stripe';
import { Banner, PageHeader, Panel, StatTiles, Table } from '../../ui';

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
export default async function PublishTaxPage() {
  await requireOrganizer();
  const s = await salesSummary();
  const live = stripeIsLive();
  const dash = (path: string) => `https://dashboard.stripe.com/${live ? '' : 'test/'}${path}`;

  return (
    <>
      <PageHeader
        title="Publish"
        actions={
          <a href={dash('settings/tax')} target="_blank" rel="noreferrer" className="whova-btn-main">
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
        KGC is at Cornell Tech, Roosevelt Island, so the jurisdiction is New York — a buyer in Berlin
        owes New York&rsquo;s treatment, not German VAT. Until the event location is set in Stripe,
        Stripe taxes by billing address instead, and that produces a wrong number that looks
        entirely reasonable.
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
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What is already wired, and what is still manual</h2>
        <Table
          cols={[
            { key: 'p', label: 'Piece', className: 'cell-md' },
            { key: 's', label: 'State', className: 'cell-fill' },
          ]}
          rows={[
            [
              'Tax code on every line',
              <span key="s">
                Done. <code>txcd_20030000</code>, the code Stripe&rsquo;s own ticketing guide
                specifies for admission, is sent on Checkout line items and on invoices.
              </span>,
            ],
            [
              'Automatic tax',
              <span key="s">
                Done in code — <code>automatic_tax: {'{'} enabled: true {'}'}</code> on both paths.
                It stays inert until tax is enabled in the Stripe dashboard, which is why turning it
                on early was safe.
              </span>,
            ],
            [
              'Billing address collected',
              <span key="s">
                Done. Required at Checkout, because automatic tax needs it and finance needs it on
                the invoice.
              </span>,
            ],
            [
              'Event location declared',
              <span key="s" className="muted">
                Manual, in Stripe. This is the one that changes the answer.
              </span>,
            ],
            [
              'New York registration',
              <span key="s" className="muted">
                A filing decision, not a toggle. Stripe monitors economic nexus and warns when sales
                cross a threshold; registering is a question for an accountant.
              </span>,
            ],
          ]}
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          Links open the {live ? 'live' : 'test'} Stripe dashboard, matching the key this app is
          configured with:{' '}
          <a href={dash('tax/registrations')} target="_blank" rel="noreferrer">
            registrations ↗
          </a>{' '}
          ·{' '}
          <a href={dash('tax')} target="_blank" rel="noreferrer">
            tax overview ↗
          </a>
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
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
      </Panel>
    </>
  );
}
