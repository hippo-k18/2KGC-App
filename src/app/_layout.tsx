import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { Colors } from '@/constants/theme';
import { useScheme } from '@/hooks/use-theme';
import { AuthProvider, useAuth } from '@/lib/auth/auth-provider';

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

function RootNavigator() {
  const { loading } = useAuth();

  useEffect(() => {
    // Hold the splash screen until the first auth state resolves, so the app
    // never flashes a signed-out screen before restoring the session.
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;

  return (
    <Stack>
      {/* Redirects straight to /agenda; no header, so it never flashes. */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="login"
        options={{ title: 'Sign in', presentation: 'modal' }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const scheme = useScheme();

  return (
    <AuthProvider>
      <ThemeProvider value={navThemes[scheme]}>
        <StatusBar style="auto" />
        <RootNavigator />
      </ThemeProvider>
    </AuthProvider>
  );
}
