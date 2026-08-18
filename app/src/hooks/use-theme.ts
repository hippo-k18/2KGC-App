import { useColorScheme } from 'react-native';

import { Colors, type ThemeColors } from '@/constants/theme';

/**
 * Whova has no dark mode. Neither do we.
 *
 * Every screen of Whova is light on every phone, and this app is a replacement
 * for it — so a side-by-side on a phone set to dark was never going to look
 * alike, and the owner's own demo phone is set to dark. Most of what read as
 * "everything looks too blocky and takes up too much of the page" in that
 * comparison was large dark panels meeting each other with no hairline between
 * them, which is a thing a light palette does not do.
 *
 * Set this to `false` to hand the app back to the system setting. The dark
 * palette in `constants/theme.ts` is deliberately left intact and complete
 * rather than deleted: nothing else has to change to bring it back, and it is
 * worth having the day this app is not being measured against Whova.
 *
 * `app.json` sets `userInterfaceStyle: "light"` alongside this. That covers the
 * chrome this hook cannot reach — the status bar, the keyboard, the native tab
 * bar and every system alert — which would otherwise stay dark around a light
 * app and look worse than either choice on its own.
 */
export const FORCE_LIGHT = true;

/** Resolved palette for the active colour scheme. */
export function useTheme(): ThemeColors {
  const scheme = useColorScheme();
  if (FORCE_LIGHT) return Colors.light;
  return scheme === 'dark' ? Colors.dark : Colors.light;
}

/** `'light' | 'dark'`, with the platform's `null`/unspecified treated as light. */
export function useScheme(): 'light' | 'dark' {
  const scheme = useColorScheme();
  if (FORCE_LIGHT) return 'light';
  return scheme === 'dark' ? 'dark' : 'light';
}
