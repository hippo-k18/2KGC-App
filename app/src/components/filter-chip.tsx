import { Pressable } from 'react-native';

import { Text } from '@/components/text';
import { HAIRLINE, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A selectable pill.
 *
 * Selected state is a solid brand fill; unselected is a plain surface with a
 * hairline. No gradient, no shadow, no border on the selected state — a filled
 * pill that also carries a stroke reads as two competing shapes.
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
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        height: 34,
        borderRadius: Radius.pill,
        backgroundColor: selected
          ? colors.tint
          : pressed
            ? colors.surfacePressed
            : colors.surface,
        borderWidth: selected ? 0 : HAIRLINE,
        borderColor: colors.border,
      })}>
      {!selected && dotColor ? (
        <Text
          style={{ color: dotColor, fontSize: 10, lineHeight: 12 }}
          accessibilityElementsHidden>
          ●
        </Text>
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
