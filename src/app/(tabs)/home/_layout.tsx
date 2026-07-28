import { Stack } from 'expo-router';

/**
 * Titles render inline in the nav bar rather than as iOS large titles, so the
 * header sits on one line and reads the same on every tab.
 */
export default function HomeLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Home' }} />
    </Stack>
  );
}
