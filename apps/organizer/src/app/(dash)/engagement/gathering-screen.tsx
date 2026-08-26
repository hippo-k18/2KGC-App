import Link from 'next/link';
import type { ReactNode } from 'react';
import type { GatheringDoc } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listRooms, listSessions } from '@/lib/data';
import { listGatherings, roomClashes } from '@/lib/gatherings';
import { Banner, PageHeader, Panel, ProgressBar, StatTiles, Table, Tag } from '../ui';
import { removeAttendeeAction, setStatusAction } from './gathering-actions';
import { GatheringForm, PlaceForm } from './gathering-forms';

/**
 * Round Table and 1-1 Meeting Scheduler.
 *
 * One screen for both, because a round table and a bookable meeting slot are
 * the same document — a title, a host, a room, a time and a cap — differing in
 * what they are called and in the default capacity.
 *
 * ── What this honestly is ──────────────────────────────────────────────────
 *
 * ⚠️ Nothing in the mobile app reads any of it. An attendee cannot browse
 * tables, join one, or request a meeting; that needs an app surface which does
 * not exist. What an organizer gets is the artefact they produce by hand today
 * — the printed table cards, the room grid on the wall, the list the front desk
 * works from — and that is worth having on its own.
 *
 * Saying so is the point. `AGENTS.md` records fourteen cases of this app
 * claiming a capability it does not have, three of them introduced by agents
 * cleaning up the other eleven. A screen implying attendees can sign up would
 * be the fifteenth.
 *
 * ── Room clashes are checked against the programme, not just each other ────
 *
 * A table booked into a room that already has a session in it is the failure
 * that actually happens, because the two are planned by different people at
 * different times. Both directions are checked.
 */
export async function GatheringScreen({
  kind,
  title,
  links,
  lead,
  formCopy,
  notBuilt,
  searchParams,
}: {
  kind: GatheringDoc['kind'];
  title: string;
  links?: ReactNode[];
  lead: ReactNode;
  formCopy: {
    titleLabel: string;
    titlePlaceholder: string;
    hostLabel: string;
    capacityHint: string;
    defaultCapacity: number;
    noun: string;
  };
  notBuilt: ReactNode[];
  searchParams: Promise<{ edit?: string }>;
}) {
  await requireOrganizer();

  const { edit } = await searchParams;
  const [rows, rooms, sessions] = await Promise.all([
    listGatherings(kind),
    listRooms(),
    listSessions(),
  ]);

  const editing = edit ? rows.find((r) => r.id === edit) : undefined;
  const live = rows.filter((r) => r.status !== 'cancelled');

  const seats = live.reduce((n, r) => n + r.capacity, 0);
  const placed = live.reduce((n, r) => n + r.attendees.length, 0);
  const clashes = roomClashes(rows);

  /** Days the programme actually uses, so a table cannot be put on a day with nothing on it. */
  const days = [...new Set(sessions.map((s) => s.day).filter(Boolean))].sort();

  /**
   * A table in a room that already has a session in it.
   *
   * The clash that actually happens, because the programme and the social plan
   * are made by different people weeks apart. Strict overlap — back-to-back is
   * how a room is used, not a mistake.
   */
  const programmeClashes = live.flatMap((g) =>
    g.roomId && g.day && g.startsAtLocal && g.endsAtLocal
      ? sessions
          .filter(
            (s) =>
              s.roomId === g.roomId &&
              s.day === g.day &&
              s.status !== 'cancelled' &&
              g.startsAtLocal < s.endsAtLocal &&
              s.startsAtLocal < g.endsAtLocal,
          )
          .map((s) => ({ gathering: g, session: s }))
      : [],
  );

  return (
    <>
      <PageHeader
        title={title}
        tags={
          clashes.length + programmeClashes.length > 0 ? (
            <Tag color="red" fill="solid">
              {clashes.length + programmeClashes.length} clashes
            </Tag>
          ) : (
            <Tag color={live.length > 0 ? 'blue' : 'grey'}>
              {live.length} planned
            </Tag>
          )
        }
        links={[
          <Link key="c" href="/engagement/community/meet-ups">
            Meet-ups
          </Link>,
          <Link key="r" href="/content/agenda-center/session-manager">
            Session Manager
          </Link>,
          ...(links ?? []),
        ]}
      />

      <Banner kind="warning">{lead}</Banner>

      <StatTiles
        tiles={[
          { label: formCopy.noun, value: live.length, sub: `${rows.length - live.length} cancelled` },
          { label: 'Seats', value: seats, sub: `${placed} placed` },
          { label: 'Spare', value: Math.max(0, seats - placed), sub: 'unfilled' },
          {
            label: 'Clashes',
            value: clashes.length + programmeClashes.length,
            sub: clashes.length + programmeClashes.length ? 'same room, same time' : 'none',
          },
        ]}
      />

      {(clashes.length > 0 || programmeClashes.length > 0) && (
        <Panel>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Room clashes</h2>
          <Table
            cols={[
              { key: 'r', label: 'Room', className: 'cell-sm' },
              { key: 'w', label: 'When', className: 'cell-sm' },
              { key: 'x', label: 'Both of these', className: 'cell-fill' },
            ]}
            rows={[
              ...clashes.map((c) => [
                c.a.roomName,
                `${c.a.day} ${c.a.startsAtLocal}`,
                <span key="x">
                  {c.a.title} · {c.b.title}
                </span>,
              ]),
              ...programmeClashes.map((c) => [
                c.gathering.roomName,
                `${c.gathering.day} ${c.gathering.startsAtLocal}`,
                <span key="x">
                  {c.gathering.title} ·{' '}
                  <Link href={`/content/agenda-center/session-manager?edit=${c.session.id}`}>
                    {c.session.title}
                  </Link>{' '}
                  <span className="muted">(on the programme)</span>
                </span>,
              ]),
            ]}
          />
          <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
            Checked against the agenda as well as against each other — a room double-booked between
            a session and a table is the clash that actually happens, because the two are planned by
            different people weeks apart. Back-to-back is not a clash.
          </p>
        </Panel>
      )}

      <Panel style={{ marginTop: clashes.length + programmeClashes.length > 0 ? 16 : 0 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The plan</h2>
        <Table
          cols={[
            { key: 't', label: formCopy.titleLabel, className: 'cell-fill' },
            { key: 'w', label: 'When', className: 'cell-md' },
            { key: 'p', label: 'Placed', className: 'cell-md' },
            { key: 'a', label: '', className: 'cell-sm' },
          ]}
          rows={rows.map((g) => [
            <div key="t">
              <div>
                {g.title}{' '}
                {g.status === 'cancelled' && (
                  <Tag color="grey" small>
                    cancelled
                  </Tag>
                )}
                {g.status === 'confirmed' && (
                  <Tag color="green" small>
                    confirmed
                  </Tag>
                )}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                {g.host ? `${formCopy.hostLabel}: ${g.host}` : 'no host'}
                {g.roomName ? ` · ${g.roomName}` : ' · no room'}
                {g.notes ? ` · ${g.notes}` : ''}
              </div>
              {g.attendees.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {g.attendees.map((a) => (
                    <form key={a} action={removeAttendeeAction}>
                      <input type="hidden" name="kind" value={kind} />
                      <input type="hidden" name="id" value={g.id} />
                      <input type="hidden" name="name" value={a} />
                      <button type="submit" className="linkish" title="Remove">
                        {a} ✕
                      </button>
                    </form>
                  ))}
                </div>
              )}
              {g.status !== 'cancelled' && (
                <div style={{ marginTop: 8 }}>
                  <PlaceForm kind={kind} gathering={g} />
                </div>
              )}
            </div>,

            <span key="w" className="muted" style={{ fontSize: 12 }}>
              {g.day || '—'}
              {g.startsAtLocal ? ` ${g.startsAtLocal}–${g.endsAtLocal}` : ''}
            </span>,

            <div key="p">
              <div style={{ fontSize: 13 }}>
                {g.attendees.length} / {g.capacity}
              </div>
              <ProgressBar pct={Math.min(100, (g.attendees.length / Math.max(1, g.capacity)) * 100)} />
            </div>,

            <div key="a" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Link href={`?edit=${g.id}`} style={{ fontSize: 12 }}>
                Edit
              </Link>
              <form action={setStatusAction}>
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={g.id} />
                <input
                  type="hidden"
                  name="status"
                  value={g.status === 'cancelled' ? 'planned' : 'cancelled'}
                />
                <button type="submit" className="linkish">
                  {g.status === 'cancelled' ? 'Restore' : 'Cancel'}
                </button>
              </form>
              {g.status === 'planned' && (
                <form action={setStatusAction}>
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="id" value={g.id} />
                  <input type="hidden" name="status" value="confirmed" />
                  <button type="submit" className="linkish">
                    Confirm
                  </button>
                </form>
              )}
            </div>,
          ])}
          empty={`Nothing planned. Add the first one below — it is the list the front desk will work from.`}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>
            {editing ? `Edit “${editing.title}”` : `Add a ${formCopy.noun.replace(/s$/, '').toLowerCase()}`}
          </h2>
          {editing && (
            <Link href="?" style={{ fontSize: 12 }}>
              Cancel
            </Link>
          )}
        </div>
        {/*
          Keyed, so React rebuilds rather than reusing the previous row's state.
          Without it, clicking Edit on a second table leaves the first one's
          capacity in the input — and saving would write it.
        */}
        <GatheringForm
          key={editing?.id ?? 'new'}
          kind={kind}
          editing={editing}
          rooms={rooms}
          days={days}
          {...formCopy}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Attendees cannot see or join any of this.</strong> The app has no surface for
            it — no browse, no join, no request. Everything above is an organizer&rsquo;s plan, and
            the people in it were placed by a person.
          </li>
          <li>
            <strong>Names, not accounts.</strong> Placed people are free text, because half of them
            are sponsors and partners who hold no account. That also means nothing joins a placement
            to a registration, so no badge and no export knows about it.
          </li>
          {notBuilt}
        </ul>
      </Panel>
    </>
  );
}
