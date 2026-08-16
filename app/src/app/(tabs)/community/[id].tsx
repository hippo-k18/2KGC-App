import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';

import { COLLECTIONS, type CommunityPostDoc, type WithId } from '@kgc/shared';

import { EmptyState } from '@/components/empty-state';
import { Text } from '@/components/text';
import { HAIRLINE, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import {
  addReply,
  categoryLabel,
  editPost,
  toggleReaction,
  useMyReactions,
  useReplies,
} from '@/lib/data/community';
import { getDb } from '@/lib/firebase/client';

type Post = WithId<CommunityPostDoc>;

/** A thread: the post, its replies, and a composer pinned to the keyboard. */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useTheme();
  const { user } = useAuth();

  const [post, setPost] = useState<Post | null>(null);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');

  const replies = useReplies(id);
  const reacted = useMyReactions(user?.uid, id ? [id] : []);

  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(getDb(), COLLECTIONS.communityPosts, id), (snap) => {
      if (!snap.exists()) return setMissing(true);
      setPost({ id: snap.id, ...snap.data() } as Post);
    });
  }, [id]);

  if (missing) {
    return <EmptyState icon="trash" title="Post removed" />;
  }
  if (!post) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  const mine = post.authorId === user?.uid;
  const iReacted = reacted.has(post.id);

  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: '', headerBackTitle: 'Community' }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={{ padding: Spacing.md, gap: Spacing.md }}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: Radius.lg,
              padding: Spacing.md,
              gap: Spacing.sm,
            }}>
            <Text variant="label" tone="tint">
              {categoryLabel(post.category).toUpperCase()}
            </Text>

            {editing ? (
              <>
                <TextInput
                  value={editTitle}
                  onChangeText={setEditTitle}
                  style={{ fontSize: 20, fontWeight: '600', color: colors.text }}
                  accessibilityLabel="Edit title"
                />
                <TextInput
                  value={editBody}
                  onChangeText={setEditBody}
                  multiline
                  style={{ fontSize: 17, color: colors.text, minHeight: 90, textAlignVertical: 'top' }}
                  accessibilityLabel="Edit body"
                />
                <View style={{ flexDirection: 'row', gap: Spacing.md }}>
                  <Pressable onPress={() => setEditing(false)} accessibilityRole="button">
                    <Text tone="secondary">Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={async () => {
                      await editPost(post.id, { title: editTitle.trim(), body: editBody.trim() });
                      setEditing(false);
                    }}
                    accessibilityRole="button">
                    <Text tone="tint">Save</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text variant="title3">{post.title}</Text>
                <Text>{post.body}</Text>
                {post.editedAt ? (
                  <Text variant="caption" tone="tertiary">
                    Edited
                  </Text>
                ) : null}
              </>
            )}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingTop: 4 }}>
              <Pressable
                onPress={() => user && toggleReaction(post.id, user.uid, !iReacted)}
                accessibilityRole="button"
                accessibilityLabel={iReacted ? 'Remove your reaction' : 'React to this post'}
                accessibilityState={{ selected: iReacted }}
                hitSlop={8}>
                <Text tone={iReacted ? 'tint' : 'secondary'}>
                  👍 {post.reactionCount}
                </Text>
              </Pressable>

              {/* Editing your own post — Whova cannot, and it is a top complaint. */}
              {mine && !editing ? (
                <Pressable
                  onPress={() => {
                    setEditTitle(post.title);
                    setEditBody(post.body);
                    setEditing(true);
                  }}
                  accessibilityRole="button"
                  hitSlop={8}>
                  <Text tone="tint">Edit</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <Text variant="label" tone="secondary">
            {replies.length} {replies.length === 1 ? 'REPLY' : 'REPLIES'}
          </Text>

          {replies.map((r) => (
            <View
              key={r.id}
              style={{
                backgroundColor: colors.surface,
                borderRadius: Radius.md,
                padding: Spacing.md,
                gap: 4,
              }}>
              <Text>{r.body}</Text>
              {r.authorId === user?.uid ? (
                <Text variant="caption" tone="tertiary">
                  You
                </Text>
              ) : null}
            </View>
          ))}
        </ScrollView>

        <View
          style={{
            flexDirection: 'row',
            gap: Spacing.sm,
            padding: Spacing.md,
            borderTopWidth: HAIRLINE,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Reply"
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Write a reply"
            style={{
              flex: 1,
              backgroundColor: colors.surface,
              borderRadius: Radius.pill,
              paddingHorizontal: 14,
              height: 40,
              fontSize: 17,
              color: colors.text,
            }}
          />
          <Pressable
            disabled={!draft.trim() || !user}
            onPress={async () => {
              if (!user) return;
              const body = draft.trim();
              setDraft('');
              await addReply(post.id, user.uid, body);
            }}
            accessibilityRole="button"
            accessibilityLabel="Send reply"
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
