import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import type { AnnouncementDoc, UserDoc } from '@kgc/shared';
import { FieldValue, getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { TRIGGER } from '../runtime-options.js';

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
 *
 * ⚠️ THIS TRIGGER DOES NOT SEND PUSH, AND MUST NOT. The dashboard owns the
 * announcement push: `announcementPush()` in `apps/organizer/src/lib/push.ts`
 * publishes one FCM message to the event topic, and the per-user
 * `notificationPrefs.announcements` switch is honoured at *subscribe* time, so
 * one call reaches every opted-in device. The version that used to live here
 * gathered every recipient's `fcmTokens` subcollection — a read per attendee,
 * ~1,000 of them — and then sent N multicasts to deliver the same message.
 * Running both, which is what deploying this function next to the dashboard
 * would have done, delivered two notifications to every phone.
 *
 * So the split is: this trigger owns the in-app notification documents (a
 * client write is the only thing that can produce them, and the dashboard
 * cannot see one), the dashboard owns the push. The known cost of that choice
 * is that an announcement created outside the dashboard — a script, the
 * console — writes inboxes but sends no push. That is the correct trade: the
 * dashboard is the only thing that creates announcements today, and a missing
 * push is recoverable in a way that a duplicate push to a thousand phones
 * during a keynote is not. `announcement.push` is now read by the dashboard
 * alone. The reverse decision was made for `onSessionAgendaChange`, which owns
 * its push outright — see that file.
 */
export const onAnnouncementCreate = onDocumentCreated(
  { document: `${COLLECTIONS.announcements}/{announcementId}`, ...TRIGGER },
  async (event) => {
    const snap = event.data as QueryDocumentSnapshot | undefined;
    if (!snap) return;

    // `snap.data()` can be undefined even on a create: the emulator, and a
    // retried delivery in production, materialise the payload by reading the
    // document, and by then it may have been deleted. Without this guard the
    // next line throws `Cannot read properties of undefined`, which the
    // emulator logs as an unhandled crash on every test run — noise that costs
    // nothing here and counts against Cloud Logging ingest once deployed.
    const announcement = snap.data() as AnnouncementDoc | undefined;
    if (!announcement) return;
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
