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
            Attendee-proposed meet-ups from the Community tab. There is no meet-up object, no
            capacity and nothing to join, so the reply list is the nearest thing to a headcount and
            is not the same as one. Somebody may have replied to say they cannot come.
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
