import { View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Metadata glyph size — a shade under the 13pt caption's cap-height. */
const GLYPH = 13;
/** Gap between a glyph and its number. */
const GAP = 5;
/** Gap between one stat and the next. Wide enough that the pairs read as pairs. */
const STAT_GAP = Spacing.md;

interface StatRowProps {
  /** People who have this session in their agenda. */
  attending?: number;
  likes?: number;
  comments?: number;
  style?: ViewStyle;
}

/** `[icon, singular, plural]`, in the order Whova draws them. */
const STATS = [
  ['person.fill.checkmark', 'attending', 'attending'],
  ['heart', 'like', 'likes'],
  ['bubble.left', 'comment', 'comments'],
] as const satisfies readonly (readonly [IconName, string, string])[];

/**
 * The engagement strip under an agenda row: person-with-tick 52, heart 1,
 * speech bubble 19.
 *
 * ## Tabular figures
 *
 * The numbers use `tabular-nums` because this strip repeats down a list and
 * proportional digits make each row's glyphs land in a slightly different place
 * — a 1 is roughly half the width of a 4 in SF Pro's default figures, so a
 * column of counts visibly wobbles. It is the same reason the agenda's time
 * column is tabular.
 *
 * ## One label, not six
 *
 * The whole strip is a single accessibility element reading "52 attending,
 * 1 like, 19 comments". Left alone it would be six: three silent glyphs and
 * three bare numbers, so VoiceOver would move through an agenda row announcing
 * "52", "1", "19" with nothing to attach them to. `accessible` on the container
 * merges the children, and every glyph is already hidden by `Icon`.
 *
 * A stat that is `undefined` is omitted entirely; a stat that is `0` keeps its
 * glyph and drops the number, which is Whova's own behaviour — the empty
 * speech bubble is an invitation to be the first comment. The spoken label says
 * "no comments" for that case rather than skipping it silently.
 */
export function StatRow({ attending, likes, comments, style }: StatRowProps) {
  const colors = useTheme();
  const counts = [attending, likes, comments];

  const present = STATS.map((stat, index) => ({ stat, count: counts[index] })).filter(
    (entry): entry is { stat: (typeof STATS)[number]; count: number } => entry.count !== undefined,
  );

  if (present.length === 0) return null;

  const label = present
    .map(({ stat, count }) =>
      count === 0 ? `no ${stat[2]}` : `${count} ${count === 1 ? stat[1] : stat[2]}`,
    )
    .join(', ');

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: STAT_GAP, flexWrap: 'wrap' },
        style,
      ]}>
      {present.map(({ stat, count }) => (
        <View key={stat[0]} style={{ flexDirection: 'row', alignItems: 'center', gap: GAP }}>
          <Icon name={stat[0]} size={GLYPH} color={colors.textTertiary} weight="regular" />
          {count > 0 ? (
            <Text variant="caption" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
              {count}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
