import { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  limitToLast,
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
import { runWrite, type WriteResult } from '@/lib/data/write';

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

/**
 * How much of the board one listener carries.
 *
 * The board grows all week and a listener with no bound re-reads every post on
 * every change, on every device. Fifty is more than fits on a phone screen.
 *
 * TODO: a cap is not pagination. Reaching the end of the list needs a
 * `startAfter` cursor before the board outgrows one page — until then the
 * oldest posts are simply unreachable.
 */
const PAGE_SIZE = 50;

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
            limit(PAGE_SIZE),
          )
        : query(
            collection(getDb(), COLLECTIONS.communityPosts),
            ...base,
            orderBy('createdAt', 'desc'),
            limit(PAGE_SIZE),
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
        // The most recent page, still in reading order — see `PAGE_SIZE`.
        limitToLast(PAGE_SIZE),
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
}): Promise<WriteResult> {
  // `replyCount` and `reactionCount` start at zero and are never written again
  // from a client — a Cloud Function trigger owns them. The security rules
  // reject a create that arrives pre-counted.
  return runWrite('create post', () =>
    addDoc(collection(getDb(), COLLECTIONS.communityPosts), {
      ...input,
      eventId: EVENT_ID,
      status: 'visible',
      replyCount: 0,
      reactionCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
}

/**
 * Editing your own post — which Whova does not allow, and which is one of the
 * most common complaints about it.
 */
export async function editPost(
  postId: string,
  patch: { title: string; body: string },
): Promise<WriteResult> {
  return runWrite('edit post', () =>
    updateDoc(doc(getDb(), COLLECTIONS.communityPosts, postId), {
      ...patch,
      editedAt: serverTimestamp(),
    }),
  );
}

export async function addReply(
  postId: string,
  authorId: string,
  body: string,
): Promise<WriteResult> {
  return runWrite('add reply', () =>
    addDoc(collection(getDb(), COLLECTIONS.communityPosts, postId, SUBCOLLECTIONS.replies), {
      authorId,
      body,
      createdAt: serverTimestamp(),
    }),
  );
}

/**
 * One document per reacting user, keyed by uid, so a client can only ever add
 * or remove its own. The aggregate count is a function's job.
 */
export async function toggleReaction(
  postId: string,
  uid: string,
  on: boolean,
): Promise<WriteResult> {
  const ref = doc(
    getDb(),
    COLLECTIONS.communityPosts,
    postId,
    SUBCOLLECTIONS.reactions,
    uid,
  );
  return runWrite('toggle reaction', () =>
    on ? setDoc(ref, { uid, emoji: '👍', createdAt: serverTimestamp() }) : deleteDoc(ref),
  );
}

/**
 * Which posts the signed-in user has reacted to.
 *
 * One listener per visible post, which is bounded by `PAGE_SIZE` above. A
 * single `collectionGroup('reactions').where('uid', '==', uid)` listener would
 * replace all of them, and should — but `firestore.rules` matches reactions only
 * under `communityPosts/{postId}`, and a collection group query with no
 * `/{path=**}/reactions/{uid}` rule is denied outright. Until that rule exists,
 * each listener carries its own error callback (an omitted one unmounts the
 * tree) and a mounted flag, because these fan out far enough that a snapshot
 * arriving after the screen closes is routine rather than theoretical.
 */
export function useMyReactions(uid: string | undefined, postIds: string[]) {
  const [reacted, setReacted] = useState<Set<string>>(new Set());
  const key = postIds.join(',');

  useEffect(() => {
    // Cleared on resubscribe: switching category must not carry the previous
    // list's reactions over onto whatever post ids happen to line up.
    setReacted(new Set());
    if (!uid || !postIds.length) return;

    let mounted = true;
    const unsubs = postIds.map((postId) =>
      onSnapshot(
        doc(getDb(), COLLECTIONS.communityPosts, postId, SUBCOLLECTIONS.reactions, uid),
        (snap) => {
          if (!mounted) return;
          setReacted((prev) => {
            const next = new Set(prev);
            if (snap.exists()) next.add(postId);
            else next.delete(postId);
            return next;
          });
        },
        (e) => {
          // Signing out denies every live listener before cleanup runs. Whether
          // a thumb is filled in is not worth taking the app down for.
          console.warn('[firestore] reaction listener failed:', e.message);
        },
      ),
    );
    return () => {
      mounted = false;
      unsubs.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key]);

  return reacted;
}
