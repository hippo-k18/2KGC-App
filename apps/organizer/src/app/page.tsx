import Link from 'next/link';
import { redirect } from 'next/navigation';
import { COLLECTIONS, EVENT } from '@kgc/shared';
import { currentSession } from '@/lib/auth';
import { countWhereEvent, listSessions } from '@/lib/data';
import { targetDescription } from '@/lib/firestore';

export const dynamic = 'force-dynamic';

/**
 * The Event List — Whova's `/xems/view/myevents/`.
 *
 * This is the page an organizer lands on before choosing an event, and the one
 * the sidebar's `MENU > Event List` points at. It exists here for a reason that
 * is more than fidelity: it is where the multi-event story lives. Every
 * top-level document in this project carries `EVENT_ID` and every composite
 * index leads with it, specifically so that KGC 2028 can exist beside 2027 —
 * this page is the surface that would show both.
 *
 * Today there is exactly one row, and saying so plainly is better than hiding
 * the page until there are two.
 *
 * It sits outside the `(dash)` group because it has no event selected, so it
 * has no tab strip and no sidebar — only the dark utility bar.
 */
export default async function EventListPage() {
  if (!(await currentSession())) redirect('/login');

  const [sessions, registrations] = await Promise.all([
    listSessions(),
    countWhereEvent(COLLECTIONS.registrations),
  ]);
  const days = [...new Set(sessions.map((s) => s.day))].sort();

  return (
    <>
      <header id="main-header">
        <div className="main-header">
          <Link className="logo" href="/">
            <span aria-hidden="true">⌂</span>
            <span className="logo-whova">{EVENT.shortName}</span>
            <span className="logo-project">EMS</span>
          </Link>
          <nav className="header-links">
            <Link href="/content/basics">Open event</Link>
          </nav>
        </div>
      </header>

      <div className="layout-boxed" style={{ paddingTop: 20 }}>
        <h1 style={{ fontSize: 25, fontWeight: 400, margin: '10px 0 20px' }}>My Events</h1>
        <div className="subtitle-2" style={{ marginBottom: 10 }}>
          Conferences
        </div>

        <Link
          href="/content/basics"
          style={{
            background: '#fff',
            border: '1px solid var(--hairline)',
            borderRadius: 4,
            display: 'flex',
            gap: 16,
            padding: 16,
            textDecoration: 'none',
          }}
        >
          <div
            style={{
              alignItems: 'center',
              background: 'var(--topnav-bg)',
              borderRadius: 4,
              color: '#fff',
              display: 'flex',
              flex: 'none',
              fontSize: 24,
              fontWeight: 700,
              height: 80,
              justifyContent: 'center',
              width: 80,
            }}
          >
            {EVENT.shortName}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'var(--body)', fontSize: 15, fontWeight: 500 }}>
              {EVENT.name}
              <span className="event-status-badge badge-alert">Draft</span>
            </div>
            <div style={{ color: 'var(--body)', fontSize: 14, fontWeight: 500 }}>
              {days.length ? `${days[0]} – ${days[days.length - 1]}` : 'no sessions scheduled'}
            </div>
            <div className="caption" style={{ marginTop: 6 }}>
              {EVENT.venue} · {registrations} registrations · {sessions.length} sessions ·{' '}
              {targetDescription()}
            </div>
          </div>
        </Link>

        <p className="caption" style={{ marginTop: 20 }}>
          One event today. Every top-level document carries <code>EVENT_ID</code> and every
          composite index leads with it, so a second year is a second row here rather than a second
          database — but nothing creates one yet, and there is no event switcher because there is
          nothing to switch to.
        </p>
      </div>
    </>
  );
}
