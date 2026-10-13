import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';

/**
 * Large title with an optional trailing action.
 *
 * The title wraps rather than truncating. It carried `numberOfLines={1}`, which
 * at the larger Dynamic Type sizes rendered the home screen's greeting as
 * "Hello, Alexandr…" — a 34pt display face is the last place to be throwing
 * characters away, and a two-line greeting costs one line of scroll. `flex: 1`
 * keeps it from pushing the trailing action off the edge, and `alignItems`
 * moves to `flex-start` so the action stays pinned to the first line of a
 * wrapped title instead of drifting to its vertical centre.
 */
export function ScreenHeader({
  title,
  trailing,
  subtitle,
}: {
  title: string;
  trailing?: ReactNode;
  subtitle?: string;
}) {
  return (
    <View style={{ paddingTop: Spacing.sm }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          paddingHorizontal: Spacing.md,
          gap: Spacing.sm,
        }}>
        <Text variant="largeTitle" style={{ flex: 1 }} accessibilityRole="header">
          {title}
        </Text>
        {trailing ? <View style={{ paddingTop: Spacing.sm }}>{trailing}</View> : null}
      </View>
      {subtitle ? (
        <Text
          variant="subhead"
          tone="secondary"
          style={{ paddingHorizontal: Spacing.md, paddingTop: Spacing.xs }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
