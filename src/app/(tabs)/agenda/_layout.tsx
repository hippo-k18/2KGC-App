import { Stack } from 'expo-router';

/** Stack inside the Agenda tab, so detail screens keep the tab bar visible. */
export default function AgendaLayout() {
  return (
    <Stack screenOptions={{ headerLargeTitle: true }}>
      <Stack.Screen name="index" options={{ title: 'Agenda' }} />
      <Stack.Screen
        name="[id]"
        options={{ title: 'Session', headerLargeTitle: false }}
      />
    </Stack>
  );
}
