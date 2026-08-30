import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import type { AnnouncementDoc, UserDoc } from '@kgc/shared';
import { FieldValue, getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

/** Firestore batched writes cap at 500 ops; FCM multicast caps at 500 tokens. */
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

    if (!announcement.push) return;

    const tokenSnaps = await Promise.all(
      recipients.map((u) => u.ref.collection(SUBCOLLECTIONS.fcmTokens).get()),
    );
    const tokens = tokenSnaps
      .flatMap((s) => s.docs.map((d) => d.data().token as string | undefined))
      .filter((t): t is string => Boolean(t));

    for (const page of chunk(tokens, BATCH_LIMIT)) {
      await getMessaging().sendEachForMulticast({
        tokens: page,
        notification: { title: announcement.title, body: announcement.body },
      });
    }
  },
);
