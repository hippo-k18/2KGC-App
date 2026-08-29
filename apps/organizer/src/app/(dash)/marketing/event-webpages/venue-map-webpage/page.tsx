import Link from 'next/link';
import { EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listRooms, listSessions } from '@/lib/data';
import { publicUrl } from '@/lib/webpages';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

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
 * missing is the image they are fractions *of*. Nothing in this repo uploads a
 * floorplan, so a coordinate is a fraction of nothing and cannot be drawn.
 *
 * That ordering is worth stating because it is unusual: normally the picture is
 * the easy part. Here the picture needs a Storage upload path and an image
 * pipeline that no screen in this dashboard has, and the maths is already done.
 *
 * So the screen reports the rooms an organizer would be pinning, and how much of
 * the programme depends on each — which is the ordering they would want if they
 * ever did place the pins, since a room with fourteen sessions matters more than
 * a room with one.
 */
export default async function VenueMapWebpagePage() {
  await requireOrganizer();
  const [rooms, sessions] = await Promise.all([listRooms(), listSessions()]);

  const live = sessions.filter((s) => s.status !== 'cancelled');
  const countFor = (id: string) => live.filter((s) => s.roomId === id).length;
  const unroomed = live.filter((s) => !s.roomId).length;

  return (
    <>
      <PageHeader
        title="Venue Map Webpage"
        tags={<Tag color="red" fill="outline">no floorplan image</Tag>}
        actions={
          <a href={publicUrl('/about')} target="_blank" rel="noreferrer" className="whova-btn-main">
            Nearest live page: /about ↗
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

      <Banner kind="warning">
        <strong>The pins are modelled; the map is not.</strong> <code>RoomDoc.mapX</code> and{' '}
        <code>mapY</code> hold a position as a fraction of each axis, which is the right shape and
        survives any image size. Nothing uploads a floorplan for them to be fractions of, so no map
        is drawn on the site or in the app. The venue is {EVENT.venue}.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Rooms', value: rooms.length, sub: 'each a pin, once there is a map' },
          { label: 'Sessions in a room', value: live.length - unroomed, sub: `of ${live.length}` },
          {
            label: 'Floorplan images',
            value: 0,
            sub: 'nothing in this repo uploads one',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Rooms a map would have to show</h2>
        <Table
          cols={[
            { key: 'n', label: 'Room', className: 'cell-fill' },
            { key: 's', label: 'Sessions', className: 'cell-sm' },
            { key: 'p', label: 'Pin', className: 'cell-md' },
          ]}
          rows={rooms.map((r) => [
            r.name,
            countFor(r.id),
            <span key="p" className="muted" style={{ fontSize: 12 }}>
              nowhere to place it
            </span>,
          ])}
          empty="No rooms yet. Session Manager creates them as sessions are scheduled."
        />
        {unroomed > 0 ? (
          // Worth surfacing here and not only on the agenda screen: a session
          // with no room is a person standing in a corridor, and a map is
          // exactly the thing they would have reached for.
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
            {unroomed} session{unroomed === 1 ? ' has' : 's have'} no room assigned, so no pin would
            help anyone looking for {unroomed === 1 ? 'it' : 'them'}.{' '}
            <Link href={ROUTES.sessionManager}>Fix in Session Manager</Link>.
          </p>
        ) : null}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Uploading a floorplan.</strong> No screen in this dashboard writes to Storage or
            resizes an image. This is the same blocker as app branding and sponsor banners, and
            fixing it once unblocks all three.
          </li>
          <li>
            <strong>Placing pins.</strong> Dragging a marker onto an image is a client component
            with pointer maths. It cannot be built before there is an image to drag onto.
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
