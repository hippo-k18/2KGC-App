/**
 * Put the first two entries on the public list at dashboard /request (T433):
 * the sponsor offers tick box and the "How did you hear about the conference?"
 * question, both Live. A one-off for the deployer, run on live once; never at
 * build time.
 *
 * Fixed ids, so a second run finds them and changes nothing. Both are written
 * with `emailed.built` and `emailed.live` set, so no status move on the
 * dashboard can ever email anyone about them, and this script sends nothing.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/ops/seed-change-requests.ts            (dry run)
 *   GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/ops/seed-change-requests.ts --apply
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 npx tsx scripts/ops/seed-change-requests.ts --apply
 */
import admin from 'firebase-admin';
import { COLLECTIONS } from '@kgc/shared';
import { CHANGE_REQUEST_SEED, seedChangeRequests } from '../../apps/organizer/src/lib/change-requests-seed';

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
const startedAt = Date.now();
const col = admin.firestore().collection(COLLECTIONS.changeRequests);

const lines = await seedChangeRequests(
  {
    exists: async (id) => (await col.doc(id).get()).exists,
    // `create` fails if the doc appeared since the check, so a race never overwrites.
    create: async (id, doc) => void (await col.doc(id).create(doc)),
  },
  // Timestamps from this script's own firebase-admin, the one the store validates
  // against. A second apart, the sponsor box first, so the list keeps that order.
  { apply, stampFor: (i) => admin.firestore.Timestamp.fromMillis(startedAt - i * 1000) },
);

const text = new Map(CHANGE_REQUEST_SEED.map((s) => [s.id, s.description]));
for (const { id, action } of lines) {
  const what = text.get(id);
  if (action === 'exists') console.log(`${id}: already there, left alone`);
  else if (action === 'would-create') console.log(`${id}: would create "${what}" as Live`);
  else console.log(`${id}: created "${what}" as Live`);
}
console.log(`Project: ${emulator ? `emulator ${emulator}` : PROJECT}. No email is sent by this script.`);
if (!apply) console.log('Dry run. Pass --apply to write.');
