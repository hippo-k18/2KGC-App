import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { findConflicts, type Conflict } from '@/lib/conflicts';
import { ROUTES } from '@/lib/nav';
import { EmptyState, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Agenda Center › Conflict Check.
 *
 * Whova flags double-booked speakers and rooms and lets an organizer write
 * custom rules. This finds those two plus three more, and needs no data that
 * Session Manager does not already load — which is why it was the cheapest
 * useful screen left on the list.
 *
 * ── Errors and warnings are separated, deliberately ─────────────────────────
 *
 * A double-booked room is a fact: two things cannot happen in one place. A
 * session with no speaker assigned might be a panel still being confirmed. If
 * both render as "problems" in one list, an organizer with eleven legitimate
 * warnings stops reading the list — and the twelfth row is the keynote clash.
 *
 * ── There is no "ignore" button ─────────────────────────────────────────────
 *
 * Whova has custom rules; dismissing a conflict is not the same thing and is a
 * worse idea. A dismissal is a decision with no expiry: the session moves, the
 * clash becomes real again, and the screen stays quiet because somebody clicked
 * ignore in March. Fix it in Session Manager or leave it visible.
 */

const KIND_LABEL: Record<Conflict['kind'], string> = {
  'speaker-double-booked': 'Speaker clash',
  'room-double-booked': 'Room clash',
  'over-capacity': 'Over capacity',
  'no-room': 'No room',
  'no-speaker': 'No speaker',
};

function ConflictTable({ rows }: { rows: Conflict[] }) {
  return (
    <Table
      cols={[
        { key: 'kind', label: 'Type', className: 'cell-sm' },
        { key: 'day', label: 'Day', className: 'cell-sm' },
        { key: 'what', label: 'Problem', className: 'cell-fill' },
        { key: 'sessions', label: 'Sessions', className: 'cell-md' },
      ]}
      rows={rows.map((c) => [
        <Tag key="k" color={c.severity === 'error' ? 'red' : 'orange'} fill="outline" small>
          {KIND_LABEL[c.kind]}
        </Tag>,
        <span key="d" className="muted" style={{ fontSize: 12 }}>
          {c.day}
        </span>,
        <span key="w" style={{ fontSize: 13 }}>
          {c.summary}
        </span>,
        <div key="s" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/*
            Every conflict links straight to the session editor. The whole point
            of the screen is the next click, and making somebody search Session
            Manager for a title they just read is the difference between a
            report and a tool.
          */}
          {c.sessions.map((s) => (
            <Link key={s.id} href={`${ROUTES.sessionManager}/${s.id}`} style={{ fontSize: 12 }}>
              {s.title}
              <span className="muted"> · {s.startsAtLocal.slice(11, 16)}</span>
            </Link>
          ))}
        </div>,
      ])}
    />
  );
}

export default async function ConflictCheckPage() {
  await requireOrganizer();
  const report = await findConflicts();

  const errors = report.conflicts.filter((c) => c.severity === 'error');
  const warnings = report.conflicts.filter((c) => c.severity === 'warning');

  return (
    <>
      <PageHeader
        title="Conflict Check"
        tags={
          report.errors > 0 ? (
            <Tag color="red" fill="solid">
              {report.errors} to fix
            </Tag>
          ) : (
            <Tag color="green" fill="outline">
              no clashes
            </Tag>
          )
        }
        links={[
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="t" href={ROUTES.trackManager}>
            Track Manager
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Sessions checked', value: report.sessionsChecked, sub: 'excludes cancelled' },
          { label: 'Must fix', value: report.errors, sub: 'clashes and missing rooms' },
          { label: 'Worth a look', value: report.warnings, sub: 'judgement calls' },
        ]}
      />

      {report.conflicts.length === 0 ? (
        <Panel>
          <EmptyState icon="✓">
            <strong>No conflicts found.</strong>
            <p className="muted" style={{ marginTop: 6 }}>
              Across {report.sessionsChecked} sessions: no speaker is in two places at once, no room
              is booked twice, and every published session has a room. Cancelled and deleted
              sessions are not checked.
            </p>
          </EmptyState>
        </Panel>
      ) : (
        <>
          {errors.length > 0 && (
            <Panel>
              <h2 style={{ fontSize: 15, marginTop: 0 }}>Must fix ({errors.length})</h2>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                Each of these is a fact about the programme rather than a judgement — two things
                cannot happen in one room, and a published session with no room has nowhere to
                print on the agenda.
              </p>
              <ConflictTable rows={errors} />
            </Panel>
          )}

          {warnings.length > 0 && (
            <Panel style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: 15, marginTop: 0 }}>Worth a look ({warnings.length})</h2>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                These may well be deliberate — a panel whose speakers are still being confirmed, or
                a room you intend to oversell because half the audience never turns up.
              </p>
              <ConflictTable rows={warnings} />
            </Panel>
          )}
        </>
      )}

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What this checks</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Speaker clash</strong> — one person on two overlapping sessions. Matched on
            speaker id, not name, so two people called the same thing are not confused.
          </li>
          <li>
            <strong>Room clash</strong> — one room hosting two overlapping sessions. A session
            ending at 10:00 does not clash with one starting at 10:00.
          </li>
          <li>
            <strong>Over capacity</strong> — a session cap larger than the room holds.
          </li>
          <li>
            <strong>No room</strong> — a <em>published</em> session with nowhere to be. Drafts are
            exempt, so this stays usable while the programme is being built.
          </li>
          <li>
            <strong>No speaker</strong> — a published session with nobody assigned. Social formats
            are exempt.
          </li>
        </ul>
      </Panel>
    </>
  );
}
