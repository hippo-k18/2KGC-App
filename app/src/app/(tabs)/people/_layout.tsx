import { Stack } from 'expo-router';

import { pushedStackScreenOptions } from '@/components/pushed-header';

/** Stack inside the People tab: directory, plus speaker and profile details. */
export default function PeopleLayout() {
  return (
    <Stack screenOptions={pushedStackScreenOptions}>
      <Stack.Screen name="index" options={{ title: 'People' }} />
    </Stack>
  );
}
