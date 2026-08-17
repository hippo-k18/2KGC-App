import { Stack } from 'expo-router';

import { pushedStackScreenOptions } from '@/components/pushed-header';

/** Stack inside the Me tab: profile, my schedule, settings. */
export default function MeLayout() {
  return (
    <Stack screenOptions={pushedStackScreenOptions}>
      <Stack.Screen name="index" options={{ title: 'Me' }} />
      <Stack.Screen name="schedule" options={{ title: 'My schedule' }} />
      <Stack.Screen name="profile" options={{ title: 'Edit profile' }} />
    </Stack>
  );
}
