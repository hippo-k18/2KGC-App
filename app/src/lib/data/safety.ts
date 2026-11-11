import { useMemo } from 'react';
import { collection, deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  reportId,
  reportTargetKey,
  reportTargetPath,
  type ReportReason,
  type ReportTarget,
} from '@kgc/shared';

import { useAuth } from '@/lib/auth/auth-provider';
import { getDb } from '@/lib/firebase/client';
import { useCollection } from '@/lib/data/use-collection';
import { runWrite, type WriteResult } from '@/lib/data/write';

/**
 * Report and block (App Store guideline 1.2).
 *
 * A block is `users/{me}/blocks/{them}`, private to me. The app hides their
 * posts, replies, messages and profile from me, and `firestore.rules` refuses
 * any new conversation or message between us in either direction, so the
 * hiding is a convenience and the rules are the guarantee.
 *
 * A report is `reports/{me}__{targetKey}`, which only the dashboard can read.
 * Filing the same report twice is refused by the rules, because the second
 * write lands on a document that already exists.
 */

/** Everyone I have blocked, as a set of uids. Empty while it loads. */
export function useBlocked(): { blocked: ReadonlySet<string>; ready: boolean } {
  const { user } = useAuth();
  const uid = user?.uid;
  const { data } = useCollection<string>(
    () => (uid ? collection(getDb(), COLLECTIONS.users, uid, SUBCOLLECTIONS.blocks) : null),
    [uid],
    (id) => id,
  );
  const blocked = useMemo(() => new Set(data ?? []), [data]);
  return { blocked, ready: data !== null };
}

export function blockUser(me: string, them: string): Promise<WriteResult> {
  return runWrite('block user', () =>
    setDoc(doc(getDb(), COLLECTIONS.users, me, SUBCOLLECTIONS.blocks, them), {
      blockedUid: them,
      createdAt: serverTimestamp(),
    }),
  );
}

export function unblockUser(me: string, them: string): Promise<WriteResult> {
  return runWrite('unblock user', () =>
    deleteDoc(doc(getDb(), COLLECTIONS.users, me, SUBCOLLECTIONS.blocks, them)),
  );
}

export function fileReport(input: {
  reporterId: string;
  target: ReportTarget;
  reason: ReportReason;
  note?: string;
  targetAuthorId?: string;
}): Promise<WriteResult> {
  const note = input.note?.trim();
  return runWrite('report', () =>
    setDoc(doc(getDb(), COLLECTIONS.reports, reportId(input.reporterId, input.target)), {
      eventId: EVENT_ID,
      reporterId: input.reporterId,
      targetType: input.target.type,
      targetKey: reportTargetKey(input.target),
      targetPath: reportTargetPath(input.target),
      ...(input.targetAuthorId ? { targetAuthorId: input.targetAuthorId } : {}),
      reason: input.reason,
      ...(note ? { note: note.slice(0, 500) } : {}),
      status: 'open',
      createdAt: serverTimestamp(),
    }),
  );
}
