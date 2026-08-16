import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';

import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';

/**
 * Large title with an optional trailing action.
 *
 * The web inset exists because `NativeTabs` draws a real bottom tab bar on iOS
 * and Android, but on web renders as a bar pinned to the top — which would sit
 * on the title. It is purely for the browser preview; on device the value is
 * the normal small gap.
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
    <View style={{ paddingTop: Platform.OS === 'web' ? 68 : Spacing.sm }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: Spacing.md,
          gap: Spacing.sm,
        }}>
        <Text variant="largeTitle" style={{ flex: 1 }} numberOfLines={1}>
          {title}
        </Text>
        {trailing}
      </View>
      {subtitle ? (
        <Text variant="subhead" tone="secondary" style={{ paddingHorizontal: Spacing.md }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
