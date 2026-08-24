import Link from 'next/link';
import { COLLECTIONS, EVENT, EVENT_ID } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { countWhereEvent, listSessions } from '@/lib/data';
import { targetDescription } from '@/lib/firestore';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content > Basics.
 *
 * Whova's version is an editable form with a Save button in the top-right of
 * the content header. This one is read-only, and the reason belongs on the page
 * rather than hidden in a comment: the event's identity lives in
 * `packages/shared/src/event.ts` as compile-time constants shared by the Expo
 * app, the seed script, the Whova importer and this dashboard, precisely so the
 * four cannot drift.
 *
 * `TIME_ZONE` in particular is what `day` is derived from on every session.
 * Making it editable from a web form would mean a write that silently
 * invalidates every derived day key and moves sessions onto the wrong tab on a
 * thousand phones. That is a migration, not a text input, and the Save button
 * is present-and-disabled so that the choice reads as one.
 */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ borderBottom: '1px solid var(--hairline)', display: 'flex', padding: '10px 0' }}>
      <div style={{ color: 'var(--ink)', flex: 'none', fontWeight: 500, width: 180 }}>{label}</div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

export default async function BasicsPage() {
  await requireOrganizer();

  const [sessions, attendees, speakers, sponsors, tracks, registrations] = await Promise.all([
    listSessions(),
    countWhereEvent(COLLECTIONS.users),
    countWhereEvent(COLLECTIONS.speakers),
    countWhereEvent(COLLECTIONS.sponsors),
    countWhereEvent(COLLECTIONS.tracks),
    countWhereEvent(COLLECTIONS.registrations),
  ]);

  const days = [...new Set(sessions.map((s) => s.day))].sort();

  return (
    <>
      <PageHeader
        title="Basics"
        actions={
          <button type="button" className="whova-btn-main small primary" disabled title="Read-only — see below">
            Save
          </button>
        }
        links={[
          <Link key="c" href="/content">
            Content
          </Link>,
          <span key="t" className="muted">
            {targetDescription()}
          </span>,
        ]}
      />

      <Panel>
        <Banner kind="info">
          <strong>Read-only.</strong> These values are compile-time constants in{' '}
          <code>packages/shared/src/event.ts</code>, shared by the app, the seed and the importer so
          they cannot drift. Changing the timezone here would invalidate the derived{' '}
          <code>day</code> on every session — a migration, not a text input.
        </Banner>

        <Row label="Event Name">{EVENT.name}</Row>
        <Row label="Short name">{EVENT.shortName}</Row>
        <Row label="Event ID">
          <code>{EVENT_ID}</code>{' '}
          <span className="muted">
            — stamped on every top-level document and leading every composite index, so KGC 2028 can
            exist beside 2027.
          </span>
        </Row>
        <Row label="Start Date">
          {days[0] ?? '—'} <span className="muted">(earliest scheduled session)</span>
        </Row>
        <Row label="End Date">
          {days[days.length - 1] ?? '—'} <span className="muted">(latest scheduled session)</span>
        </Row>
        <Row label="Time zone">
          <code>{EVENT.timeZone}</code>{' '}
          <span className="muted">
            — sessions are authored in this zone; a 21:00 reception is 01:00 UTC the next day.
          </span>
        </Row>
        <Row label="Location / Venue">{EVENT.venue}</Row>
        <Row label="Website">
          <a href={EVENT.website} target="_blank" rel="noreferrer">
            {EVENT.website}
          </a>
        </Row>
        <Row label="Description">
          <span className="muted">
            Not modelled. Whova cannot edit theirs after publish either — it requires emailing their
            support.
          </span>
        </Row>
        <Row label="Twitter hashtag">
          <span className="muted">Not modelled.</span>
        </Row>
      </Panel>

      <Panel>
        <h2 className="section-header">What is in the event</h2>
        <div className="index-grid">
          {(
            [
              ['Sessions', sessions.length, ROUTES.sessionManager],
              ['Days', days.length, ROUTES.sessionManager],
              ['Tracks', tracks, ROUTES.trackManager],
              ['Speakers', speakers, ROUTES.speakerManager],
              ['Sponsors', sponsors, ROUTES.sponsorManager],
              ['Registrations', registrations, ROUTES.checkIn],
              ['Signed-in attendees', attendees, ROUTES.attendees],
            ] as [string, number, string][]
          ).map(([label, n, href]) => (
            <Link key={label} className="index-card" href={href}>
              <span className="index-title">{label}</span>
              <span style={{ color: 'var(--ink)', display: 'block', fontSize: 24, fontWeight: 500 }}>
                {n}
              </span>
            </Link>
          ))}
        </div>
      </Panel>

      <Panel>
        <h2 className="section-header">Not built here</h2>
        <p className="body-2">
          Whova&apos;s Basics also carries Project Management — a checklist and team portal with
          external team members who are not event admins. That is a genuinely separate product
          surface with its own login, and it is sequenced after the demo rather than cut.
        </p>
      </Panel>
    </>
  );
}
