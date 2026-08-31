import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { doc } from 'firebase/firestore';

import { COLLECTIONS, type CommunityPostDoc, type WithId } from '@kgc/shared';

import { DataError, DataErrorBanner } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { PushedHeader } from '@/components/pushed-header';
import { SkeletonBlock, SkeletonScreen, SkeletonText } from '@/components/skeleton';
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
  useReactionCounts,
  useReplies,
} from '@/lib/data/community';
import { useDocument } from '@/lib/data/use-document';
import { getDb } from '@/lib/firebase/client';

type Post = WithId<CommunityPostDoc>;

/** A thread: the post, its replies, and a composer pinned to the keyboard. */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useTheme();
  const { user } = useAuth();

  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');

  // `useDocument` rather than a bare `onSnapshot`. The listener this replaces had
  // no error callback at all, which is the one omission that unmounts the whole
  // app: the SDK rethrows asynchronously, so a refused read of one post took the
  // tab bar with it. And with no error state, a denial left `post` null forever —
  // the screen below sat on a blank body under a back button, indefinitely, with
  // no way to tell that apart from a slow load.
  const {
    data: post,
    status: postStatus,
    error: postError,
    retry: retryPost,
  } = useDocument<Post>(
    () => (id ? doc(getDb(), COLLECTIONS.communityPosts, id) : null),
    [id],
    (docId, d) => ({ id: docId, ...d }) as Post,
  );
  // Settled and absent, which is different from settled and refused.
  const missing = postStatus === 'ready' && !post;

  const { replies, error: repliesError, retry: retryReplies } = useReplies(id);
  const reacted = useMyReactions(user?.uid, id ? [id] : []);
  // `post.reactionCount` is trigger-owned and nothing has ever incremented it,
  // so this screen printed "👍 0" however many people had reacted. Counted
  // instead — one aggregation, because there is one post here.
  const { counts: likes, adjust: adjustLikes } = useReactionCounts(post ? [post] : null);

  // Above the early returns — see the note in `agenda/[id].tsx`.
  const header = <PushedHeader backTitle="Community" backHref="/community" />;

  if (postError) {
    return (
      <>
        {header}
        <DataError error={postError} subject="this topic" onRetry={retryPost} />
      </>
    );
  }
  if (missing) {
    return (
      <>
        {header}
        <EmptyState icon="trash" title="Post removed" />
      </>
    );
  }
  if (!post) {
    // Post-shaped, not blank — see `agenda/[id].tsx`. The card and the replies
    // heading are drawn where they will be, so the thread does not shift under a
    // thumb that is already reaching for it.
    return (
      <>
        {header}
        <View style={{ flex: 1, backgroundColor: colors.background, padding: Spacing.md }}>
          <SkeletonScreen
            label="this topic"
            slowNotice="Still loading. The app cannot reach the server — this will fill in as soon as it can.">
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: Radius.lg,
                padding: Spacing.md,
                gap: Spacing.sm,
              }}>
              <SkeletonBlock width="30%" height={12} />
              <SkeletonBlock width="85%" height={22} />
              <SkeletonText lines={3} />
            </View>
            <SkeletonBlock width="25%" height={12} />
            <SkeletonBlock height={64} radius={Radius.md} />
          </SkeletonScreen>
        </View>
      </>
    );
  }

  const mine = post.authorId === user?.uid;
  const iReacted = reacted.has(post.id);

  return (
    <>
      {header}
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
                onPress={async () => {
                  if (!user) return;
                  const on = !iReacted;
                  const result = await toggleReaction(post.id, user.uid, on);
                  // Moved only on a write that landed. The thumb itself is a
                  // live listener on the reader's own document and needs no
                  // help; the total does, because nothing it listens to changes.
                  if (result.ok) adjustLikes(post.id, on ? 1 : -1);
                }}
                accessibilityRole="button"
                accessibilityLabel={iReacted ? 'Remove your reaction' : 'React to this post'}
                accessibilityState={{ selected: iReacted }}
                hitSlop={8}>
                <Text tone={iReacted ? 'tint' : 'secondary'}>
                  {/* A dash until the count arrives — see `useSubcollectionCounts`. */}
                  👍 {likes?.[post.id] ?? '—'}
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

          {/* The count below is drawn from the loaded page, so a refused read
              renders a confident "0 REPLIES" over a discussion. */}
          {repliesError ? (
            <DataErrorBanner
              error={repliesError}
              subject="the replies to this topic"
              onRetry={retryReplies}
            />
          ) : (
            <Text variant="label" tone="secondary">
              {replies.length} {replies.length === 1 ? 'REPLY' : 'REPLIES'}
            </Text>
          )}

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
