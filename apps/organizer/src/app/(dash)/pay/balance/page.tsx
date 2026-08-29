import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { money, salesSummary } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';
import { stripeEnabled, stripeIsLive } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * Pay › Balance.
 *
 * ── This screen deliberately does not try to be Stripe ──────────────────────
 *
 * Whova holds your ticket money and shows you a balance, because Whova is the
 * merchant of record. We are not — Stripe is, and it pays out to KGC's bank on
 * a rolling basis. So the true balance lives in Stripe's dashboard and any
 * number printed here would be a second figure that disagrees with it the
 * moment a payout, a fee or a dispute lands.
 *
 * What this can honestly show is **what was sold**, from our own order records,
 * plus the arithmetic that gets you from there to roughly what arrives. The gap
 * between the two is Stripe's processing fees, which are charged against the
 * payout rather than the order and which only Stripe knows.
 */

/** Stripe's standard US card rate. Used only for an estimate, and labelled as one. */
const FEE_PCT = 0.029;
const FEE_FIXED_CENTS = 30;

export default async function BalancePage() {
  await requireOrganizer();
  const s = await salesSummary();

  const estimatedFees = Math.round(s.grossCents * FEE_PCT + s.paidOrders * FEE_FIXED_CENTS);
  const estimatedNet = s.netCents - estimatedFees;

  return (
    <>
      <PageHeader
        title="Balance"
        tags={
          stripeEnabled() ? (
            <Tag color={stripeIsLive() ? 'green' : 'orange'} fill="outline">
              {stripeIsLive() ? 'Stripe live' : 'Stripe test mode'}
            </Tag>
          ) : (
            <Tag color="grey">No Stripe key</Tag>
          )
        }
        actions={
          <a
            href={`https://dashboard.stripe.com/${stripeIsLive() ? '' : 'test/'}balance`}
            target="_blank"
            rel="noreferrer"
            className="whova-btn-main"
          >
            Stripe balance ↗
          </a>
        }
        links={[
          <Link key="s" href={ROUTES.ordersSummary}>
            Orders summary
          </Link>,
          <Link key="o" href="/pay/order-details">
            Order details
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>Stripe holds the money, not KGC.</strong> Payouts land in the bank account attached
        to the Stripe account, on a rolling schedule — that is the main reason this project uses
        Stripe rather than a ticketing platform, which would hold ticket revenue until after the
        event. The authoritative balance is in Stripe; the figures below come from our own order
        records and will differ by fees.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Sold (gross)', value: money(s.grossCents, s.currency), sub: `${s.paidOrders} orders` },
          { label: 'Refunded', value: money(s.refundedCents, s.currency), sub: `${s.refundedOrders} orders` },
          { label: 'Net of refunds', value: money(s.netCents, s.currency), sub: 'before fees' },
          {
            label: 'Outstanding',
            value: money(s.outstandingCents, s.currency),
            sub: `${s.outstandingInvoices} unpaid invoices`,
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>From sold to banked</h2>
        <Table
          cols={[
            { key: 'k', label: 'Line', className: 'cell-fill' },
            { key: 'v', label: 'Amount', className: 'cell-sm' },
          ]}
          rows={[
            ['Gross charged', money(s.grossCents, s.currency)],
            ['Refunded', s.refundedCents === 0 ? '—' : `−${money(s.refundedCents, s.currency)}`],
            [
              <span key="k">
                Stripe fees <span className="muted">(estimated at 2.9% + $0.30)</span>
              </span>,
              `−${money(estimatedFees, s.currency)}`,
            ],
            [
              <strong key="k">Roughly what reaches the bank</strong>,
              <strong key="v">{money(estimatedNet, s.currency)}</strong>,
            ],
          ]}
        />
        {/*
          Labelled an estimate three times on one screen, deliberately. A fee
          figure that looks authoritative is a figure somebody puts in a budget,
          and the real one varies by card type, country and dispute.
        */}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
          ⚠️ The fee line is an <strong>estimate</strong>. Stripe charges per transaction and the
          real rate varies with card type and country; international cards and currency conversion
          cost more. Take the actual figure from Stripe before it goes anywhere near a budget.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Payout schedule and history.</strong> Stripe owns these and shows them properly.
            Mirroring them would be a copy that goes stale.
          </li>
          <li>
            <strong>Requesting a payout.</strong> A banking action, and one that belongs behind
            Stripe&rsquo;s own authentication rather than a shared dashboard passphrase.
          </li>
          <li>
            <strong>Real fee reconciliation.</strong> Needs Stripe&rsquo;s balance-transaction API,
            which reports the actual fee per charge rather than the headline rate.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
