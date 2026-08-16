import { Stack } from 'expo-router';

/**
 * No header — the screen is intentionally bare. `title` is still set because
 * it names the route for accessibility and for any screen pushed on top later;
 * add `headerShown: true` to a child screen when it needs a nav bar.
 */
export default function HomeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Home' }} />
    </Stack>
  );
}
