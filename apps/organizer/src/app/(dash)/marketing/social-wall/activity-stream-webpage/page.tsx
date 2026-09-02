import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listCommunityPosts } from '@/lib/engagement';
import { listAnnouncements } from '@/lib/data';
import { publicUrl } from '@/lib/webpages';
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
 * What can go on a public page without any of that is the organizer's own
 * broadcast: announcements are written by staff, for everyone, and already read
 * like a news feed. **That half is built** — `/announcements` in `apps/web`,
 * the wall the Engagement tab's own stream screen points at. So this screen
 * counts both streams and says which of them is published, because "we have no
 * activity stream" was false and "we could publish the attendee board" is
 * worse.
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
        tags={<Tag color="orange" fill="outline">half of it is public</Tag>}
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
        in a closed room and gated by <code>firestore.rules</code>, and stay there.{' '}
        <strong>Announcements</strong> are written by organizers for broadcast, and are the one of
        the two that is published — at{' '}
        <a href={publicUrl('/announcements')} target="_blank" rel="noreferrer">
          /announcements
        </a>
        .
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Attendee posts', value: visible.length, sub: `${replies} replies` },
          { label: 'Announcements', value: announcements.length, sub: 'organizer-written' },
          {
            label: 'On the public site',
            // The wall renders the newest 40 — the cap and the reason for it are
            // in the Engagement tab's stream screen, which owns that number.
            value: Math.min(announcements.length, 40),
            sub: 'announcements only',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The two streams, and where each one goes</h2>
        <Table
          cols={[
            { key: 's', label: 'Stream', className: 'cell-md' },
            { key: 'w', label: 'Who writes it', className: 'cell-md' },
            { key: 'p', label: 'Where it is published', className: 'cell-fill' },
          ]}
          rows={[
            [
              'Community board',
              'Attendees, in the app',
              'Nowhere. Gated by the registered claim, and posted on that understanding. Publishing it retroactively changes the deal.',
            ],
            [
              'Announcements',
              'Organizers, from this dashboard',
              <span key="p">
                <a href={publicUrl('/announcements')} target="_blank" rel="noreferrer">
                  /announcements
                </a>{' '}
                — already a broadcast to everyone, and the public page reaches the people who never
                installed the app.
              </span>,
            ],
          ]}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
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
            client component and a listener that does not exist there — which is why{' '}
            <code>/announcements</code> shows what was true when the browser loaded it and no
            later.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
