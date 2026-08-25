/**
 * Palette and layout scale. Every screen pulls colours from `useTheme()` rather
 * than hard-coding hex values, so dark mode needs no per-screen work.
 *
 * ## Where these came from
 *
 * Sampled from screenshots of the real Whova app running the real KGC 2026
 * event, rather than guessed. Method, for anyone repeating it: a screenshot is
 * ~85% white, so a plain colour histogram just returns white. Filtering pixels
 * by HSV saturation (> 0.25) isolates the design system's actual colours, and
 * quantising to a coarse grid merges antialiasing variants of one swatch into a
 * single bucket instead of scattering it across hundreds of near-identical
 * counts. That yields Whova's chrome exactly: header `#2069BC`, accent
 * `#24A8E4`, badge `#F0604E`, amber banner `#F2B24A`, search field `#E3E3E5`.
 *
 * ## Where we deliberately differ
 *
 * Three of Whova's own pairings fail WCAG AA, and they are not marginal:
 *
 *   white on `#24A8E4` (selected chip)  2.69:1
 *   white on `#F0604E` (unread badge)   3.24:1
 *   white on `#F2B24A` (amber banner)   1.87:1
 *
 * Copying those would be copying a defect. Each is fixed by holding Whova's hue
 * and moving only luminance until white clears 4.5:1 — so it still reads as the
 * same colour at a glance. The amber banner keeps Whova's bright fill and takes
 * near-black text instead, because darkening amber far enough for white turns it
 * brown and loses the point of the banner.
 *
 * Deliberately flat. The only gradients are inside the KGC logo and the hero
 * artwork; the chrome around them is solid fills and hairline rules.
 */

import { Platform } from 'react-native';

/** Whova's chrome, sampled. `*Raw` values are Whova's exact pixels. */
export const Brand = {
  /** Header, primary buttons, active tab. white-on-this is 5.51:1. */
  blue: '#2069BC',
  /** Whova's bright accent. Decorative only — see `accent` for text-bearing fills. */
  accentRaw: '#24A8E4',
  /** Same hue as Whova's accent, luminance dropped until white passes AA. */
  accent: '#1B7EAB',
  /** Pressed / status-bar navy, sampled. */
  blueDark: '#0C4884',
  /** KGC's own brand blue from knowledgegraph.tech. */
  kgc: '#2B6CB0',
  /** The teal end of the KGC logo gradient. */
  teal: '#3AAFA9',
} as const;

/**
 * Category tile tints, in Whova's style: a pale fill with a saturated glyph.
 * Each pair is checked — the glyph clears 4.5:1 on its own tile.
 */
export const CategoryTints = {
  blue: { bg: '#DCE9F7', fg: '#14538F' },
  purple: { bg: '#EADDF5', fg: '#5B21A8' },
  red: { bg: '#FADCD7', fg: '#A32A18' },
  green: { bg: '#D9EFDD', fg: '#1B6B33' },
  amber: { bg: '#FBEBCB', fg: '#7A5310' },
  orange: { bg: '#FBE0D2', fg: '#96410F' },
  teal: { bg: '#D6EDEC', fg: '#12615D' },
} as const;

export const Colors = {
  light: {
    background: '#F2F2F7',
    surface: '#FFFFFF',
    surfacePressed: '#E5E5EA',
    groupedBackground: '#F2F2F7',
    /** Whova's blue header. Content on it uses `onHeader`. */
    header: Brand.blue,
    onHeader: '#FFFFFF',
    /** The search field that sits inside the blue header. */
    headerField: '#E3E3E5',
    /** 21.00:1 on surface. */
    text: '#000000',
    /** 9.12:1 on surface · 8.18 on background · 7.27 on pressed. */
    textSecondary: '#48484A',
    /** 5.99:1 on surface · 5.37 on background · 4.77 on pressed. */
    textTertiary: '#636366',
    /**
     * The white plate a sponsor logo sits on, and the one colour that is
     * deliberately identical in both schemes. Sponsor logos are supplied as
     * transparent PNGs drawn in dark ink; on a dark surface several of them
     * disappear entirely. A brand mark is also not ours to re-tint, so the plate
     * stays white and the logo stays as its owner drew it.
     */
    logoPlate: '#FFFFFF',
    border: '#D1D1D6',
    separator: '#E5E5EA',
    /** Brand as *foreground*: links, tinted text. 5.51:1 on surface. */
    tint: Brand.blue,
    /** Brand as a *solid fill* under `onAccent`. */
    accent: Brand.blue,
    onAccent: '#FFFFFF',
    tintSoft: '#E1ECF8',
    /** Whova's amber promo banner, with near-black text — 7.43:1. */
    banner: '#F2B24A',
    onBanner: '#3A2A05',
    /** Destructive text. 5.38:1 on surface. */
    danger: '#D70015',
    /** Unread badges: Whova's hue, luminance fixed. white-on-this 4.51:1. */
    dangerFill: '#C75041',
    success: '#1E7A34',
    warning: '#B25000',
  },
  dark: {
    background: '#000000',
    surface: '#1C1C1E',
    surfacePressed: '#2C2C2E',
    groupedBackground: '#000000',
    /** Held at Whova's blue in dark too — the header is the brand. */
    header: Brand.blue,
    onHeader: '#FFFFFF',
    headerField: '#2C2C2E',
    text: '#FFFFFF',
    /** 7.69:1 on surface · 9.50 on background. */
    textSecondary: '#AEAEB2',
    /** 5.94:1 on surface · 7.33 on background. */
    textTertiary: '#98989F',
    /**
     * The white plate a sponsor logo sits on, and the one colour that is
     * deliberately identical in both schemes. Sponsor logos are supplied as
     * transparent PNGs drawn in dark ink; on a dark surface several of them
     * disappear entirely. A brand mark is also not ours to re-tint, so the plate
     * stays white and the logo stays as its owner drew it.
     */
    logoPlate: '#FFFFFF',
    border: '#38383A',
    separator: '#2C2C2E',
    /**
     * Brand as *foreground*, lifted for a dark surface — #2069BC fails AA there.
     * 5.95:1 on surface.
     */
    tint: '#4A9EE8',
    /**
     * Brand as a *solid fill*. Deliberately not `tint`: white on #4A9EE8 is
     * 2.86:1. A blue readable as text on #1C1C1E is too light to carry white.
     */
    accent: '#1F6FBF',
    onAccent: '#FFFFFF',
    tintSoft: '#16283D',
    banner: '#C98F30',
    onBanner: '#1A1200',
    danger: '#FF6961',
    dangerFill: '#D9202B',
    success: '#30D158',
    warning: '#FF9F0A',
  },
} as const;

/**
 * Avatar initial swatches. Every one carries white initials and clears AA
 * against white: blue 5.42 · teal 6.08 · violet 5.70 · amber 5.77 · red 5.91 ·
 * green 5.88 · cyan 6.47.
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
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

/**
 * Minimum tappable edge. Apple's HIG and Android's Material both land on 44pt
 * (Material says 48dp; 44 is the stricter shared floor). Controls smaller than
 * this must make up the difference with `hitSlop` rather than by growing.
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
