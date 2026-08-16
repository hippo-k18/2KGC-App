import { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  type CommunityPostDoc,
  type CommunityReplyDoc,
  type WithId,
} from '@kgc/shared';

import { getDb } from '@/lib/firebase/client';
import { useCollection } from '@/lib/data/use-collection';

export type Post = WithId<CommunityPostDoc>;
export type Reply = WithId<CommunityReplyDoc>;

export const CATEGORIES = [
  { id: 'meetup', label: 'Meet-ups' },
  { id: 'ride-share', label: 'Travel' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'questions', label: 'Questions' },
  { id: 'lost-and-found', label: 'Lost & found' },
  { id: 'ice-breakers', label: 'Ice breakers' },
] as const;

export const categoryLabel = (id: string) =>
  CATEGORIES.find((c) => c.id === id)?.label ?? id;

export function useCommunityPosts(category: string | null) {
  const { data, error, loading } = useCollection<Post>(
    () => {
      const base = [
        where('eventId', '==', EVENT_ID),
        where('status', '==', 'visible'),
      ];
      return category
        ? query(
            collection(getDb(), COLLECTIONS.communityPosts),
            ...base,
            where('category', '==', category),
            orderBy('createdAt', 'desc'),
          )
        : query(
            collection(getDb(), COLLECTIONS.communityPosts),
            ...base,
            orderBy('createdAt', 'desc'),
          );
    },
    [category],
    (id, d) => ({ id, ...d }) as Post,
  );
  return { posts: data, error, loading };
}

export function useReplies(postId: string | undefined): Reply[] {
  const { data } = useCollection<Reply>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.communityPosts, postId ?? '_', SUBCOLLECTIONS.replies),
        orderBy('createdAt', 'asc'),
      ),
    [postId],
    (id, d) => ({ id, ...d }) as Reply,
  );
  return data ?? [];
}

export async function createPost(input: {
  authorId: string;
  category: string;
  title: string;
  body: string;
}) {
  // `replyCount` and `reactionCount` start at zero and are never written again
  // from a client — a Cloud Function trigger owns them. The security rules
  // reject a create that arrives pre-counted.
  await addDoc(collection(getDb(), COLLECTIONS.communityPosts), {
    ...input,
    eventId: EVENT_ID,
    status: 'visible',
    replyCount: 0,
    reactionCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Editing your own post — which Whova does not allow, and which is one of the
 * most common complaints about it.
 */
export async function editPost(postId: string, patch: { title: string; body: string }) {
  await updateDoc(doc(getDb(), COLLECTIONS.communityPosts, postId), {
    ...patch,
    editedAt: serverTimestamp(),
  });
}

export async function addReply(postId: string, authorId: string, body: string) {
  await addDoc(
    collection(getDb(), COLLECTIONS.communityPosts, postId, SUBCOLLECTIONS.replies),
    { authorId, body, createdAt: serverTimestamp() },
  );
}

/**
 * One document per reacting user, keyed by uid, so a client can only ever add
 * or remove its own. The aggregate count is a function's job.
 */
export async function toggleReaction(postId: string, uid: string, on: boolean) {
  const ref = doc(
    getDb(),
    COLLECTIONS.communityPosts,
    postId,
    SUBCOLLECTIONS.reactions,
    uid,
  );
  if (on) {
    await setDoc(ref, { uid, emoji: '👍', createdAt: serverTimestamp() });
  } else {
    await deleteDoc(ref);
  }
}

/** Which posts the signed-in user has reacted to. */
export function useMyReactions(uid: string | undefined, postIds: string[]) {
  const [reacted, setReacted] = useState<Set<string>>(new Set());
  const key = postIds.join(',');

  useEffect(() => {
    if (!uid || !postIds.length) return;
    const unsubs = postIds.map((postId) =>
      onSnapshot(
        doc(getDb(), COLLECTIONS.communityPosts, postId, SUBCOLLECTIONS.reactions, uid),
        (snap) => {
          setReacted((prev) => {
            const next = new Set(prev);
            if (snap.exists()) next.add(postId);
            else next.delete(postId);
            return next;
          });
        },
      ),
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key]);

  return reacted;
}
