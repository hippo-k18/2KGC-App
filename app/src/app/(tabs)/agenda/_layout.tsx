import { Stack } from 'expo-router';

import { pushedStackScreenOptions } from '@/components/pushed-header';

/** Stack inside the Agenda tab, ready for a detail screen (add [id].tsx). */
export default function AgendaLayout() {
  return (
    <Stack screenOptions={pushedStackScreenOptions}>
      <Stack.Screen name="index" options={{ title: 'Agenda' }} />
    </Stack>
  );
}
