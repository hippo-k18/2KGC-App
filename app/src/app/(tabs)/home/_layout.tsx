import { Stack } from 'expo-router';

/**
 * Stack inside the Home tab.
 *
 * `index` draws its own `WhovaHeader`, so the native header stays off by
 * default. The two pushed screens turn it back on from inside themselves — the
 * pattern `agenda/[id].tsx` already uses — because their titles depend on the
 * params they were opened with.
 */
export default function HomeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Home' }} />
      <Stack.Screen name="session-feature" options={{ title: 'Session Q&A' }} />
      <Stack.Screen name="coming-soon" options={{ title: 'Not built yet' }} />
    </Stack>
  );
}
