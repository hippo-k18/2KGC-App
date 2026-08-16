import { Stack } from 'expo-router';

/** Stack inside the Community tab: the board and a post thread. */
export default function CommunityLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Community' }} />
    </Stack>
  );
}
