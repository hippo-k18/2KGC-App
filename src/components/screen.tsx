import type { ReactNode } from 'react';
import { ScrollView, View, type ViewStyle } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ScreenProps {
  children: ReactNode;
  /**
   * Wrap the content in a ScrollView. Turn this off for screens that host their
   * own FlatList, which must not be nested inside a scroll view.
   */
  scroll?: boolean;
  /** Use the grey grouped-list background instead of the plain one. */
  grouped?: boolean;
  /** Horizontal gutter. Set false for edge-to-edge lists. */
  padded?: boolean;
  contentStyle?: ViewStyle;
}

/**
 * Standard screen container. `contentInsetAdjustmentBehavior="automatic"` is
 * what makes iOS large titles collapse correctly on scroll, and it keeps
 * content clear of the native tab bar.
 */
export function Screen({
  children,
  scroll = true,
  grouped = false,
  padded = true,
  contentStyle,
}: ScreenProps) {
  const colors = useTheme();
  const background = grouped ? colors.groupedBackground : colors.background;
  const inner: ViewStyle = {
    padding: padded ? Spacing.md : 0,
    gap: Spacing.md,
    ...contentStyle,
  };

  if (!scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: background }, inner]}>{children}</View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={inner}>
      {children}
    </ScrollView>
  );
}
