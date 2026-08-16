/**
 * Palette and layout scale. Every screen pulls colours from `useTheme()` rather
 * than hard-coding hex values, so dark mode needs no per-screen work.
 *
 * The blues are KGC's own, lifted from knowledgegraph.tech: #2B6CB0 primary and
 * #3182CE lighter. The greys are the iOS system scale rather than a bespoke one,
 * because the target is a native-feeling Apple interface — matching the platform
 * reads as considered, and inventing a grey ramp reads as a website in a phone.
 *
 * Deliberately flat. The only gradient anywhere in this app is inside the KGC
 * logo itself, which is the brand's own artwork; the chrome around it is solid
 * fills and hairline rules.
 */

import { Platform } from 'react-native';

/** KGC brand, from the conference site. */
export const Brand = {
  /** Primary. Buttons, active state, links. */
  blue: '#2B6CB0',
  /** Lighter blue, for dark mode and secondary emphasis. */
  blueLight: '#3182CE',
  /** The teal end of the logo's gradient. Accents only, never large fills. */
  teal: '#3AAFA9',
  /** The navy end of the logo's gradient. */
  navy: '#2A4B8D',
} as const;

export const Colors = {
  light: {
    /** Behind grouped content — iOS convention is grey behind white cards. */
    background: '#F2F2F7',
    /** Cards, list rows, anything raised off the background. */
    surface: '#FFFFFF',
    /** Pressed state for a surface row. */
    surfacePressed: '#E5E5EA',
    groupedBackground: '#F2F2F7',
    text: '#000000',
    textSecondary: '#6B7280',
    /** Third-level text: timestamps, metadata. */
    textTertiary: '#9CA3AF',
    /** Hairline separators. Rendered at 0.5pt, not 1. */
    border: '#D1D1D6',
    /** Even lighter rule, for separators inside a card. */
    separator: '#E5E5EA',
    tint: Brand.blue,
    accent: Brand.blue,
    /** Text/icons drawn on top of `tint` or `accent`. */
    onAccent: '#FFFFFF',
    /** Subtle tinted fill — selected chips, badges. */
    tintSoft: '#E8F0F9',
    danger: '#FF3B30',
    success: '#34C759',
    warning: '#FF9500',
  },
  dark: {
    background: '#000000',
    surface: '#1C1C1E',
    surfacePressed: '#2C2C2E',
    groupedBackground: '#000000',
    text: '#FFFFFF',
    textSecondary: '#98989F',
    textTertiary: '#6B6B70',
    border: '#38383A',
    separator: '#2C2C2E',
    /** Lifted for contrast on black — #2B6CB0 fails AA against a dark surface. */
    tint: '#4A9EE8',
    accent: '#4A9EE8',
    onAccent: '#FFFFFF',
    tintSoft: '#1B2B3D',
    danger: '#FF453A',
    success: '#30D158',
    warning: '#FF9F0A',
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

/** iOS uses larger corner radii than the web. 10 is a list row, 14 a card. */
export const Radius = {
  sm: 8,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

/** A true hairline, not a 1px web border. */
export const HAIRLINE = Platform.OS === 'web' ? 1 : 0.5;

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
