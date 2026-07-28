import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';

/** Whova's community board: meetups, ride shares, jobs, ice breakers. */
const CATEGORIES = [
  { id: 'meetup', label: 'Meetups', hint: 'Organise a dinner or a coffee' },
  { id: 'ride-share', label: 'Ride Share', hint: 'Split a cab from the airport' },
  { id: 'jobs', label: 'Jobs', hint: 'Who is hiring, who is looking' },
  { id: 'questions', label: 'Questions', hint: 'Ask the room' },
];

export default function CommunityScreen() {
  return (
    <Screen grouped>
      {CATEGORIES.map((category) => (
        <Card key={category.id}>
          <Text variant="heading">{category.label}</Text>
          <Text variant="caption" tone="secondary">
            {category.hint}
          </Text>
        </Card>
      ))}

      <EmptyState
        icon="bubble.left.and.bubble.right"
        title="No posts yet"
        message="Posts will come from the `communityPosts` collection once it is wired up."
      />
    </Screen>
  );
}
