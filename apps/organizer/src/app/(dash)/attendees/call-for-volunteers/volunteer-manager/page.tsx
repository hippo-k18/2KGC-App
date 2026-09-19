import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSessions } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { listVolunteers, overlappingShifts, summariseRoster, withRegistrations } from '@/lib/volunteers';
import { ConfirmButton } from '../../../form';
import { Banner, NotInputted, PER_PAGE, PageHeader, Pagination, Panel, StatTiles, Table, Tag, listParams, paginate } from '../../../ui';
import { deleteVolunteerAction, setVolunteerStatusAction } from './actions';
import { VolunteerForm } from './form';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Call for Volunteers › Volunteer Manager.
 *
 * ── What this is, and what it deliberately is not ───────────────────────────
 *
 * A roster: people, shifts, and whether each one has said yes. `volunteers` is
 * its own server-only collection rather than a role on `users`, because a role
 * is a claim minted from a laptop by `scripts/src/set-claims.ts` and adding a
 * volunteer through this screen would have granted precisely nothing — the
 * silent-no-op defect AGENTS.md counts fourteen instances of. It is also not
 * `contacts`: that collection's `unsubscribedAt` suppresses sends, and somebody
 * who left the newsletter still has to be told which door to stand at.
 *
 * The shift is on the row, so one person working two shifts is two rows joined
 * by their address. That is the shape the question needs — "who is on the desk
 * at 08:00" is a filter over rows — and `overlappingShifts()` is the one piece
 * of roster arithmetic done on read, because a volunteer double-booked at 09:00
 * is a hole in the plan that nobody notices until 09:00.
 *
 * ── Recruitment is still a form this project does not have ──────────────────
 *
 * Whova's call for volunteers is a public submission portal, the same missing
 * capability behind Call for Speakers. Rows arrive here by hand or from the
 * CSV import on Attendees. That is stated in the header tip rather than on the
 * page, because it is a limit of this software and not something an organizer
 * does anything about in the next minute.
 */
export default async function VolunteerManagerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();

  const sp = await searchParams;
  const filter = typeof sp.status === 'string' ? sp.status : undefined;
  const { page, baseParams } = listParams(sp);

  const [roster, sessions] = await Promise.all([
    listVolunteers().then(withRegistrations),
    listSessions(),
  ]);

  const summary = summariseRoster(roster);
  const clashes = overlappingShifts(roster);

  // The days the event actually runs on, offered to the shift field so a roster
  // cannot be built for a Saturday the conference does not use.
  const days = [...new Set(sessions.filter((s) => s.status !== 'cancelled').map((s) => s.day))].sort();

  const matched = filter ? roster.filter((r) => r.status === filter) : roster;
  const pageRows = paginate(matched, page, PER_PAGE);

  const chip = (value: string | undefined, label: string, count: number) => (
    <Link
      key={label}
      className={`whova-tag-main ${value === filter ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
      href={value ? `?status=${value}` : '/attendees/call-for-volunteers/volunteer-manager'}
      style={{ textDecoration: 'none' }}
    >
      {label} ({count})
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Volunteer Manager"
        info={
          <>
            <strong>Volunteer roster</strong>
            <p>
              Add volunteers here. There is no public sign-up form yet, and volunteers get no extra
              access.
            </p>
          </>
        }
        tags={<Tag color="blue">{summary.total} on the roster</Tag>}
        links={[
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="c" href="/attendees/call-for-volunteers/release-and-consent-forms">
            Release &amp; Consent Forms
          </Link>,
        ]}
      />

      {clashes.length > 0 ? (
        <Banner kind="warning">
          <strong>
            {clashes.length} {clashes.length === 1 ? 'volunteer is' : 'volunteers are'} rostered on
            two shifts at once.
          </strong>{' '}
          {clashes
            .slice(0, 3)
            .map(([a, b]) => `${a.name}: ${a.role} and ${b.role} on ${a.day}`)
            .join('; ')}
          {clashes.length > 3 ? `, and ${clashes.length - 3} more` : ''}.
        </Banner>
      ) : null}

      <StatTiles
        tiles={[
          {
            label: 'Shifts',
            value: summary.total,
            sub: summary.total
              ? `${summary.people} ${summary.people === 1 ? 'person' : 'people'}`
              : 'none yet',
          },
          {
            label: 'Confirmed',
            value: summary.confirmed,
            sub: summary.total ? `of ${summary.total} shifts` : 'none yet',
          },
          {
            label: 'Awaiting an answer',
            value: summary.outstanding,
            sub: summary.outstanding ? 'invited, not yet replied' : 'nobody outstanding',
          },
          {
            label: 'No shift yet',
            value: summary.unscheduled,
            sub: summary.unscheduled ? 'no day or time set' : 'every shift has a time',
          },
        ]}
      />

      <Panel>
        <h2 className="section-header">Roster ({matched.length})</h2>

        {roster.length === 0 ? (
          <NotInputted what="volunteers" />
        ) : (
          <>
            <div className="toolbar">
              {chip(undefined, 'Everyone', summary.total)}
              {chip('confirmed', 'Confirmed', summary.confirmed)}
              {chip('invited', 'Invited', summary.outstanding)}
              {chip('declined', 'Declined', roster.filter((r) => r.status === 'declined').length)}
              {chip('no-show', 'No-show', roster.filter((r) => r.status === 'no-show').length)}
            </div>

            <Table
              cols={[
                { key: 'n', label: 'Volunteer', className: 'cell-md' },
                { key: 'r', label: 'Role', className: 'cell-mdsm' },
                { key: 's', label: 'Shift', className: 'cell-mdsm' },
                { key: 'st', label: 'Status', className: 'cell-sm' },
                { key: 'a', label: '', className: 'cell-fill' },
              ]}
              empty="Nobody matches that filter"
              rows={pageRows.map((v) => [
                <span key="n">
                  <strong>{v.name}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {v.email}
                    {v.phone ? ` · ${v.phone}` : ''}
                  </div>
                  {v.registrationId ? (
                    <div className="muted" style={{ fontSize: 11 }}>
                      also holds a ticket
                    </div>
                  ) : null}
                </span>,
                <span key="r">
                  {v.role}
                  {v.notes ? (
                    <div className="muted" style={{ fontSize: 11 }}>
                      {v.notes}
                    </div>
                  ) : null}
                </span>,
                v.day ? (
                  <span key="s" style={{ fontSize: 13 }}>
                    {v.day}
                    <div className="muted" style={{ fontSize: 12 }}>
                      {v.startsAtLocal || '—'}
                      {v.endsAtLocal ? ` to ${v.endsAtLocal}` : ''}
                    </div>
                  </span>
                ) : (
                  <span key="s" className="muted">
                    no shift yet
                  </span>
                ),
                <Tag
                  key="st"
                  color={
                    v.status === 'confirmed'
                      ? 'green'
                      : v.status === 'invited'
                        ? 'orange'
                        : v.status === 'declined'
                          ? 'grey'
                          : 'red'
                  }
                  small
                >
                  {v.status}
                </Tag>,
                /*
                  Two plain server-action forms rather than a select: the reply an
                  organizer wants is the row changing, and a `<select>` that needs
                  a Save beside it turns one click into three at the moment the
                  roster is actually being worked through.
                */
                <span key="a" style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
                  {v.status !== 'confirmed' ? (
                    <form action={setVolunteerStatusAction}>
                      <input type="hidden" name="id" value={v.id} />
                      <input type="hidden" name="status" value="confirmed" />
                      <button type="submit" className="linkish">
                        Confirm
                      </button>
                    </form>
                  ) : null}
                  {v.status !== 'declined' ? (
                    <form action={setVolunteerStatusAction}>
                      <input type="hidden" name="id" value={v.id} />
                      <input type="hidden" name="status" value="declined" />
                      <button type="submit" className="linkish">
                        Declined
                      </button>
                    </form>
                  ) : null}
                  {v.status !== 'no-show' ? (
                    <form action={setVolunteerStatusAction}>
                      <input type="hidden" name="id" value={v.id} />
                      <input type="hidden" name="status" value="no-show" />
                      <button type="submit" className="linkish">
                        No-show
                      </button>
                    </form>
                  ) : null}
                  <ConfirmButton
                    action={deleteVolunteerAction}
                    label="Remove"
                    confirmLabel="Remove from roster"
                    hidden={{ id: v.id }}
                  >
                    Takes {v.name} off the roster. Any waiver they signed is kept.
                  </ConfirmButton>
                </span>,
              ])}
            />
            <Pagination
              total={matched.length}
              page={page}
              perPage={PER_PAGE}
              baseParams={baseParams}
            />
          </>
        )}
      </Panel>

      {summary.days.length > 0 ? (
        <Panel>
          <h2 className="section-header">Cover by day</h2>
          <Table
            cols={[
              { key: 'd', label: 'Day', className: 'cell-sm' },
              { key: 's', label: 'Shifts', className: 'cell-xs' },
              { key: 'c', label: 'Confirmed', className: 'cell-xs' },
              { key: 'g', label: '', className: 'cell-fill' },
            ]}
            rows={summary.days.map((d) => [
              <strong key="d">{d.day}</strong>,
              d.count,
              d.confirmed,
              d.confirmed < d.count ? (
                <span key="g" style={{ fontSize: 13 }}>
                  {d.count - d.confirmed} still to answer
                </span>
              ) : (
                <span key="g" className="muted" style={{ fontSize: 13 }}>
                  fully confirmed
                </span>
              ),
            ])}
          />
        </Panel>
      ) : null}

      <Panel>
        <h2 className="section-header">Add a volunteer</h2>
        <VolunteerForm days={days} />
      </Panel>
    </>
  );
}
