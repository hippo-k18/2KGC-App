import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listLinks } from '@/lib/campaigns';
import { money } from '@/lib/commerce';
import { Banner, PageHeader, Panel, StatTiles, Table } from '../../../ui';
import { LinkForm } from '../link-form';
import { DESTINATIONS, LinkTable } from '../link-table';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Marketing › Referral Contest.
 *
 * ── The same mechanism as Campaign Link Tracking, plus an owner ─────────────
 *
 * A referral link is a tracked link with somebody's name on it. Building a
 * second mechanism for it would mean two places for the open-redirect check to
 * be forgotten in, and two definitions of "a sale" that will eventually
 * disagree in front of the person expecting a prize.
 *
 * `owner` is free text rather than a uid, deliberately. Most of the people a
 * conference referral contest rewards are speakers, partners and community
 * organisers who will never hold an account here, and requiring one would mean
 * the contest cannot include the people it exists for.
 *
 * ── The leaderboard is net of refunds, and that is not a detail ─────────────
 *
 * Ranking on gross rewards a link that brought three purchases and three
 * refunds. It also creates an incentive that a contest with a real prize does
 * not want to create.
 *
 * ── What this cannot do, and says so ────────────────────────────────────────
 *
 * Attribution is last-click over thirty days. A friend told about KGC in person
 * who searches for it and buys is unattributed, and that is the most common way
 * a genuine referral actually happens. A contest run on this data rewards
 * link-sharing, which is a narrower thing than referring — worth saying out
 * loud before somebody is told they came second.
 */
export default async function ReferralContestPage() {
  await requireOrganizer();

  const links = await listLinks();
  const publicOrigin = (process.env.WEB_PUBLIC_ORIGIN ?? 'http://localhost:3200').replace(/\/$/, '');

  const owned = links.filter((l) => l.owner);

  /**
   * One person may hold several links — a speaker with one for LinkedIn and one
   * for their newsletter. The leaderboard is per person, not per link, or the
   * winner is whoever split their audience least.
   */
  const byOwner = new Map<string, { orders: number; revenueCents: number; clicks: number; links: number; currency: string }>();
  for (const l of owned) {
    const key = l.owner;
    const row = byOwner.get(key) ?? { orders: 0, revenueCents: 0, clicks: 0, links: 0, currency: l.currency };
    row.orders += l.orders;
    row.revenueCents += l.revenueCents;
    row.clicks += l.clicks;
    row.links += 1;
    byOwner.set(key, row);
  }

  const leaderboard = [...byOwner.entries()]
    .map(([owner, v]) => ({ owner, ...v }))
    .sort((a, b) => b.orders - a.orders || b.revenueCents - a.revenueCents || a.owner.localeCompare(b.owner));

  const totalOrders = leaderboard.reduce((n, r) => n + r.orders, 0);
  const totalRevenue = leaderboard.reduce((n, r) => n + r.revenueCents, 0);
  const currency = leaderboard[0]?.currency ?? 'usd';

  return (
    <>
      <PageHeader
        title="Referral Contest"
        links={[
          <Link key="l" href="/tickets/ticket-marketing/campaign-link-tracking">
            Link Tracking
          </Link>,
          <Link key="s" href="/tickets/ticket-marketing/social-sharing">
            Social Sharing
          </Link>,
          <Link key="sp" href="/content/speaker-center/speaker-manager">
            Speakers
          </Link>,
        ]}
      />

      <Banner kind={owned.length === 0 ? 'info' : 'warning'}>
        {owned.length === 0 ? (
          <>
            <strong>No referral links yet.</strong> Give each speaker, partner or committee member
            their own <code>/r/</code> code below and this becomes a leaderboard. It is the same
            mechanism as Campaign Link Tracking — the only difference is the name attached.
          </>
        ) : (
          <>
            <strong>This measures link-sharing, not referring.</strong> A friend told about KGC over
            coffee who then searches for it and buys is <em>unattributed</em>. Attribution is
            last-click over thirty days, so a contest run on these numbers rewards the people who
            posted a link — which is narrower than the people who brought somebody. Worth saying
            before anybody is told they came second.
          </>
        )}
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Referrers', value: leaderboard.length, sub: `${owned.length} links` },
          { label: 'Referred orders', value: totalOrders, sub: 'last-click, 30 days' },
          { label: 'Referred net', value: money(totalRevenue, currency), sub: 'after refunds' },
          {
            label: 'Leader',
            value: leaderboard[0]?.owner ?? '—',
            sub: leaderboard[0] ? `${leaderboard[0].orders} orders` : 'nobody yet',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Leaderboard</h2>
        <Table
          cols={[
            { key: 'p', label: '#', className: 'cell-xs' },
            { key: 'o', label: 'Referrer', className: 'cell-fill' },
            { key: 'c', label: 'Clicks', className: 'cell-sm' },
            { key: 'n', label: 'Orders', className: 'cell-sm' },
            { key: 'r', label: 'Net', className: 'cell-sm' },
          ]}
          rows={leaderboard.map((r, i) => [
            <strong key="p">{i + 1}</strong>,
            <div key="o">
              <div>{r.owner}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {r.links} {r.links === 1 ? 'link' : 'links'}
              </div>
            </div>,
            r.clicks,
            <strong key="n">{r.orders}</strong>,
            r.revenueCents > 0 ? money(r.revenueCents, r.currency) : '—',
          ])}
          empty="Nobody has a referral link yet. Ranked by orders, then by net value — never by clicks, which reward posting rather than persuading."
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          One person may hold several links, and the leaderboard sums them — otherwise the winner is
          whoever split their audience least. Ties break on net value, then alphabetically, so the
          order is stable between page loads.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Referral links</h2>
        <LinkTable
          links={owned}
          publicOrigin={publicOrigin}
          showOwner
          emptyMessage="No link has an owner. A link with no name attached belongs on Campaign Link Tracking; this screen is only the ones somebody gets credit for."
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Give somebody a referral link</h2>
        <LinkForm
          destinations={DESTINATIONS}
          showOwner
          ownerLabel="Referrer"
          codePlaceholder="ada-lovelace"
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No prize, discount or payout.</strong> Whova&rsquo;s contest can attach a
            discount code to a referral so both sides benefit. Codes live in Stripe, so wiring that
            means creating one per referrer through their API and reading redemptions back —
            genuinely useful, and a day&rsquo;s work rather than an afternoon.
          </li>
          <li>
            <strong>Referrers cannot see their own numbers.</strong> They would need a page of
            their own behind a capability token — the same pattern{' '}
            <code>/order/{'{token}'}</code> uses. Until then the leaderboard is something an
            organizer screenshots.
          </li>
          <li>
            <strong>No self-service sign-up.</strong> Each link is created here by hand. That is
            fine for twenty speakers and wrong for two hundred attendees.
          </li>
        </ul>
      </Panel>
    </>
  );
}
