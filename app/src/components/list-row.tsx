import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/text';
import { HAIRLINE, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A row in an inset grouped list — the iOS Settings pattern.
 *
 * `first`/`last` round the outer corners so a run of rows reads as one card,
 * and the separator is inset to the text column rather than running full width.
 * Both are small details that the platform does everywhere and that their
 * absence makes an interface feel foreign.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  onPress,
  first,
  last,
  destructive,
}: {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  meta?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  first?: boolean;
  last?: boolean;
  destructive?: boolean;
}) {
  const colors = useTheme();
  const inset = leading ? Spacing.md + 44 + 12 : Spacing.md;

  const body = (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: Spacing.md,
          paddingVertical: 11,
          minHeight: 48,
        }}>
        {leading}
        <View style={{ flex: 1, gap: 1 }}>
          <Text variant="body" tone={destructive ? 'danger' : 'primary'} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="subhead" tone="secondary" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          {meta ? (
            <Text variant="caption" tone="tertiary" numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        {trailing}
      </View>
      {!last ? (
        <View style={{ height: HAIRLINE, backgroundColor: colors.separator, marginLeft: inset }} />
      ) : null}
    </>
  );

  const shape = {
    borderTopLeftRadius: first ? Radius.lg : 0,
    borderTopRightRadius: first ? Radius.lg : 0,
    borderBottomLeftRadius: last ? Radius.lg : 0,
    borderBottomRightRadius: last ? Radius.lg : 0,
  };

  if (!onPress) {
    return <View style={[{ backgroundColor: colors.surface }, shape]}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        { backgroundColor: pressed ? colors.surfacePressed : colors.surface },
        shape,
      ]}>
      {body}
    </Pressable>
  );
}

/** Uppercase section header above a grouped list. */
export function SectionHeader({ children }: { children: string }) {
  return (
    <Text
      variant="label"
      tone="secondary"
      style={{ paddingHorizontal: Spacing.xs, paddingBottom: Spacing.sm, paddingTop: Spacing.lg }}>
      {children.toUpperCase()}
    </Text>
  );
}
