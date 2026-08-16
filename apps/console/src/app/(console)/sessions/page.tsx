import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSessions } from '@/lib/data';
import { clockOf } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function SessionsPage({
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
      <h1>Sessions</h1>
      <p className="muted">
        {rows.length} of {all.length} · sorted by local start · all statuses, including drafts and
        cancellations, which attendees cannot see.
      </p>

      <div className="filters">
        <Link href="/sessions" aria-current={!day}>
          All days
        </Link>
        {days.map((d) => (
          <Link key={d} href={`/sessions?day=${d}`} aria-current={d === day}>
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
                <Link href={`/sessions/${s.id}`}>{s.title}</Link>
              </td>
              <td>{s.roomName ?? <span className="muted">—</span>}</td>
              <td>{s.primaryTrackName ?? <span className="muted">—</span>}</td>
              <td>{s.speakerNames.join(', ')}</td>
              <td className={s.status === 'published' ? '' : 'error'}>{s.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
