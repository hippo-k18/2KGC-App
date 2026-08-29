import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSessions, type SessionRow } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { clockOf } from '@/lib/time';
import { Banner, GapPanel, PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content > Agenda Center > Session Manager.
 *
 * Whova's agenda is deliberately *not* a table and not a calendar grid. It is a
 * vertical stack of hour buckets — one white card per clock hour, with the hour
 * label at top-left and an "Add session" control at top-right — and sessions
 * live inside the bucket their start time falls in. Each session is a dark
 * charcoal header strip (drag handle, underlined title, type pill, and the
 * Edit / Duplicate / Swap / More actions in white text) over a white body
 * carrying the time and the speakers.
 *
 * That shape is unusual enough that it is worth saying why it is copied rather
 * than replaced with a table: it is the layout an organizer scans to answer
 * "what is happening at 2pm and is there a hole", which is the actual question,
 * and a sortable table answers it worse. The overnight hours collapse into a
 * single `12:00 AM – 7:00 AM` bucket for the same reason.
 *
 * The day tabs are two-line (weekday over `Mmm D`), which is Whova's, and the
 * day is a query parameter so a link to "Tuesday" is shareable — Whova keeps it
 * in component state and loses it on reload, which is one of the specific
 * complaints in the research.
 *
 * Not built here, and it is the expensive half: the Excel round-trip, bulk
 * edit, block move and swap, and the drag-drop calendar. Those are ~15–20 days
 * against a programme that is authored in a spreadsheet by a committee anyway,
 * which is why §35.1 trades them for one good importer.
 */

function prettyDayTab(day: string): { weekday: string; date: string } {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return {
    weekday: dt.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' }),
    date: dt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }),
  };
}

function hourLabel(h: number): string {
  const ampm = h < 12 ? 'AM' : 'PM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${ampm}`;
}

function twelveHour(wall: string): string {
  const [hh, mm] = clockOf(wall).split(':').map(Number);
  const ampm = hh < 12 ? 'AM' : 'PM';
  const twelve = hh % 12 === 0 ? 12 : hh % 12;
  return `${twelve}:${String(mm).padStart(2, '0')} ${ampm}`;
}

const CHARCOAL = '#3f3f3f';

function SessionCard({ s }: { s: SessionRow }) {
  return (
    <div style={{ border: '1px solid var(--hairline)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
      <div
        style={{
          alignItems: 'center',
          background: CHARCOAL,
          color: '#fff',
          display: 'flex',
          gap: 10,
          minHeight: 34,
          padding: '6px 10px',
        }}
      >
        <span aria-hidden="true" style={{ opacity: 0.7 }}>
          ✥
        </span>
        <Link
          href={`${ROUTES.sessionManager}/${s.id}`}
          style={{ color: '#fff', textDecoration: 'underline', fontSize: 14 }}
        >
          {s.title}
        </Link>
        {s.format ? (
          <span
            style={{
              background: s.status === 'published' ? '#00a65a' : '#adb0b6',
              borderRadius: 12,
              color: '#fff',
              fontSize: 11,
              padding: '2px 8px',
              textTransform: 'capitalize',
            }}
          >
            {s.format}
          </span>
        ) : null}
        {s.status !== 'published' ? (
          <span
            style={{ background: '#ffdb00', borderRadius: 12, color: '#333', fontSize: 11, padding: '2px 8px' }}
          >
            {s.status}
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: 13 }}>
          <Link href={`${ROUTES.sessionManager}/${s.id}`} style={{ color: '#fff' }}>
            Edit
          </Link>
        </span>
      </div>
      <div
        style={{
          background: '#fff',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 18,
          fontSize: 13,
          padding: '10px 12px',
        }}
      >
        <span>
          🕐 {twelveHour(s.startsAtLocal)} – {twelveHour(s.endsAtLocal)}
        </span>
        {s.roomName ? <span>📍 {s.roomName}</span> : null}
        {s.primaryTrackName ? <span>🏷 {s.primaryTrackName}</span> : null}
        {s.speakerNames.length ? <span>👤 {s.speakerNames.join(', ')}</span> : null}
      </div>
    </div>
  );
}

export default async function SessionManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; q?: string }>;
}) {
  await requireOrganizer();

  const { day, q } = await searchParams;
  const all = await listSessions();
  const days = [...new Set(all.map((s) => s.day))].sort();
  const activeDay = day && days.includes(day) ? day : (days[0] ?? '');

  const needle = (q ?? '').trim().toLowerCase();
  const onDay = all.filter((s) => s.day === activeDay);
  const rows =
    needle.length >= 3
      ? onDay.filter((s) =>
          [s.title, ...s.speakerNames, s.roomName ?? '', s.primaryTrackName ?? '']
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : onDay;

  // Whova collapses everything before 07:00 into one bucket, then one per hour
  // through the last hour that actually has something in it.
  const byHour = new Map<number, SessionRow[]>();
  for (const s of rows) {
    const h = Number(clockOf(s.startsAtLocal).slice(0, 2));
    const bucket = h < 7 ? -1 : h;
    byHour.set(bucket, [...(byHour.get(bucket) ?? []), s]);
  }
  const lastHour = Math.max(7, ...[...byHour.keys()].filter((h) => h >= 0));
  const hours = Array.from({ length: lastHour - 7 + 1 }, (_, i) => 7 + i);
  const unscheduled = all.filter((s) => !s.day);

  const qs = (d: string) => `${ROUTES.sessionManager}?day=${d}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

  return (
    <>
      <PageHeader
        title="Session Manager"
        actions={
          <Link className="whova-btn-main small secondary" href={ROUTES.trackManager}>
            Track Manager
          </Link>
        }
        links={[
          <Link key="c" href="/content/agenda-center">
            Agenda Center
          </Link>,
          <Link key="cc" href="/content/agenda-center/conflict-check">
            Conflict Check
          </Link>,
          <span key="n" className="muted">
            {all.length} sessions · {days.length} days
          </span>,
        ]}
      />

      <Panel>
        {unscheduled.length ? (
          <Banner kind="warning">
            <strong>{unscheduled.length}</strong> sessions are not scheduled.
          </Banner>
        ) : null}

        <div className="toolbar">
          <button type="button" className="btn btn-primary" disabled title="Not built — see below">
            Import ▾
          </button>
          <button type="button" className="btn btn-primary" disabled title="Not built — see below">
            Reuse from past event
          </button>
          <button type="button" className="btn btn-default" disabled title="Not built — see below">
            Copy day
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-default" disabled title="Not built — see below">
            Export ▾
          </button>
        </div>

        <form method="get" className="toolbar">
          <input type="hidden" name="day" value={activeDay} />
          <input
            className="whova-text-input"
            name="q"
            defaultValue={q ?? ''}
            autoComplete="off"
            placeholder="Search by session name, speaker name, room or track (min 3 chars)"
            style={{ maxWidth: 520 }}
          />
          <button type="submit" className="btn btn-default">
            Search
          </button>
          {q ? (
            <Link className="btn btn-default" href={qs(activeDay)}>
              Clear
            </Link>
          ) : null}
          <span className="spacer" />
          <button type="button" className="btn btn-default" disabled title="Not built — see below">
            Bulk edit ▾
          </button>
        </form>

        <div style={{ display: 'flex', gap: 1, marginBottom: 16, flexWrap: 'wrap' }}>
          {days.map((d) => {
            const t = prettyDayTab(d);
            const on = d === activeDay;
            return (
              <Link
                key={d}
                href={qs(d)}
                style={{
                  background: on ? 'var(--interactive)' : '#fdfdfd',
                  border: on ? '1px solid var(--interactive)' : '1px solid var(--line-strong)',
                  color: on ? '#fff' : 'var(--body)',
                  fontWeight: on ? 700 : 400,
                  lineHeight: '17px',
                  minWidth: 74,
                  padding: '8px 14px',
                  textAlign: 'center',
                  textDecoration: 'none',
                }}
              >
                <span style={{ display: 'block', fontSize: 12 }}>{t.weekday}</span>
                <span style={{ display: 'block', fontSize: 13 }}>{t.date}</span>
              </Link>
            );
          })}
        </div>

        <div style={{ background: 'var(--surface-alt)', borderRadius: 4, padding: 10 }}>
          {byHour.has(-1) ? (
            <div style={{ background: '#fff', border: '1px solid var(--hairline)', borderRadius: 4, marginBottom: 10, padding: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>12:00 AM – 7:00 AM</div>
              {byHour.get(-1)!.map((s) => (
                <SessionCard key={s.id} s={s} />
              ))}
            </div>
          ) : null}

          {hours.map((h) => (
            <div
              key={h}
              style={{
                background: '#fff',
                border: '1px solid var(--hairline)',
                borderRadius: 4,
                marginBottom: 10,
                padding: 10,
              }}
            >
              <div style={{ alignItems: 'center', display: 'flex', marginBottom: 8 }}>
                <span style={{ fontWeight: 600 }}>{hourLabel(h)}</span>
                <span style={{ flex: 1 }} />
                <button type="button" className="btn btn-default btn-sm" disabled title="Not built — see below">
                  Add session ▾
                </button>
              </div>
              {(byHour.get(h) ?? []).map((s) => (
                <SessionCard key={s.id} s={s} />
              ))}
              {(byHour.get(h) ?? []).length === 0 ? (
                <div className="muted" style={{ fontSize: 12, paddingLeft: 2 }}>
                  Nothing scheduled.
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Agenda import and export.</strong> Whova&apos;s canonical workflow is an Excel
            round-trip — three sheets, multi-value separators, speaker names that must match the
            Speaker sheet exactly, and 25 rows of instructions that must not be deleted because
            data starts at row 26. The research puts a round-trippable importer with stable IDs at
            6–9 days and calls the estimate deceptive: everyone underestimates it by 3×.{' '}
            <code>scripts/src/import-whova.ts</code> is the start of it.
          </li>
          <li>
            <strong>Add a session, sub-sessions and non-session items.</strong> Note the time
            cascade Whova does: move a parent and its sub-sessions move to fit the new bounds.{' '}
            <code>SessionDoc</code> has <code>seriesId</code> for repeated runs but no parent link.
          </li>
          <li>
            <strong>Bulk edit, block move and swap</strong>, plus the neighbour-aware prompts that
            offer to extend or shorten an adjacent session when an edit opens a gap. That last one
            is small and genuinely good; the rest is what §35.1 trades away.
          </li>
          <li>
            <strong>Telling attendees a session moved.</strong> Whova has nothing here either — no
            versioning, no diff, no automatic notice, only a manual announcement. Editing a session
            below writes one document that every phone watching it picks up within about a second;
            notifying the people who saved it is the <code>roomChangePush()</code> seam in{' '}
            <code>src/lib/push.ts</code>, targeted rather than broadcast on purpose.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
