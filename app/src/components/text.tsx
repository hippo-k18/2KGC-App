import {
  Text as RNText,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * Typography, on Apple's scale rather than a web one.
 *
 * The sizes and line heights are SF Pro's published metrics — body is 17pt, not
 * the 16 a web design would use, and the negative letter-spacing on the display
 * sizes is what stops large type looking loose. Getting these two details right
 * is most of what makes an interface read as native rather than as a website in
 * a phone-shaped window.
 *
 * `allowFontScaling` stays on everywhere: a professional conference audience
 * includes people using larger text, and this is the layer that decides whether
 * the app respects that.
 *
 * ## Why the display sizes carry no `lineHeight`
 *
 * React Native has no unitless `lineHeight`; the value is points. Both platforms
 * do scale it with the font scale — iOS multiplies by `effectiveFontSizeMultiplier`
 * in `RCTTextAttributes`, Android converts it with `toPixelFromSP` — but iOS then
 * assigns it to *both* `minimumLineHeight` and `maximumLineHeight`, which turns
 * the line box into a hard clamp. A ratio that is comfortable at 1× therefore
 * clips at accessibility sizes as soon as the rendered font's natural leading
 * exceeds it, and every rounding error goes the wrong way.
 *
 * SF Pro's natural leading is ≈1.19–1.21× the point size. The text variants below
 * sit at 1.29–1.38×, which is enough headroom that the clamp never binds. The
 * display variants were at 1.206× (largeTitle), 1.214× (title) and 1.25× (title3)
 * — at or under the natural leading of a 700-weight face — so `largeTitle`
 * overflowed its 41pt box at the largest Dynamic Type sizes and lost the top of
 * its ascenders. They now omit `lineHeight` entirely and take the font's own
 * leading, which is correct at every size by construction.
 *
 * Where a fixed-size container genuinely cannot grow (an avatar circle, a badge
 * pill), the fix is `maxFontSizeMultiplier` or `allowFontScaling={false}` at the
 * call site, never a tighter line box here.
 */
type Variant =
  | 'largeTitle'
  | 'title'
  | 'title3'
  | 'heading'
  | 'body'
  | 'callout'
  | 'subhead'
  | 'caption'
  | 'label';

const VARIANTS: Record<Variant, TextStyle> = {
  // Display sizes: no lineHeight — see the note above.
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: 0.37 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: 0.36 },
  title3: { fontSize: 20, fontWeight: '600', letterSpacing: -0.45 },
  // Text sizes: lineHeight at ≥1.29×, which clears SF Pro's natural leading.
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.41 },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400', letterSpacing: -0.41 },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400', letterSpacing: -0.32 },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400', letterSpacing: -0.24 },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400', letterSpacing: -0.08 },
  /** Uppercase metadata — section headers, badges. */
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.5 },
};

export interface TextProps extends RNTextProps {
  variant?: Variant;
  tone?: 'primary' | 'secondary' | 'tertiary' | 'tint' | 'onAccent' | 'danger';
}

export function Text({ variant = 'body', tone = 'primary', style, ...rest }: TextProps) {
  const colors = useTheme();

  const color = {
    primary: colors.text,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    tint: colors.tint,
    onAccent: colors.onAccent,
    danger: colors.danger,
  }[tone];

  return <RNText style={[VARIANTS[variant], { color }, style]} {...rest} />;
}
