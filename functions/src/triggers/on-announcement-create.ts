import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import type { AnnouncementDoc, UserDoc } from '@kgc/shared';
import { FieldValue, getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

/** Firestore batched writes cap at 500 ops. */
const BATCH_LIMIT = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * `announcements/{id}` — see functions/SPEC.md #7.
 *
 * There is no queryable "is this account registered" field on `users/{uid}`
 * — `registered` is an Auth custom claim, not a Firestore value, and
 * checking it for ~1,000 users would mean ~1,000 Admin Auth lookups. The
 * `users` collection itself is the proxy: a document only exists once
 * `AuthProvider` creates it on a real sign-in, which the sign-in function
 * only ever grants after minting the claim — so every doc this query
 * returns is, by construction, a registered attendee.
 *
 * The notification id is the announcement's own id, not a generated one:
 * a retried dispatch (Cloud Functions retries on a thrown error) `set()`s
 * the same document again rather than duplicating it in 1,000 inboxes.
 *
 * Writes the in-app record only — it does not send FCM. `announcement.push`
 * is read and acted on by `apps/organizer/src/lib/push.ts`'s
 * `announcementPush()`, called from the same server action that creates this
 * document, before this trigger ever fires. That path broadcasts to a topic;
 * this trigger's own multicast-by-token send used to run in parallel with it
 * and would double-deliver to every subscribed device the moment both were
 * live. See functions/SPEC.md decision 11.
 */
export const onAnnouncementCreate = onDocumentCreated(
  `${COLLECTIONS.announcements}/{announcementId}`,
  async (event) => {
    const snap = event.data as QueryDocumentSnapshot | undefined;
    if (!snap) return;

    const announcement = snap.data() as AnnouncementDoc;
    const { announcementId } = event.params;
    const db = getFirestore();

    const usersSnap = await db
      .collection(COLLECTIONS.users)
      .where('eventId', '==', announcement.eventId)
      .get();

    const recipients = usersSnap.docs.filter(
      (d) => (d.data() as UserDoc).notificationPrefs?.announcements === true,
    );

    for (const page of chunk(recipients, BATCH_LIMIT)) {
      const batch = db.batch();
      for (const userDoc of page) {
        batch.set(userDoc.ref.collection(SUBCOLLECTIONS.notifications).doc(announcementId), {
          type: 'announcement',
          title: announcement.title,
          body: announcement.body,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
  },
);
