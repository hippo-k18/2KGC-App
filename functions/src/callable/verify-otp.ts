import { createHash } from 'node:crypto';

import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import type { OtpCodeDoc, RegistrationDoc } from '@kgc/shared';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { normaliseEmail, otpDocId } from '../lib/otp.js';

const MAX_ATTEMPTS = 5;
const CODE_SHAPE = /^\d{6}$/;

/**
 * MUST match `registrationId()` in `scripts/src/lib/ids.ts` exactly — that is
 * the function that mints the id every seeded/imported registration is
 * actually stored under, and this one has to land on the same document with
 * a direct `get()`, no query. Duplicated rather than shared because
 * `@kgc/shared` is also bundled into the Expo app, which has no
 * `node:crypto` — moving a crypto-dependent helper there risks breaking
 * Metro's bundle, the same class of problem AGENTS.md's gotcha list already
 * warns about elsewhere. If this formula ever changes, change it in both
 * places. Expects an already-normalised email, like `otpDocId`.
 */
function registrationId(email: string): string {
  return `reg_${createHash('sha256').update(email).digest('hex').slice(0, 24)}`;
}

/**
 * A registration matches on its primary `email` (the common case, a direct
 * `get()` by derived id — no query, no index) or on `altEmails` (assistants,
 * forwards, aliases — the same alternate-address support `registrationIsMine`
 * grants in `firestore.rules`). The `altEmails` lookup filters `status` in
 * memory rather than adding a second `where()`: an `array-contains` filter
 * combined with an equality filter needs a composite index, and alt-email
 * matches are rare enough that reading the handful of candidates and
 * filtering them is simpler than another `firestore.indexes.json` entry for
 * a query that will almost never run.
 */
async function findActiveRegistration(db: Firestore, email: string): Promise<RegistrationDoc | undefined> {
  const primary = await db.collection(COLLECTIONS.registrations).doc(registrationId(email)).get();
  if (primary.exists) {
    const data = primary.data() as RegistrationDoc;
    return data.status === 'active' ? data : undefined;
  }

  const altSnap = await db.collection(COLLECTIONS.registrations).where('altEmails', 'array-contains', email).get();
  const active = altSnap.docs.find((d) => (d.data() as RegistrationDoc).status === 'active');
  return active?.data() as RegistrationDoc | undefined;
}

type VerifyOutcome = 'ok' | 'no-code' | 'expired' | 'exhausted' | 'wrong-code';

/**
 * HTTPS callable, no Firestore trigger — see functions/SPEC.md #10.
 *
 * BRUTE-FORCE PROTECTION: up to `MAX_ATTEMPTS` (5) wrong guesses are
 * tolerated — `otpCodes/{id}.attempts` increments on each one — and the
 * call *after* the fifth, whatever code it submits, finds `attempts` already
 * at the cap and invalidates the document outright rather than checking it:
 * a code cannot be redeemed by guessing right on attempt six just because
 * six is also when the cap check runs. This is deliberately a separate
 * question from expiry — attempts exhausted kills the code even with eight
 * minutes still left on its 10-minute TTL. The whole check-and-mutate step
 * runs in one transaction so two concurrent guesses can't both read
 * `attempts: 4` and both slip in under the cap.
 *
 * The transaction can only READ its own failure — Firestore discards every
 * queued write the moment a transaction callback throws, so a wrong-code
 * attempt cannot both delete/update the document and signal an error via a
 * thrown `HttpsError` in the same attempt. It returns an outcome tag instead,
 * and the `HttpsError` is thrown afterwards, once the mutation has already
 * committed.
 *
 * ROLES, PER PHASE 0 DECISION #6: a successful verify checks `registrations`
 * for an active ticket (primary email or `altEmails`) and refuses outright if
 * none exists — this function is the only gate standing between "correct
 * OTP" and "attendee of a ticketed conference," now that `requestOtp`
 * deliberately never looks at `registrations` (see that file's docblock).
 * Custom claims are minted ONLY the moment the Firebase Auth account is
 * created — i.e. only on this email's actual first successful sign-in — and
 * always as `{ registered: true, roles: ['attendee'], eventId }`. A
 * *returning* account's claims are never touched here: `roles` may by then
 * include `organizer`/`speaker`/etc., granted by hand via `npm run claims`,
 * and re-deriving `['attendee']` on every sign-in would silently erase that
 * grant the next time its holder signs out and back in. There is no
 * allowlist or speaker-collection lookup anywhere in this file — a higher
 * role is never guessed, only ever assigned manually.
 */
export const verifyOtp = onCall<{ email?: unknown; code?: unknown }>(async (request) => {
  const email = normaliseEmail(String(request.data?.email ?? ''));
  const code = String(request.data?.code ?? '');
  if (!email || !CODE_SHAPE.test(code)) {
    throw new HttpsError('invalid-argument', 'A valid email and 6-digit code are required.');
  }

  const db = getFirestore();
  const otpRef = db.collection(COLLECTIONS.otpCodes).doc(otpDocId(email));

  const outcome = await db.runTransaction<VerifyOutcome>(async (tx) => {
    const snap = await tx.get(otpRef);
    if (!snap.exists) return 'no-code';

    const data = snap.data() as OtpCodeDoc;
    const now = Timestamp.now();

    if (data.expiresAt.toMillis() <= now.toMillis()) {
      tx.delete(otpRef);
      return 'expired';
    }
    if (data.attempts >= MAX_ATTEMPTS) {
      tx.delete(otpRef);
      return 'exhausted';
    }
    if (data.code !== code) {
      tx.update(otpRef, { attempts: data.attempts + 1 });
      return 'wrong-code';
    }

    tx.delete(otpRef);
    return 'ok';
  });

  if (outcome === 'no-code') {
    throw new HttpsError('failed-precondition', 'No active code for this email. Request a new one.');
  }
  if (outcome === 'expired') {
    throw new HttpsError('failed-precondition', 'This code has expired. Request a new one.');
  }
  if (outcome === 'exhausted') {
    throw new HttpsError('resource-exhausted', 'Too many incorrect attempts. Request a new code.');
  }
  if (outcome === 'wrong-code') {
    throw new HttpsError('invalid-argument', 'Incorrect code.');
  }

  const registration = await findActiveRegistration(db, email);
  if (!registration) {
    throw new HttpsError('permission-denied', 'No active registration found for this email.');
  }

  const auth = getAuth();
  const existing = await auth.getUserByEmail(email).catch((err: { code?: string }) => {
    if (err.code === 'auth/user-not-found') return undefined;
    throw err;
  });

  let uid: string;
  if (existing) {
    uid = existing.uid;
  } else {
    const created = await auth.createUser({ email, emailVerified: true });
    uid = created.uid;
    await auth.setCustomUserClaims(uid, { registered: true, roles: ['attendee'], eventId: EVENT_ID });
  }

  const token = await auth.createCustomToken(uid);
  return { token };
});
