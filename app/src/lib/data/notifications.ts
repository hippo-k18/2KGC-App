import { useCallback } from 'react';
import { collection, doc, limit, orderBy, query, updateDoc } from 'firebase/firestore';

import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  type NotificationDoc,
  type WithId,
} from '@kgc/shared';

import { useAuth } from '@/lib/auth/auth-provider';
import { useCollection } from '@/lib/data/use-collection';
import { detachWrite } from '@/lib/data/write';
import { getDb } from '@/lib/firebase/client';

export type Notice = WithId<NotificationDoc>;

/**
 * What the organizers have told this attendee: `users/{uid}/notifications`.
 *
 * ── Why this hook did not exist until now ───────────────────────────────────
 *
 * The collection has been modelled, ruled and written about since the first
 * build, and nothing has ever read it — which is exactly why an organizer who
 * moved a keynote could only tell people by posting an announcement to the
 * whole event. The dashboard's session save now writes one of these to
 * everybody who has that session on their schedule, so the home screen has
 * something to show.
 *
 * ── Server-written, owner-read ──────────────────────────────────────────────
 *
 * `firestore.rules` is `allow create, delete: if false` and lets the owner
 * change one field, `read`. So nothing here writes a notice and nothing deletes
 * one: the only client write in this file marks one read, which is what the
 * rule's `hasOnly(['read'])` exists for. A "clear all" would need a delete rule
 * and is not worth one — the list is capped and ordered, and the oldest simply
 * falls off the end.
 */
const PAGE_SIZE = 20;

export function useNotifications() {
  const { user } = useAuth();

  const { data, error, status, retry } = useCollection<Notice>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.users, user?.uid ?? '_', SUBCOLLECTIONS.notifications),
        // Newest first, capped. A `where('read', '==', false)` beside this would
        // need the composite index `firestore.indexes.json` already declares —
        // but a notice does not disappear when it is read, it just stops being
        // marked, so the unread filter belongs in the render and not the query.
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE),
      ),
    [user?.uid],
    (id, d) => ({ id, ...d }) as Notice,
  );

  /**
   * Mark one read. Detached: this fires from a tap that also navigates, and
   * Firestore resolves a write only when the server acknowledges it — awaiting
   * one on conference wifi holds the navigation for seconds, and with no
   * network at all it never resolves, though the mutation is already queued and
   * visible locally.
   */
  const markRead = useCallback(
    (id: string) => {
      if (!user?.uid) return;
      detachWrite(
        'mark notice read',
        updateDoc(
          doc(getDb(), COLLECTIONS.users, user.uid, SUBCOLLECTIONS.notifications, id),
          { read: true },
        ),
      );
    },
    [user?.uid],
  );

  return { notices: data ?? [], error, status, retry, markRead };
}

/** Notices this attendee has not opened yet, newest first. */
export function unreadNotices(notices: Notice[]): Notice[] {
  return notices.filter((n) => !n.read);
}
