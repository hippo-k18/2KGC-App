import Link from 'next/link';
import { GatheringScreen } from '../gathering-screen';

export const dynamic = 'force-dynamic';

/**
 * Engagement › 1-1 Meeting Scheduler.
 *
 * ── Whova's version is attendee-to-attendee, and ours cannot be ────────────
 *
 * In Whova an attendee finds somebody in the directory, proposes a time, and
 * the other person accepts. That needs three things this project does not have:
 * a request in the app, a notification to answer it, and a mutual availability
 * model. The first two are app work and the third is a genuine design problem —
 * availability that is a calendar is a calendar integration, and availability
 * that is a free-text note is not schedulable.
 *
 * ── What an organizer actually needs, and what this is ─────────────────────
 *
 * The half that matters most at an in-person conference is not attendee
 * matchmaking — it is **meeting-room inventory**. Sponsors and exhibitors ask
 * for a room to take a customer into, there are four of them, and they are
 * allocated by somebody with a spreadsheet. This is that, with a clash check
 * against the programme so a meeting is not booked into a room that has a
 * keynote in it.
 */
export default async function MeetingSchedulerPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  return (
    <GatheringScreen
      kind="meeting-slot"
      title="1-1 Meeting Scheduler"
      searchParams={searchParams}
      links={[
        <Link key="m" href="/engagement/community/attendee-matchmaking">
          Attendee Matchmaking
        </Link>,
        <Link key="e" href="/content/exhibitor-center/exhibitor-manager">
          Exhibitors
        </Link>,
      ]}
      lead={
        <>
          <strong>Attendees cannot request meetings, and this does not pretend they can.</strong>{' '}
          Whova&rsquo;s scheduler is attendee-to-attendee and needs a request flow, a notification
          to answer it and a mutual availability model — none of which exists here. What this{' '}
          <em>is</em> is meeting-room inventory: the rooms sponsors and exhibitors ask for, booked
          by a person, checked against the programme so nothing lands in a room with a keynote in
          it. <Link href="/engagement/community/attendee-matchmaking">Attendee Matchmaking</Link>{' '}
          is the built half of the introduction problem — it suggests who should meet, and stops
          there.
        </>
      }
      formCopy={{
        noun: 'Slots',
        titleLabel: 'Booked for',
        titlePlaceholder: 'Graphwise — customer meetings',
        hostLabel: 'Booked by',
        capacityHint:
          'How many people fit. Two is a one-to-one; a sponsor bringing a customer team needs more, which is why this is a number rather than a fixed pair.',
        defaultCapacity: 2,
      }}
      notBuilt={[
        <li key="request">
          <strong>No request-and-accept flow.</strong> The attendee-facing half. It needs a screen
          in the app, a notification to answer it, and a decision about what availability means —
          the third is the hard one, and a free-text &ldquo;afternoons are fine&rdquo; is not
          schedulable.
        </li>,
        <li key="cal">
          <strong>No calendar export.</strong> A booked slot does not become an{' '}
          <code>.ics</code> file, so it lives only on this screen and on whatever the sponsor wrote
          down.
        </li>,
        <li key="conflict">
          <strong>No check against the person&rsquo;s own schedule.</strong> Somebody booked into
          two rooms at once is not caught — only two things in one room are. That needs a placement
          to be a real attendee rather than a name.
        </li>,
      ]}
    />
  );
}
