import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSessions } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { GapPanel, PageHeader, Panel, StatTiles, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Manage Attendees › Hybrid Settings.
 *
 * Whova splits an attendee list into in-person and remote audiences and lets an
 * organizer set what each may see and do. The Attendees screen keeps that
 * column and every row reads `In Person`, because KGC 2027 is an in-person
 * event.
 *
 * This screen exists to say that once, properly, rather than to offer switches
 * that would silently do nothing. The interesting part is *how far* the absence
 * goes: it is not that hybrid is turned off, it is that the schema has no
 * notion of remote at all — `SessionDoc` has no stream URL and no virtual flag,
 * `RegistrationDoc` has no audience field, and the app has no player. Turning
 * hybrid "on" would be a data-model change, not a setting.
 */
export default async function HybridSettingsPage() {
  await requireOrganizer();

  // Single equality filter, sorted in memory — an `orderBy` on a second field
  // would need a composite index this repo does not declare, and the emulator
  // does not enforce indexes, so the failure would first appear in production.
  const sessions = await listSessions();

  return (
    <>
      <PageHeader
        title="Hybrid Settings"
        info={
          <>
            <strong>KGC 2027 is in-person only</strong>
            <p>Remote attendance and streaming are not available, so there is nothing to set here.</p>
          </>
        }
        tags={<Tag color="grey">in-person event</Tag>}
        links={[
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Sessions', value: sessions.length, sub: 'all in person' },
          { label: 'Streamed', value: 0 },
          { label: 'Remote attendees', value: 0 },
        ]}
      />

      <Panel>
        <p className="body-2" style={{ margin: 0 }}>
          This event is in-person only. Hybrid settings are not available yet.
        </p>
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Every setting Whova puts on this screen.</strong> Nothing on this page stores a
            value, because there is no field for one to control.
          </li>
          <li>
            <strong>The Audience column.</strong> Kept on the{' '}
            <Link href={ROUTES.attendees}>Attendees</Link> list and hard-coded to{' '}
            <em>In Person</em> — removing a column is a decision an organizer should make rather
            than find already made.
          </li>
          <li>
            <strong>Online Session Manager.</strong> The Virtual &amp; Hybrid tab has its own gap
            note covering the streaming side.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
