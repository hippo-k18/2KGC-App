import Link from 'next/link';
import { EVENT_ID } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listAttendees } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { EmptyState, GapPanel, PageHeader, Panel, StatTiles, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Manage Attendees › Cross-Event Report.
 *
 * Whova compares this event against the organizer's previous ones: returning
 * attendees, year-on-year growth, which sessions kept people coming back.
 *
 * There is one event in this database. `EVENT_ID` is a constant in
 * `@kgc/shared`, every top-level document carries it, and every query in this
 * dashboard filters on it — so a comparison has nothing on the other side.
 * Showing this event's numbers under a heading that says "cross-event" would be
 * the clearest possible example of the defect AGENTS.md counts fourteen of.
 *
 * ── What a second event would need, kept here rather than on the screen ────
 *
 * The storage half is done: every top-level document carries `eventId` and it
 * leads every composite index, so a second event coexists in the same
 * collections without a migration. That was the expensive decision — Firestore
 * cannot add a field to an existing index, so retrofitting it means a full
 * rebuild and backfill — and it was made correctly at the start.
 *
 * The plumbing half is not. `EVENT_ID` is a compile-time constant shared by the
 * app, the website and this dashboard; a second event turns it into a runtime
 * selection — a switcher in the header, an event in the session cookie, and
 * every query in `lib/` taking it as an argument rather than importing it.
 *
 * And the interesting question is identity: "returning attendee" means matching
 * a person in 2027 to a person in 2026, and `registrationId` is derived from the
 * email address, which people change. A uid is stabler and covers only people
 * who signed in. Whichever is chosen, the retention figure inherits its error,
 * and a retention number with an unstated matching rule is one nobody should
 * act on.
 */
export default async function CrossEventReportPage() {
  await requireOrganizer();

  // The same single equality filter every read here uses. One event, so this is
  // the whole population — and that is precisely the problem this screen has.
  const attendees = await listAttendees();

  return (
    <>
      <PageHeader
        title="Cross-Event Report"
        info={
          <>
            <strong>One event in this database</strong>
            <p>
              There is nothing on the other side of a comparison, so no returning-attendee figure,
              retention rate or year-on-year trend is computed, and none is shown.
            </p>
          </>
        }
        tags={<Tag color="grey">one event</Tag>}
        links={[
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="x" href={ROUTES.analyticsExports}>
            Analytics &amp; Exports
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Events in this database', value: 1, sub: EVENT_ID },
          { label: 'Attendees this event', value: attendees.length, sub: 'nothing to compare to' },
          { label: 'Returning attendees', value: '—', sub: 'not computable' },
        ]}
      />

      <Panel>
        <EmptyState icon="◌">
          <strong>No prior event to report against.</strong>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            Single-event analytics live on{' '}
            <Link href={ROUTES.analyticsExports}>Analytics &amp; Exports</Link>. Adoption,
            ticket mix, top organisations and the exports that leave the building.
          </div>
        </EmptyState>
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Any cross-event figure.</strong> Nothing on this page compares anything, because
            there is one event.
          </li>
          <li>
            <strong>An event switcher.</strong> <code>EVENT_ID</code> is a constant; changing it is
            a code change and a redeploy.
          </li>
          <li>
            <strong>Importing a past event for comparison.</strong> The Whova CSV importer at{' '}
            <code>scripts/src/import-whova.ts</code> writes into the current event. Loading a 2026
            export as a second event needs the runtime <code>eventId</code> above first, or it
            silently merges two years of attendees into one list.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
