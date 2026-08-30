import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import type { SessionDoc } from '@kgc/shared';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

/** Firestore batched writes cap at 500 ops; FCM multicast caps at 500 tokens. */
const BATCH_LIMIT = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * `sessions/{sessionId}` — see functions/SPEC.md #8.
 *
 * Only fires for a session that *was* published — `before.status` is
 * checked, not `after.status`, so a draft being edited has nobody in
 * `savedSessions` relying on it, while a published→cancelled transition
 * still fires this one last time. And only for the fields that change
 * where, when or whether the session happens — `description`, `slidesUrl`
 * and the cached `speakerNames`/`roomName` are display text, not agenda
 * facts, and editing them must not spam every attendee who saved the talk.
 *
 * No preference gate: `notificationPrefs` has no field for this type and
 * SPEC.md records that as a decision, not a gap — every attendee who saved
 * the session gets notified, unconditionally, including the FCM push.
 *
 * The notification id is the event's own id (stable across a Cloud
 * Functions retry of the *same* delivery), not a generated one — a retry
 * `set()`s the same document again instead of duplicating the notification.
 * It is not `sessionId`, unlike `onAnnouncementCreate`'s use of
 * `announcementId`, because a session can legitimately change again later
 * and each change is its own notification.
 */
export const onSessionAgendaChange = onDocumentUpdated(
  `${COLLECTIONS.sessions}/{sessionId}`,
  async (event) => {
    const change = event.data;
    if (!change) return;

    const before = change.before.data() as SessionDoc;
    const after = change.after.data() as SessionDoc;
    if (before.status !== 'published') return;

    const changed: string[] = [];
    if (before.roomId !== after.roomId) changed.push('room');
    if (before.startsAtLocal !== after.startsAtLocal || before.endsAtLocal !== after.endsAtLocal) {
      changed.push('time');
    }
    if (before.day !== after.day) changed.push('day');
    const cancelled = after.status === 'cancelled';
    if (changed.length === 0 && !cancelled) return;

    const { sessionId } = event.params;
    const db = getFirestore();

    const savedSnap = await db
      .collectionGroup(SUBCOLLECTIONS.savedSessions)
      .where('sessionId', '==', sessionId)
      .get();

    const uids = savedSnap.docs
      .map((d) => d.ref.parent.parent?.id)
      .filter((uid): uid is string => Boolean(uid));
    if (uids.length === 0) return;

    const title = after.title;
    const body = cancelled ? `${title} has been cancelled.` : `${title}'s ${joinWithAnd(changed)} changed.`;
    const href = `/agenda/${sessionId}`;

    for (const page of chunk(uids, BATCH_LIMIT)) {
      const batch = db.batch();
      for (const uid of page) {
        batch.set(
          db.collection(COLLECTIONS.users).doc(uid).collection(SUBCOLLECTIONS.notifications).doc(event.id),
          {
            type: 'agenda-change',
            title,
            body,
            href,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          },
        );
      }
      await batch.commit();
    }

    const tokenSnaps = await Promise.all(
      uids.map((uid) => db.collection(COLLECTIONS.users).doc(uid).collection(SUBCOLLECTIONS.fcmTokens).get()),
    );
    const tokens = tokenSnaps
      .flatMap((s) => s.docs.map((d) => d.data().token as string | undefined))
      .filter((t): t is string => Boolean(t));

    for (const page of chunk(tokens, BATCH_LIMIT)) {
      await getMessaging().sendEachForMulticast({
        tokens: page,
        notification: { title, body },
      });
    }
  },
);
