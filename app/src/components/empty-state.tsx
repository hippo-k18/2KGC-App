import { View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface EmptyStateProps {
  /** SF Symbol name. Must have an Android pairing in `icon.tsx` — see `IconName`. */
  icon?: IconName;
  title: string;
  message?: string;
}

/** A comfortable measure for two or three lines of explanatory text. */
const MESSAGE_WIDTH = 300;

/**
 * Shown when a query returns nothing, or when a record has been removed.
 *
 * The icon used to be wrapped in `Platform.OS === 'ios' &&` around a raw
 * `SymbolView`, which is exactly the failure `AGENTS.md` gotcha 3 describes:
 * every empty state on Android rendered a title with a gap above it and no icon
 * at all. It now goes through `Icon`, which pairs each SF Symbol with a Material
 * glyph and cannot be used without one.
 *
 * It centres itself in whatever space it is given rather than hanging from the
 * top of it. Top-anchoring with a fixed `Spacing.xxl` pad put "No matches" a
 * third of the way down the screen with 286pt of empty white under it, which
 * reads as a half-loaded screen rather than an answer. `flexGrow` is the growth
 * rule, not `flex`, so it still measures naturally inside a `ScrollView` whose
 * content container has no `flexGrow: 1` of its own.
 */
export function EmptyState({ icon = 'square.dashed', title, message }: EmptyStateProps) {
  const colors = useTheme();

  return (
    <View
      style={{
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.sm,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xl,
      }}>
      <Icon name={icon} size={Spacing.xxl} color={colors.textSecondary} weight="regular" />
      <Text variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {message ? (
        <Text tone="secondary" style={{ textAlign: 'center', maxWidth: MESSAGE_WIDTH }}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}
