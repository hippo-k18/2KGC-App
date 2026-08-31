import { createHash } from 'node:crypto';

import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import type { OtpCodeDoc, RegistrationDoc } from '@kgc/shared';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { normaliseEmail, otpDocId } from '../lib/otp.js';
import { callerIp, ipCounterId, tickWindow, type WindowCounterDoc } from '../lib/rate-limit.js';
import { PUBLIC_CALLABLE } from '../runtime-options.js';

const MAX_ATTEMPTS = 5;
const CODE_SHAPE = /^\d{6}$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Matches `requestOtp`'s per-IP limit, for the same reason and with the same
 * NAT arithmetic — see the constants in that file.
 *
 * The per-code brute-force cap below is per *code*, which means it is per
 * email: five wrong guesses kill one code and cost the guesser nothing but a
 * new `requestOtp` call. Guessing a six-digit code takes 10^6/2 attempts on
 * average, so an attacker never wants one email — they want to spray many, and
 * the only thing that sees that shape is a limit keyed on the caller.
 */
const IP_RATE_LIMIT_WINDOW_MINUTES = 15;
const IP_RATE_LIMIT_MAX_REQUESTS = 120;

/**
 * MUST match `registrationId()` in `scripts/src/lib/ids.ts` exactly — that is
 * the function that mints the id every seeded/imported registration is
 * actually stored under, and this one has to land on the same document with
 * a direct `get()`, no query. Duplicated rather than shared because
 * `@kgc/shared` is also bundled into the Expo app, which has no
 * `node:crypto` — moving a crypto-dependent helper there risks breaking
 * Metro's bundle, the same class of problem AGENTS.md's gotcha list already
 * warns about elsewhere. If this formula ever changes, change it in both
 * places. Normalises internally, like the canonical version — so it stays
 * correct even if a future call site forgets to.
 */
function registrationId(email: string): string {
  return `reg_${createHash('sha256').update(normaliseEmail(email)).digest('hex').slice(0, 24)}`;
}

/** At conference scale, more genuine matches than this would itself be surprising. */
const ALT_EMAIL_QUERY_LIMIT = 10;

/**
 * A registration matches on its primary `email` (the common case, a direct
 * `get()` by derived id — no query, no index) or on `altEmails` (assistants,
 * forwards, aliases — the same alternate-address support `registrationIsMine`
 * grants in `firestore.rules`). A primary match that exists but isn't
 * `active` (cancelled, transferred) still falls through to the `altEmails`
 * check — that primary ticket being dead says nothing about whether this
 * email is *also* listed as an alternate on someone else's active one.
 *
 * The `altEmails` lookup filters `status` and `eventId` in memory rather
 * than adding more `where()` clauses: an `array-contains` filter combined
 * with an equality filter needs a composite index, and alt-email matches are
 * rare enough that reading a bounded handful of candidates and filtering
 * them is simpler than another `firestore.indexes.json` entry for a query
 * that will almost never run.
 */
async function findActiveRegistration(db: Firestore, email: string): Promise<RegistrationDoc | undefined> {
  const primary = await db.collection(COLLECTIONS.registrations).doc(registrationId(email)).get();
  if (primary.exists) {
    const data = primary.data() as RegistrationDoc;
    if (data.status === 'active') return data;
  }

  const altSnap = await db
    .collection(COLLECTIONS.registrations)
    .where('altEmails', 'array-contains', email)
    .limit(ALT_EMAIL_QUERY_LIMIT)
    .get();
  const active = altSnap.docs.find((d) => {
    const data = d.data() as RegistrationDoc;
    return data.status === 'active' && data.eventId === EVENT_ID;
  });
  return active?.data() as RegistrationDoc | undefined;
}

type VerifyOutcome = 'ok' | 'no-code' | 'expired' | 'exhausted' | 'wrong-code';

/**
 * One fixed-window counter keyed on the caller's IP, consumed before anything
 * else this function does.
 *
 * Its own transaction rather than a share of the OTP one below, because the
 * two must not be atomic with each other: a wrong guess has to increment the
 * IP counter *and* increment `attempts` on the code, and folding them into one
 * transaction would mean a rejected guess discards its own IP tick. Free
 * guesses is exactly what this limit exists to prevent.
 */
async function ipLimitExceeded(db: Firestore, ip: string): Promise<boolean> {
  const ref = db.collection(COLLECTIONS.rateLimits).doc(ipCounterId('verifyOtp', ip));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = tickWindow(
      snap.data() as WindowCounterDoc | undefined,
      'verifyOtp-ip',
      Timestamp.now(),
      IP_RATE_LIMIT_WINDOW_MINUTES * 60_000,
      IP_RATE_LIMIT_MAX_REQUESTS,
    );
    if (!next) return true;
    tx.set(ref, next);
    return false;
  });
}

/**
 * HTTPS callable, no Firestore trigger — see functions/SPEC.md #10.
 *
 * ⚠️ PUBLIC AND UNAUTHENTICATED, like `requestOtp` — see that file's docblock
 * for why App Check is registered but not enforced, and for the shape of the
 * per-IP limit both callables share. This one is the more attractive target of
 * the two: a successful call mints an Auth account and returns a custom token.
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
 * *returning* account's claims are left alone as long as `registered` is
 * already set: `roles` may by then include `organizer`/`speaker`/etc.,
 * granted by hand via `npm run claims`, and re-deriving `['attendee']` on
 * every sign-in would silently erase that grant the next time its holder
 * signs out and back in. The one exception is an account that is missing
 * `registered` entirely — only possible if a prior verify created the Auth
 * user but crashed before its own `setCustomUserClaims` call — which is
 * repaired using whatever `roles` it already has, never reset to
 * attendee-only. There is no allowlist or speaker-collection lookup
 * anywhere in this file — a higher role is never guessed, only ever
 * assigned manually.
 */
export const verifyOtp = onCall<{ email?: unknown; code?: unknown }>(PUBLIC_CALLABLE, async (request) => {
  const email = normaliseEmail(String(request.data?.email ?? ''));
  const code = String(request.data?.code ?? '');
  if (!EMAIL_SHAPE.test(email) || !CODE_SHAPE.test(code)) {
    throw new HttpsError('invalid-argument', 'A valid email and 6-digit code are required.');
  }

  const db = getFirestore();

  const ip = callerIp(request.rawRequest);
  if (ip && (await ipLimitExceeded(db, ip))) {
    throw new HttpsError('resource-exhausted', 'Too many attempts. Try again later.');
  }

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

  switch (outcome) {
    case 'ok':
      break;
    case 'no-code':
      throw new HttpsError('failed-precondition', 'No active code for this email. Request a new one.');
    case 'expired':
      throw new HttpsError('failed-precondition', 'This code has expired. Request a new one.');
    case 'exhausted':
      throw new HttpsError('resource-exhausted', 'Too many incorrect attempts. Request a new code.');
    case 'wrong-code':
      throw new HttpsError('invalid-argument', 'Incorrect code.');
    default: {
      // Exhaustiveness check: a new VerifyOutcome member with no case above
      // fails the build here instead of silently falling through to a token.
      const unreachable: never = outcome;
      throw new HttpsError('internal', `Unhandled verify outcome: ${unreachable}`);
    }
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
    // Self-heal: a prior verify that created this account but then failed
    // before setCustomUserClaims landed (a mid-request crash, a quota blip)
    // would otherwise leave it claims-less forever — nothing else ever
    // revisits an *existing* account's claims. Preserves any roles already
    // present rather than resetting to attendee-only, so this can never
    // undo a manual `npm run claims` grant, only repair a genuinely missing one.
    if (!existing.customClaims?.registered) {
      await auth.setCustomUserClaims(uid, {
        registered: true,
        roles: existing.customClaims?.roles ?? ['attendee'],
        eventId: EVENT_ID,
      });
    }
  } else {
    const created = await auth.createUser({ email, emailVerified: true });
    uid = created.uid;
    await auth.setCustomUserClaims(uid, { registered: true, roles: ['attendee'], eventId: EVENT_ID });
  }

  const token = await auth.createCustomToken(uid);
  return { token };
});
