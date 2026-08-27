import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Admin SDK access for the seed and import scripts.
 *
 * These run on a laptop, not in Cloud Functions, which is deliberate: the Admin
 * SDK needs no Blaze plan, so the whole demo can be built and seeded while the
 * project is still on Spark. See `whova-rebuild/DECISIONS.md`.
 *
 * Two modes, chosen by environment rather than by a flag, so it is impossible to
 * point a destructive script at production by forgetting an argument:
 *
 *   FIRESTORE_EMULATOR_HOST set  → the local emulator, no credentials needed
 *   otherwise                    → the real project, credentials required
 */
export function db(): Firestore {
  if (!getApps().length) {
    const emulator = process.env.FIRESTORE_EMULATOR_HOST;
    const projectId = process.env.GCLOUD_PROJECT ?? 'kgc-conference-app-and-website';

    if (emulator) {
      initializeApp({ projectId });
    } else {
      const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (!keyPath) {
        throw new Error(
          'Refusing to run against the real project without credentials.\n' +
            'Either:\n' +
            '  export FIRESTORE_EMULATOR_HOST=localhost:8080   (safe, local)\n' +
            '  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json',
        );
      }
      initializeApp({ credential: cert(keyPath), projectId });
    }

    // Many fields in the model are genuinely optional (`primaryTrackName` on the
    // reception, which belongs to no track). Without this the Admin SDK rejects
    // the whole batch rather than omitting the key, which would force every
    // caller to strip undefined by hand.
    getFirestore().settings({ ignoreUndefinedProperties: true });
  }
  return getFirestore();
}

export function targetDescription(): string {
  return process.env.FIRESTORE_EMULATOR_HOST
    ? `emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`
    : `PROJECT ${process.env.GCLOUD_PROJECT ?? 'kgc-conference-app-and-website'} (live)`;
}

/**
 * A pending write, described by path rather than by a `DocumentReference`.
 *
 * This indirection is what lets `--dry-run` validate a whole import with no
 * credentials and no network at all — building a real `DocumentReference`
 * requires an initialised app, which would mean a dry run could only be
 * performed by someone already holding production keys. That is exactly
 * backwards for the command whose job is to be safe.
 */
export interface PendingWrite {
  collection: string;
  id: string;
  data: FirebaseFirestore.DocumentData;
}

/**
 * Deletes documents in `collection` for this event that this run did not write.
 *
 * Ids here are derived from content — a session from its title and start time, a
 * speaker from name and company — which is what makes re-importing idempotent.
 * The cost is that *editing* the content changes the id, so the old document is
 * orphaned rather than updated. Fixing one mis-typed surname in the fixtures
 * left five ghost speakers behind, and the same thing happens the first time
 * somebody corrects a session title in Whova and re-imports: a duplicate, with
 * the stale copy still linked from anyone's saved agenda.
 *
 * Scoped to `eventId` and to the collections the caller names, so it can never
 * reach another event or a collection this run does not own.
 */
export async function pruneStale(
  collection: string,
  eventId: string,
  keepIds: Set<string>,
): Promise<number> {
  const store = db();
  const snap = await store.collection(collection).where('eventId', '==', eventId).get();
  const stale = snap.docs.filter((d) => !keepIds.has(d.id));
  for (let i = 0; i < stale.length; i += 400) {
    const batch = store.batch();
    for (const d of stale.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
  return stale.length;
}

/**
 * Firestore caps a batch at 500 writes. Callers hand over the whole set and let
 * this chunk it, because "it worked with 60 sessions and failed at 600" is a bug
 * that only ever appears once the data is real.
 */
export async function commitAll(writes: PendingWrite[]): Promise<number> {
  const store = db();
  for (let i = 0; i < writes.length; i += 400) {
    const batch = store.batch();
    for (const w of writes.slice(i, i + 400)) {
      batch.set(store.collection(w.collection).doc(w.id), w.data, { merge: true });
    }
    await batch.commit();
  }
  return writes.length;
}
