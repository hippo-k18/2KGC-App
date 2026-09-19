import Link from 'next/link';
import { EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listRoomRows, listSessions } from '@/lib/data';
import { publicUrl } from '@/lib/webpages';
import { ROUTES } from '@/lib/nav';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Event Webpages › Venue Map Webpage.
 *
 * Whova hosts a floorplan image with tappable pins and publishes it as a page.
 *
 * ── The half we have is the half that is hard to fake ───────────────────────
 *
 * `RoomDoc` already carries `mapX` and `mapY` as 0–1 fractions of each axis —
 * the pin coordinates, modelled correctly and resolution-independent. What is
 * missing is the image they are fractions *of*, and no public surface draws
 * one. That ordering is unusual enough to be worth stating: normally the
 * picture is the easy part.
 *
 * So the screen reports the rooms an organizer would be pinning, ordered by how
 * much of the programme depends on each — a room with fourteen sessions matters
 * more than a room with one — and says for each whether a pin has actually been
 * placed. It used to print "nowhere to place it" on every row unconditionally,
 * which is a claim about the software rather than a reading of the data: the
 * coordinates are a real field that a room can genuinely have.
 */
export default async function VenueMapWebpagePage() {
  await requireOrganizer();
  const [rooms, sessions] = await Promise.all([listRoomRows(), listSessions()]);

  const live = sessions.filter((s) => s.status !== 'cancelled');
  const unroomed = live.filter((s) => !s.roomId).length;
  const pinned = rooms.filter((r) => r.mapX !== undefined).length;

  // Busiest first: the ordering an organizer would place pins in.
  const ordered = [...rooms].sort(
    (a, b) => b.sessionCount - a.sessionCount || a.name.localeCompare(b.name),
  );

  return (
    <>
      <PageHeader
        title="Venue Map Webpage"
        info={
          <>
            <strong>No venue map yet</strong>
            <p>A venue map is not available on the site or in the app yet.</p>
          </>
        }
        tags={
          <Tag color={pinned === rooms.length && rooms.length > 0 ? 'green' : 'orange'} fill="outline">
            {pinned} of {rooms.length} pinned
          </Tag>
        }
        actions={
          <a href={publicUrl('/about')} target="_blank" rel="noreferrer" className="whova-btn-main secondary">
            View /about ↗
          </a>
        }
        links={[
          <Link key="f" href="/engagement/floormap">
            Floormap (in-app)
          </Link>,
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          {
            label: 'Venue',
            // Body size: the address is a sentence, not a number.
            value: (
              <span style={{ display: 'block', fontSize: 15, lineHeight: '20px', padding: '7px 0' }}>
                {EVENT.venue}
              </span>
            ),
          },
          { label: 'Rooms', value: rooms.length, sub: 'one pin each' },
          {
            label: 'Pins placed',
            value: pinned,
            sub: pinned === 0 ? 'not inputted yet' : `of ${rooms.length} rooms`,
          },
          {
            label: 'Sessions in a room',
            value: live.length - unroomed,
            sub: `of ${live.length}`,
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Rooms</h2>
        <Table
          cols={[
            { key: 'n', label: 'Room', className: 'cell-fill' },
            { key: 'b', label: 'Floor', className: 'cell-sm' },
            { key: 's', label: 'Sessions', className: 'cell-sm' },
            { key: 'p', label: 'Pin', className: 'cell-md' },
          ]}
          rows={ordered.map((r) => [
            r.name,
            r.floor || <span key="b" className="muted">—</span>,
            <span key="s">
              {r.sessionCount}
              {r.publishedCount !== r.sessionCount ? (
                <div className="muted" style={{ fontSize: 11 }}>
                  {r.publishedCount} published
                </div>
              ) : null}
            </span>,
            r.mapX !== undefined && r.mapY !== undefined ? (
              <code key="p" style={{ fontSize: 12 }}>
                {r.mapX.toFixed(3)}, {r.mapY.toFixed(3)}
              </code>
            ) : (
              <span key="p" className="muted" style={{ fontSize: 12 }}>
                not inputted yet
              </span>
            ),
          ])}
          empty={
            <NotInputted
              what="rooms"
              compact
              action={
                <Link className="btn btn-primary" href={ROUTES.sessionManager}>
                  Schedule a session
                </Link>
              }
            />
          }
        />
        {unroomed > 0 ? (
          // Worth surfacing here and not only on the agenda screen: a session
          // with no room is a person standing in a corridor, and a map is
          // exactly the thing they would have reached for.
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
            {unroomed} session{unroomed === 1 ? ' has' : 's have'} no room assigned.{' '}
            <Link href={ROUTES.sessionManager}>Fix in Session Manager</Link>.
          </p>
        ) : null}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>The floorplan image.</strong> <code>lib/uploads.ts</code> and the Storage bucket
            both exist now, so uploading one is no longer the blocker — the blocker is that no
            surface draws it. A saved image nothing renders is a setting nothing reads, which is
            the pattern this dashboard has been removing rather than adding.
          </li>
          <li>
            <strong>Placing pins.</strong> Dragging a marker onto an image is a client component
            with pointer maths. The coordinates it would write are already modelled and readable —
            see the Pin column — so this is the drag surface and nothing else.
          </li>
          <li>
            <strong>Multiple floors.</strong> <code>RoomDoc</code> has a <code>floor</code> string
            but a single pair of coordinates, so two floors would need two images and a way to say
            which one a room is on.
          </li>
          <li>
            <strong>Wayfinding.</strong> Whova has no routing either — both would be a static image
            with dots on it, and neither knows where the visitor is standing.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
