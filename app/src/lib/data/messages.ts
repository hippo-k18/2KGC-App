import {
  addDoc,
  collection,
  doc,
  increment,
  limitToLast,
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
  threadIdFor,
  type MessageDoc,
  type ThreadDoc,
  type WithId,
} from '@kgc/shared';

import { getDb } from '@/lib/firebase/client';
import { useCollection } from '@/lib/data/use-collection';
import { detachWrite, runWrite, type WriteResult } from '@/lib/data/write';

export type Thread = WithId<ThreadDoc>;
export type Message = WithId<MessageDoc>;

/** Whova caps direct messages at 100 per 24 hours. Worth copying. */
export const DAILY_MESSAGE_LIMIT = 100;

/** How much of a conversation one listener carries. See `useMessages`. */
const MESSAGE_PAGE_SIZE = 50;

export function useThreads(uid: string | undefined) {
  const { data, loading } = useCollection<Thread>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.threads),
        where('participantIds', 'array-contains', uid ?? '_'),
        orderBy('lastMessageAt', 'desc'),
      ),
    [uid],
    (id, d) => ({ id, ...d }) as Thread,
  );
  return { threads: data, loading };
}

/**
 * The tail of a conversation.
 *
 * Capped at the most recent 50: an unbounded listener on a growing
 * subcollection re-reads and re-renders the entire history on every message,
 * and a long-running thread would keep paying for it all week. `limitToLast`
 * with an ascending order rather than `orderBy(desc) + limit` because the
 * single-field index override in `firestore.indexes.json` leaves `sentAt`
 * indexed ascending only — descending would work in the emulator and fail with
 * `failed-precondition` in production.
 *
 * TODO: this is a cap, not pagination. Scrolling back past 50 messages needs a
 * cursor (`endBefore` the oldest loaded doc) before a heavy thread loses
 * history.
 */
export function useMessages(threadId: string | undefined): Message[] {
  const { data } = useCollection<Message>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.threads, threadId ?? '_', SUBCOLLECTIONS.messages),
        orderBy('sentAt', 'asc'),
        limitToLast(MESSAGE_PAGE_SIZE),
      ),
    [threadId],
    (id, d) => ({ id, ...d }) as Message,
  );
  return data ?? [];
}

/**
 * Sends a message, creating the thread on first contact.
 *
 * The thread id is the two uids sorted and joined with `_`, so two people who
 * message each other simultaneously converge on one conversation instead of
 * creating two. That determinism is also what lets the security rules prove
 * membership from the path without reading the parent document — which is why
 * the message can be written before the thread exists.
 *
 * The order matters. This used to `getDoc` the thread first, and a read is the
 * one thing that cannot be queued: with no network it rejects with `unavailable`
 * instead of answering "no such document", so the send failed outright and the
 * attendee's text was already gone from the input. Now the message goes first
 * and the thread summary follows, detached, because a write promise settles only
 * on server acknowledgement and awaiting it on conference wifi meant the message
 * was never even queued.
 */
export async function sendMessage(
  from: string,
  to: string,
  body: string,
): Promise<WriteResult & { threadId: string }> {
  const db = getDb();
  const threadId = threadIdFor(from, to);
  const threadRef = doc(db, COLLECTIONS.threads, threadId);
  const text = body.trim();

  const queued = addDoc(collection(threadRef, SUBCOLLECTIONS.messages), {
    senderId: from,
    body: text,
    sentAt: serverTimestamp(),
  });

  // `setDoc(..., merge)` covers both cases in one write: it creates the thread
  // on first contact and updates the summary afterwards. The rules allow both,
  // because `diff()` reports only the fields whose values actually change, and
  // `eventId`/`participantIds` are rewritten identically.
  //
  // `increment` rather than reading the map and writing it back: three messages
  // sent in quick succession all read 0 and all wrote 1, so two of them
  // disappeared from the badge. The nested value keeps the top-level key set to
  // `unread`, which is what the update rule allows.
  detachWrite(
    'thread summary',
    setDoc(
      threadRef,
      {
        eventId: EVENT_ID,
        participantIds: [from, to].sort(),
        lastMessage: text.slice(0, 140),
        lastMessageAt: serverTimestamp(),
        lastSenderId: from,
        unread: { [from]: 0, [to]: increment(1) },
      },
      { merge: true },
    ),
  );

  return { ...(await runWrite('send message', () => queued)), threadId };
}

/**
 * Clears your own unread count when you open a thread.
 *
 * A dot-path, so the other participant's count is untouched no matter what it
 * was when this device last saw the thread — and the rules still see a single
 * changed key, `unread`. Only meaningful once the thread document exists, so
 * callers should skip it while their own count is already zero rather than take
 * a `not-found` on a conversation that has never been written.
 */
export async function markThreadRead(threadId: string, uid: string): Promise<WriteResult> {
  return runWrite('mark thread read', () =>
    updateDoc(doc(getDb(), COLLECTIONS.threads, threadId), { [`unread.${uid}`]: 0 }),
  );
}

export function otherParticipant(thread: Thread, uid: string): string {
  return thread.participantIds.find((p) => p !== uid) ?? uid;
}

export function totalUnread(threads: Thread[] | null, uid: string | undefined): number {
  if (!threads || !uid) return 0;
  return threads.reduce((sum, t) => sum + (t.unread?.[uid] ?? 0), 0);
}
