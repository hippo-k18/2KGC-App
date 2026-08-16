import { Stack } from 'expo-router';

/** Stack inside the Me tab: profile, my schedule, settings. */
export default function MeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Me' }} />
      <Stack.Screen name="schedule" options={{ title: 'My schedule' }} />
      <Stack.Screen name="profile" options={{ title: 'Edit profile' }} />
    </Stack>
  );
}
