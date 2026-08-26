import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listAnnouncements } from '@/lib/data';
import { publicUrl } from '@/lib/webpages';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Announcement Wall › Activity Stream Webpage.
 *
 * Whova's announcement wall is the organizer's broadcast history as a
 * full-screen page — the thing you put on the lobby screen between talks.
 *
 * ── Unlike the social wall, there is no reason not to publish this ──────────
 *
 * The social wall is blocked by consent: attendees wrote those posts in a closed
 * room. Announcements are written by staff, for everybody, and already go out
 * over push. Nothing about publishing them betrays anyone, which makes this the
 * one wall in the nav that is merely unbuilt rather than deliberately absent —
 * and that distinction is the point of the screen.
 *
 * What it shows is the stream as it stands, with the delivery column that
 * matters: `push` is per-announcement and `push.ts` really does send, so an
 * announcement without it reached only people who opened the app. On a lobby
 * screen that difference disappears, which is an argument *for* the wall.
 */
export default async function AnnouncementWallStreamPage() {
  await requireOrganizer();
  const announcements = await listAnnouncements(100);

  const pushed = announcements.filter((a) => a.push).length;

  return (
    <>
      <PageHeader
        title="Activity Stream Webpage"
        tags={<Tag color="orange" fill="outline">unbuilt, not blocked</Tag>}
        actions={
          <Link href={ROUTES.announcements} className="whova-btn-main">
            Write an announcement
          </Link>
        }
        links={[
          <Link key="a" href={ROUTES.announcements}>
            Announcements
          </Link>,
          <Link key="s" href="/marketing/social-wall/activity-stream-webpage">
            Social wall stream
          </Link>,
        ]}
      />

      <Banner kind="info">
        These {announcements.length} announcements are already a broadcast — written by organizers,
        sent to everyone. <strong>Nothing stops them being a public page;</strong> nobody has
        written one. That makes this the only wall in the nav that is unbuilt rather than
        deliberately closed — the{' '}
        <Link href="/marketing/social-wall/social-wall-customization">social wall</Link> is the
        other kind.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Announcements', value: announcements.length, sub: 'newest first' },
          {
            label: 'Sent with push',
            value: pushed,
            sub: announcements.length - pushed > 0 ? `${announcements.length - pushed} in-app only` : 'all of them',
          },
          { label: 'Public wall pages', value: 0, sub: 'none exists yet' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The stream a wall would render</h2>
        <Table
          cols={[
            { key: 't', label: 'Title', className: 'cell-fill' },
            { key: 'd', label: 'Delivery', className: 'cell-sm' },
            { key: 'w', label: 'Sent', className: 'cell-md' },
          ]}
          rows={announcements.map((a) => [
            a.title,
            a.push ? (
              <Tag key="d" color="green" fill="outline" small>
                push
              </Tag>
            ) : (
              <span key="d" className="muted" style={{ fontSize: 12 }}>
                in-app only
              </span>
            ),
            a.createdAt ? (
              // Date only. A wall between talks is read from ten metres away and
              // the minute an announcement went out has never been the question.
              <span key="w" style={{ fontSize: 12 }}>
                {a.createdAt.slice(0, 10)}
              </span>
            ) : (
              <span key="w" className="muted" style={{ fontSize: 12 }}>
                unknown
              </span>
            ),
          ])}
          empty="No announcements yet."
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>The wall page.</strong> A route in <code>apps/web</code> reading{' '}
            <code>announcements</code>, styled for a screen across a room. Small, defensible, and
            nobody has done it — the smallest genuinely public thing left on this tab. It would live
            at <code>{publicUrl('/')}</code> alongside the other nineteen pages.
          </li>
          <li>
            <strong>Auto-refresh.</strong> A lobby screen nobody touches has to reload itself.
            Every page in <code>apps/web</code> is server-rendered per request, so this means a
            client component with a timer, which none of them has.
          </li>
          <li>
            <strong>Pinning and expiry.</strong> <code>AnnouncementDoc</code> has a title, a body
            and a push flag. Nothing says &ldquo;keep this at the top until 14:00&rdquo;, which is
            the first thing a wall would want.
          </li>
          <li>
            <strong>Images in an announcement.</strong> Text only, and no upload path anywhere in
            this dashboard.
          </li>
        </ul>
      </Panel>
    </>
  );
}
