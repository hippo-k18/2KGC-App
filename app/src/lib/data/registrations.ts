import {
  collection,
  doc,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
  type Query,
} from 'firebase/firestore';

import { COLLECTIONS } from '@kgc/shared';

/**
 * Finding the signed-in attendee's registration, spelled once.
 *
 * Three screens need it — the badge, the seat button, and the seat transaction
 * behind the button — and the first two were reading it live while the third
 * fetched it. Three spellings of one lookup is three chances to disagree, and
 * when they disagree the symptom is an attendee who is told their own ticket
 * does not cover a session it does cover.
 *
 * ## Why the address and not the document id
 *
 * The id is `reg_` + sha256(email) and this client cannot compute it: there is
 * no `node:crypto` in React Native and `expo-crypto` is not a dependency, so
 * `registrationId()` in `@kgc/scripts` is out of reach. `badge.ts` has the long
 * version of this argument. If `expo-crypto` is ever added, both queries below
 * become one `getDoc` and the `list` rule can go with them.
 *
 * ## Why both addresses
 *
 * A registration holds the address it was bought under, plus any number of
 * alternates — a personal address used to sign in against a ticket bought on a
 * work address is the ordinary case, and `verifyOtp` already signs those people
 * in. `firestore.rules` says the same thing twice (`registrationIsMine` matches
 * `email` OR `altEmails`) and `findActiveRegistration` in
 * `scripts/src/lib/otp-core.ts` looks in both. A lookup that checks only the
 * primary finds nothing for them.
 */

/**
 * The signed-in address, folded the way registrations store it.
 *
 * `normaliseEmail()` in `@kgc/scripts` lowercases on the way in, so both
 * `email` and every entry of `altEmails` are lower case in the database — but
 * an ID token carries whatever the account was created with, so somebody who
 * signed up as `Ada.Okonkwo@Example.com` carries that. Comparing one verbatim
 * side against one folded side is a query that returns nothing for them, with
 * no error to explain it. `firestore.rules` folds for exactly this reason and
 * says so at `registrationIsMine`.
 *
 * Null for an account with no address at all, which is a caller that must not
 * build a query around an empty string: `where('email', '==', '')` is a real
 * query that really returns nothing.
 */
export function myAddress(email: string | null | undefined): string | null {
  const address = email?.trim().toLowerCase() ?? '';
  return address.length > 0 ? address : null;
}

/**
 * The registration bought under this address.
 *
 * One ticket per address by construction — `registrationId(email)` is the
 * document id — so the limit is belt-and-braces against a hand-edited database.
 * Single-field equality, so Firestore's automatic index serves it and there is
 * no composite index to declare.
 */
export function registrationByEmail(db: Firestore, address: string): Query {
  return query(
    collection(db, COLLECTIONS.registrations),
    where('email', '==', address),
    limit(1),
  );
}

/**
 * A registration that lists this address as an alternate. Asked only when the
 * primary lookup came back empty, so the common path is still one read.
 *
 * `array-contains` is a single-field query and is indexed automatically. The
 * `list` rule is evaluated against each candidate, and the `altEmails` arm of
 * `registrationIsMine` is what allows it.
 */
export function registrationByAltEmail(db: Firestore, address: string): Query {
  return query(
    collection(db, COLLECTIONS.registrations),
    where('altEmails', 'array-contains', address),
    limit(1),
  );
}

/**
 * Point this account's profile at its registration.
 *
 * ── What depends on it ──────────────────────────────────────────────────────
 *
 * `users/{uid}.registrationId` is the pointer `firestore.rules` follows to find
 * out which ticket the caller holds, and it gates every restricted stream and
 * recording. The rules cannot find it themselves: a registration's id is
 * `reg_` + sha256(email) and the rules language has no hash function, so the
 * pointer has to be stored by whoever can do the lookup, which is this client.
 *
 * It is written by the client and the rules do not trust it — they read the
 * registration it names and then require that registration to carry the
 * caller's own address. Pointing it at somebody else refuses you a video; it
 * does not get you theirs.
 *
 * ⚠️ **An account with no pointer is refused everything restricted**, and the
 * refusal looks exactly like the wrong ticket. So this must be written wherever
 * the app can write it, not only on the screen that happens to have looked the
 * registration up — it lived on the badge hook alone for a fortnight, and
 * anyone who installed the app, signed in and went straight to a gated session
 * was locked out of a video their ticket covered. `useRegistrationPointer`
 * mounts it once, above every screen.
 *
 * `setDoc(..., {merge: true})` rather than `updateDoc`, because an attendee
 * whose profile has not been created yet would get `not-found` and never
 * acquire the pointer at all. Takes the store as an argument so the rules suite
 * can make exactly this write against exactly these rules.
 */
export async function claimRegistrationPointer(
  db: Firestore,
  uid: string,
  registrationId: string,
): Promise<void> {
  await setDoc(
    doc(db, COLLECTIONS.users, uid),
    { registrationId, updatedAt: serverTimestamp() },
    { merge: true },
  );
}
