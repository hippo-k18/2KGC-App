import { MEET_UP_CATEGORIES } from '@/lib/engagement';
import { CategoryScreen } from '../category-screen';

export const dynamic = 'force-dynamic';

/** Engagement › Community › Meet-ups. */
export default async function MeetUpsPage() {
  return (
    <CategoryScreen
      title="Meet-ups"
      categories={MEET_UP_CATEGORIES}
      info={
        <>
          <strong>Board posts, not RSVPs</strong>
          <p>
            Meet-ups attendees proposed on the community board. There is no RSVP or capacity yet,
            so replies are the nearest thing to a headcount. A reply may be somebody saying they
            cannot come.
          </p>
        </>
      }
      notBuilt={[
        'RSVPs and capacity. Whova lets an attendee join a meet-up and caps the list; ours are replies on a post, which is a different thing and is labelled as one.',
        'A time and place field. A meet-up here says when and where in its body text, so nothing can put it on the agenda or a map.',
        'Organizer-created meet-ups with assigned hosts.',
      ]}
    />
  );
}
