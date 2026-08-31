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
  correspondentIn,
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

/*
 * Whova caps direct messages at 100 per 24 hours, and copying that is worth
 * doing — but the constant that used to sit here did not do it. It was exported,
 * documented as a cap, and referenced by nothing: no rule, no client check, no
 * call site. Anyone reading it would have concluded the app was rate-limited.
 *
 * It cannot be enforced from a client at all. A counter the sender increments is
 * a counter the sender can decline to increment, and a rule cannot count a
 * sender's writes across a day without reading a document that only a server can
 * be trusted to maintain. So this belongs with the other Blaze-blocked work
 * rather than in a constant that reads as done.
 *
 * Restore it when there is a function to enforce it, next to the enforcement.
 */

/** How much of a conversation one listener carries. See `useMessages`. */
const MESSAGE_PAGE_SIZE = 50;

export function useThreads(uid: string | undefined) {
  const { data, error, loading, retry } = useCollection<Thread>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.threads),
        where('participantIds', 'array-contains', uid ?? '_'),
        orderBy('lastMessageAt', 'desc'),
      ),
    [uid],
    (id, d) => ({ id, ...d }) as Thread,
  );
  return { threads: data, error, loading, retry };
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
export function useMessages(threadId: string | undefined) {
  const { data, error, retry } = useCollection<Message>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.threads, threadId ?? '_', SUBCOLLECTIONS.messages),
        orderBy('sentAt', 'asc'),
        limitToLast(MESSAGE_PAGE_SIZE),
      ),
    [threadId],
    (id, d) => ({ id, ...d }) as Message,
  );
  // An object, not a bare array. "Say hello to Priya" over a conversation the
  // server refused to send is the same lie an empty agenda was telling.
  return { messages: data ?? [], error, retry };
}

/**
 * Sends a message, creating the thread on first contact.
 *
 * The thread id is the two uids sorted and joined with `_`, so two people who
 * message each other simultaneously converge on one conversation instead of
 * creating two. Membership is *not* derivable from that id — uids here contain
 * the separator — so the rules read `participantIds` off the thread document.
 *
 * The order matters, twice over.
 *
 * This used to `getDoc` the thread first, and a read is the one thing that
 * cannot be queued: with no network it rejects with `unavailable` instead of
 * answering "no such document", so the send failed outright and the attendee's
 * text was already gone from the input. Neither write is awaited before the
 * other is dispatched, because a write promise settles only on server
 * acknowledgement and awaiting one on conference wifi meant the next was never
 * even queued.
 *
 * But the *thread summary must be dispatched first*. The `messages` rule proves
 * membership with `get()` on the parent thread, and `get()` on a document that
 * does not exist returns null — dereferencing `.data.participantIds` on it is a
 * "Null value error", which Firestore reports as `permission-denied`. With the
 * message queued first, every FIRST message to a new contact was rejected: the
 * text bounced back into the composer, while the summary write that followed
 * still created the thread, so the recipient got an inbox row and an unread
 * badge for a message that did not exist. The SDK's mutation queue is FIFO, so
 * dispatching the thread first is enough — it commits before the message is
 * evaluated, without either call being awaited.
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

  const queued = addDoc(collection(threadRef, SUBCOLLECTIONS.messages), {
    senderId: from,
    body: text,
    sentAt: serverTimestamp(),
  });

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

/**
 * Kept returning `uid` on a non-member because several screens render this
 * directly into a title; the shared `correspondentIn()` is the one that answers
 * honestly with `undefined`, and it is what decides membership here.
 */
export function otherParticipant(thread: Thread, uid: string): string {
  return correspondentIn(thread.participantIds, uid) ?? uid;
}

export function totalUnread(threads: Thread[] | null, uid: string | undefined): number {
  if (!threads || !uid) return 0;
  return threads.reduce((sum, t) => sum + (t.unread?.[uid] ?? 0), 0);
}
