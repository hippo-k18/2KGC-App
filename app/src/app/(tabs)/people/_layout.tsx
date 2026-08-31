import { Stack } from 'expo-router';

import { pushedStackScreenOptions } from '@/components/pushed-header';

/**
 * Stack inside the People tab: the directory, plus a detail screen for each of
 * the four things it lists — an attendee (`[uid]`), a speaker, a sponsor and an
 * exhibitor.
 */
export default function PeopleLayout() {
  return (
    <Stack screenOptions={pushedStackScreenOptions}>
      <Stack.Screen name="index" options={{ title: 'People' }} />
      <Stack.Screen name="speaker/[id]" options={{ title: 'Speaker' }} />
      <Stack.Screen name="sponsor/[id]" options={{ title: 'Sponsor' }} />
      <Stack.Screen name="exhibitor/[id]" options={{ title: 'Exhibitor' }} />
    </Stack>
  );
}
