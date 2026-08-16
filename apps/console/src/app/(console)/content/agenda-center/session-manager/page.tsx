import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSessions } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { clockOf } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * Content > Agenda Center > Session Manager — §11.
 *
 * Whova's most actively developed area, 40 help articles deep. What is here is
 * the spine §35.1 argues for keeping: the list, and edit-one-session. What is
 * not here is everything that flow says to trade for a spreadsheet importer —
 * bulk edit, block move, swap, the drag-drop calendar — which is ~15–20 days
 * against a programme that is authored in a spreadsheet by a committee anyway.
 */
export default async function SessionManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  await requireOrganizer();

  const { day } = await searchParams;
  const all = await listSessions();
  const days = [...new Set(all.map((s) => s.day))].sort();
  const rows = day ? all.filter((s) => s.day === day) : all;

  return (
    <>
      <p className="crumbs">
        <Link href="/content">Content</Link> {' › '}
        <Link href="/content/agenda-center">Agenda Center</Link> {' › '}
      </p>
      <h1>Session Manager</h1>
      <p className="muted">
        {rows.length} of {all.length} · sorted by local start · all statuses, including drafts and
        cancellations, which attendees cannot see.
      </p>

      <div className="filters">
        <Link href={ROUTES.sessionManager} aria-current={!day}>
          All days
        </Link>
        {days.map((d) => (
          <Link key={d} href={`${ROUTES.sessionManager}?day=${d}`} aria-current={d === day}>
            {d}
          </Link>
        ))}
      </div>

      <table>
        <thead>
          <tr>
            <th>Day</th>
            <th>Time</th>
            <th>Title</th>
            <th>Room</th>
            <th>Track</th>
            <th>Speakers</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td>{s.day}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {clockOf(s.startsAtLocal)}–{clockOf(s.endsAtLocal)}
              </td>
              <td>
                <Link href={`${ROUTES.sessionManager}/${s.id}`}>{s.title}</Link>
              </td>
              <td>{s.roomName ?? <span className="muted">—</span>}</td>
              <td>{s.primaryTrackName ?? <span className="muted">—</span>}</td>
              <td>{s.speakerNames.join(', ')}</td>
              <td className={s.status === 'published' ? '' : 'error'}>{s.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Not built here</h2>
      <ul className="muted" style={{ maxWidth: 780 }}>
        <li>
          <strong>Agenda import and export</strong> (§11.1, §11.2, §11.10). Whova&apos;s canonical
          workflow is an Excel round-trip — three sheets, multi-value separators, speaker names
          that must match the Speaker sheet exactly, and 25 rows of instructions that must not be
          deleted because data starts at row 26. §34 puts a round-trippable importer with stable
          IDs at 6–9 days and calls it very deceptive: &ldquo;everyone underestimates this by
          3×.&rdquo; <code>scripts/src/import-whova.ts</code> is the start of it.
        </li>
        <li>
          <strong>Add a session, sub-sessions and non-session items</strong> (§11.5, §11.6). Note
          the time-cascade Whova does: move a parent and its sub-sessions move to fit inside the
          new bounds. <code>SessionDoc</code> has <code>seriesId</code> for repeated runs but no
          parent link.
        </li>
        <li>
          <strong>Bulk edit, block move and swap</strong> (§11.7), and the neighbour-aware prompts
          that offer to extend or shorten adjacent sessions when an edit opens a gap or an overlap.
          That last one is small and genuinely good; the rest is what §35.1 trades away.
        </li>
        <li>
          <strong>Conflict checking</strong> — see{' '}
          <Link href="/content/agenda-center/conflict-check">Conflict Check</Link>. A double-booked
          speaker or room query over this exact data is 1–2 days and catches the errors that
          actually happen.
        </li>
        <li>
          <strong>Notifying attendees of a change.</strong> Whova has nothing here either (§11.9):
          no versioning, no draft/published split for the agenda, no diff, no automatic notice —
          the only mechanism is a manual announcement. Editing a session below writes one document,
          which every phone watching it picks up over its existing listener within about a second;
          telling the people who saved it is the{' '}
          <code>roomChangePush()</code> seam in <code>src/lib/push.ts</code>, and it is targeted at
          the attendees who saved that session rather than broadcast, on purpose.
        </li>
      </ul>
    </>
  );
}
