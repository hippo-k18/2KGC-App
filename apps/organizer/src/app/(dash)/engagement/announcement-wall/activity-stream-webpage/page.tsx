import Link from 'next/link';
import { ANNOUNCEMENT_WALL_LIMIT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listAnnouncements } from '@/lib/data';
import { publicUrl } from '@/lib/webpages';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Announcement Wall › Activity Stream Webpage.
 *
 * Whova's announcement wall is the organizer's broadcast history as a
 * full-screen page — the thing you put on the lobby screen between talks.
 *
 * ── Unlike the social wall, there was never a reason not to publish this ────
 *
 * The social wall is blocked by consent: attendees wrote those posts in a closed
 * room. Announcements are written by staff, for everybody, and already go out
 * over push. Nothing about publishing them betrays anyone, which made this the
 * one wall in the nav that was merely unbuilt rather than deliberately absent —
 * and that distinction is still the point of the screen.
 *
 * **The wall exists now**, at `/announcements`: a dark, one-column page whose
 * type scales with the viewport, so the same URL is a foyer screen at six
 * metres and a readable page on a phone. It reads the `announcements`
 * collection on every request, so writing one here puts it on the wall.
 *
 * What this screen shows is the stream as it stands, with the delivery column
 * that matters: `push` is per-announcement and `push.ts` really does send, so an
 * announcement without it reached only people who opened the app. On the wall
 * that difference disappears, which is the argument for having it.
 */
export default async function AnnouncementWallStreamPage() {
  await requireOrganizer();
  const announcements = await listAnnouncements(100);

  const pushed = announcements.filter((a) => a.push).length;
  /*
   * The wall's own cap, from `@kgc/shared`.
   *
   * This was a second copy of `40` carrying a comment that said the two apps
   * are separate installs and neither may import the other. Both depend on
   * `@kgc/shared`, so that was never the constraint — and the number decides
   * whether the tile below tells an organizer the truth about a public page.
   */
  const onWall = Math.min(announcements.length, ANNOUNCEMENT_WALL_LIMIT);

  return (
    <>
      <PageHeader
        title="Activity Stream Webpage"
        tags={<Tag color="green" fill="outline">live at /announcements</Tag>}
        actions={
          <a
            href={publicUrl('/announcements')}
            target="_blank"
            rel="noreferrer"
            className="whova-btn-main"
          >
            Open the wall ↗
          </a>
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
        sent to everyone — and{' '}
        <a href={publicUrl('/announcements')} target="_blank" rel="noreferrer">
          /announcements
        </a>{' '}
        is the wall that renders them, sized to be read across a room. It stays the only wall in
        the nav that could be published at all; the{' '}
        <Link href="/marketing/social-wall/social-wall-customization">social wall</Link> is
        deliberately closed and is the other kind.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Announcements', value: announcements.length, sub: 'newest first' },
          {
            label: 'Sent with push',
            value: pushed,
            sub: announcements.length - pushed > 0 ? `${announcements.length - pushed} in-app only` : 'all of them',
          },
          {
            label: 'On the public wall',
            value: onWall,
            sub:
              announcements.length > ANNOUNCEMENT_WALL_LIMIT
                ? `${announcements.length - onWall} older, not shown`
                : 'newest shown largest',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The stream the wall renders</h2>
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

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Auto-refresh.</strong> ⚠️ The one thing standing between the wall and a screen
            you can leave running. Every page in <code>apps/web</code> is server-rendered per
            request, so a browser parked on <code>/announcements</code> shows whatever was true when
            it loaded — a room change posted at 11:00 does not appear on a panel opened at 09:00.
            Fixing it properly means a client component with a timer, and <code>apps/web</code> has
            none; until then a kiosk browser set to reload is the answer, and the page says so.
          </li>
          <li>
            <strong>The archive cut-off.</strong> The wall renders the newest{' '}
            {ANNOUNCEMENT_WALL_LIMIT}. That is not a paging control, it is a ceiling so one runaway
            writer cannot turn a public page into a thousand-document read. Nothing lists the rest.
          </li>
          <li>
            <strong>Pinning and expiry.</strong> <code>AnnouncementDoc</code> has a title, a body
            and a push flag. Nothing says &ldquo;keep this at the top until 14:00&rdquo;, which is
            the first thing a wall would want.
          </li>
          <li>
            <strong>Images in an announcement.</strong> Text only. <code>lib/uploads.ts</code>
            takes a file for an exhibitor, a sponsor and a speaker; <code>AnnouncementDoc</code>
            has no field to put one in, so this is a model change and not a wiring job.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
