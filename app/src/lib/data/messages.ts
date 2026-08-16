import { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  getDoc,
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
  threadIdFor,
  type MessageDoc,
  type ThreadDoc,
  type WithId,
} from '@kgc/shared';

import { getDb } from '@/lib/firebase/client';
import { useCollection } from '@/lib/data/use-collection';

export type Thread = WithId<ThreadDoc>;
export type Message = WithId<MessageDoc>;

/** Whova caps direct messages at 100 per 24 hours. Worth copying. */
export const DAILY_MESSAGE_LIMIT = 100;

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

export function useMessages(threadId: string | undefined): Message[] {
  const { data } = useCollection<Message>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.threads, threadId ?? '_', SUBCOLLECTIONS.messages),
        orderBy('sentAt', 'asc'),
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
 * membership from the path without reading the parent document.
 */
export async function sendMessage(from: string, to: string, body: string) {
  const db = getDb();
  const threadId = threadIdFor(from, to);
  const threadRef = doc(db, COLLECTIONS.threads, threadId);

  const existing = await getDoc(threadRef);
  if (!existing.exists()) {
    await setDoc(threadRef, {
      eventId: EVENT_ID,
      participantIds: [from, to].sort(),
      unread: { [from]: 0, [to]: 0 },
    });
  }

  await addDoc(collection(threadRef, SUBCOLLECTIONS.messages), {
    senderId: from,
    body: body.trim(),
    sentAt: serverTimestamp(),
  });

  // The unread counter is a per-thread map the rules allow participants to
  // write, unlike the community counters — there are exactly two writers and
  // they are both named in the document.
  const current = existing.exists() ? (existing.data() as ThreadDoc) : null;
  await updateDoc(threadRef, {
    lastMessage: body.trim().slice(0, 140),
    lastMessageAt: serverTimestamp(),
    lastSenderId: from,
    unread: {
      [from]: 0,
      [to]: (current?.unread?.[to] ?? 0) + 1,
    },
  });

  return threadId;
}

/** Clears your own unread count when you open a thread. */
export async function markThreadRead(threadId: string, uid: string, other: string, otherUnread: number) {
  await updateDoc(doc(getDb(), COLLECTIONS.threads, threadId), {
    unread: { [uid]: 0, [other]: otherUnread },
  });
}

export function otherParticipant(thread: Thread, uid: string): string {
  return thread.participantIds.find((p) => p !== uid) ?? uid;
}

export function totalUnread(threads: Thread[] | null, uid: string | undefined): number {
  if (!threads || !uid) return 0;
  return threads.reduce((sum, t) => sum + (t.unread?.[uid] ?? 0), 0);
}
