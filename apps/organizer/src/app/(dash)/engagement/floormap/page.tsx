import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listRooms, listSessions } from '@/lib/data';
import { exhibitorSummary } from '@/lib/exhibitors';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Floormap.
 *
 * The in-app twin of Marketing › Venue Map Webpage: Whova shows attendees a
 * tappable floorplan with session rooms and exhibitor booths pinned on it, and
 * a session's detail screen links straight to its pin.
 *
 * ── Same blocker, different consequence ─────────────────────────────────────
 *
 * `RoomDoc.mapX` / `mapY` are modelled and no floorplan image exists to place
 * them on — that argument is written out on the webpage screen and is not
 * repeated here. What this screen adds is the half the public page does not
 * have: **booths**. `ExhibitorDoc.boothNumber` is a free-text string, so the
 * hall has numbers but no coordinates at all, and an exhibitor without a booth
 * number is invisible to any map even after somebody draws one.
 *
 * That makes the useful content here a readiness count on booth numbers, which
 * is fixable today in Exhibitor Manager, rather than another paragraph about
 * the missing image.
 */
export default async function FloormapPage() {
  await requireOrganizer();
  const [rooms, sessions, exhibitors] = await Promise.all([
    listRooms(),
    listSessions(),
    exhibitorSummary(),
  ]);

  const live = sessions.filter((s) => s.status !== 'cancelled');
  const unroomed = live.filter((s) => !s.roomId).length;
  const booked = exhibitors.total - exhibitors.cancelled - exhibitors.withoutBooth;

  return (
    <>
      <PageHeader
        title="Floormap"
        tags={<Tag color="red" fill="outline">no map, in app or on the site</Tag>}
        links={[
          <Link key="v" href="/marketing/event-webpages/venue-map-webpage">
            Venue map webpage
          </Link>,
          <Link key="e" href="/content/exhibitor-center/exhibitor-manager">
            Exhibitor Manager
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>Nothing in the app draws a map.</strong> The five tabs are Home, Agenda, People,
        Community and Me; none has a floorplan, and a session&rsquo;s detail screen shows a room
        name rather than a location. Rooms carry pin coordinates with no image behind them; booths
        carry a number and no coordinates at all.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Rooms', value: rooms.length, sub: `${live.length - unroomed} of ${live.length} sessions placed` },
          {
            label: 'Booths numbered',
            value: `${booked}/${exhibitors.total - exhibitors.cancelled}`,
            sub: exhibitors.withoutBooth > 0 ? `${exhibitors.withoutBooth} exhibitors without one` : 'the whole hall',
          },
          { label: 'Map images', value: 0, sub: 'nothing uploads one' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What a map would need, and what exists</h2>
        <Table
          cols={[
            { key: 'p', label: 'Piece', className: 'cell-md' },
            { key: 's', label: 'State', className: 'cell-sm' },
            { key: 'n', label: '', className: 'cell-fill' },
          ]}
          rows={[
            [
              'A floorplan image',
              <Tag key="s" color="red" fill="outline" small>
                missing
              </Tag>,
              'No screen in this dashboard writes to Storage. The same blocker as app branding and sponsor banners.',
            ],
            [
              'Room pin coordinates',
              <Tag key="s" color="green" fill="outline" small>
                modelled
              </Tag>,
              'mapX and mapY are 0–1 fractions of each axis, so they survive any image size. Correct, and currently fractions of nothing.',
            ],
            [
              'Booth coordinates',
              <Tag key="s" color="red" fill="outline" small>
                missing
              </Tag>,
              'boothNumber is a free-text label. There is no x/y on ExhibitorDoc at all.',
            ],
            [
              'A map screen in the app',
              <Tag key="s" color="red" fill="outline" small>
                missing
              </Tag>,
              'No tab, no route, and no link from a session or an exhibitor to a location.',
            ],
          ]}
        />
        {(unroomed > 0 || exhibitors.withoutBooth > 0) && (
          // The one actionable thing on this page: both counts are fixable in an
          // afternoon and both would otherwise be discovered on the morning of
          // day one, by somebody who cannot find the room.
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
            Fixable today, map or no map:{' '}
            {unroomed > 0 ? (
              <>
                {unroomed} session{unroomed === 1 ? '' : 's'} with no room (
                <Link href={ROUTES.sessionManager}>Session Manager</Link>)
              </>
            ) : null}
            {unroomed > 0 && exhibitors.withoutBooth > 0 ? ' and ' : null}
            {exhibitors.withoutBooth > 0 ? (
              <>
                {exhibitors.withoutBooth} exhibitor{exhibitors.withoutBooth === 1 ? '' : 's'} with no
                booth number (
                <Link href="/content/exhibitor-center/exhibitor-manager">Exhibitor Manager</Link>)
              </>
            ) : null}
            .
          </p>
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Uploading and pinning.</strong> Both blocked on the same missing Storage path.
            Fixing it once unblocks the venue map, sponsor banners and app branding as well.
          </li>
          <li>
            <strong>Booth coordinates.</strong> <code>ExhibitorDoc</code> would need the same{' '}
            <code>mapX</code>/<code>mapY</code> pair <code>RoomDoc</code> already has. Adding fields
            nothing renders is modelling for its own sake, so it should come with the map.
          </li>
          <li>
            <strong>Links from a session or exhibitor to a pin.</strong> The payoff of a floormap is
            tapping &ldquo;where is this&rdquo; from wherever you are. That is app work, not
            dashboard work.
          </li>
          <li>
            <strong>Multiple floors.</strong> <code>RoomDoc.floor</code> is a string and there is
            one coordinate pair, so two floors need two images and a way to say which one a room is
            on.
          </li>
        </ul>
      </Panel>
    </>
  );
}
