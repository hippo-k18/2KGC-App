import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { DECORATIVE } from '@/components/a11y';
import { Text } from '@/components/text';
import { AVATAR_SIZE, HAIRLINE, HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Gap between the leading slot and the text column, and the row's own rhythm. */
const GUTTER = Spacing.md - Spacing.xs; // 12
/** Comfortably clear of the 44pt minimum without looking Material-tall. */
const ROW_MIN_HEIGHT = HIT_TARGET + Spacing.xs; // 48

/**
 * A row in an inset grouped list — the iOS Settings pattern.
 *
 * `first`/`last` round the outer corners so a run of rows reads as one card,
 * and the separator is inset to the text column rather than running full width.
 * Both are small details that the platform does everywhere and that their
 * absence makes an interface feel foreign.
 *
 * Every line of text allows two lines. It used to allow one, which at the larger
 * Dynamic Type sizes turned "Hello, Alexandra" into "Hello, Alexandr…" and every
 * attendee's affiliation into an ellipsis — the readers most likely to be using
 * large type were the ones getting the least information. Two lines is the right
 * cap rather than unlimited: a row still has to be scannable, and an
 * announcement body that ran to nine lines would stop the list working as a list.
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
  const inset = leading ? Spacing.md + AVATAR_SIZE + GUTTER : Spacing.md;

  const body = (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: GUTTER,
          paddingHorizontal: Spacing.md,
          paddingVertical: GUTTER,
          minHeight: ROW_MIN_HEIGHT,
        }}>
        {leading}
        <View style={{ flex: 1, gap: Spacing.xs / 2 }}>
          <Text variant="body" tone={destructive ? 'danger' : 'primary'} numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="subhead" tone="secondary" numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
          {meta ? (
            <Text variant="caption" tone="tertiary" numberOfLines={2}>
              {meta}
            </Text>
          ) : null}
        </View>
        {trailing}
      </View>
      {!last ? (
        <View
          style={{ height: HAIRLINE, backgroundColor: colors.separator, marginLeft: inset }}
          {...DECORATIVE}
        />
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

/**
 * Uppercase section header above a grouped list.
 *
 * Inset by a full gutter so it aligns with the row *title* rather than floating
 * 4pt off the card edge — the alignment iOS Settings uses, and the reason a
 * grouped list reads as one object instead of a header and an unrelated card.
 */
export function SectionHeader({ children }: { children: string }) {
  return (
    <Text
      variant="label"
      tone="secondary"
      style={{
        paddingHorizontal: Spacing.md,
        paddingBottom: Spacing.sm,
        paddingTop: Spacing.lg,
      }}>
      {children.toUpperCase()}
    </Text>
  );
}
