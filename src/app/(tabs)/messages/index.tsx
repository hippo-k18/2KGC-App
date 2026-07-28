import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';

export default function MessagesScreen() {
  return (
    <Screen grouped>
      <EmptyState
        icon="message"
        title="No conversations yet"
        message="One-to-one threads live in the `threads` collection, keyed by both attendee ids so a pair always maps to a single conversation."
      />
    </Screen>
  );
}
