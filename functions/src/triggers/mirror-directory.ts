import { COLLECTIONS } from '@kgc/shared';
import type { UserDoc } from '@kgc/shared';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { isFirebaseStorageUrl } from '../lib/storage-url.js';
import { TRIGGER } from '../runtime-options.js';

const NAME_MAX = 120;
const TITLE_MAX = 120;
const COMPANY_MAX = 120;
const INTERESTS_MAX = 20;

/**
 * `users/{uid}` — see functions/SPEC.md #6.
 *
 * Mirrors into `directory/{uid}` if `visibleInDirectory`, deletes it
 * otherwise — a profile hidden mid-conference must stop showing up on
 * someone else's next fetch, not just on future writes.
 *
 * The client can still write `directory/{uid}` directly (the shim documented
 * in `firestore.rules`, kept open deliberately as a Phase 1 fallback — see
 * functions/SPEC.md's Phase 0 decision log). This function does not replace
 * that path yet, it runs alongside it; closing it is a rules change for
 * later, not something to fold in here.
 *
 * ⚠️ NEVER ADD A TRIGGER ON `directory/{uid}` THAT WRITES BACK TO
 * `users/{uid}`. This function writes `directory/{uid}` on every write to
 * `users/{uid}`; a trigger going the other way closes the circuit, and the
 * result is an unbounded loop between two documents, running at whatever rate
 * Eventarc will deliver, billing every hop, with no natural stopping point.
 * Nothing guards against it — Firestore v2 triggers match an exact path, which
 * is the only reason none of the ten existing functions can loop, and that
 * property protects you only until somebody registers the second half. If a
 * `directory` → `users` sync is ever genuinely needed, it must compare the
 * incoming value against what is already stored and return without writing
 * when they match; a bare mirror in both directions is the loop.
 *
 * Bounds `name`/`title`/`company`/`interests` to the same limits
 * `validDirectoryEntry()` enforces on the client path, even though nothing
 * enforces them on `users/{uid}` itself — the directory is ~1,000 documents
 * fetched whole by every attendee, and one oversized profile must not blow
 * that budget for everyone just because this path bypasses rules.
 */
export const mirrorDirectory = onDocumentWritten(
  { document: `${COLLECTIONS.users}/{uid}`, ...TRIGGER },
  async (event) => {
    const { uid } = event.params;
    const directoryRef = getFirestore().collection(COLLECTIONS.directory).doc(uid);

    const after = event.data?.after;
    if (!after?.exists) {
      await directoryRef.delete();
      return;
    }

    const user = after.data() as UserDoc;
    if (!user.visibleInDirectory) {
      await directoryRef.delete();
      return;
    }

    await directoryRef.set({
      eventId: user.eventId,
      uid,
      name: (user.name ?? '').slice(0, NAME_MAX),
      interests: (user.interests ?? []).slice(0, INTERESTS_MAX),
      ...(user.title ? { title: user.title.slice(0, TITLE_MAX) } : {}),
      ...(user.company ? { company: user.company.slice(0, COMPANY_MAX) } : {}),
      ...(isFirebaseStorageUrl(user.photoURL) ? { photoURL: user.photoURL } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
  },
);
