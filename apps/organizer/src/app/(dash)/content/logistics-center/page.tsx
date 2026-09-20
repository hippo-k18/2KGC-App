import Link from 'next/link';
import { EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { getRoom, listRoomRows } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { SETTINGS_KEYS, readSettings } from '@/lib/settings';
import { Banner, GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';
import { RoomForm, type EditableRoom } from './room-form';

export const dynamic = 'force-dynamic';

/**
 * Content › Logistics Center.
 *
 * ── Why the room editor is here ─────────────────────────────────────────────
 *
 * `nav.ts` is a transcription of a shipped product's own tree and it has no
 * rooms node — Logistics Center is the leaf that owns the venue, and it was
 * already the one screen displaying a room count. Adding
 * `logistics-center/room-manager` would put a path in the sidebar the tree does
 * not have, and on IA questions `nav.ts` wins. So the rooms live here.
 *
 * That closes the largest hole on this screen. Rooms were readable by three
 * modules (`data.ts`, `conflicts.ts`, `cohorts.ts`) and writable by nothing but
 * the CLI importer, while `SessionDoc.roomName` — a cache of the name below —
 * is the **only** thing telling an attendee where to walk, because the app
 * cannot read this collection at all.
 *
 * ── What is still missing, and why it stays missing ─────────────────────────
 *
 * The venue *notes* — address, doors, wifi, parking, accessibility, shuttles —
 * are a different thing from the rooms, and they remain unbuilt on purpose.
 * The `logistics` settings bag exists and the Emergency Manager already writes
 * it, so storing them is two hours' work; what does not exist is anywhere in
 * the app to read them. The five tabs are fixed
 * at build time and none has a slot for venue information, so a form here would
 * write a document nothing reads — and a wifi password typed into a dashboard
 * nobody reads back is worse than a note in the shared drive, because it looks
 * filed. Rooms are the opposite case: they are read by the agenda, on every
 * surface, today.
 */
export default async function LogisticsCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();

  const sp = await searchParams;
  const editId = typeof sp.edit === 'string' ? sp.edit : undefined;
  const creating = typeof sp.new === 'string';

  const rooms = await listRoomRows();
  /**
   * The emergency card, read rather than described.
   *
   * This screen owns the venue, and the emergency card is a venue fact filed on
   * a different screen — so an organizer standing here should be told whether
   * it exists rather than left to go and look. It is also what makes
   * `planReady` a genuinely read field in `SETTINGS_REGISTER` instead of a
   * value the dashboard writes to itself.
   */
  const logistics = await readSettings(SETTINGS_KEYS.logistics);
  const doc = editId ? await getRoom(editId) : null;
  const row = doc ? rooms.find((r) => r.id === doc.id) : undefined;
  /** Plain values only — `getRoom` carries Firestore `Timestamp`s. */
  const editing: EditableRoom | undefined = doc
    ? {
        id: doc.id,
        name: doc.name,
        building: doc.building,
        floor: doc.floor,
        capacity: doc.capacity,
        sessionCount: row?.sessionCount ?? 0,
      }
    : undefined;
  const showForm = creating || Boolean(editing);

  const unused = rooms.filter((r) => r.sessionCount === 0);
  const noCapacity = rooms.filter((r) => typeof r.capacity !== 'number');
  const overCapacity = rooms.filter((r) => r.overCapacityCount > 0);

  return (
    <>
      <PageHeader
        title="Logistics Center"
        info={
          <>
            <strong>Rooms, not venue notes</strong>
            <p>
              Venue notes such as wifi, parking, shuttles and accessibility are not available here
              yet. Add them as a link on the Documents screen.
            </p>
          </>
        }
        actions={
          showForm ? (
            <Link href="/content/logistics-center" className="whova-btn-main secondary">
              Back to list
            </Link>
          ) : (
            <Link href="?new=1" className="whova-btn-main primary">
              + Add room
            </Link>
          )
        }
        links={[
          <Link key="b" href="/content/basics">
            Basics
          </Link>,
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="d" href="/content/documents-and-videos/documents">
            Documents
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Rooms', value: rooms.length, sub: 'shown on their sessions' },
          {
            label: 'Nothing scheduled',
            value: unused.length,
            sub: unused.length === 0 ? 'every room is in use' : 'no sessions in them',
          },
          {
            label: 'No seat count',
            value: noCapacity.length,
            sub: 'Conflict Check cannot check these',
          },
        ]}
      />

      {overCapacity.length > 0 && (
        <Banner kind="warning">
          <strong>
            {overCapacity.length} room{overCapacity.length === 1 ? ' holds a session' : 's hold sessions'}{' '}
            capped above what the room seats.
          </strong>{' '}
          {overCapacity.map((r) => r.name).join(', ')}.{' '}
          <Link href={ROUTES.conflictCheck}>Conflict Check</Link> lists them session by session.
        </Banner>
      )}

      {showForm ? (
        <Panel>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            {editing ? `Edit ${editing.name}` : 'New room'}
          </h2>
          <RoomForm existing={editing} />
        </Panel>
      ) : (
        <Panel>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            Rooms
          </h2>
          <p className="body-2">
            Attendees see the room name on each session. Renaming a room here updates every
            session in it.
          </p>

          {rooms.length === 0 ? (
            <NotInputted
              what="rooms"
              action={
                <Link className="whova-btn-main secondary" href="?new=1">
                  Add the first one
                </Link>
              }
            />
          ) : (
          <Table
            cols={[
              { key: 'n', label: 'Room', className: 'cell-lg' },
              { key: 'w', label: 'Where', className: 'cell-md' },
              { key: 'c', label: 'Seats', className: 'cell-xs cell-end-align' },
              { key: 's', label: 'Sessions', className: 'cell-xs cell-end-align' },
              { key: 'p', label: 'Published', className: 'cell-xs cell-end-align' },
              { key: 'a', label: '', className: 'cell-xs cell-end-align' },
            ]}
            empty="Nothing here yet"
            rows={rooms.map((r) => [
              <span key="n">
                <strong>{r.name}</strong>
                <div className="muted" style={{ fontSize: 11 }}>
                  <code>{r.id}</code>
                </div>
              </span>,
              <span key="w" style={{ fontSize: 13 }}>
                {r.building || r.floor ? (
                  <>
                    {r.building}
                    {r.building && r.floor ? ', ' : ''}
                    {r.floor ? `floor ${r.floor}` : ''}
                  </>
                ) : (
                  <span className="muted">not recorded</span>
                )}
              </span>,
              typeof r.capacity === 'number' ? (
                <span key="c">{r.capacity}</span>
              ) : (
                <Tag key="c" color="orange" fill="outline" small>
                  unset
                </Tag>
              ),
              r.sessionCount === 0 ? (
                <Tag key="s" color="grey" fill="outline" small>
                  none
                </Tag>
              ) : (
                r.sessionCount
              ),
              r.publishedCount,
              <Link key="a" href={`?edit=${encodeURIComponent(r.id)}`} style={{ fontSize: 12 }}>
                Edit
              </Link>,
            ])}
          />
          )}

          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>
            <strong>Rooms cannot be deleted.</strong> Move its sessions to another room in{' '}
            <Link href={ROUTES.sessionManager}>Session Manager</Link> instead.
          </p>
        </Panel>
      )}

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          The venue
        </h2>
        <p className="body-2">
          <strong>{EVENT.venue}</strong>. The venue cannot be edited here. It is listed with the
          other event details on <Link href="/content/basics">Basics</Link>.
        </p>
        <p className="body-2">
          <strong>Emergency card:</strong>{' '}
          <Tag color={logistics.planReady ? 'green' : 'orange'} fill="outline">
            {logistics.planReady ? 'marked ready' : 'draft'}
          </Tag>{' '}
          {logistics.assemblyPoint ? (
            <>
              Assembly point <strong>{logistics.assemblyPoint}</strong>
              {logistics.onSiteLead ? (
                <>
                  , on-site lead <strong>{logistics.onSiteLead}</strong>
                </>
              ) : null}
              .{' '}
            </>
          ) : (
            <>No assembly point recorded. </>
          )}
          Filled in on{' '}
          <Link href="/virtual-and-hybrid/logistics-management/emergency-manager">
            Emergency Manager
          </Link>
          .
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Venue notes for attendees.</strong> No wifi, parking, accessibility or shuttle
            fields, because the app has no screen that would show them. Adding a sixth tab means an
            SF Symbol, an Android vector icon and a release, so realistically this lives under Home
            or Me — the app change first, the form here second.
          </li>
          <li>
            <strong>A venue map, and room pins on it.</strong> <code>RoomDoc</code> models{' '}
            <code>mapX</code> / <code>mapY</code> as fractions of a floorplan image; there is no
            floorplan to place them on, so the room form does not offer them. The same missing image
            blocks booth selection and poster board numbering.
          </li>
          <li>
            <strong>Emergency information.</strong> Filed on a separate screen under Virtual &amp;
            Hybrid, and the one item on this page that would genuinely matter at 3pm on day two.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
