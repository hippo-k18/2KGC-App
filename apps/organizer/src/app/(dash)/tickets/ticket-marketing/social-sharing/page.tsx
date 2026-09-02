import Link from 'next/link';
import { publicSiteOrigin } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listLinks } from '@/lib/campaigns';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';
import { LinkForm } from '../link-form';
import { DESTINATIONS, LinkTable } from '../link-table';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Marketing › Social Sharing.
 *
 * ── Whova's version, and why ours is smaller ────────────────────────────────
 *
 * Whova gives attendees share buttons inside the app and gives organizers a
 * composer that posts to connected accounts. The second half needs OAuth
 * against four social platforms whose APIs change more often than a conference
 * happens, and every one of them now charges for write access. That is a
 * subscription and a maintenance burden for something an organizer does by
 * pasting a link into a browser tab they already have open.
 *
 * What is genuinely worth automating is the part that is invisible: knowing
 * which post brought the traffic. So this screen is a per-channel tracked link
 * plus the copy that goes with it, and the posting is done by a person.
 *
 * ── The preview matters more than the buttons ───────────────────────────────
 *
 * A link posted to LinkedIn is rendered by LinkedIn from the page's Open Graph
 * tags. If those are missing the post is a bare URL, which performs about a
 * quarter as well — and nobody notices until it has been posted. The table
 * below is where that gets checked before rather than after.
 */
export default async function SocialSharingPage() {
  await requireOrganizer();

  const links = await listLinks();
  const publicOrigin = publicSiteOrigin();

  const social = links.filter((l) => l.channel);
  const clicks = social.reduce((n, l) => n + l.clicks, 0);
  const orders = social.reduce((n, l) => n + l.orders, 0);

  const byChannel = new Map<string, { clicks: number; orders: number }>();
  for (const l of social) {
    const row = byChannel.get(l.channel) ?? { clicks: 0, orders: 0 };
    row.clicks += l.clicks;
    row.orders += l.orders;
    byChannel.set(l.channel, row);
  }

  return (
    <>
      <PageHeader
        title="Social Sharing"
        links={[
          <Link key="l" href="/tickets/ticket-marketing/campaign-link-tracking">
            Link Tracking
          </Link>,
          <Link key="r" href="/tickets/ticket-marketing/referral-contest">
            Referral Contest
          </Link>,
          <Link key="w" href="/marketing/event-webpages/agenda-webpage/general-purpose">
            Event Webpages
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>Nothing here posts anything.</strong> Automating that means OAuth against four
        platforms whose APIs change more often than a conference happens, and most now charge for
        write access — a subscription and a maintenance burden for something you do by pasting a
        link into a tab you already have open. What is worth automating is knowing{' '}
        <em>which post worked</em>, and that is a tracked link per channel.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Channel links', value: social.length, sub: `${byChannel.size} channels` },
          { label: 'Clicks', value: clicks, sub: 'from social' },
          { label: 'Orders', value: orders, sub: 'last-click, 30 days' },
          {
            label: 'Best channel',
            value:
              [...byChannel.entries()].sort((a, b) => b[1].orders - a[1].orders || b[1].clicks - a[1].clicks)[0]?.[0] ??
              '—',
            sub: 'by orders, then clicks',
          },
        ]}
      />

      {byChannel.size > 0 && (
        <Panel>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>By channel</h2>
          <Table
            cols={[
              { key: 'c', label: 'Channel', className: 'cell-fill' },
              { key: 'k', label: 'Clicks', className: 'cell-sm' },
              { key: 'o', label: 'Orders', className: 'cell-sm' },
            ]}
            rows={[...byChannel.entries()]
              .sort((a, b) => b[1].clicks - a[1].clicks)
              .map(([channel, v]) => [channel, v.clicks, v.orders])}
          />
        </Panel>
      )}

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Links to share</h2>
        <LinkTable
          links={social}
          publicOrigin={publicOrigin}
          emptyMessage="No channel links yet. Make one per platform rather than one for all of them — otherwise 'social brought 40 clicks' is the only thing you ever learn."
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>New channel link</h2>
        <LinkForm destinations={DESTINATIONS} showChannel codePlaceholder="li-feb" />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Before you post</h2>
        <Table
          cols={[
            { key: 'c', label: 'Check', className: 'cell-md' },
            { key: 'w', label: 'Why it matters', className: 'cell-fill' },
            { key: 's', label: '', className: 'cell-sm' },
          ]}
          rows={[
            [
              'Open Graph tags on the destination',
              'A link posted to LinkedIn is rendered by LinkedIn from the page’s OG tags. Missing ones make the post a bare URL, which performs a fraction as well — and nobody notices until after it is posted.',
              <Tag key="s" color="green" small>
                set
              </Tag>,
            ],
            [
              'The redirect resolves',
              'Open the /r/ link yourself once. A retired or mistyped code 404s deliberately rather than bouncing to the homepage, precisely so a typo in a link that has gone to a thousand people gets noticed.',
              <Tag key="s" color="blue" small>
                open it
              </Tag>,
            ],
            [
              'One code per post, not per platform',
              'Two posts on the same platform sharing a code cannot be told apart. Codes are free; ambiguity is not.',
              <Tag key="s" color="grey" small>
                habit
              </Tag>,
            ],
          ]}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No posting, scheduling or connected accounts.</strong> Deliberate, and
            explained above. The tracked link is the part that pays for itself.
          </li>
          <li>
            <strong>No share buttons in the attendee app.</strong> Whova has &ldquo;I&rsquo;m
            attending&rdquo; cards an attendee posts. That is an app feature rather than a
            dashboard one, and the app has no share sheet wired yet.
          </li>
          <li>
            <strong>No per-post OG image.</strong> Every page shares the site&rsquo;s default card.
            Generating one per session or speaker needs the image pipeline{' '}
            <code>ROADMAP.md</code> records as blocker 3.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
