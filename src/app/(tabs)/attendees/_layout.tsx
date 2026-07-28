import { Stack } from 'expo-router';

/** Stack inside the Attendees tab, ready for a detail screen (add [id].tsx). */
export default function AttendeesLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Attendees' }} />
    </Stack>
  );
}
