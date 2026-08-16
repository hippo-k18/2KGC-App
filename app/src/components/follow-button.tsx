import { Pressable } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { HIT_TARGET, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Circled glyph size. Whova's is noticeably larger than the label's cap-height. */
const GLYPH = 21;
/** Gap between the glyph and the word. */
const GAP = 6;
/** Vertical padding around the 20pt subhead line box → a 28pt drawn control. */
const PADDING_Y = 4;
/** Drawn height at 1× Dynamic Type. `hitSlop` covers the gap to HIT_TARGET. */
const DRAWN_HEIGHT = 20 + PADDING_Y * 2;

interface FollowButtonProps {
  following: boolean;
  onPress: () => void;
  /**
   * What is being followed — "Presentation Decks", "Article Sharing". Folded
   * into the spoken label, because "Follow" on its own is meaningless when a
   * screen reader is moving down a list of eight of these.
   */
  name?: string;
}

/**
 * Whova's "⊕ Follow" pill, at the right-hand end of a Community row.
 *
 * ## Why this is 28pt tall and still a legal target
 *
 * It sits on the same line as "5 Replies (5 New) · 3 Following", so it cannot be
 * 44pt without either pushing that metadata onto its own line or making every
 * row in the list a third taller. Whova draws it small and leaves it small — the
 * control is about 28pt of real estate and has no slop at all, which on a phone
 * held one-handed is a miss about as often as a hit.
 *
 * The fix is the platform's: the drawn shape stays at Whova's size and `hitSlop`
 * takes the *target* to exactly 44. Horizontal slop is asymmetric — 12pt to the
 * right, where there is only the screen edge, and 8pt to the left, which is half
 * the gutter and so cannot reach the metadata text beside it.
 *
 * ## State is not carried by colour alone
 *
 * Follow → Following changes the glyph (plus-in-a-circle → tick-in-a-circle) as
 * well as the word and the tone. Someone who cannot separate the grey from the
 * blue still has two other signals, and `accessibilityState.selected` gives
 * VoiceOver and TalkBack a third.
 */
export function FollowButton({ following, onPress, name }: FollowButtonProps) {
  const colors = useTheme();
  const subject = name ? ` ${name}` : '';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: following }}
      accessibilityLabel={following ? `Following${subject}` : `Follow${subject}`}
      accessibilityHint={following ? 'Double tap to stop following' : undefined}
      hitSlop={{
        top: (HIT_TARGET - DRAWN_HEIGHT) / 2,
        bottom: (HIT_TARGET - DRAWN_HEIGHT) / 2,
        left: Spacing.sm,
        right: Spacing.sm + Spacing.xs,
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: GAP,
        paddingVertical: PADDING_Y,
        minHeight: DRAWN_HEIGHT,
        opacity: pressed ? 0.4 : 1,
      })}>
      <Icon
        name={following ? 'checkmark.circle.fill' : 'plus.circle.fill'}
        size={GLYPH}
        color={following ? colors.tint : colors.textTertiary}
      />
      <Text variant="subhead" tone={following ? 'tint' : 'secondary'} numberOfLines={1}>
        {following ? 'Following' : 'Follow'}
      </Text>
    </Pressable>
  );
}
