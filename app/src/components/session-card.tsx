import { Pressable, View } from 'react-native';

import { Text } from '@/components/text';
import { HAIRLINE, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatTime, type Session } from '@/lib/data/sessions';

/**
 * One row in the agenda, built as an inset grouped-list row rather than a card.
 *
 * The time sits in a fixed-width left column instead of inline in the prose,
 * because the single most common thing anyone does with a conference agenda is
 * scan down it for a time — and a ragged left edge makes that measurably slower.
 * This is the layout Apple Calendar and Things use, for the same reason. Whova's
 * flat, time-inline list is the thing being beaten here.
 *
 * The track colour is a 3pt dot, not a filled block: at eleven tracks a bar per
 * row turns the list into a barcode.
 */
export function SessionCard({
  session,
  onPress,
  saved,
  first,
  last,
}: {
  session: Session;
  onPress?: () => void;
  saved?: boolean;
  /** Rounds the top corners — the row is at the head of a group. */
  first?: boolean;
  /** Rounds the bottom corners and drops the separator. */
  last?: boolean;
}) {
  const colors = useTheme();
  const accent = session.primaryTrackColor ?? colors.tint;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        `${session.title}, ${formatTime(session.startsAtLocal)} to ` +
        `${formatTime(session.endsAtLocal)}` +
        (session.roomName ? `, ${session.roomName}` : '') +
        (saved ? ', in your schedule' : '')
      }
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.surfacePressed : colors.surface,
        borderTopLeftRadius: first ? Radius.lg : 0,
        borderTopRightRadius: first ? Radius.lg : 0,
        borderBottomLeftRadius: last ? Radius.lg : 0,
        borderBottomRightRadius: last ? Radius.lg : 0,
      })}>
      <View style={{ flexDirection: 'row', paddingHorizontal: Spacing.md, paddingVertical: 12 }}>
        {/* Fixed-width time column — the scan anchor. */}
        <View style={{ width: 74, paddingTop: 1 }}>
          <Text variant="subhead" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
            {formatTime(session.startsAtLocal)}
          </Text>
          <Text variant="caption" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
            {formatTime(session.endsAtLocal)}
          </Text>
        </View>

        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
            {session.primaryTrackName ? (
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: accent,
                  // Nudged to sit on the cap-height of the first line rather
                  // than the centre of a wrapped block.
                  marginTop: 8,
                }}
              />
            ) : null}
            <Text variant="heading" style={{ flex: 1 }}>
              {session.title}
            </Text>
            {saved ? (
              <Text variant="caption" tone="tint" accessibilityElementsHidden>
                ★
              </Text>
            ) : null}
          </View>

          {session.speakerNames?.length ? (
            <Text variant="subhead" tone="secondary" numberOfLines={1}>
              {session.speakerNames.join(', ')}
            </Text>
          ) : null}

          <Text variant="caption" tone="tertiary" numberOfLines={1}>
            {[session.roomName, session.primaryTrackName].filter(Boolean).join('  ·  ')}
          </Text>
        </View>
      </View>

      {/* Inset separator, aligned to the text column — the iOS convention. */}
      {!last ? (
        <View
          style={{
            height: HAIRLINE,
            backgroundColor: colors.separator,
            marginLeft: Spacing.md + 74,
          }}
        />
      ) : null}
    </Pressable>
  );
}
