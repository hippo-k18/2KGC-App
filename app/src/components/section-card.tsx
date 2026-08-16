import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { Text } from '@/components/text';
import { HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Drawn height of the "See more" link at 1×: a 20pt subhead plus 4pt each side. */
const LINK_HEIGHT = 28;

interface SectionCardProps {
  /** Omit for an untitled block — a card that is only content. */
  title?: string;
  /** "See more", "View all". Requires `onActionPress`. */
  actionLabel?: string;
  onActionPress?: () => void;
  children: ReactNode;
  /**
   * Pad the content. Turn it off when the card holds rows that draw their own
   * gutters and full-bleed separators — the title row stays padded either way.
   */
  inset?: boolean;
  style?: ViewStyle;
}

/**
 * One of Whova's grouped white sections: "Admin Tools · View as attendee",
 * "Browse attendees by · See more", "Additional Resources".
 *
 * A plain white block on the grey grouped background, with no border and no
 * shadow. `Card` is the other shape in this app and is a *standalone* raised
 * block with a hairline outline; this one is a *section of the page*, which on
 * both platforms is drawn as a fill change and nothing else. Two cards with two
 * different treatments on one screen would read as two different kinds of thing,
 * which is exactly what they are.
 *
 * ## The action is a link, and it looks like one
 *
 * "See more" keeps its underline. Underlining is unfashionable and it is also
 * the only part of a text link that survives being read by someone who cannot
 * separate the tint blue from the near-black beside it — colour alone is a
 * WCAG 1.4.1 failure, and this is a text-only control with no icon to help.
 * Whova underlines it too, so here the accessible choice and the reference are
 * the same choice.
 *
 * The link is drawn at 28pt and reaches 44 with `hitSlop`, the same trick the
 * filter chips and the follow button use: growing it would drag the section
 * heading's baseline down with it.
 *
 * The title is `accessibilityRole="header"`, which is what puts it in the rotor
 * and lets someone using VoiceOver jump between sections instead of swiping
 * through every row of every one of them.
 */
export function SectionCard({
  title,
  actionLabel,
  onActionPress,
  children,
  inset = true,
  style,
}: SectionCardProps) {
  const colors = useTheme();

  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: Radius.lg,
          paddingVertical: inset ? Spacing.md : Spacing.sm,
          gap: Spacing.sm,
        },
        style,
      ]}>
      {title || actionLabel ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: Spacing.sm,
            paddingHorizontal: Spacing.md,
          }}>
          {title ? (
            <Text variant="title3" accessibilityRole="header" style={{ flex: 1 }}>
              {title}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          {actionLabel && onActionPress ? (
            <Pressable
              onPress={onActionPress}
              accessibilityRole="link"
              accessibilityLabel={title ? `${actionLabel}, ${title}` : actionLabel}
              hitSlop={{
                top: (HIT_TARGET - LINK_HEIGHT) / 2,
                bottom: (HIT_TARGET - LINK_HEIGHT) / 2,
                left: Spacing.sm,
                right: Spacing.sm,
              }}
              style={({ pressed }) => ({
                justifyContent: 'center',
                paddingVertical: Spacing.xs,
                minHeight: LINK_HEIGHT,
                opacity: pressed ? 0.4 : 1,
              })}>
              <Text
                variant="subhead"
                tone="tint"
                numberOfLines={1}
                style={{ fontWeight: '600', textDecorationLine: 'underline' }}>
                {actionLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={inset ? { paddingHorizontal: Spacing.md, gap: Spacing.sm } : undefined}>
        {children}
      </View>
    </View>
  );
}
