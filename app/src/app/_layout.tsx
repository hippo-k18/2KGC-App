// expo-router 6 does not re-export the navigation theme helpers; they come
// straight from React Navigation. (expo-router 7 re-exports them again.)
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Redirect, Stack, usePathname } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { joinCodeNeeded } from '@kgc/shared';

import { EventClosedScreen, JoinCodeScreen } from '@/components/access-gate';
import { Colors } from '@/constants/theme';
import { useScheme, useTheme } from '@/hooks/use-theme';
import { AuthProvider, useAuth } from '@/lib/auth/auth-provider';
import { AppAccessProvider, useAppAccess } from '@/lib/data/app-access';
import { EventSettingsProvider, useEventSettings } from '@/lib/data/event-settings';

SplashScreen.preventAutoHideAsync();

/** Navigation themes, so native headers and tab bars use the brand palette. */
const navThemes = {
  light: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: Colors.light.tint,
      background: Colors.light.groupedBackground,
      card: Colors.light.surface,
      text: Colors.light.text,
      border: Colors.light.border,
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      primary: Colors.dark.tint,
      background: Colors.dark.background,
      card: Colors.dark.surface,
      text: Colors.dark.text,
      border: Colors.dark.border,
    },
  },
};

/**
 * How long to wait for Firebase Auth before showing the app anyway.
 *
 * `onAuthStateChanged` normally settles in well under a second. If it never
 * fires — a wedged emulator connection, no network on a venue guest wifi — the
 * old `if (loading) return null` rendered *nothing at all*, permanently, with
 * no error and no way out. A blank screen is the one failure an attendee cannot
 * report usefully.
 */
const AUTH_TIMEOUT_MS = 8000;

function RootNavigator() {
  const { loading, user, profile } = useAuth();
  const { state: accessState, access } = useAppAccess();
  const pathname = usePathname();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setTimedOut(true), AUTH_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [loading]);

  useEffect(() => {
    if (!loading || timedOut) SplashScreen.hideAsync();
  }, [loading, timedOut]);

  // Fall through to the router once we give up waiting: the tab guard will send
  // an unauthenticated user to /login, which is a screen they can act on.
  if (loading && !timedOut) return null;

  /**
   * The gate in front of the temporary password.
   *
   * An account provisioned by a ticket purchase holds six random digits shown
   * on a web page and mailed in a receipt, and
   * `mustChangePassword` is true until the attendee has replaced it. Redirecting
   * here rather than inside each screen is the point: a per-screen check is one
   * a new route forgets to add, and `/messages` — the route where the shared
   * password does the most damage — is exactly the kind of thing reached by a
   * notification deep link rather than by tapping through the tabs.
   *
   * ⚠️ Only on an explicit `true`. `profile` is null while it loads and the
   * field is absent on every account created before 2026-09-02 and on every
   * account that never had a password; both must fall through. Treating
   * "unknown" as "must change" would strand the entire existing attendee list
   * behind a prompt asking for a temporary password they were never given.
   */
  if (user && profile?.mustChangePassword === true && pathname !== '/change-password') {
    return <Redirect href="/change-password" />;
  }

  /**
   * The access window, and the event code.
   *
   * Both replace the stack rather than redirecting into it. A redirect needs a
   * route, a route can be reached by a deep link, and a gate with a route is a
   * gate with a way round it — which is why the temporary-password screen above
   * also refuses to render anything else while its flag is up. Neither of these
   * has a route at all.
   *
   * ⚠️ Only for a signed-in attendee. Signed out, the login screen is the right
   * screen whatever the window says: somebody has to be able to sign in and
   * read the sentence with their own name on it, and `firestore.rules` is what
   * actually refuses the data either way. The closed screen carries a sign-out
   * control for the same reason — it is the only way off it.
   */
  if (user && accessState === 'closed') return <EventClosedScreen />;
  if (user && joinCodeNeeded(access, profile)) return <JoinCodeScreen uid={user.uid} />;

  return (
    <Stack>
      {/* Decides between /login and /home; no header, so it never flashes. */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/*
        Messages sits outside the tab bar and draws its own header. Declaring
        it here does more than remove the duplicate bar the group used to render
        under: an undeclared route falls through to this stack's defaults, and
        the default header's back button names itself after the *previous
        route*, which is the group `(tabs)`. That is where the inbox's
        "(tabs), back" came from — a group name is not a place.
      */}
      <Stack.Screen name="messages" options={{ headerShown: false }} />
      {/* Full screen rather than a modal — it gates the app. */}
      <Stack.Screen name="login" options={{ headerShown: false }} />
      {/*
        No header, and therefore no back button, on purpose. This screen is
        reached by a redirect that fires again the moment anything navigates
        away from it, so a back affordance would be a control that visibly does
        nothing. Signing out is the only other way off it.
      */}
      <Stack.Screen name="change-password" options={{ headerShown: false }} />
    </Stack>
  );
}

/**
 * The provider sits outside everything, the sign-in screen included, so the
 * brand colour and event name saved on the dashboard reach the first screen a
 * person sees. `Themed` is a separate component because it reads that context.
 */
export default function RootLayout() {
  return (
    <EventSettingsProvider>
      <Themed />
    </EventSettingsProvider>
  );
}

function Themed() {
  const scheme = useScheme();
  const { event } = useEventSettings();
  const tint = useTheme().tint;
  const navTheme = useMemo(
    () => ({ ...navThemes[scheme], colors: { ...navThemes[scheme].colors, primary: tint } }),
    [scheme, tint],
  );

  return (
    <AuthProvider>
      {/*
        Inside `AuthProvider`, because the rule on `settings/appAccess` asks for
        a signed-in reader — it deliberately does not ask for a ticket, so that
        a closed app can still read the document that says it is closed.
      */}
      <AppAccessProvider>
        <ThemeProvider value={navTheme}>
          {/*
            expo-router turns React Navigation's document title off, so without
            this the browser tab, history and share sheet show the bare URL. Web
            only: on iOS `Head` is the Handoff integration, which is not wanted.
          */}
          {Platform.OS === 'web' ? (
            <Head>
              <title>{`${event.shortName} ${event.year}`}</title>
            </Head>
          ) : null}
          <StatusBar style="auto" />
          <RootNavigator />
        </ThemeProvider>
      </AppAccessProvider>
    </AuthProvider>
  );
}
