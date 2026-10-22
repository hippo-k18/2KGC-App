// The owner's session epoch, a learn-only member and an agenda-only member, in
// the private emulator this suite runs against. Refuses to run without
// FIRESTORE_EMULATOR_HOST, so it can never touch live.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { COLLECTIONS, EVENT_ID, LEARN_LIBRARY_SAMPLE, LEARN_PAGE_KITCHEN_SINK_V2 } from '@kgc/shared';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { memberIdFor } from '../../../apps/organizer/src/lib/team-core.ts';
import { AGENDA, LEARN, OWNER, ownerSessionId } from './people.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST || !/^(127\.0\.0\.1|localhost):8323$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  console.error('seed.mts only runs against the private emulator on 8323');
  process.exit(1);
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-learn-v2-e2e' });
const db = getFirestore();
await db
  .collection(COLLECTIONS.ownerSessions)
  .doc(ownerSessionId(OWNER))
  .set({ epoch: randomBytes(16).toString('hex'), updatedAt: new Date() });
for (const [email, roles] of [
  [LEARN, ['learn']],
  [AGENDA, ['agenda']],
] as const) {
  await db.collection(COLLECTIONS.teamMembers).doc(memberIdFor(email)).set({
    email,
    name: email.split('@')[0],
    roles: [...roles],
    status: 'active',
    sessionEpoch: randomBytes(16).toString('hex'),
    eventId: EVENT_ID,
    invitedBy: OWNER,
    updatedBy: OWNER,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}
// The spec cannot import @kgc/shared's TypeScript, so the samples it needs are written beside it.
writeFileSync(
  new URL('./.fixtures.json', import.meta.url),
  JSON.stringify({ sink: LEARN_PAGE_KITCHEN_SINK_V2, library: LEARN_LIBRARY_SAMPLE }),
);
console.log('[seed] owner epoch, a learn-only and an agenda-only member');
