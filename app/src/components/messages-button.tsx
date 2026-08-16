import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Text } from '@/components/text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { totalUnread, useThreads } from '@/lib/data/messages';

/**
 * Messages as a header action rather than a tab.
 *
 * The badge is the whole reason this works: an inbox does not need a permanent
 * tab, it needs to be findable the moment it has something in it. Whova spends
 * one of five tab slots on a screen that is empty for most attendees all week.
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
      hitSlop={12}
      style={{ padding: 4 }}>
      <Text variant="title3" tone="tint" accessibilityElementsHidden>
        ✉
      </Text>
      {unread > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -2,
            right: -6,
            minWidth: 18,
            height: 18,
            paddingHorizontal: 5,
            borderRadius: Radius.pill,
            backgroundColor: colors.danger,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text variant="label" tone="onAccent" style={{ fontSize: 11 }}>
            {unread > 99 ? '99+' : unread}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
