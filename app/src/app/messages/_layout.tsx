import { Redirect, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { pushedStackScreenOptions } from '@/components/pushed-header';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';

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
  const { user, loading } = useAuth();

  /*
   * The same gate `(tabs)/_layout.tsx` carries, which this group needed just as
   * much and did not have. Messages is outside the tab group, so the tab guard
   * never covered it — and these are the two most linkable routes in the app.
   *
   * Signed out, `/messages` rendered an inbox whose list never resolved: not the
   * empty state, a permanent blank, because `loading` stays true with no user to
   * query for. `/messages/<id>` was worse — "Say hello to" with a dangling empty
   * name, above a composer that looked live and whose Send did nothing.
   */
  if (loading) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    <>
      {/* White status-bar content — the same override `WhovaHeader` makes, for
          the same reason: dark glyphs on brand blue are unreadable. */}
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          ...pushedStackScreenOptions,
          /*
           * `headerShown: true` here, overriding the `false` that
           * `pushedStackScreenOptions` carries for every other stack in the app.
           *
           * Both of these screens want a header unconditionally — the inbox
           * and a thread are pushed, and neither draws a `WhovaHeader` — and
           * relying on each screen to switch it back on left the inbox with no
           * header and therefore no back button at all on device. The only ways
           * out were the swipe gesture and force-quitting.
           *
           * The screens still set their own `title` and `headerLeft` through
           * `PushedHeader`; what they no longer have to do is turn the header on
           * before those options mean anything.
           */
          headerShown: true,
          headerStyle: { backgroundColor: colors.header },
          headerTintColor: colors.onHeader,
          headerTitleStyle: { color: colors.onHeader },
          headerShadowVisible: false,
        }}
      />
    </>
  );
}
