import { COLLECTIONS } from '@kgc/shared';
import type { UserDoc } from '@kgc/shared';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

const NAME_MAX = 120;
const TITLE_MAX = 120;
const COMPANY_MAX = 120;
const INTERESTS_MAX = 20;

/**
 * Only a URL Storage actually issued for an upload — never an attendee's own
 * typed string. `firestore.rules` has enforced this identical hostname
 * constraint directly on `users/{uid}.photoURL` itself since the
 * `fix-photourl-validation` PR, so the only current writer of that field is
 * already gated before this trigger ever runs — but this check stays rather
 * than being trusted away: it is defense in depth against any future writer
 * that reaches `users/{uid}` through the Admin SDK and bypasses rules
 * entirely (a seed script, an import, a console tool), and a URL is the one
 * field this function mirrors whose value gets *fetched* rather than just
 * displayed as text.
 *
 * `.protocol` is checked explicitly, unlike the rules-side regex which bakes
 * `https://` into the match itself — kept in sync by hand, not by a shared
 * implementation: `@kgc/shared` is bundled into the Expo app, which cannot
 * carry a Node-only `URL`-based check, and the rules language cannot run
 * this file's code. If this constraint ever changes, change it in both
 * places.
 */
function isFirebaseStorageUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'firebasestorage.googleapis.com';
  } catch {
    return false;
  }
}

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
 * Bounds `name`/`title`/`company`/`interests` to the same limits
 * `validDirectoryEntry()` enforces on the client path, even though nothing
 * enforces them on `users/{uid}` itself — the directory is ~1,000 documents
 * fetched whole by every attendee, and one oversized profile must not blow
 * that budget for everyone just because this path bypasses rules.
 */
export const mirrorDirectory = onDocumentWritten(
  `${COLLECTIONS.users}/{uid}`,
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
