/**
 * Add the two starter merch items to a project (T380): KGC socks $15 and the
 * T-shirt $35 with three designs and sizes S to XXL, both switched off until
 * the prices are confirmed. Creates only what is missing, so it never changes
 * a price an organizer has set or switches an item back off.
 *
 * The dashboard's Ticket Add-ons screen has the same button while the list is
 * empty; this is for doing it from a terminal.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/ops/seed-merch.ts            (dry run)
 *   GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/ops/seed-merch.ts --apply
 *   FIRESTORE_EMULATOR_HOST=localhost:8180 npx tsx scripts/ops/seed-merch.ts --apply
 */
import admin from 'firebase-admin';
import { COLLECTIONS, EVENT_ID, MERCH_SEED } from '@kgc/shared';

const apply = process.argv.includes('--apply');
const PROJECT = process.env.GCLOUD_PROJECT ?? 'kgc-conference-app-and-website';
const emulator = process.env.FIRESTORE_EMULATOR_HOST;

if (!emulator && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS, or FIRESTORE_EMULATOR_HOST for the emulator.');
  process.exit(1);
}

admin.initializeApp(
  emulator ? { projectId: PROJECT } : { credential: admin.credential.applicationDefault(), projectId: PROJECT },
);
const db = admin.firestore();

for (const { id, doc } of MERCH_SEED) {
  const ref = db.collection(COLLECTIONS.merchItems).doc(id);
  if ((await ref.get()).exists) {
    console.log(`${id}: already there, left alone`);
    continue;
  }
  if (!apply) {
    console.log(`${id}: would create ${doc.name} at $${doc.priceCents / 100}, switched off`);
    continue;
  }
  await ref.create({ ...doc, eventId: EVENT_ID, createdAt: new Date(), updatedAt: new Date() });
  console.log(`${id}: created ${doc.name} at $${doc.priceCents / 100}, switched off`);
}
if (!apply) console.log('Dry run. Pass --apply to write.');
