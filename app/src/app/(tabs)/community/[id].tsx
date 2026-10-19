import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { doc } from 'firebase/firestore';

import {
  DELETED_USER_ID,
  DELETED_USER_NAME,
  COLLECTIONS,
  WORD_FILTER_MESSAGE,
  findBlockedWord,
  type CommunityPostDoc,
  type WithId,
} from '@kgc/shared';

import { webSlop } from '@/components/a11y';
import { DataError, DataErrorBanner } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { PushedHeader } from '@/components/pushed-header';
import { SafetyMenu } from '@/components/safety-sheet';
import { SkeletonBlock, SkeletonScreen, SkeletonText } from '@/components/skeleton';
import { Text } from '@/components/text';
import { HAIRLINE, HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { useAppAccess } from '@/lib/data/app-access';
import {
  addReply,
  categoryLabel,
  editPost,
  toggleReaction,
  useMyReactions,
  useReactionCounts,
  useReplies,
} from '@/lib/data/community';
import { useDirectory } from '@/lib/data/directory';
import { useBlocked } from '@/lib/data/safety';
import { useDocument } from '@/lib/data/use-document';
import { getDb } from '@/lib/firebase/client';

import { relative } from './index';

type Post = WithId<CommunityPostDoc>;

/**
 * Slop around the thumb and Edit, which are drawn as bare text at 22pt.
 *
 * 11 each side rather than 8: `webSlop` has to take the browser target to 44
 * on its own, and 22 + 8 + 8 is 38.
 */
const REACTION_SLOP = { top: 11, bottom: 11, left: 11, right: 11 };

/** A thread: the post, its replies, and a composer pinned to the keyboard. */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useTheme();
  const { user } = useAuth();
  const { writesOpen } = useAppAccess();

  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  /** The word filter's refusal, shown above whichever box was refused. */
  const [filterError, setFilterError] = useState<string | null>(null);
  const { blocked } = useBlocked();

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

  const { replies: allReplies, error: repliesError, retry: retryReplies } = useReplies(id);
  // Replies from people I blocked are left out, count included.
  const replies = useMemo(
    () => allReplies.filter((r) => !blocked.has(r.authorId)),
    [allReplies, blocked],
  );
  /** A deleted account can still be reported, but there is nobody left to block. */
  const blockable = (authorId: string) => (authorId === DELETED_USER_ID ? undefined : authorId);
  /*
   * Names for the bylines, from the same projection the People list reads.
   *
   * Three people answering a question all arrived as the same anonymous voice,
   * and only your own reply carried a label. An attendee who has opted out of
   * the directory has no document here at all, which is the whole point of that
   * projection, so their reply stays unnamed rather than being named from some
   * other collection.
   */
  const { people } = useDirectory();
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of people ?? []) map.set(p.uid, p.name);
    return map;
  }, [people]);
  const byline = (authorId: string | undefined, at: Parameters<typeof relative>[0]) => {
    const who =
      authorId && authorId === user?.uid
        ? 'You'
        : authorId === DELETED_USER_ID
          ? DELETED_USER_NAME
          : (names.get(authorId ?? '') ?? 'Attendee');
    return `${who} · ${relative(at)}`;
  };
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
            slowNotice="Still loading. Check your connection.">
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

  if (blocked.has(post.authorId)) {
    return (
      <>
        {header}
        <EmptyState
          icon="person.slash"
          title="You blocked this person"
          message="Their posts are hidden from you. You can unblock them from their profile."
        />
      </>
    );
  }

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
                      if (findBlockedWord(editTitle) || findBlockedWord(editBody)) {
                        setFilterError(WORD_FILTER_MESSAGE);
                        return;
                      }
                      setFilterError(null);
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
                <Text variant="caption" tone="tertiary">
                  {byline(post.authorId, post.createdAt)}
                </Text>
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
                hitSlop={REACTION_SLOP}
                style={{ justifyContent: 'center', ...webSlop({}, REACTION_SLOP) }}>
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
                  hitSlop={REACTION_SLOP}
                  style={{ justifyContent: 'center', ...webSlop({}, REACTION_SLOP) }}>
                  <Text tone="tint">Edit</Text>
                </Pressable>
              ) : null}
              <View style={{ flex: 1 }} />
              <SafetyMenu
                target={{ type: 'communityPost', postId: post.id }}
                authorId={blockable(post.authorId)}
                authorName={names.get(post.authorId)}
                subject="this post"
              />
            </View>
            {filterError && editing ? (
              <Text variant="subhead" tone="danger" accessibilityLiveRegion="polite">
                {filterError}
              </Text>
            ) : null}
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

          {/*
            A heading with nothing under it. "0 REPLIES" over 500pt of empty
            grey said only that the screen had finished loading; it did not say
            that the thread is open and that a reply is the next thing to do.
            Suppressed when the read failed, because the banner above already
            holds the floor.
          */}
          {!repliesError && replies.length === 0 ? (
            <Text tone="secondary">
              {writesOpen ? 'No replies yet. Be the first.' : 'No replies.'}
            </Text>
          ) : null}

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
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text variant="caption" tone="tertiary" style={{ flex: 1 }}>
                  {byline(r.authorId, r.createdAt)}
                </Text>
                <SafetyMenu
                  target={{ type: 'reply', postId: post.id, replyId: r.id }}
                  authorId={blockable(r.authorId)}
                  authorName={names.get(r.authorId)}
                  subject="this reply"
                />
              </View>
            </View>
          ))}
        </ScrollView>

        {/*
          The reply box goes when the event does. `firestore.rules` refuses the
          write past the read-only boundary, so a box that still accepted a
          reply here would take what somebody typed and drop it.
        */}
        {writesOpen && filterError && !editing ? (
          <Text
            variant="subhead"
            tone="danger"
            accessibilityLiveRegion="polite"
            style={{ paddingHorizontal: Spacing.md, paddingTop: Spacing.sm }}>
            {filterError}
          </Text>
        ) : null}
        {writesOpen ? (
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
              height: HIT_TARGET,
              fontSize: 17,
              color: colors.text,
            }}
          />
          <Pressable
            disabled={!draft.trim() || !user}
            onPress={async () => {
              if (!user) return;
              const body = draft.trim();
              if (findBlockedWord(body)) {
                setFilterError(WORD_FILTER_MESSAGE);
                return;
              }
              setFilterError(null);
              setDraft('');
              const result = await addReply(post.id, user.uid, body);
              // Put back what was typed rather than lose it to a refused write.
              if (!result.ok) setDraft((current) => current || body);
            }}
            accessibilityRole="button"
            accessibilityLabel="Send reply"
            style={{
              justifyContent: 'center',
              alignItems: 'center',
              minWidth: HIT_TARGET,
              opacity: draft.trim() ? 1 : 0.4,
            }}>
            <Text variant="heading" tone="tint">
              Send
            </Text>
          </Pressable>
        </View>
        ) : (
          <View
            style={{
              padding: Spacing.md,
              borderTopWidth: HAIRLINE,
              borderTopColor: colors.border,
              backgroundColor: colors.background,
            }}>
            <Text variant="subhead" tone="secondary">
              The event is over. The board is still here to read.
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </>
  );
}
