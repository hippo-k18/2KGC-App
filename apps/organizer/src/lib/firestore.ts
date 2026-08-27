import 'server-only';

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { demoFirestore, isDemoMode } from './demo/store';

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
  /**
   * No emulator and no credential means no database to talk to at all, which is
   * how this runs when it is deployed for a demonstration. Rather than throw on
   * every page, serve the seeded fixture through an in-memory stand-in — see
   * `demo/store.ts`. Every screen then runs its real query logic, which is the
   * whole point: a screen that works in the demo works against Firestore.
   */
  if (isDemoMode()) return demoFirestore();

  if (!getApps().length) {
    const emulator = process.env.FIRESTORE_EMULATOR_HOST;
    const projectId = process.env.GCLOUD_PROJECT ?? 'kgc-conference-app-and-website';

    if (emulator) {
      initializeApp({ projectId });
    } else {
      // Two ways to hold the same service account, because two hosts differ.
      //
      // `GOOGLE_APPLICATION_CREDENTIALS` is a *path*, which is the convention
      // on a laptop and useless on Netlify or any other serverless host: there
      // is no filesystem to put the file on. `FIREBASE_SERVICE_ACCOUNT` carries
      // the JSON itself, so the same credential travels in an environment
      // variable. The path wins when both are set, because a developer who has
      // deliberately exported a path is pointing at a specific key and should
      // get that one.
      const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const inline = process.env.FIREBASE_SERVICE_ACCOUNT;

      if (keyPath) {
        initializeApp({ credential: cert(keyPath), projectId });
      } else if (inline) {
        let parsed: Record<string, string>;
        try {
          parsed = JSON.parse(inline) as Record<string, string>;
        } catch {
          throw new Error(
            'FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON. Paste the whole ' +
              'service-account file, including its newlines escaped as \\n.',
          );
        }
        initializeApp({
          credential: cert({
            projectId: parsed.project_id,
            clientEmail: parsed.client_email,
            // Netlify's UI stores the value literally, so the PEM's newlines
            // arrive as the two characters backslash-n and must be restored or
            // the key fails to parse with an opaque OpenSSL error.
            privateKey: (parsed.private_key ?? '').replace(/\\n/g, '\n'),
          }),
          projectId: parsed.project_id ?? projectId,
        });
      } else {
        throw new Error(
          'Refusing to run the dashboard against the real project without credentials.\n' +
            'Use one of:\n' +
            '  FIRESTORE_EMULATOR_HOST=localhost:8080          (safe, local)\n' +
            '  GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json (a laptop)\n' +
            '  FIREBASE_SERVICE_ACCOUNT={...}                   (a serverless host)',
        );
      }
    }

    // Same reason as the scripts: many model fields are genuinely optional
    // (`roomId` on a session with no room yet), and without this the Admin SDK
    // rejects the whole write rather than omitting the key.
    getFirestore().settings({ ignoreUndefinedProperties: true });
  }
  return getFirestore();
}

export function targetDescription(): string {
  if (isDemoMode()) return 'demo data (no database — nothing is saved)';
  return process.env.FIRESTORE_EMULATOR_HOST
    ? `emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`
    : `PROJECT ${process.env.GCLOUD_PROJECT ?? 'kgc-conference-app-and-website'} (LIVE)`;
}
