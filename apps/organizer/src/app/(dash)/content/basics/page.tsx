import Link from 'next/link';
import { COLLECTIONS, EVENT, EVENT_ID } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { countWhereEvent, listSessions } from '@/lib/data';
import { targetLabel } from '@/lib/firestore';
import { ROUTES } from '@/lib/nav';
import { GapPanel, NotInputted, PageHeader, Panel } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content > Basics.
 *
 * Read-only, and the reason is on the page rather than only in this comment:
 * the event's identity lives in `packages/shared/src/event.ts` as compile-time
 * constants shared by the Expo app, the seed script, the CSV importer and this
 * dashboard, precisely so the four cannot drift.
 *
 * `TIME_ZONE` in particular is what `day` is derived from on every session.
 * Making it editable from a web form would mean a write that silently
 * invalidates every derived day key and moves sessions onto the wrong tab on a
 * thousand phones. That is a migration, not a text input, so the page has no
 * Save button and says it is read-only.
 */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="stack-sm"
      style={{ borderBottom: '1px solid var(--hairline)', display: 'flex', gap: 2, padding: '10px 0' }}
    >
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
        info={
          <>
            <strong>Read-only</strong>
            <p>
              The event name, dates, time zone and venue are fixed for this edition and cannot be
              changed here.
            </p>
          </>
        }
        links={[
          <Link key="c" href="/content">
            Content
          </Link>,
          <Link key="w" href="/content/basics/website-copy">
            Website Copy
          </Link>,
        ]}
      />

      <Panel>
        <p className="body-2" style={{ marginTop: 0 }}>
          These details are read-only. The code of conduct contact and the call deadlines are
          edited at <Link href="/content/basics/website-copy">Website Copy</Link>.
        </p>

        <Row label="Event Name">{EVENT.name}</Row>
        <Row label="Short name">{EVENT.shortName}</Row>
        <Row label="Event ID">
          <code>{EVENT_ID}</code>
        </Row>
        <Row label="Signed in to">
          {EVENT.name}. {targetLabel()}.
        </Row>
        <Row label="Start Date">
          {days[0] ?? <span className="muted">no session is scheduled yet</span>}{' '}
          <span className="muted">(earliest scheduled session)</span>
        </Row>
        <Row label="End Date">
          {days[days.length - 1] ?? <span className="muted">no session is scheduled yet</span>}{' '}
          <span className="muted">(latest scheduled session)</span>
        </Row>
        <Row label="Time zone">
          <code>{EVENT.timeZone}</code>{' '}
          <span className="muted">All session times are in this zone.</span>
        </Row>
        <Row label="Location / Venue">{EVENT.venue}</Row>
        <Row label="Website">
          <a href={EVENT.website} target="_blank" rel="noreferrer">
            {EVENT.website}
          </a>
        </Row>
        <Row label="Tagline and hashtag">
          <Link href="/content/branding-center/app-branding">App Branding</Link>{' '}
          <span className="muted">Edited there.</span>
        </Row>
      </Panel>

      <Panel>
        <h2 className="section-header">What is in the event</h2>
        {sessions.length + tracks + speakers + sponsors + registrations + attendees === 0 ? (
          <NotInputted
            what="content"
            action={
              <Link className="whova-btn-main primary" href={ROUTES.sessionManager}>
                Start with the agenda
              </Link>
            }
          />
        ) : null}
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

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <p className="body-2">
          A team portal for external helpers who are not event admins. The checklist itself exists
          at Project Management; what is missing is a second login surface for people who should
          see it without seeing the rest of this dashboard.
        </p>
      </GapPanel>
    </>
  );
}
