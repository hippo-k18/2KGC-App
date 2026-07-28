import { Stack } from 'expo-router';

/** Stack inside the Agenda tab, ready for a detail screen (add [id].tsx). */
export default function AgendaLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Agenda' }} />
    </Stack>
  );
}
