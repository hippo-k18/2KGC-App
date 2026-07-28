/**
 * Brand palette and layout scale. Every screen pulls colours from `useTheme()`
 * rather than hard-coding hex values, so dark mode needs no per-screen work.
 *
 * Brand colours come from the KGC rebuild plan: navy #222c4f, teal #1f959f.
 */

import { Platform } from 'react-native';

const navy = '#222c4f';
const teal = '#1f959f';

export const Brand = {
  navy,
  teal,
  /** Lightened navy, for pressed states and subtle fills on white. */
  navySoft: '#e8eaf0',
  tealSoft: '#e4f3f4',
} as const;

export const Colors = {
  light: {
    /** Screen background. */
    background: '#ffffff',
    /** Cards, list rows, anything raised off the background. */
    surface: '#ffffff',
    /** Grouped-list background — iOS convention is grey behind white cards. */
    groupedBackground: '#f2f2f7',
    text: navy,
    textSecondary: '#6b7280',
    /** Hairline separators. */
    border: '#e5e7eb',
    tint: teal,
    accent: navy,
    /** Text/icons drawn on top of `tint` or `accent`. */
    onAccent: '#ffffff',
    danger: '#dc2626',
  },
  dark: {
    background: '#0f1220',
    surface: '#1a1f33',
    groupedBackground: '#0f1220',
    text: '#f5f6fa',
    textSecondary: '#9aa1b4',
    border: '#2b3149',
    tint: '#3fb6c0',
    accent: '#3fb6c0',
    onAccent: '#0f1220',
    danger: '#f87171',
  },
} as const;

/**
 * Widened to `string` so the light and dark palettes stay mutually assignable —
 * `as const` would otherwise make each hex value its own literal type.
 */
export type ThemeColors = Record<keyof (typeof Colors)['light'], string>;

/** 4pt scale. `Spacing.md` is the default gutter. */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    rounded: 'normal',
    mono: 'monospace',
  },
});
