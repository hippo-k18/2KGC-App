import Link from 'next/link';
import { COLLECTIONS, EVENT, EVENT_ID } from '@kgc/shared';
import { eventBasics } from '@/lib/event';
import { SETTINGS_KEYS, readSettings } from '@/lib/settings';
import { requireOrganizer } from '@/lib/auth';
import { countWhereEvent, listSessions } from '@/lib/data';
import { targetLabel } from '@/lib/firestore';
import { ROUTES } from '@/lib/nav';
import { GapPanel, NotInputted, PageHeader, Panel } from '../../ui';
import { BasicsForm } from './basics-form';

export const dynamic = 'force-dynamic';

/**
 * Content > Basics.
 *
 * The event's name, dates, time zone, venue and type are `settings/event`,
 * edited in the form below. The constants in `packages/shared/src/event.ts` are
 * the fallback for anything left empty, so the masthead, the website and the
 * app show what they always did until somebody saves.
 *
 * The time zone is the one field with consequences beyond a label: session
 * times are wall clock in it. `actions.ts` explains what a change does and
 * does not move.
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

  const [saved, basics, sessions, attendees, speakers, sponsors, tracks, registrations] = await Promise.all([
    readSettings(SETTINGS_KEYS.event),
    eventBasics(),
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
            <strong>Event details</strong>
            <p>
              The name, dates, time zone, venue and event type. The website and the attendee app
              show what is saved here.
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
          Leave a box empty to use the value shown in grey. The code of conduct contact and the
          call deadlines are edited at <Link href="/content/basics/website-copy">Website Copy</Link>.
        </p>

        <BasicsForm
          saved={{
            name: saved.name,
            shortName: saved.shortName,
            startDate: saved.startDate,
            endDate: saved.endDate,
            timeZone: saved.timeZone,
            venue: saved.venue,
            eventType: saved.eventType,
          }}
          shown={basics}
          sessionsInZone={sessions.filter((x) => x.timeZone === basics.timeZone).length}
        />
        {saved.updatedBy && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Last changed by {saved.updatedBy}
            {saved.updatedAt ? ` on ${saved.updatedAt.slice(0, 10)}` : ''}.
          </p>
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <Row label="Shown as">
          {basics.name}. {basics.datesLong}. {basics.venue}
        </Row>
        <Row label="Event ID">
          <code>{EVENT_ID}</code>
        </Row>
        <Row label="Signed in to">
          {basics.name}. {targetLabel()}.
        </Row>
        <Row label="Scheduled sessions">
          {days.length === 0 ? (
            <span className="muted">no session is scheduled yet</span>
          ) : (
            <>
              {days[0]} to {days[days.length - 1]}
              {days[0] < basics.startDate || days[days.length - 1] > basics.endDate ? (
                <span className="muted"> Some sessions fall outside the event dates.</span>
              ) : null}
            </>
          )}
        </Row>
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
