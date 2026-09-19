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
          title="Page not found"
        />
        <Link href="/home" style={{ textAlign: 'center' }}>
          <Text tone="tint" variant="heading">
            Go to Home
          </Text>
        </Link>
      </Screen>
    </>
  );
}
