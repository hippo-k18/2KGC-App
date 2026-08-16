import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { HAIRLINE, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface CardProps {
  children: ReactNode;
  /** Supplying this makes the whole card tappable. */
  onPress?: () => void;
  style?: ViewStyle;
}

/**
 * A standalone raised block, for content that is not part of a grouped list.
 *
 * The border is a hairline like every other rule in the app — it was 1pt, which
 * on a 3× screen is three device pixels and reads as a web card outline next to
 * the 0.5pt separators inside `ListRow`.
 *
 * The pressed state changes the fill rather than dropping opacity. Fading a card
 * lets the background show through its text as well as its surface, which on the
 * grouped grey reads as the card going out of focus rather than being pushed;
 * iOS moves the fill and leaves the content alone.
 */
export function Card({ children, onPress, style }: CardProps) {
  const colors = useTheme();

  const base: ViewStyle = {
    backgroundColor: colors.surface,
    borderRadius: Radius.md,
    borderWidth: HAIRLINE,
    borderColor: colors.border,
    padding: Spacing.md,
    gap: Spacing.xs,
    ...style,
  };

  if (!onPress) return <View style={base}>{children}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [base, pressed && { backgroundColor: colors.surfacePressed }]}>
      {children}
    </Pressable>
  );
}
