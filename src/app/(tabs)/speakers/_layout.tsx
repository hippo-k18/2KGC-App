import { Stack } from 'expo-router';

/** Stack inside the Speakers tab, ready for a detail screen (add [id].tsx). */
export default function SpeakersLayout() {
  return (
    <Stack screenOptions={{ headerLargeTitle: true }}>
      <Stack.Screen name="index" options={{ title: 'Speakers' }} />
    </Stack>
  );
}
