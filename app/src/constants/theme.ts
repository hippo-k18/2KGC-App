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
 *
 * ## Contrast policy
 *
 * Every foreground token clears **WCAG 2.1 AA (4.5:1)** against every resting
 * background it can land on — `surface`, `background`/`groupedBackground` and
 * `tintSoft` — because the type it carries is 13–17pt and none of it qualifies
 * as "large text". `textSecondary` and `textTertiary` additionally clear 4.5:1
 * against `surfacePressed`, since a ListRow held under a thumb is still being
 * read. Measured ratios are recorded per token below; they were computed with
 * the WCAG relative-luminance formula, not eyeballed.
 *
 * `surfacePressed` is a transient state, so the semantic colours (`danger`,
 * `success`, `warning`) are allowed to sit at ~4.1–4.3:1 there; their resting
 * ratios are all ≥ 4.5:1 and they are the Apple HIG "accessible" variants.
 *
 * Fills carry a separate token from foregrounds. `tint` is the brand colour for
 * *text, icons and the tab bar*; `accent` is the brand colour for a *solid fill
 * behind `onAccent` text*. In light mode they are the same value. In dark they
 * cannot be: a blue readable as text on #1C1C1E has too high a luminance for
 * white to sit on it (#4A9EE8 vs white is 2.86:1), and a blue dark enough for
 * white is unreadable as text. Same reason `dangerFill` exists apart from
 * `danger`.
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
    /** 21.00:1 on surface · 18.82 on background · 16.73 on pressed. */
    text: '#000000',
    /**
     * 9.12:1 on surface · 8.18 on background · 7.27 on pressed · 7.94 on tintSoft.
     * Was #6B7280 (4.83 / 4.33 / 3.85 / 4.20) — passed only against white, and
     * it was a Tailwind blue-grey rather than an iOS one.
     */
    textSecondary: '#48484A',
    /**
     * Third-level text: timestamps, metadata, session end times, unread counts.
     * 5.99:1 on surface · 5.37 on background · 4.77 on pressed · 5.21 on tintSoft.
     * Was #9CA3AF — **2.54:1 on white**, less than a third of what 13pt needs.
     * iOS's own tertiaryLabel is lighter still; it is legible on device only
     * because Apple pairs it with Increase Contrast. This is systemGray2's
     * dark-side value, which is the closest real Apple grey that clears AA.
     */
    textTertiary: '#636366',
    /** Hairline separators. Rendered at 0.5pt, not 1. Non-text, 1.52:1. */
    border: '#D1D1D6',
    /** Even lighter rule, for separators inside a card. Non-text, 1.26:1. */
    separator: '#E5E5EA',
    /** Brand as *foreground*: links, tinted text, tab bar. 5.42:1 on surface. */
    tint: Brand.blue,
    /** Brand as a *solid fill* under `onAccent`. white-on-fill 5.42:1. */
    accent: Brand.blue,
    /** Text/icons drawn on top of `accent`, `dangerFill` or an avatar swatch. */
    onAccent: '#FFFFFF',
    /** Subtle tinted fill — selected chips, badges. */
    tintSoft: '#E8F0F9',
    /**
     * Destructive *text* (a "Sign out" row). Apple's accessible red.
     * 5.38:1 on surface · 4.83 on background · 4.29 on pressed · 4.68 on tintSoft.
     * Was #FF3B30 — 3.55:1 on white.
     */
    danger: '#D70015',
    /** Destructive *fill* (the unread badge). white-on-fill 6.12:1. */
    dangerFill: '#C7000B',
    /** 5.40:1 on surface · 4.84 on background · 4.30 on pressed. Was #34C759, 2.22:1. */
    success: '#1E7A34',
    /** 5.20:1 on surface · 4.66 on background · 4.14 on pressed. Was #FF9500, 2.20:1. */
    warning: '#B25000',
  },
  dark: {
    background: '#000000',
    surface: '#1C1C1E',
    surfacePressed: '#2C2C2E',
    groupedBackground: '#000000',
    /** 17.01:1 on surface · 21.00 on background · 13.94 on pressed. */
    text: '#FFFFFF',
    /** 7.69:1 on surface · 9.50 on background · 6.30 on pressed · 6.51 on tintSoft. */
    textSecondary: '#AEAEB2',
    /**
     * 5.94:1 on surface · 7.33 on background · 4.86 on pressed · 5.02 on tintSoft.
     * Was #6B6B70 — 3.21:1 on surface, 2.63 on a pressed row.
     */
    textTertiary: '#98989F',
    border: '#38383A',
    separator: '#2C2C2E',
    /**
     * Brand as *foreground*. Lifted for contrast on black — #2B6CB0 fails AA
     * against a dark surface. 5.95:1 on surface · 7.35 on background.
     */
    tint: '#4A9EE8',
    /**
     * Brand as a *solid fill*. Deliberately NOT `tint`: white on #4A9EE8 is
     * 2.86:1. white-on-fill 5.14:1, and the fill itself clears 3:1 against
     * surface (3.31) and background (4.08) so its edge is visible.
     */
    accent: '#1F6FBF',
    onAccent: '#FFFFFF',
    tintSoft: '#1B2B3D',
    /** 6.03:1 on surface · 7.45 on background · 4.94 on pressed. Was #FF453A, 4.99/4.09. */
    danger: '#FF6961',
    /** white-on-fill 5.01:1, fill vs surface 3.40:1. */
    dangerFill: '#D9202B',
    /** 8.42:1 on surface · 10.39 on background · 6.89 on pressed. */
    success: '#30D158',
    /** 8.28:1 on surface · 10.22 on background · 6.78 on pressed. */
    warning: '#FF9F0A',
  },
} as const;

/**
 * Avatar initial swatches. Lives here rather than in `avatar.tsx` because it is
 * palette, and nothing outside this file may spell a hex value.
 *
 * Every swatch carries white initials, so every one clears AA against #FFFFFF:
 * blue 5.42 · teal 6.08 · violet 5.70 · amber 5.77 · red 5.91 · green 5.88 ·
 * cyan 6.47. The previous set was four failures out of seven (teal #3AAFA9 at
 * 2.66:1, amber #D97706 at 3.19, green #059669 at 3.77, cyan #0891B2 at 3.68).
 *
 * Scheme-independent: the swatch *is* the background, so only the white-on-swatch
 * pair matters. Against a dark surface the circles sit at 2.6–3.5:1, which is a
 * decorative shape boundary rather than an information-bearing one — the initials
 * inside it are what must be legible, and they are.
 */
export const AvatarPalette = [
  '#2B6CB0',
  '#0E6E69',
  '#7C3AED',
  '#9A5400',
  '#C0271F',
  '#03734F',
  '#116682',
] as const;

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

/**
 * Minimum tappable edge. Apple's HIG and Android's Material both land on 44pt
 * (Material says 48dp; 44 is the stricter shared floor for iOS). Controls that
 * are visually smaller than this must make up the difference with `hitSlop`
 * rather than by growing — see `FilterChip`.
 */
export const HIT_TARGET = 44;

/** The size an `Avatar` renders at in a list row, and the separator inset it implies. */
export const AVATAR_SIZE = 44;

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
