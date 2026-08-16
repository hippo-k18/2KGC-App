import { Pressable, View } from 'react-native';

import { DECORATIVE } from '@/components/a11y';
import { Text } from '@/components/text';
import { HAIRLINE, HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Visual height of the pill at 1× Dynamic Type. Deliberately under 44pt. */
const CHIP_HEIGHT = 34;
/** 7 + the 20pt subhead line box + 7 = CHIP_HEIGHT, so nothing moves at 1×. */
const PADDING_Y = 7;
/** Optical inset for a pill. A full 16pt gutter makes short labels look lost. */
const PADDING_X = 14;
/** Vertical slop that brings the tappable box up to HIT_TARGET. */
const SLOP_Y = (HIT_TARGET - CHIP_HEIGHT) / 2;
/** Track-colour swatch. A real circle, not a `●` glyph. */
const DOT = 8;
/** Gap between the swatch and the label. */
const DOT_GAP = 6;

/**
 * A selectable pill.
 *
 * Selected state is a solid brand fill; unselected is a plain surface with a
 * hairline. No gradient, no shadow, no border on the selected state — a filled
 * pill that also carries a stroke reads as two competing shapes.
 *
 * ## Why 34pt tall with `hitSlop` rather than 44pt tall
 *
 * This is the app's primary navigation control — agenda day tabs, track filters,
 * the People segments, interest and category filters — and it is tapped while
 * walking between rooms, which is exactly the case Apple's 44pt minimum exists
 * for. It was 34pt with no `hitSlop` at all.
 *
 * Growing the pill to 44 is the wrong fix: a 44pt pill in a horizontal scroller
 * is a chunky Android-looking control, and iOS's own segmented controls and
 * filter pills are 32–34pt. The platform solves this with an *invisible* target,
 * so `hitSlop` adds 5pt above and below to reach exactly `HIT_TARGET` while the
 * drawn shape is untouched. Horizontal slop is kept to 2pt because these render
 * in a row with an 8pt gap and overlapping targets would be worse than a small
 * one — 2pt each side consumes half the gap and no more.
 *
 * The height is a `minHeight` plus symmetric padding rather than a fixed
 * `height`, so the label is not guillotined at large Dynamic Type. At 1× the
 * padding and the 20pt subhead line box sum to exactly 34, so nothing moves.
 */
export function FilterChip({
  label,
  selected,
  onPress,
  role = 'button',
  dotColor,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  role?: 'button' | 'tab';
  /** Track colour, shown as a dot when unselected. */
  dotColor?: string;
}) {
  const colors = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      hitSlop={{ top: SLOP_Y, bottom: SLOP_Y, left: 2, right: 2 }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: DOT_GAP,
        paddingHorizontal: PADDING_X,
        paddingVertical: PADDING_Y,
        minHeight: CHIP_HEIGHT,
        borderRadius: Radius.pill,
        backgroundColor: selected
          ? colors.accent
          : pressed
            ? colors.surfacePressed
            : colors.surface,
        borderWidth: selected ? 0 : HAIRLINE,
        borderColor: colors.border,
      })}>
      {!selected && dotColor ? (
        <View
          style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: dotColor }}
          {...DECORATIVE}
        />
      ) : null}
      <Text
        variant="subhead"
        tone={selected ? 'onAccent' : 'primary'}
        style={{ fontWeight: selected ? '600' : '400' }}>
        {label}
      </Text>
    </Pressable>
  );
}
