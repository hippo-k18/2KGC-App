import { Stack } from 'expo-router';

/**
 * Messages sits outside the tab bar.
 *
 * Whova gives it a permanent tab, where it stays empty for most attendees all
 * week — five tabs is a scarce budget and a mostly-empty inbox does not earn
 * one. It is reached from a header icon with an unread badge instead.
 */
export default function MessagesLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Messages' }} />
      <Stack.Screen name="[threadId]" options={{ title: '' }} />
    </Stack>
  );
}
