import { GapScreen } from '../../gap-screen';

export const dynamic = 'force-dynamic';

/** Engagement › 1-1 Meeting Scheduler. */
export default async function Page() {
  return (
    <GapScreen
      title="1-1 Meeting Scheduler"
      lead={<>Not built, and honestly sized rather than promised. The note below is what it would actually take.</>}
      whova={<>Attendees publish their availability and book fifteen-minute slots with each other, with the app holding both calendars and preventing double-booking.</>}
      needs={<>Availability, which nothing collects. There is no calendar model, no free/busy, and no notion of a meeting anywhere in the schema — the closest thing is <code>savedSessions</code>, which is a private bookmark list.</>}
      size="8–12 days, and it is the largest single unbuilt feature in Engagement."
      notBuilt={[
        <><strong>It needs push to be useful.</strong> A meeting request nobody is told about is a meeting nobody attends, and Expo Go cannot receive push at all.</>,
        <><strong>Matchmaking exists and is deliberately a report</strong> — see Attendee Matchmaking. Turning it into introductions would use the profiles of people who opted out of being found.</>,
      ]}
    />
  );
}
