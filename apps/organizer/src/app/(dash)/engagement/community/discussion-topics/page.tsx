import { DISCUSSION_CATEGORIES } from '@/lib/engagement';
import { CategoryScreen } from '../category-screen';

export const dynamic = 'force-dynamic';

/** Engagement › Community › Discussion Topics. */
export default async function DiscussionTopicsPage() {
  return (
    <CategoryScreen
      title="Discussion Topics"
      categories={DISCUSSION_CATEGORIES}
      intro="Questions and ice-breakers from the community board. Whova seeds discussion topics before an event to get the board moving; ours are whatever attendees have asked, because nothing lets an organizer post."
      notBuilt={[
        'Seeded topics. Whova ships prompts an organizer can publish before doors open, which is what stops a board being empty on day one. That needs organizer posting, which does not exist.',
        'Pinning a topic to the top of the board.',
        'Per-topic notifications when somebody replies.',
      ]}
    />
  );
}
