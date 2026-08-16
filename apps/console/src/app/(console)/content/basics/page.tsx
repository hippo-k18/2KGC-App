import Link from 'next/link';
import { COLLECTIONS, EVENT, EVENT_ID } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { countWhereEvent, listSessions } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { targetDescription } from '@/lib/firestore';

export const dynamic = 'force-dynamic';

/**
 * Content > Basics — §4.1.
 *
 * Whova's version is an editable form. This one is not, and the reason is worth
 * stating on the page rather than hiding: the event's identity lives in
 * `packages/shared/src/event.ts` as compile-time constants, shared by the Expo
 * app, the seed script, the Whova importer and this console precisely so the
 * four cannot drift. `TIME_ZONE` in particular is what `day` is derived from on
 * every session; making it editable from a web form would mean a write that
 * silently invalidates 72 derived day keys and moves sessions onto the wrong
 * tab on a thousand phones. That is a migration, not a text input.
 */
export default async function BasicsPage() {
  await requireOrganizer();

  const [sessions, attendees, speakers, sponsors, tracks] = await Promise.all([
    listSessions(),
    countWhereEvent(COLLECTIONS.users),
    countWhereEvent(COLLECTIONS.speakers),
    countWhereEvent(COLLECTIONS.sponsors),
    countWhereEvent(COLLECTIONS.tracks),
  ]);

  const days = [...new Set(sessions.map((s) => s.day))].sort();

  return (
    <>
      <p className="crumbs">
        <Link href="/content">Content</Link> {' › '}
      </p>
      <h1>Basics</h1>
      <p className="muted">
        Event name, dates, timezone and venue — the fields §4.1 lists for this screen.
      </p>

      <table style={{ maxWidth: 780 }}>
        <tbody>
          <tr>
            <th style={{ width: 190 }}>Event Name</th>
            <td>{EVENT.name}</td>
          </tr>
          <tr>
            <th>Short name</th>
            <td>{EVENT.shortName}</td>
          </tr>
          <tr>
            <th>Event ID</th>
            <td>
              <code>{EVENT_ID}</code> — stamped on every top-level document, and leading every
              composite index, so KGC 2028 can exist beside 2027.
            </td>
          </tr>
          <tr>
            <th>Start Date</th>
            <td>
              {days[0] ?? '—'} <span className="muted">(earliest scheduled session)</span>
            </td>
          </tr>
          <tr>
            <th>End Date</th>
            <td>
              {days[days.length - 1] ?? '—'} <span className="muted">(latest scheduled session)</span>
            </td>
          </tr>
          <tr>
            <th>Time zone</th>
            <td>
              <code>{EVENT.timeZone}</code>
            </td>
          </tr>
          <tr>
            <th>Location/Venue</th>
            <td>{EVENT.venue}</td>
          </tr>
          <tr>
            <th>Website</th>
            <td>
              <a href={EVENT.website}>{EVENT.website}</a>
            </td>
          </tr>
          <tr>
            <th>Writing to</th>
            <td>{targetDescription()}</td>
          </tr>
        </tbody>
      </table>

      <h2>What is in the event</h2>
      <div className="tiles">
        <div className="tile">
          <div className="n">{sessions.length}</div>
          <Link href={ROUTES.sessionManager}>sessions</Link>
        </div>
        <div className="tile">
          <div className="n">{tracks}</div>
          <Link href={ROUTES.trackManager}>tracks</Link>
        </div>
        <div className="tile">
          <div className="n">{speakers}</div>
          <Link href={ROUTES.speakerManager}>speakers</Link>
        </div>
        <div className="tile">
          <div className="n">{sponsors}</div>
          <Link href={ROUTES.sponsorManager}>sponsors</Link>
        </div>
        <div className="tile">
          <div className="n">{attendees}</div>
          <Link href={ROUTES.attendees}>attendees</Link>
        </div>
        <div className="tile">
          <div className="n">{days.length}</div>
          event days
        </div>
      </div>

      <h2>Why this screen is read-only</h2>
      <p className="muted" style={{ maxWidth: 760 }}>
        These values are compile-time constants in{' '}
        <code>packages/shared/src/event.ts</code>, imported by the Expo app, the seed script, the
        Whova importer and this console so that the four cannot drift. Changing{' '}
        <code>TIME_ZONE</code> is not a text edit: <code>day</code>, <code>startsAt</code> and{' '}
        <code>endsAt</code> on all {sessions.length} sessions are derived from it, and rewriting it
        without re-deriving them moves sessions onto the wrong day tab on every phone — the exact
        failure the derivation comment in <code>scripts/src/lib/time.ts</code> exists to prevent.
        Whova has the same constraint and expresses it as a lock: event dates become editable only
        by emailing support once the event is published (§4.1), and the event description can never
        be edited after the event ends at all.
      </p>

      <h2>Fields Whova has here that this model does not</h2>
      <ul className="muted" style={{ maxWidth: 760 }}>
        <li>
          <strong>Event Description</strong> and <strong>Twitter hashtag</strong> — §4.1. The
          hashtag is load-bearing there: removing it disables the Twitter resource tab, because
          Whova derives feature visibility from data presence rather than from a toggle (§4.4).
        </li>
        <li>
          <strong>A geocoded venue</strong> with a map pin and a &ldquo;reset location&rdquo;
          affordance. Ours is a string.
        </li>
        <li>
          <strong>Brand colour, logo and banner</strong> — those are{' '}
          <Link href="/content/branding-center/app-branding">Branding Center → App Branding</Link>{' '}
          in Whova too, and are not built.
        </li>
      </ul>
    </>
  );
}
