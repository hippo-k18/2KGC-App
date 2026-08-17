import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Icon } from '@/components/icon';
import { PushedHeader } from '@/components/pushed-header';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The honest end of a resource tile that has no screen behind it yet.
 *
 * Whova's home grid is fifteen tiles and every one of them opens something. Ours
 * cannot yet, and the two dishonest options — omitting the tile, or drawing it
 * and swallowing the tap — are both worse than saying so. A tile that opens a
 * screen naming what is missing and why is a *demo asset*: it shows the intended
 * surface area of the product while being straight about what is wired.
 *
 * The `detail` is passed in by the caller rather than looked up from a table
 * here, so the reason sits beside the tile it belongs to in `index.tsx` and
 * cannot drift out of sync with it.
 */
export default function ComingSoonScreen() {
  const colors = useTheme();
  const { title, detail } = useLocalSearchParams<{ title?: string; detail?: string }>();

  const heading = title ?? 'Not built yet';

  return (
    <>
      <PushedHeader backTitle="Home" backHref="/home" />

      <Screen grouped>
        <View
          style={{
            gap: Spacing.md,
            padding: Spacing.md,
            borderRadius: Radius.lg,
            backgroundColor: colors.surface,
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
            <Icon name="square.dashed" size={22} color={colors.textTertiary} />
            <Text variant="title3" accessibilityRole="header" style={{ flex: 1 }}>
              {heading}
            </Text>
          </View>

          <View
            style={{
              alignSelf: 'flex-start',
              paddingHorizontal: Spacing.sm,
              paddingVertical: Spacing.xs,
              borderRadius: Radius.sm,
              backgroundColor: colors.tintSoft,
            }}>
            <Text variant="label" tone="tint">
              NOT BUILT YET
            </Text>
          </View>

          {detail ? (
            <Text variant="body" tone="secondary">
              {detail}
            </Text>
          ) : null}

          <Text variant="subhead" tone="tertiary">
            This tile is here so the shape of the app matches what it will ship as.
            Nothing on this screen is faked — when the feature lands, the tile opens it
            instead of this.
          </Text>
        </View>
      </Screen>
    </>
  );
}
