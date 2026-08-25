import { MEET_UP_CATEGORIES } from '@/lib/engagement';
import { CategoryScreen } from '../category-screen';

export const dynamic = 'force-dynamic';

/** Engagement › Community › Meet-ups. */
export default async function MeetUpsPage() {
  return (
    <CategoryScreen
      title="Meet-ups"
      categories={MEET_UP_CATEGORIES}
      intro="Attendee-proposed meet-ups from the Community tab. These are board posts with the meetup category — there is no separate meet-up object, no RSVP and no capacity, so the reply list below is the closest thing to a headcount and is not the same as one."
      notBuilt={[
        'RSVPs and capacity. Whova lets an attendee join a meet-up and caps the list; ours are replies on a post, which is a different thing and is labelled as one.',
        'A time and place field. A meet-up here says when and where in its body text, so nothing can put it on the agenda or a map.',
        'Organizer-created meet-ups with assigned hosts.',
      ]}
    />
  );
}
