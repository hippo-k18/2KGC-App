import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';

import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';

/**
 * Height of the bar `NativeTabs` pins to the top of the window on web. Nothing
 * measures it, so it is a constant here; on device the value is unused.
 */
const WEB_TAB_BAR = 68;

/**
 * Large title with an optional trailing action.
 *
 * The web inset exists because `NativeTabs` draws a real bottom tab bar on iOS
 * and Android, but on web renders as a bar pinned to the top — which would sit
 * on the title. It is purely for the browser preview; on device the value is
 * the normal small gap.
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
    <View style={{ paddingTop: Platform.OS === 'web' ? WEB_TAB_BAR : Spacing.sm }}>
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
