import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useTheme } from '@/hooks/use-theme';

/**
 * Messages sits outside the tab bar.
 *
 * Whova gives it a permanent tab, where it stays empty for most attendees all
 * week — five tabs is a scarce budget and a mostly-empty inbox does not earn
 * one. It is reached from a header icon with an unread badge instead.
 *
 * ## Why this uses the native header rather than `WhovaHeader`
 *
 * Every other screen in this app is a tab root, so `WhovaHeader` can own the
 * whole bar. These two are *pushed*, and `WhovaHeader` has no back affordance —
 * it cannot grow one either, because `icon.tsx` deliberately carries no back or
 * close glyph and that file is not this screen's to edit. Hiding the native
 * header would leave the inbox reachable only by a swipe.
 *
 * So the native header is kept and painted in Whova's chrome instead: the brand
 * blue, white content, and a real platform back button. The visible difference
 * from `WhovaHeader` is the missing profile pill on the left, which is where the
 * back button now is anyway.
 */
export default function MessagesLayout() {
  const colors = useTheme();

  return (
    <>
      {/*
        The root stack draws its own header for this group, on top of the one
        below — `app/_layout.tsx` declares options for `index`, `(tabs)` and
        `login` only, so `messages` fell through to the default and the inbox
        rendered under two stacked bars. A `Stack.Screen` rendered here, outside
        the nested navigator, targets the *parent* stack's entry for this route,
        which is the only place this can be turned off without editing a file
        this screen does not own.
      */}
      <Stack.Screen options={{ headerShown: false }} />

      {/* White status-bar content — the same override `WhovaHeader` makes, for
          the same reason: dark glyphs on brand blue are unreadable. */}
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.header },
          headerTintColor: colors.onHeader,
          headerTitleStyle: { color: colors.onHeader },
          headerShadowVisible: false,
        }}>
        {/* The title carries the unread count, so it is set from the screen. */}
        <Stack.Screen name="index" />
        <Stack.Screen name="[threadId]" options={{ title: '' }} />
      </Stack>
    </>
  );
}
