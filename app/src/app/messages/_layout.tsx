import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { pushedStackScreenOptions } from '@/components/pushed-header';
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
 * whole bar. These two are *pushed*, and `WhovaHeader` has no back affordance.
 * Hiding the native header would leave the inbox reachable only by a swipe.
 *
 * So the native header is kept and painted in Whova's chrome instead: the brand
 * blue, white content, and a back button (`PushedHeader`, from each screen).
 * The visible difference from `WhovaHeader` is the missing profile pill on the
 * left, which is where the back button now is anyway.
 *
 * The root stack used to draw its own header for this group on top of the one
 * below, because `app/_layout.tsx` declared options for `index`, `(tabs)` and
 * `login` only. It now declares `messages` as well, so the workaround that used
 * to live here — a bare `<Stack.Screen>` rendered outside the navigator to
 * reach into the parent — is gone.
 */
export default function MessagesLayout() {
  const colors = useTheme();

  return (
    <>
      {/* White status-bar content — the same override `WhovaHeader` makes, for
          the same reason: dark glyphs on brand blue are unreadable. */}
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          ...pushedStackScreenOptions,
          headerStyle: { backgroundColor: colors.header },
          headerTintColor: colors.onHeader,
          headerTitleStyle: { color: colors.onHeader },
          headerShadowVisible: false,
        }}>
        {/* Both screens turn the header on themselves, via `PushedHeader`: the
            inbox's title carries the unread count and the thread's is a name,
            so neither can be spelled here. */}
        <Stack.Screen name="index" />
        <Stack.Screen name="[threadId]" />
      </Stack>
    </>
  );
}
