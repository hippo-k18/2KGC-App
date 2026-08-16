import { Link, Stack } from 'expo-router';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Screen grouped>
        <EmptyState
          icon="exclamationmark.triangle"
          title="This screen doesn't exist"
          message="The route you followed isn't part of the app."
        />
        <Link href="/agenda" style={{ textAlign: 'center' }}>
          <Text tone="tint" variant="heading">
            Go to the agenda
          </Text>
        </Link>
      </Screen>
    </>
  );
}
