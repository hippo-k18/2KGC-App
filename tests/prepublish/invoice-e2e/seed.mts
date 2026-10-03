// Puts the ticket catalogue into the private emulator this suite runs against.
// Refuses to run without FIRESTORE_EMULATOR_HOST, so it can never touch live.
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { TICKET_TYPE_SEED } from '../../../scripts/src/lib/ticket-types.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('seed.mts only runs against an emulator (FIRESTORE_EMULATOR_HOST is unset)');
  process.exit(1);
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'kgc-invoice-e2e' });
const db = getFirestore();
const batch = db.batch();
for (const { id, ...fields } of TICKET_TYPE_SEED) {
  batch.set(db.collection(COLLECTIONS.ticketTypes).doc(id), {
    ...fields,
    eventId: EVENT_ID,
    quantitySold: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}
await batch.commit();
console.log(`[seed] ${TICKET_TYPE_SEED.length} ticket types`);
