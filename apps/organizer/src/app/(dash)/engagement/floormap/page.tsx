import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listRooms, listSessions } from '@/lib/data';
import { exhibitorSummary } from '@/lib/exhibitors';
import { ROUTES } from '@/lib/nav';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Floormap.
 *
 * The in-app twin of Marketing › Venue Map Webpage: a tappable floorplan with
 * session rooms and exhibitor booths pinned on it.
 *
 * ── What this screen is for, given there is no image ────────────────────────
 *
 * `RoomDoc.mapX` / `mapY` are modelled and there is no floorplan image to place
 * them on. ⚠️ That is no longer a Storage problem: the bucket exists and
 * `lib/uploads.ts` writes to it from three screens already (OWNER-ACTIONS.md §1,
 * done 2026-09-01). What is missing is a field to hang a floorplan on — no
 * document in the model has one — a pin editor, and a map screen in the app.
 * `ExhibitorDoc.boothNumber` is free text, so the hall has numbers and no
 * coordinates at all.
 *
 * A page of prose about that helps nobody. What is useful, and what this shows,
 * is the placement readiness that has to be right whether or not a map is ever
 * drawn: sessions with no room, and exhibitors with no booth number. Both are
 * fixable this afternoon, and both are otherwise discovered on the morning of
 * day one by somebody who cannot find the room.
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
  const standing = exhibitors.total - exhibitors.cancelled;
  const booked = standing - exhibitors.withoutBooth;

  return (
    <>
      <PageHeader
        title="Floormap"
        info={
          <>
            <strong>No floorplan image yet</strong>
            <p>
              Rooms carry pin coordinates as 0–1 fractions of each axis, so they survive any image
              size, but there is nothing behind them, and booths carry a number rather than a
              position.
            </p>
            <p>
              Uploads work; no document in the model has a field to hang a floorplan on, and the
              app has no map screen.
            </p>
          </>
        }
        tags={
          unroomed + exhibitors.withoutBooth > 0 ? (
            <Tag color="orange" fill="outline">
              {unroomed + exhibitors.withoutBooth} unplaced
            </Tag>
          ) : (
            <Tag color="green" fill="outline">everything placed</Tag>
          )
        }
        links={[
          <Link key="v" href="/marketing/event-webpages/venue-map-webpage">
            Venue map webpage
          </Link>,
          <Link key="e" href="/content/exhibitor-center/exhibitor-manager">
            Exhibitor Manager
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Rooms', value: rooms.length, sub: 'on the programme' },
          {
            label: 'Sessions in a room',
            value: `${live.length - unroomed}/${live.length}`,
            sub: unroomed > 0 ? `${unroomed} with no room` : 'all placed',
          },
          {
            label: 'Booths numbered',
            value: `${booked}/${standing}`,
            sub:
              exhibitors.withoutBooth > 0
                ? `${exhibitors.withoutBooth} exhibitors without one`
                : 'the whole hall',
          },
          { label: 'Map images', value: 0, sub: 'not inputted yet' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Placement</h2>
        {rooms.length === 0 ? (
          <NotInputted
            what="rooms"
            action={
              <Link className="btn btn-primary" href={ROUTES.sessionManager}>
                Session Manager
              </Link>
            }
          />
        ) : (
          <>
            <Table
              cols={[
                { key: 'r', label: 'Room', className: 'cell-md' },
                { key: 's', label: 'Sessions in it', className: 'cell-sm' },
                { key: 'u', label: '', className: 'cell-fill' },
              ]}
              rows={rooms.map((r) => {
                const used = live.filter((s) => s.roomId === r.id).length;
                return [
                  <strong key="r">{r.name}</strong>,
                  used,
                  used === 0 ? (
                    <span key="u" className="muted" style={{ fontSize: 12 }}>
                      nothing scheduled in it
                    </span>
                  ) : null,
                ];
              })}
            />
            {(unroomed > 0 || exhibitors.withoutBooth > 0) && (
              // The one actionable thing on this page, and it is actionable
              // whether or not a floorplan is ever drawn.
              <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
                Fixable today:{' '}
                {unroomed > 0 ? (
                  <>
                    {unroomed} session{unroomed === 1 ? '' : 's'} with no room (
                    <Link href={ROUTES.sessionManager}>Session Manager</Link>)
                  </>
                ) : null}
                {unroomed > 0 && exhibitors.withoutBooth > 0 ? ' and ' : null}
                {exhibitors.withoutBooth > 0 ? (
                  <>
                    {exhibitors.withoutBooth} exhibitor{exhibitors.withoutBooth === 1 ? '' : 's'}{' '}
                    with no booth number (
                    <Link href="/content/exhibitor-center/exhibitor-manager">Exhibitor Manager</Link>
                    )
                  </>
                ) : null}
                .
              </p>
            )}
          </>
        )}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Somewhere to put the image, and a pin editor.</strong> The upload path exists
            and is used by three screens; what is missing is a field on any document for a
            floorplan, and a way to drag <code>mapX</code>/<code>mapY</code> onto it.
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
      </GapPanel>
    </>
  );
}
