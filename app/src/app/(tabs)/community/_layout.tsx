import { Stack } from 'expo-router';

/**
 * Stack inside the Community tab: the board, the pinned organizer announcements
 * board, and a topic thread.
 */
export default function CommunityLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Community' }} />
      <Stack.Screen name="announcements" options={{ title: 'Announcements' }} />
    </Stack>
  );
}
