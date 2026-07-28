import {
  Text as RNText,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';

import { useTheme } from '@/hooks/use-theme';

type Variant = 'largeTitle' | 'title' | 'heading' | 'body' | 'caption' | 'label';

const VARIANTS: Record<Variant, TextStyle> = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
};

export interface TextProps extends RNTextProps {
  variant?: Variant;
  /** `secondary` for supporting copy, `tint` for links and active state. */
  tone?: 'primary' | 'secondary' | 'tint' | 'onAccent' | 'danger';
}

export function Text({ variant = 'body', tone = 'primary', style, ...rest }: TextProps) {
  const colors = useTheme();

  const color =
    tone === 'secondary'
      ? colors.textSecondary
      : tone === 'tint'
        ? colors.tint
        : tone === 'onAccent'
          ? colors.onAccent
          : tone === 'danger'
            ? colors.danger
            : colors.text;

  return <RNText style={[VARIANTS[variant], { color }, style]} {...rest} />;
}
