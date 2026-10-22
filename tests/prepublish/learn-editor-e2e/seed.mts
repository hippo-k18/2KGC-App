// Puts the owner's session epoch and two learn-only members into the private
// emulator this suite runs against. Refuses to run without
// FIRESTORE_EMULATOR_HOST, so it can never touch live.
import { randomBytes } from 'node:crypto';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { memberIdFor } from '../../../apps/organizer/src/lib/team-core.ts';
import { OWNER, MEMBERS, ownerSessionId } from './people.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('seed.mts only runs against an emulator (FIRESTORE_EMULATOR_HOST is unset)');
  process.exit(1);
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-learn-editor-e2e' });
const db = getFirestore();
await db
  .collection(COLLECTIONS.ownerSessions)
  .doc(ownerSessionId(OWNER))
  .set({ epoch: randomBytes(16).toString('hex'), updatedAt: new Date() });
for (const email of MEMBERS) {
  await db.collection(COLLECTIONS.teamMembers).doc(memberIdFor(email)).set({
    email,
    name: email.split('@')[0],
    roles: ['learn'],
    status: 'active',
    sessionEpoch: randomBytes(16).toString('hex'),
    eventId: EVENT_ID,
    invitedBy: OWNER,
    updatedBy: OWNER,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}
console.log(`[seed] owner epoch and ${MEMBERS.length} learn-only members`);
