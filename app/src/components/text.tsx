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
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: 0.37 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: 0.36 },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600', letterSpacing: -0.45 },
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
