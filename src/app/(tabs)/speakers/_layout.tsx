import { Stack } from 'expo-router';

export default function SpeakersLayout() {
  return (
    <Stack screenOptions={{ headerLargeTitle: true }}>
      <Stack.Screen name="index" options={{ title: 'Speakers' }} />
      <Stack.Screen
        name="[id]"
        options={{ title: 'Speaker', headerLargeTitle: false }}
      />
    </Stack>
  );
}
