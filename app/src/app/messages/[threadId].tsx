import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { EmptyState } from '@/components/empty-state';
import { Text } from '@/components/text';
import { HAIRLINE, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { useDirectory } from '@/lib/data/directory';
import { markThreadRead, sendMessage, useMessages, useThreads } from '@/lib/data/messages';

/**
 * A conversation.
 *
 * The thread may not exist yet — arriving from someone's profile passes a
 * deterministic id for a conversation that has never been written. That is
 * deliberate: the thread is created by the first message, so opening a profile
 * and backing out leaves no empty conversations behind.
 */
export default function ThreadScreen() {
  const { threadId, to } = useLocalSearchParams<{ threadId: string; to?: string }>();
  const colors = useTheme();
  const { user } = useAuth();
  const { people } = useDirectory();
  const { threads } = useThreads(user?.uid);
  const messages = useMessages(threadId);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList>(null);

  // Derive the other participant from the id when it was not passed in.
  const other = to ?? threadId?.split('_').find((p) => p !== user?.uid) ?? '';
  const name = people?.find((p) => p.uid === other)?.name ?? 'Attendee';

  useEffect(() => {
    if (messages.length) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
    }
  }, [messages.length]);

  const uid = user?.uid;
  const unreadForMe = threads?.find((t) => t.id === threadId)?.unread?.[uid ?? ''] ?? 0;

  // Reading the conversation is what clears the badge. Nothing called
  // `markThreadRead` before this, so the red count on the header icon survived
  // an attendee's first DM for the rest of the week. Guarded on a non-zero
  // count both to avoid a write on every render and because a thread reached
  // from a profile may not exist yet, where an update is a `not-found`.
  useEffect(() => {
    if (!uid || !threadId || unreadForMe === 0) return;
    void markThreadRead(threadId, uid);
  }, [threadId, uid, unreadForMe]);

  async function send() {
    if (!user || !draft.trim() || !other) return;
    const body = draft.trim();
    // Cleared optimistically — the message appears in the list from the local
    // mutation — but put back if the send fails, because silently destroying
    // what someone typed is worse than the failure itself.
    setDraft('');
    try {
      const result = await sendMessage(user.uid, other, body);
      if (!result.ok) restoreDraft(body);
    } catch {
      restoreDraft(body);
    }
  }

  /** Only if nothing new has been typed in the meantime. */
  function restoreDraft(body: string) {
    setDraft((current) => current || body);
  }

  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: Spacing.md, gap: Spacing.sm }}
          renderItem={({ item }) => {
            const mine = item.senderId === user?.uid;
            return (
              <View
                style={{
                  alignSelf: mine ? 'flex-end' : 'flex-start',
                  backgroundColor: mine ? colors.accent : colors.surface,
                  borderRadius: 18,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  maxWidth: '78%',
                }}>
                <Text tone={mine ? 'onAccent' : 'primary'}>{item.body}</Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="envelope"
              title={`Say hello to ${name}`}
              message="Messages are private between the two of you."
            />
          }
        />

        <View
          style={{
            flexDirection: 'row',
            gap: Spacing.sm,
            padding: Spacing.md,
            borderTopWidth: HAIRLINE,
            borderTopColor: colors.border,
          }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Write a message"
            multiline
            style={{
              flex: 1,
              backgroundColor: colors.surface,
              borderRadius: Radius.xl,
              paddingHorizontal: 14,
              paddingTop: 10,
              paddingBottom: 10,
              maxHeight: 120,
              fontSize: 17,
              color: colors.text,
            }}
          />
          <Pressable
            disabled={!draft.trim()}
            onPress={send}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={{ justifyContent: 'center', opacity: draft.trim() ? 1 : 0.4 }}>
            <Text variant="heading" tone="tint">
              Send
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}
