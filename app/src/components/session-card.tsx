import { Pressable, useWindowDimensions, View } from 'react-native';

import { DECORATIVE } from '@/components/a11y';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { HAIRLINE, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatTime, type Session } from '@/lib/data/sessions';

/** Width of the time column at 1× Dynamic Type — fits "12:30 PM" in tabular figures. */
const TIME_COLUMN = 74;
/**
 * Font scale at which the two-column layout stops paying for itself. Past this
 * the time column would need more than half the screen and the title would be
 * reduced to two words a line, so the row stacks instead.
 */
const STACK_ABOVE = 1.35;
/** Track colour swatch. */
const TRACK_DOT = 6;
/** Gap between the title, speakers and room lines — tighter than Spacing.xs. */
const LINE_GAP = 3;
/** Gap between the track dot and the title, and the title and the saved star. */
const INLINE_GAP = 6;
/** Star glyph size, and the nudge that seats it on the title's cap-height. */
const STAR = 13;

/**
 * One row in the agenda, built as an inset grouped-list row rather than a card.
 *
 * The time sits in a fixed-width left column instead of inline in the prose,
 * because the single most common thing anyone does with a conference agenda is
 * scan down it for a time — and a ragged left edge makes that measurably slower.
 * This is the layout Apple Calendar and Things use, for the same reason. Whova's
 * flat, time-inline list is the thing being beaten here.
 *
 * The track colour is a 6pt dot, not a filled block: at eleven tracks a bar per
 * row turns the list into a barcode.
 *
 * The time column is the one thing here that cannot simply reflow. It was a
 * hard 74pt, which at the largest Dynamic Type sizes broke "9:00 AM" across
 * three lines as "9:0 / 0 / AM". Widening it in proportion to `fontScale` only
 * moves the problem: at 3.1× the column wants 230pt of a 414pt screen and the
 * title gets two words a line.
 *
 * So past `STACK_ABOVE` the row stops being two columns and stacks — time on its
 * own line above the title, which is what iOS's own list content configurations
 * do at accessibility sizes. Below it, the scan-anchor layout is untouched and
 * the column grows with the type so nothing clips. The separator inset follows
 * the layout either way, so the hairline stays aligned to the text column.
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
  const { fontScale } = useWindowDimensions();
  const accent = session.primaryTrackColor ?? colors.tint;
  const stacked = fontScale > STACK_ABOVE;
  const timeColumn = Math.round(TIME_COLUMN * Math.max(fontScale, 1));

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
      <View
        style={{
          flexDirection: stacked ? 'column' : 'row',
          gap: stacked ? Spacing.xs : 0,
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.md - Spacing.xs,
        }}>
        {/* The scan anchor: a fixed column when it fits, its own line when it does not. */}
        <View
          style={
            stacked
              ? { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap' }
              : { width: timeColumn, paddingTop: 1 }
          }>
          <Text variant="subhead" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
            {formatTime(session.startsAtLocal)}
            {stacked ? ' –' : ''}
          </Text>
          <Text variant="caption" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
            {formatTime(session.endsAtLocal)}
          </Text>
        </View>

        <View style={{ flex: stacked ? undefined : 1, gap: LINE_GAP }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: INLINE_GAP }}>
            {session.primaryTrackName ? (
              <View
                style={{
                  width: TRACK_DOT,
                  height: TRACK_DOT,
                  borderRadius: TRACK_DOT / 2,
                  backgroundColor: accent,
                  // Nudged to sit on the cap-height of the first line rather
                  // than the centre of a wrapped block.
                  marginTop: Spacing.sm,
                }}
                {...DECORATIVE}
              />
            ) : null}
            <Text variant="heading" style={{ flex: 1 }}>
              {session.title}
            </Text>
            {saved ? (
              // Redundant with ", in your schedule" in the label above, so `Icon`
              // hides it everywhere rather than have it read as "black star".
              <Icon
                name="star.fill"
                size={STAR}
                color={colors.tint}
                style={{ marginTop: Spacing.xs }}
              />
            ) : null}
          </View>

          {session.speakerNames?.length ? (
            <Text variant="subhead" tone="secondary" numberOfLines={2}>
              {session.speakerNames.join(', ')}
            </Text>
          ) : null}

          <Text variant="caption" tone="tertiary" numberOfLines={2}>
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
            marginLeft: stacked ? Spacing.md : Spacing.md + timeColumn,
          }}
          {...DECORATIVE}
        />
      ) : null}
    </Pressable>
  );
}
