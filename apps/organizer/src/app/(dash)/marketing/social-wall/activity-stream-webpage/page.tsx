import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listCommunityPosts } from '@/lib/engagement';
import { listAnnouncements } from '@/lib/data';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Social Wall › Activity Stream Webpage.
 *
 * The sibling of Social Wall Customization: Whova's activity stream is the same
 * content as an embeddable feed rather than a full-screen wall, for pasting into
 * your own site so visitors see the event is alive.
 *
 * ── The embed argument fails twice here ─────────────────────────────────────
 *
 * Once for the reason on every webpage screen: ours *is* the site, so there is
 * nothing to embed into. And once more seriously — the stream's content is the
 * closed board, which is gated behind the `registered` claim precisely so that
 * ride-share posts stay among ticket holders. An embed is a public wall with
 * extra steps.
 *
 * What could go on a public page without any of that is the organizer's own
 * broadcast: announcements are written by staff, for everyone, and already read
 * like a news feed. So this screen counts both streams and says which one could
 * ever be published — because "we have no activity stream" is false and "we
 * could publish the activity stream" is worse.
 */
export default async function SocialActivityStreamPage() {
  await requireOrganizer();
  const [posts, announcements] = await Promise.all([listCommunityPosts(), listAnnouncements(100)]);

  const visible = posts.filter((p) => p.status !== 'hidden');
  const replies = visible.reduce((n, p) => n + p.replyCount, 0);

  return (
    <>
      <PageHeader
        title="Activity Stream Webpage"
        tags={<Tag color="red" fill="outline">nothing published</Tag>}
        links={[
          <Link key="c" href="/marketing/social-wall/social-wall-customization">
            Social wall customization
          </Link>,
          <Link key="a" href="/engagement/announcements">
            Announcements
          </Link>,
        ]}
      />

      <Banner kind="info">
        Two streams exist and they are not equivalent. <strong>Attendee posts</strong> are written
        in a closed room and gated by <code>firestore.rules</code>. <strong>Announcements</strong>{' '}
        are written by organizers for broadcast, and are the only one of the two that could
        reasonably appear on a public page.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Attendee posts', value: visible.length, sub: `${replies} replies` },
          { label: 'Announcements', value: announcements.length, sub: 'organizer-written' },
          { label: 'On the public site', value: 0, sub: 'no stream page exists' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The two streams, and what each could become</h2>
        <Table
          cols={[
            { key: 's', label: 'Stream', className: 'cell-md' },
            { key: 'w', label: 'Who writes it', className: 'cell-md' },
            { key: 'p', label: 'Could it be public?', className: 'cell-fill' },
          ]}
          rows={[
            [
              'Community board',
              'Attendees, in the app',
              'No. Gated by the registered claim, and posted on that understanding. Publishing it retroactively changes the deal.',
            ],
            [
              'Announcements',
              'Organizers, from this dashboard',
              'Yes. Already a broadcast to everyone; a public page would reach people who have not installed the app.',
            ],
          ]}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>A public announcements feed.</strong> The defensible half of this feature and
            the cheapest: a route in <code>apps/web</code> reading <code>announcements</code>, which
            is a top-level collection with no per-attendee content in it. Nobody has written it.
          </li>
          <li>
            <strong>Publishing the attendee board.</strong> Deliberately absent — see the rules
            argument above. This is a decision, and it should stay one rather than becoming a
            toggle.
          </li>
          <li>
            <strong>An embed snippet.</strong> Whova gives you an iframe for your own site. Ours{' '}
            <em>is</em> the site.
          </li>
          <li>
            <strong>Live refresh.</strong> Whova&rsquo;s stream polls. Every page in{' '}
            <code>apps/web</code> is server-rendered per request, so &ldquo;live&rdquo; would mean a
            client component and a listener that does not exist there.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
