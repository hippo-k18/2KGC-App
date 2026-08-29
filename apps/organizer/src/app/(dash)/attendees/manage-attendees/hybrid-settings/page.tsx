import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSessions } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Tag } from '../../../ui';

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

      <Banner kind="info">
        <strong>KGC 2027 is in-person only, and the data model has no remote half.</strong> There is
        no virtual flag on a session, no stream URL, no audience on a registration and no player in
        the app. Nothing here is switched off — it is absent, which is why there is no switch.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Sessions', value: sessions.length, sub: 'all in a room' },
          { label: 'Streamed', value: 0, sub: 'no stream field exists' },
          { label: 'Remote attendees', value: 0, sub: 'no audience field exists' },
        ]}
      />

      <Panel>
        <h2 className="section-header">What hybrid would actually require</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>An audience on the registration, decided at purchase.</strong> Remote tickets
            are a ticket type, so the money path is where this starts — and a remote ticket that
            still mints a <code>qrSecret</code> is a badge for a door somebody will never walk
            through. The check-in denominator on the desk screen would need to exclude them, or the
            progress bar reads permanently stalled.
          </li>
          <li>
            <strong>A stream per session, and a decision about who may watch.</strong> A URL on{' '}
            <code>SessionDoc</code> is the easy half. Gating it is the real one: a link readable by
            every signed-in attendee is a link that leaves the building, and{' '}
            <code>firestore.rules</code> filters documents rather than fields, so a gated stream
            URL means a separate projection in the way the attendee directory already is.
          </li>
          <li>
            <strong>A player in Expo Go.</strong> Video is a native module and Expo Go ships a fixed
            set. This is the same constraint that made the QR encoder hand-rolled, and video has no
            equivalent pure-JS escape hatch — hybrid would need the development build that WP-06
            already wants for other reasons.
          </li>
          <li>
            <strong>Two rooms, socially.</strong> The hard part of hybrid is not the stream; it is
            Q&amp;A, polls and the community board being shared between people who are in the room
            and people who are not. Every one of those exists here in a form that assumes one
            audience.
          </li>
        </ul>
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
