import 'server-only';

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Admin SDK access for the public website.
 *
 * A deliberate mirror of `apps/console/src/lib/firestore.ts` and
 * `scripts/src/lib/firestore.ts` — the same two modes, chosen by environment
 * rather than by a flag, so it is impossible to point this at production by
 * forgetting an argument:
 *
 *   FIRESTORE_EMULATOR_HOST set  → the local emulator, no credentials needed
 *   otherwise                    → the real project, credentials required
 *
 * The stakes are higher here than in the console, because this app is exposed
 * to the public internet. The Admin SDK **bypasses `firestore.rules`
 * entirely**, so every read on this site is deliberately narrow (published
 * sessions, speakers, sponsors) and every write goes through
 * `src/lib/registrations.ts`. There is no Firebase client in this app and no
 * `NEXT_PUBLIC_*` variable anywhere: nothing exists for a browser chunk to
 * leak. `server-only` above turns a mistaken client import into a build error
 * rather than a credential in a bundle.
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
          'Refusing to run the website against the real project without credentials.\n' +
            'Either:\n' +
            '  export FIRESTORE_EMULATOR_HOST=localhost:8080   (safe, local)\n' +
            '  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json',
        );
      }
      initializeApp({ credential: cert(keyPath), projectId });
    }

    // Many model fields are genuinely optional (`roomId` on a session with no
    // room yet). Without this the Admin SDK rejects the whole write rather
    // than omitting the key. Same setting as the scripts and the console.
    getFirestore().settings({ ignoreUndefinedProperties: true });
  }
  return getFirestore();
}

export function targetDescription(): string {
  return process.env.FIRESTORE_EMULATOR_HOST
    ? `emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`
    : `PROJECT ${process.env.GCLOUD_PROJECT ?? 'kgc-database'} (LIVE)`;
}
