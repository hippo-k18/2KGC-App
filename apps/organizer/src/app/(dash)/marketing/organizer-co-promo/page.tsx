import Link from 'next/link';
import { publicSiteOrigin } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listContacts, listLinks, summariseContacts } from '@/lib/campaigns';
import { listSpeakers, listSponsors } from '@/lib/data';
import { money } from '@/lib/commerce';
import { publicUrl } from '@/lib/webpages';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Organizer Co-Promo.
 *
 * ── What Whova's version is, and why the nav item survives ──────────────────
 *
 * Co-promo swaps promotional slots between events inside Whova: your event
 * appears to the attendees of somebody else's, and theirs to yours. The feature
 * is the network rather than the software — it works because Whova has tens of
 * thousands of events and one audience moving between them. There is no
 * marketplace here, so there is no slot to trade.
 *
 * The *need* behind it is real: reaching people who have not heard of KGC,
 * through somebody else's audience. That is served by a partner posting a link
 * — and a partner link is a thing this product measures properly, because
 * `/r/{code}` counts the click itself and fulfilment stamps `campaignCode` onto
 * the order. So this screen is the reach KGC actually has, with the partner and
 * referral links that have earned something against it.
 *
 * It creates nothing. The link builder lives on Campaign Link Tracking and its
 * two siblings; a second copy of the form would be a second place for the
 * open-redirect check to drift out of.
 */
export default async function OrganizerCoPromoPage() {
  await requireOrganizer();

  const [contacts, links, speakers, sponsors] = await Promise.all([
    listContacts(),
    listLinks(),
    listSpeakers(),
    listSponsors(),
  ]);

  const c = summariseContacts(contacts);
  const origin = publicSiteOrigin();

  /*
   * A link somebody else is expected to post: it names who gets the credit, or
   * it names an off-platform channel. A plain campaign link with neither is the
   * conference mailing its own list, which is not co-promotion.
   */
  const partnerLinks = links.filter((l) => l.owner || l.channel === 'partner');
  const partnerClicks = partnerLinks.reduce((n, l) => n + l.clicks, 0);
  const partnerOrders = partnerLinks.reduce((n, l) => n + l.orders, 0);
  const partnerRevenue = partnerLinks.reduce((n, l) => n + l.revenueCents, 0);
  const currency = partnerLinks.find((l) => l.revenueCents > 0)?.currency ?? 'usd';

  const CHANNELS = [
    {
      channel: 'Speakers and their networks',
      reach: speakers.length,
      unit: speakers.length === 1 ? 'speaker' : 'speakers',
      how: 'A referral link each, credited by name, so the leaderboard is real.',
      href: '/tickets/ticket-marketing/referral-contest',
      label: 'Referral Contest',
    },
    {
      channel: 'Sponsors and exhibitors',
      reach: sponsors.length,
      unit: sponsors.length === 1 ? 'sponsor' : 'sponsors',
      how: 'Partner links they can put in their own newsletter, tracked separately.',
      href: '/tickets/ticket-marketing/campaign-link-tracking',
      label: 'Campaign Links',
    },
    {
      channel: 'The mailing list',
      reach: c.mailable,
      unit: 'mailable contacts',
      how: `${c.total} on file, ${c.unsubscribed + c.bounced} suppressed and never mailed.`,
      href: '/tickets/ticket-marketing/email-campaign',
      label: 'Email Campaign',
    },
    {
      channel: 'Social posts',
      reach: links.filter((l) => l.channel && l.channel !== 'partner').length,
      unit: 'tracked social links',
      how: 'Post copy is written for you; the link in it is counted by the redirect.',
      href: '/tickets/ticket-marketing/social-sharing',
      label: 'Social Sharing',
    },
  ];

  return (
    <>
      <PageHeader
        title="Organizer Co-Promo"
        info={
          <>
            <strong>No marketplace to trade slots in</strong>
            <p>
              Whova&rsquo;s version swaps promotional slots between events on its own platform. KGC
              reaches a new audience through somebody else&rsquo;s (a partner or a speaker posting
              a tracked link) so that is what this measures.
            </p>
          </>
        }
        tags={
          partnerLinks.length > 0 ? (
            <Tag color="green" fill="outline">
              {partnerLinks.length} partner {partnerLinks.length === 1 ? 'link' : 'links'}
            </Tag>
          ) : (
            <Tag color="grey" fill="outline">
              no partner links yet
            </Tag>
          )
        }
        actions={
          <Link href="/tickets/ticket-marketing/campaign-link-tracking" className="whova-btn-main">
            Create a tracked link
          </Link>
        }
        links={[
          <Link key="r" href="/tickets/ticket-marketing/referral-contest">
            Referral contest
          </Link>,
          <Link key="w" href="/marketing/event-website">
            Event Website
          </Link>,
          <Link key="s" href="/tools/app-adoption/social-media">
            Social media copy
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          {
            label: 'Partner and referral links',
            value: partnerLinks.length,
            sub: partnerLinks.length === 0 ? 'not inputted yet' : `of ${links.length} tracked links`,
          },
          { label: 'Clicks', value: partnerClicks, sub: 'counted by the redirect' },
          {
            label: 'Orders credited',
            value: partnerOrders,
            sub:
              partnerClicks > 0
                ? `${Math.round((partnerOrders / partnerClicks) * 100)}% of those clicks`
                : 'no clicks yet',
          },
          {
            label: 'Revenue credited',
            value: money(partnerRevenue, currency),
            sub: 'net of refunds',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Links somebody else is posting</h2>
        <Table
          cols={[
            { key: 'l', label: 'Link', className: 'cell-fill' },
            { key: 'o', label: 'Credited to', className: 'cell-md' },
            { key: 'c', label: 'Clicks', className: 'cell-sm' },
            { key: 'n', label: 'Orders', className: 'cell-sm' },
            { key: 'r', label: 'Net', className: 'cell-sm' },
          ]}
          rows={partnerLinks.map((l) => [
            <span key="l">
              <a href={`${origin}/r/${l.code}`} target="_blank" rel="noreferrer">
                /r/{l.code}
              </a>
              {!l.active ? (
                <>
                  {' '}
                  <Tag color="grey" small>
                    retired
                  </Tag>
                </>
              ) : null}
              <div className="muted" style={{ fontSize: 11 }}>
                {l.label} → {l.destination}
              </div>
            </span>,
            l.owner || <span className="muted">{l.channel || '—'}</span>,
            l.clicks,
            l.orders,
            l.revenueCents > 0 ? money(l.revenueCents, l.currency) : <span className="muted">—</span>,
          ])}
          empty={
            <NotInputted
              what="partner or referral links"
              compact
              action={
                <Link
                  className="btn btn-primary"
                  href="/tickets/ticket-marketing/campaign-link-tracking"
                >
                  Create one
                </Link>
              }
            />
          }
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The audiences KGC can reach through</h2>
        <Table
          cols={[
            { key: 'c', label: 'Channel', className: 'cell-md' },
            { key: 'r', label: 'Reach', className: 'cell-sm' },
            { key: 'h', label: 'How it is tracked', className: 'cell-fill' },
            { key: 'a', label: '', className: 'cell-md' },
          ]}
          rows={CHANNELS.map((ch) => [
            ch.channel,
            <span key="r">
              <strong>{ch.reach}</strong>
              <div className="muted" style={{ fontSize: 11 }}>
                {ch.unit}
              </div>
            </span>,
            <span key="h" className="muted" style={{ fontSize: 12 }}>
              {ch.how}
            </span>,
            <Link key="a" href={ch.href} style={{ fontSize: 12 }}>
              {ch.label}
            </Link>,
          ])}
        />
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
          Every one of these ends at{' '}
          <a href={publicUrl('/tickets')} target="_blank" rel="noreferrer">
            /tickets
          </a>
          , and a purchase within thirty days of the click is credited back to the link that made
          it.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Cross-event promotion.</strong> No marketplace, no partner events, no exchange.
            Building one means signing up other conferences and running an ad exchange between them
            — a marketplace business, not a feature of KGC&rsquo;s app.
          </li>
          <li>
            <strong>Promotional slots in the app.</strong> The app renders no ad surface of any
            kind — the same missing surfaces that block sponsor banners.
          </li>
          <li>
            <strong>Impressions.</strong> A link records that it was used, not how many people saw
            it unclicked. That number would have to come from the partner&rsquo;s own platform.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
