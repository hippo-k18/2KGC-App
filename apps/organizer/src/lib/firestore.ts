import 'server-only';

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Admin SDK access for the organizer console.
 *
 * This is a deliberate mirror of `scripts/src/lib/firestore.ts` — same two
 * modes, chosen by environment rather than by a flag, so it is impossible to
 * point the console at production by forgetting an argument:
 *
 *   FIRESTORE_EMULATOR_HOST set  → the local emulator, no credentials needed
 *   otherwise                    → the real project, credentials required
 *
 * The Admin SDK **bypasses `firestore.rules` entirely**. That is the correct
 * posture for an organizer tool — organizers legitimately need to read drafts
 * and write fields no client may touch — and it is exactly why no Firebase
 * credential of any kind may ever reach the browser. Every call site of this
 * module is a server action or a server component; `server-only` above turns a
 * mistaken client import into a build error rather than a leak.
 */
export function db(): Firestore {
  if (!getApps().length) {
    const emulator = process.env.FIRESTORE_EMULATOR_HOST;
    const projectId = process.env.GCLOUD_PROJECT ?? 'kgc-database';

    if (emulator) {
      initializeApp({ projectId });
    } else {
      const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (!keyPath) {
        throw new Error(
          'Refusing to run the console against the real project without credentials.\n' +
            'Either:\n' +
            '  export FIRESTORE_EMULATOR_HOST=localhost:8080   (safe, local)\n' +
            '  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json',
        );
      }
      initializeApp({ credential: cert(keyPath), projectId });
    }

    // Same reason as the scripts: many model fields are genuinely optional
    // (`roomId` on a session with no room yet), and without this the Admin SDK
    // rejects the whole write rather than omitting the key.
    getFirestore().settings({ ignoreUndefinedProperties: true });
  }
  return getFirestore();
}

export function targetDescription(): string {
  return process.env.FIRESTORE_EMULATOR_HOST
    ? `emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`
    : `PROJECT ${process.env.GCLOUD_PROJECT ?? 'kgc-database'} (LIVE)`;
}
