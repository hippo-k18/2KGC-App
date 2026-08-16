import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { DECORATIVE } from '@/components/a11y';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { totalUnread, useThreads } from '@/lib/data/messages';

const GLYPH = 22;
const BADGE_HEIGHT = 18;

/**
 * Messages as a header action rather than a tab.
 *
 * The badge is the whole reason this works: an inbox does not need a permanent
 * tab, it needs to be findable the moment it has something in it. Whova spends
 * one of five tab slots on a screen that is empty for most attendees all week.
 *
 * The badge count sets `maxFontSizeMultiplier`. Everywhere else in the app text
 * scales freely, but this pill is a fixed 18pt circle pinned to the corner of an
 * icon; at the largest accessibility sizes an unbounded "12" would render at
 * ~39pt and either clip or cover the icon it annotates. The count is redundant
 * anyway — it is already spoken in full by the button's `accessibilityLabel`,
 * which is the path someone using large type is most likely on.
 */
export function MessagesButton() {
  const colors = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { threads } = useThreads(user?.uid);
  const unread = totalUnread(threads, user?.uid);

  return (
    <Pressable
      onPress={() => router.push('/messages')}
      accessibilityRole="button"
      accessibilityLabel={unread ? `Messages, ${unread} unread` : 'Messages'}
      // The glyph is 22pt inside 4pt of padding; slop makes up the rest of 44.
      hitSlop={(HIT_TARGET - GLYPH - Spacing.xs * 2) / 2}
      style={({ pressed }) => ({ padding: Spacing.xs, opacity: pressed ? 0.4 : 1 })}>
      <Icon name="envelope.fill" size={GLYPH} color={colors.tint} />
      {unread > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -2,
            right: -6,
            minWidth: BADGE_HEIGHT,
            height: BADGE_HEIGHT,
            paddingHorizontal: 5,
            borderRadius: Radius.pill,
            backgroundColor: colors.dangerFill,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          {...DECORATIVE}>
          <Text
            variant="label"
            tone="onAccent"
            style={{ fontSize: 11, lineHeight: 14 }}
            maxFontSizeMultiplier={1.2}>
            {unread > 99 ? '99+' : unread}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
