import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { money, salesSummary } from '@/lib/commerce';
import { payoutSummary } from '@/lib/payouts';
import { stripeEnabled, stripeIsLive } from '@/lib/stripe';
import { Banner, GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Payout.
 *
 * ── Whova holds the money. Stripe holds ours ────────────────────────────────
 *
 * Whova is the merchant of record for tickets bought through it, so their
 * Payout screen is a request form: you ask them to send you your money. That
 * relationship does not exist here. Stripe is the merchant of record, the
 * account is KGC's own, and payouts happen on a schedule KGC set — there is
 * nothing to request and nobody to request it from.
 *
 * So this screen shows what is actually happening: the cleared balance, the
 * money still settling, and the payouts that have gone out. It is read live
 * from Stripe rather than derived from our order records, because our records
 * cannot see processing fees, disputes or Stripe's rolling hold — every one of
 * which is the difference between what was sold and what lands in the bank.
 *
 * ── Nothing here writes, deliberately ───────────────────────────────────────
 *
 * Bank details, payout schedule and account verification stay in Stripe's own
 * dashboard behind Stripe's own authentication. Reproducing a bank-details form
 * here would mean a session on this dashboard became sufficient to redirect a
 * conference's entire income, which is a trade nothing on this screen is worth.
 */
export default async function PayoutPage() {
  await requireOrganizer();

  const [payouts, sales] = await Promise.all([payoutSummary(12), salesSummary()]);

  const dashboardUrl = `https://dashboard.stripe.com/${stripeIsLive() ? '' : 'test/'}payouts`;
  const failed = payouts.payouts.filter((p) => p.status === 'failed');

  return (
    <>
      <PageHeader
        title="Payout"
        info={
          <>
            <strong>Stripe pays out to KGC&rsquo;s bank on its own schedule</strong>
            <p>
              Bank details, the payout schedule and verification are managed in Stripe. This
              screen is read only.
            </p>
          </>
        }
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
          <a key="s" href={dashboardUrl} target="_blank" rel="noreferrer">
            Stripe payouts ↗
          </a>,
          <Link key="b" href="/pay/balance">
            Balance
          </Link>,
          <Link key="t" href="/tickets/orders-and-transactions/transaction-history">
            Transactions
          </Link>,
        ]}
      />

      {payouts.unavailable ? (
        <Banner kind="warning">
          <strong>No live figures: Stripe could not be read.</strong> {payouts.unavailable} The
          figures below come from our own order records, so they show what was sold, not what has
          reached the bank.
        </Banner>
      ) : failed.length > 0 ? (
        <Banner kind="danger">
          <strong>
            {failed.length} {failed.length === 1 ? 'payout has' : 'payouts have'} failed.
          </strong>{' '}
          Money that was taken has not reached the bank. Stripe&rsquo;s reason is in the table
          below. The fix is usually a bank detail to correct in Stripe.
        </Banner>
      ) : null}

      <StatTiles
        tiles={[
          {
            label: 'Available',
            value: payouts.unavailable ? '—' : money(payouts.availableCents, payouts.currency),
            sub: 'cleared, awaiting payout',
          },
          {
            label: 'Pending',
            value: payouts.unavailable ? '—' : money(payouts.pendingCents, payouts.currency),
            sub: 'taken, still settling',
          },
          {
            label: 'Sold, net of refunds',
            value: money(sales.netCents, sales.currency),
            sub: 'our records, before fees',
          },
          { label: 'Payouts listed', value: payouts.payouts.length, sub: 'most recent first' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Payouts</h2>
        <Table
          cols={[
            { key: 'a', label: 'Amount', className: 'cell-sm' },
            { key: 'd', label: 'Arrives', className: 'cell-sm' },
            { key: 's', label: 'Status', className: 'cell-sm' },
            { key: 'n', label: '', className: 'cell-fill' },
          ]}
          rows={payouts.payouts.map((p) => [
            <strong key="a">{money(p.amountCents, p.currency)}</strong>,
            <span key="d" style={{ fontSize: 12 }}>
              {p.arrivalDate.slice(0, 10)}
            </span>,
            <Tag
              key="s"
              small
              color={p.status === 'paid' ? 'green' : p.status === 'failed' ? 'red' : 'blue'}
            >
              {p.status}
            </Tag>,
            <span key="n" className="muted" style={{ fontSize: 12 }}>
              {p.failureMessage ? (
                <span style={{ color: 'var(--danger)' }}>{p.failureMessage}</span>
              ) : (
                `${p.method} · ${p.id}`
              )}
            </span>,
          ])}
          empty={
            payouts.unavailable ? (
              'Nothing to list: Stripe could not be read. The reason is in the banner above.'
            ) : (
              <NotInputted what="payouts" compact />
            )
          }
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Why sold and paid out differ</h2>
        <Table
          cols={[
            { key: 'g', label: 'Gap', className: 'cell-md' },
            { key: 'w', label: 'Why', className: 'cell-fill' },
          ]}
          rows={[
            [
              'Processing fees',
              'Taken out of the payout, not the order. Roughly 2.9% + 30¢ per card payment. Stripe has the exact figure.',
            ],
            [
              'Stripe’s rolling hold',
              'A new account waits several days before its first payout, then settles on a rolling schedule.',
            ],
            [
              'Manual orders',
              <span key="w">
                Cheques, wires and comps recorded on{' '}
                <Link href="/tickets/exhibitor-ticket-setup/2-6-offline-payment">
                  Offline Payment
                </Link>{' '}
                count as sales here but are not paid through Stripe.
              </span>,
            ],
            [
              'Demo orders',
              'Left out of every sales figure. No money was taken.',
            ],
            [
              'Disputes',
              'A chargeback takes money back and adds a fee. Disputes only show in Stripe.',
            ],
          ]}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No bank details, schedule or verification.</strong> Deliberate. Those live in
            Stripe behind Stripe&rsquo;s authentication; putting them here would make a session on
            this dashboard sufficient to redirect the conference&rsquo;s income.
          </li>
          <li>
            <strong>No instant payout.</strong> Stripe supports it for eligible accounts at a fee.
            It is one API call and it moves real money irreversibly, which is the same category as
            a refund — worth building behind the same passphrase, and not worth building
            speculatively.
          </li>
          <li>
            <strong>No per-payout breakdown.</strong> Which orders make up a given payout is
            answerable through Stripe&rsquo;s balance-transaction API and is a page of round trips.
            Stripe&rsquo;s own dashboard already does it well.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
