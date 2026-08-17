import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { PushedHeader } from '@/components/pushed-header';
import { Text } from '@/components/text';
import { HAIRLINE, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { useDirectory } from '@/lib/data/directory';
import { markThreadRead, sendMessage, useMessages, useThreads } from '@/lib/data/messages';

/**
 * The correspondent's uid, read out of the thread id.
 *
 * A thread id is the two uids sorted and joined with `_` — but the uids
 * themselves contain underscores (`demo_003`), so splitting on `_` and taking
 * whichever piece is not yours yields `"demo"`. That matched nobody in the
 * directory, which is why a thread opened from a link was headed "Attendee" and
 * offered to "Say hello to Attendee": not a race with the directory load, a
 * mis-parse that never resolved. Stripping your own uid off whichever end it
 * sits on leaves the other one whole, whatever it contains.
 *
 * Only needed when the screen was opened cold; every in-app route passes `to`.
 */
function otherFromThreadId(threadId?: string, uid?: string): string {
  if (!threadId || !uid) return '';
  if (threadId.startsWith(`${uid}_`)) return threadId.slice(uid.length + 1);
  if (threadId.endsWith(`_${uid}`)) return threadId.slice(0, -(uid.length + 1));
  return '';
}

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
  const { people, error: peopleError } = useDirectory();
  const { threads } = useThreads(user?.uid);
  const { messages, error, retry } = useMessages(threadId);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList>(null);

  // Derive the other participant from the id when it was not passed in.
  const other = to ?? otherFromThreadId(threadId, user?.uid);
  // `people` is `undefined` until the directory listener delivers, which on a
  // cold open of a link to this screen is a second or two. Titling the header
  // "Attendee" in the meantime states, wrongly and confidently, that the name
  // is unknown; an empty title says only that it has not arrived yet.
  // A refused directory read leaves `people` null forever, which held the header
  // title at the empty string permanently — a conversation with nobody. Falling
  // back to "Attendee" is at least a visible placeholder rather than a blank.
  const name = people
    ? (people.find((p) => p.uid === other)?.name ?? 'Attendee')
    : peopleError
      ? 'Attendee'
      : '';

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
      {/* `backHref` is the inbox rather than wherever this was opened from: a
          thread reached by link has no history at all, and the inbox is the one
          screen that certainly lists it. */}
      <PushedHeader title={name} backTitle="Messages" backHref="/messages" />
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
            // A thread reached from a profile genuinely has no messages, which is
            // why this screen's empty state is an invitation. Over a refused read
            // the same invitation appears above a conversation that already
            // exists, and the reply the other person is waiting for is written as
            // though it were the first thing ever said.
            error ? (
              <DataError error={error} subject="this conversation" onRetry={retry} />
            ) : (
              <EmptyState
                icon="envelope"
                title={`Say hello to ${name}`}
                message="Messages are private between the two of you."
              />
            )
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
