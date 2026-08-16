import { Stack } from 'expo-router';

/** Stack inside the People tab: directory, plus speaker and profile details. */
export default function PeopleLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'People' }} />
    </Stack>
  );
}
