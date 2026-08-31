import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, type ContactDoc } from '@kgc/shared';
import { db } from './firestore';

/**
 * Honouring a public unsubscribe.
 *
 * Two functions, and the split is the whole design: `lookupContact` is what a
 * `GET` may do, `unsubscribeContact` is what only a `POST` may do. See
 * `app/u/[token]/page.tsx` for why that boundary is drawn where it is.
 *
 * ── What this deliberately does not have ────────────────────────────────────
 *
 * **No re-subscribe.** ⚠️ `ContactDoc` says `unsubscribedAt` is "set once,
 * never cleared except by a deliberate re-subscribe", and the CSV importer is
 * built around never resurrecting one — `importContacts()` refuses to write the
 * field at all and reports how many suppressed rows a 1,000-row upload
 * touched. A public re-subscribe link would put a second writer on the one
 * field the whole suppression story rests on, reachable by anybody holding an
 * old newsletter, with no confirmation of intent. The dashboard's own
 * `setContactSubscribed` stays the only way back on, because a human being
 * asked for it there.
 *
 * **No delete.** An unsubscribe is a record that has to survive the next
 * import, and a deleted contact is one that a re-import silently re-creates as
 * subscribed. Suppression only works if the row stays.
 */

export interface UnsubscribeContact {
  /** The address, so the page can say which one it is about. */
  email: string;
  /** Already unsubscribed before this visit. */
  alreadyUnsubscribed: boolean;
  /** The named lists this address is on, for the "what stops" line. */
  lists: string[];
}

/**
 * Read the contact a token points at, or null if there is no such document.
 *
 * Null is not an error state. A contact deleted from the dashboard since the
 * mail went out is genuinely on no list, so the honest page for that case says
 * so rather than 404-ing — a reader who clicked "unsubscribe" and got a "page
 * not found" will assume it did not work, and their next move is the spam
 * button, which costs the sending domain far more than a reassuring page does.
 */
export async function lookupContact(contactId: string): Promise<UnsubscribeContact | null> {
  try {
    const snap = await db().collection(COLLECTIONS.contacts).doc(contactId).get();
    if (!snap.exists) return null;

    const c = snap.data() as ContactDoc;
    return {
      email: c.email,
      alreadyUnsubscribed: Boolean(c.unsubscribedAt),
      lists: c.lists ?? [],
    };
  } catch (err) {
    console.error('[unsubscribe] could not read the contact', err);
    return null;
  }
}

/**
 * Record the unsubscribe. Idempotent, and it never clears the field.
 *
 * ── Why `update` and not `set(..., { merge: true })` ────────────────────────
 *
 * A merge would create the document when it is absent, and what it created
 * would be a contact with an `unsubscribedAt` and no `email`, no `eventId` and
 * no `lists` — invisible to `listContacts()`, which filters on `eventId`, and
 * therefore a suppression record that suppresses nothing. `update` fails
 * loudly on a missing document instead, and the caller has already resolved
 * that case.
 *
 * ── Why the timestamp is only ever written when it is absent ────────────────
 *
 * Re-clicking must not restamp the date. The date is the evidence of *when*
 * somebody opted out, which is the fact a regulator or a deliverability
 * investigation actually asks for, and a link that a mail scanner re-fetches
 * every week would otherwise keep moving it forward.
 *
 * Returns true when this call is what recorded it, false when it was already
 * recorded. Both are success from the reader's point of view; the distinction
 * only changes what the page says.
 */
export async function unsubscribeContact(contactId: string): Promise<boolean> {
  const ref = db().collection(COLLECTIONS.contacts).doc(contactId);

  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error(`contact ${contactId} no longer exists`);

    const c = snap.data() as ContactDoc;
    if (c.unsubscribedAt) return false;

    tx.update(ref, {
      unsubscribedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}
