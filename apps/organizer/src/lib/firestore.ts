import 'server-only';

import { existsSync } from 'node:fs';

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
/**
 * ⚠️ **No credential is a hard failure, deliberately.**
 *
 * Until BUILD-PLAN 1.5 this function had a third mode: with no emulator host and
 * no service account it returned an in-memory stand-in backed by a 343 KB
 * `fixture.json`, so a misconfigured deployment showed a complete, plausible,
 * entirely invented dashboard — and reported saves that went nowhere. Nobody set
 * that mode; it derived itself from the absence of a variable, which meant
 * "the dashboard lost its service account" and "the organizer's edit never
 * reached the app" presented as the same symptom.
 *
 * It now throws the message below instead. A dashboard that will not start is a
 * bug report; a dashboard full of fiction is a decision made on fiction.
 */
export function db(): Firestore {
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
      // ⚠️ The path is honoured only if the file is actually there.
      //
      // `next build` bakes `.env.local` into the server bundle, so building on
      // a laptop and uploading the result carries that laptop's
      // GOOGLE_APPLICATION_CREDENTIALS path into production — where it names a
      // file that cannot exist. Preferring it unconditionally then beats the
      // perfectly good inline credential the host does have, and every read
      // fails with ENOENT on somebody's home directory.
      //
      // That is not hypothetical: it took every Firestore read on the deployed
      // website down on 2026-08-31, and it failed quietly, because each read is
      // wrapped in a fallback that renders an empty state. The site looked like
      // an event with no sessions and no sponsors rather than a broken one.
      const rawKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const keyPath = rawKeyPath && existsSync(rawKeyPath) ? rawKeyPath : undefined;
      const inline = process.env.FIREBASE_SERVICE_ACCOUNT;

      if (rawKeyPath && !keyPath && !inline) {
        throw new Error(
          `GOOGLE_APPLICATION_CREDENTIALS points at ${rawKeyPath}, which does not ` +
            'exist, and FIREBASE_SERVICE_ACCOUNT is not set. On a deployed host the ' +
            'path is usually one baked in by a local build; set FIREBASE_SERVICE_ACCOUNT ' +
            'instead.',
        );
      }

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
  return process.env.FIRESTORE_EMULATOR_HOST
    ? `emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`
    : `PROJECT ${process.env.GCLOUD_PROJECT ?? 'kgc-conference-app-and-website'} (LIVE)`;
}
