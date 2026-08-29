import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listLinks } from '@/lib/campaigns';
import { listOrders, money } from '@/lib/commerce';
import { Banner, GapPanel, PageHeader, Panel, StatTiles } from '../../../ui';
import { LinkForm } from '../link-form';
import { DESTINATIONS, LinkTable } from '../link-table';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Marketing › Campaign Link Tracking.
 *
 * ── How a click becomes a sale, across a redirect we do not control ─────────
 *
 * `/r/{code}` counts the click and sets a first-party cookie. When that visitor
 * buys, `startCheckout` reads the cookie and puts the code into Stripe
 * metadata; the webhook reads it back out and stamps `campaignCode` on the
 * order. That hop through metadata is not decoration — the buyer leaves our
 * origin entirely for hosted Checkout, which is what keeps this project in PCI
 * SAQ A, so there is no other way to carry anything across it.
 *
 * A cookie rather than a query parameter, because a parameter survives one
 * navigation and real buyers read the FAQ, look at the agenda, and come back on
 * Friday.
 *
 * ── There is no analytics vendor anywhere on this site ──────────────────────
 *
 * The cookie is first-party, `SameSite=Lax`, and holds a short code an
 * organizer chose. Not an identifier, not a profile, and nothing leaves the
 * building. Whova's equivalent is a UTM builder handing off to Google
 * Analytics; this is the same answer without the third party.
 *
 * ── What the numbers are not ────────────────────────────────────────────────
 *
 * `clicks` is raw hits, not unique visitors — deduplicating means storing
 * something per visitor, which is a tracking cookie with a retention question.
 * And attribution is last-click: a buyer who arrives through a partner link and
 * later a speaker's referral is credited to the speaker.
 */
export default async function CampaignLinkTrackingPage() {
  await requireOrganizer();

  const [links, orders] = await Promise.all([listLinks(), listOrders()]);
  const publicOrigin = (process.env.WEB_PUBLIC_ORIGIN ?? 'http://localhost:3200').replace(/\/$/, '');

  const clicks = links.reduce((n, l) => n + l.clicks, 0);
  const attributed = links.reduce((n, l) => n + l.orders, 0);
  const revenue = links.reduce((n, l) => n + l.revenueCents, 0);

  const real = orders.filter((o) => o.channel !== 'demo' && o.status !== 'cancelled');
  const currency = real[0]?.currency ?? 'usd';

  return (
    <>
      <PageHeader
        title="Campaign Link Tracking"
        links={[
          <Link key="c" href="/tickets/ticket-marketing/campaign-contact-list">
            Contact List
          </Link>,
          <Link key="e" href="/tickets/ticket-marketing/email-campaign">
            Email Campaign
          </Link>,
          <Link key="r" href="/tickets/ticket-marketing/referral-contest">
            Referral Contest
          </Link>,
        ]}
      />

      {links.length === 0 ? (
        <Banner kind="info">
          <strong>No tracked links yet.</strong> Create one below and use <code>/r/your-code</code>{' '}
          wherever you would have used the plain URL — in an email, a post, a partner&rsquo;s
          newsletter. Clicks are counted by the redirect itself, and a purchase that follows within
          thirty days is credited back to it.
        </Banner>
      ) : (
        <Banner kind="info">
          <strong>
            {attributed} of {real.length} purchases are attributed to a link.
          </strong>{' '}
          The rest arrived directly — and unattributed means <em>unattributed</em>, not organic: a
          cleared cookie, a link shared onward as plain text, or a visitor who first heard about KGC
          somewhere with no link in it all land there too.
        </Banner>
      )}

      <StatTiles
        tiles={[
          { label: 'Links', value: links.length, sub: `${links.filter((l) => l.active).length} live` },
          { label: 'Clicks', value: clicks, sub: 'raw hits, not unique visitors' },
          { label: 'Attributed orders', value: attributed, sub: `of ${real.length} real orders` },
          { label: 'Attributed net', value: money(revenue, currency), sub: 'after refunds' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Links</h2>
        <LinkTable
          links={links}
          publicOrigin={publicOrigin}
          emptyMessage="Nothing yet. The first link is the one worth making — a campaign you cannot measure is one you cannot repeat."
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>New link</h2>
        <LinkForm destinations={DESTINATIONS} codePlaceholder="spring-mail" />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No unique-visitor count.</strong> Clicks are raw hits. Deduplicating means
            storing something per visitor, which is a tracking cookie with a retention question
            attached — and for comparing one link against another, the raw number is enough.
          </li>
          <li>
            <strong>No UTM builder.</strong> Whova generates <code>utm_*</code> parameters for
            Google Analytics. There is no analytics vendor on this site, so there is nothing for
            them to reach — the short code does the same job and keeps the data here.
          </li>
          <li>
            <strong>No per-day chart.</strong> One counter per link, not a time series. A series
            needs a document per day per link, which is real storage for a question an organizer
            asks about twice.
          </li>
          <li>
            <strong>Attribution is last-click and thirty days.</strong> Both are conventions rather
            than facts, and both are wrong in some direction for some purchase. They are stated so
            that a leaderboard built on them can be argued with.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
