/**
 * Creates the demo Auth users and stamps their custom claims.
 *
 *   npm run claims -- --emulator
 *   npm run claims -- --confirm-live
 *
 * This is the local stand-in for the `verifyOtp` Cloud Function (WP-02), which
 * cannot be deployed while the project is on Spark. It does the same thing that
 * function will do — look the address up in `registrations`, then set
 * `registered` and `roles` on the account — just from a laptop instead of from
 * GCP.
 *
 * That matters for honesty as much as convenience: `firestore.rules` gates on
 * those claims, so without this the app is testing a different security model
 * than the one that ships. With it, the gate is real.
 */
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { getAuth } from 'firebase-admin/auth';

import { db, targetDescription } from './lib/firestore.js';

/** Password sign-in is only for local demo accounts. Production is OTP. */
const DEMO_PASSWORD = 'kgcdemo2027';

async function main() {
  const live = process.argv.includes('--confirm-live');

  // Both guards, not just the Firestore one. This script's dangerous writes go
  // through Auth — createUser and setCustomUserClaims — which is gated by
  // FIREBASE_AUTH_EMULATOR_HOST, not FIRESTORE_EMULATOR_HOST. Exporting only
  // the Firestore variable (which is exactly what the seed's own error message
  // suggests) would otherwise create 50 real accounts on the live project, with
  // a password that is printed on the login screen, each carrying
  // `registered: true`. That is a complete bypass of the only security boundary
  // in the project.
  const onEmulator =
    Boolean(process.env.FIRESTORE_EMULATOR_HOST) &&
    Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);

  if (!onEmulator && !live) {
    console.error(
      `Refusing to touch accounts on ${targetDescription()} without --confirm-live.\n` +
        'This script writes to Auth, so BOTH emulator hosts must be set:\n' +
        '  export FIRESTORE_EMULATOR_HOST=localhost:8080\n' +
        '  export FIREBASE_AUTH_EMULATOR_HOST=localhost:9099',
    );
    process.exit(1);
  }

  const store = db();
  const auth = getAuth();

  const users = await store
    .collection(COLLECTIONS.users)
    .where('eventId', '==', EVENT_ID)
    .get();

  if (users.empty) {
    console.error('No users found. Run `npm run seed` first.');
    process.exit(1);
  }

  console.log(`Setting claims on ${targetDescription()}\n`);
  let created = 0;
  let updated = 0;

  for (const doc of users.docs) {
    const { email, name, roles } = doc.data() as {
      email: string; name: string; roles: string[];
    };
    const uid = doc.id;

    // The seed writes `users/{uid}` directly, so the Auth account may not exist.
    // Create it with the same uid so the profile and the account line up — the
    // real OTP flow does the reverse (account first, then profile), but the
    // invariant that matters is that they share a uid.
    try {
      await auth.getUser(uid);
      updated++;
    } catch {
      await auth.createUser({ uid, email, displayName: name, password: DEMO_PASSWORD });
      created++;
    }

    // `registered` is the gate. `roles` is a list because a speaker is also an
    // attendee — see the note in models.ts.
    await auth.setCustomUserClaims(uid, {
      registered: true,
      roles: roles ?? ['attendee'],
      eventId: EVENT_ID,
    });
  }

  const organizers = users.docs.filter((d) => (d.data().roles ?? []).includes('organizer'));

  console.log(`  ${created} accounts created, ${updated} already existed`);
  console.log(`  ${users.size} sets of claims written`);
  console.log(`\n  Sign in with any of these and the password: ${DEMO_PASSWORD}`);
  for (const d of users.docs.slice(0, 3)) console.log(`    ${d.data().email}`);
  if (organizers.length) {
    console.log(`\n  Organizer account: ${organizers[0].data().email}`);
  }
  console.log('\n  Claims land in the token at sign-in, so sign out and back in');
  console.log('  after re-running this, or the client keeps the old token for up to an hour.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
