import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { ListRow } from '@/components/list-row';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { useDirectory } from '@/lib/data/directory';
import { otherParticipant, useThreads } from '@/lib/data/messages';

/** The inbox. One row per conversation, newest first, unread count on the right. */
export default function MessagesScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { threads, loading } = useThreads(user?.uid);
  const { people } = useDirectory();

  const nameFor = (uid: string) =>
    people?.find((p) => p.uid === uid)?.name ?? 'Attendee';
  const personFor = (uid: string) => people?.find((p) => p.uid === uid);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={threads ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: Spacing.md, paddingBottom: Spacing.xxl }}
        renderItem={({ item, index }) => {
          const other = otherParticipant(item, user?.uid ?? '');
          const unread = item.unread?.[user?.uid ?? ''] ?? 0;
          const p = personFor(other);
          return (
            <ListRow
              leading={<Avatar name={nameFor(other)} photoURL={p?.photoURL} />}
              title={nameFor(other)}
              subtitle={item.lastMessage ?? 'No messages yet'}
              first={index === 0}
              last={index === (threads?.length ?? 0) - 1}
              trailing={
                unread > 0 ? (
                  <View
                    style={{
                      backgroundColor: colors.dangerFill,
                      borderRadius: Radius.pill,
                      minWidth: 22,
                      height: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingHorizontal: 6,
                    }}>
                    <Text variant="label" tone="onAccent">
                      {unread}
                    </Text>
                  </View>
                ) : undefined
              }
              onPress={() =>
                router.push({
                  pathname: '/messages/[threadId]',
                  params: { threadId: item.id, to: other },
                })
              }
            />
          );
        }}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="envelope"
              title="No messages"
              message="Find someone in People and say hello."
            />
          )
        }
      />
    </View>
  );
}
