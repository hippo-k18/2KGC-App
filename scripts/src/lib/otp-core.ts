import { randomInt } from 'node:crypto';

import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import type { OtpCodeDoc, RateLimitDoc, RegistrationDoc } from '@kgc/shared';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

import { emailEnabled, sendSignInCode } from './email.js';
import { registrationId } from './ids.js';
import { normaliseEmail, otpDocId } from './otp-ids.js';
import { ipCounterId, tickWindow, toMillis, type WindowCounterDoc } from './rate-limit.js';

/**
 * The six-digit sign-in code, as domain logic with no transport attached.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * This was `functions/src/callable/request-otp.ts` and `verify-otp.ts`, and
 * every rule it enforces was argued out there. Nothing about the rules has
 * changed. What changed is that the callables **cannot be deployed**:
 * `firebase deploy` for functions needs `iam.serviceAccounts.ActAs` on the
 * App Engine default service account, only `roles/owner` can grant it, and the
 * owner has not (OWNER-ACTIONS.md §3). An attendee cannot sign in to an app
 * whose sign-in endpoint 404s, so the endpoints move to somewhere that does
 * deploy — `apps/web`, which already carries the Admin SDK, the Resend key and
 * the account-provisioning path.
 *
 * The logic did NOT move. It came here, to the one place AGENTS.md nominates
 * for server-side domain logic with more than one caller, and both hosts now
 * delegate to it: the callables in `functions/` for the day the grant lands,
 * and the route handlers in `apps/web/src/app/api/auth/` for today. A fork
 * would be the `ensureRegistration` hazard again — two copies of an auth
 * decision, disagreeing quietly.
 *
 * ── The property this file must not break ──────────────────────────────────
 *
 * `requestSignInCode` behaves identically for **every syntactically valid
 * address** — ticket holder or stranger, real mailbox or typo. It does not
 * read `registrations` at all. That is an anti-enumeration property with a test
 * pinning it, and it is worth what it costs: an endpoint whose answer varies
 * with whether an address is on the guest list turns "send me a code" into a
 * query against a $1,199-a-seat delegate list. A code is generated, stored and
 * mailed in every case, and there is deliberately no branch on whether the send
 * succeeded.
 *
 * The ticket check happens exactly once, in `verifySignInCode`, **after** the
 * caller has proved they read the mailbox.
 *
 * ── Outcomes, not exceptions ───────────────────────────────────────────────
 *
 * Both functions return a tagged outcome rather than throwing a transport's
 * error type. `HttpsError` belongs to Cloud Functions and an HTTP status
 * belongs to a route handler; a shared core that threw either would force one
 * host to catch and translate the other's vocabulary. The two callers map these
 * tags to their own errors, and the tag names are the ones the app's
 * `lib/auth/otp.ts` already knows.
 */

const CODE_TTL_MINUTES = 10;
const RATE_LIMIT_WINDOW_MINUTES = 60;
const RATE_LIMIT_MAX_REQUESTS = 5;

/**
 * The per-IP limit, which exists because the per-email one is trivially
 * defeated by cycling addresses — a script asking for a code for a thousand
 * made-up addresses never trips a limit keyed on the address, and every one of
 * those requests costs an invocation plus two Firestore writes.
 *
 * The numbers are set by one uncomfortable constraint: a conference venue is
 * behind NAT. Several hundred attendees on the same wifi share one public IP,
 * and the registration desk on day-one morning is precisely when they all sign
 * in at once. A tight cap would not stop an attacker — who has other addresses
 * — and would lock the room out of its own conference. The limit exists to
 * bound a runaway, not to price an attacker out.
 *
 * If the venue trips this, raise the cap. Do not remove the limit, and do not
 * lengthen the window.
 */
const IP_RATE_LIMIT_WINDOW_MINUTES = 15;
const IP_REQUEST_MAX = 120;
const IP_VERIFY_MAX = 120;

const MAX_ATTEMPTS = 5;
const ALT_EMAIL_QUERY_LIMIT = 5;

export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const CODE_SHAPE = /^\d{6}$/;

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export type RequestOutcome =
  | { ok: true }
  | { ok: false; reason: 'invalid-argument' | 'resource-exhausted' };

export type VerifyOutcome =
  | { ok: true; token: string }
  | {
      ok: false;
      reason:
        | 'invalid-argument'
        | 'wrong-code'
        | 'no-code'
        | 'expired'
        | 'exhausted'
        | 'resource-exhausted'
        | 'no-registration';
    };

/**
 * Generate, store and mail a code.
 *
 * The rate-limit tick and the code write happen in ONE transaction: without it,
 * two concurrent requests could each read `count: 4`, both decide they are
 * under the cap of 5, and both proceed. Both counters are read before either is
 * written, as a transaction requires.
 *
 * ── Where the send sits, and why ───────────────────────────────────────────
 *
 * After the transaction commits, never inside it. Three reasons, worst first:
 *
 * 1. A Firestore transaction is *retried* on contention. Its body must be a
 *    pure function of what it read, and a send inside one would mail a fresh
 *    code on every attempt — the attendee gets three emails, two of which name
 *    a code the database never kept, and picks the wrong one.
 * 2. The code must be durable before it is delivered. Committing first means
 *    the only reachable failure is "stored but not delivered", which the
 *    attendee fixes by asking again. Sending first would allow "delivered but
 *    not stored" — a correct code that `verifySignInCode` rejects, unfixable
 *    from the attendee's side and indistinguishable from a broken product.
 * 3. A transaction holds locks on `rateLimits/{id}` for its whole duration.
 *    An HTTP round-trip to a third party inside that window turns a provider's
 *    bad afternoon into contention for every caller behind the same NAT.
 *
 * A failed send does not refund the rate-limit tick. The tick counts
 * *requests*, because that is what costs money; counting deliveries would make
 * any address the provider rejects an unmetered channel for running this for
 * free.
 *
 * ⚠️ **Nothing here may print the code** — not at debug level, not behind an
 * environment flag. Logs are not a delivery channel for a credential, and
 * anyone with Logs Viewer would be able to read every attendee's code. To see a
 * code while developing, read `otpCodes` in the emulator UI.
 */
export async function requestSignInCode(
  db: Firestore,
  rawEmail: string,
  ip: string | undefined,
): Promise<RequestOutcome> {
  const email = normaliseEmail(rawEmail);
  if (!EMAIL_SHAPE.test(email)) return { ok: false, reason: 'invalid-argument' };

  const id = otpDocId(email);
  /**
   * ⚠️ A native `Date`, never `Timestamp.now()` — AGENTS.md gotcha 8. This
   * module is imported by `apps/web`, which resolves its **own** copy of
   * `firebase-admin`; a `Timestamp` constructed here resolves the root copy and
   * fails the store's `instanceof` check, taking the entire write down with
   * "Value for argument data is not a valid Firestore document". A `Date` is a
   * global and converts on write under every copy.
   */
  const now = new Date();
  const code = generateCode();

  let limited = false;

  await db.runTransaction(async (tx) => {
    const rateLimitRef = db.collection(COLLECTIONS.rateLimits).doc(id);
    const ipRef = ip
      ? db.collection(COLLECTIONS.rateLimits).doc(ipCounterId('requestOtp', ip))
      : undefined;

    // Every read first, then every write — Firestore rejects a transaction
    // that reads after it has queued a write.
    const rateSnap = await tx.get(rateLimitRef);
    const ipSnap = ipRef ? await tx.get(ipRef) : undefined;

    const rateData = rateSnap.data() as RateLimitDoc | undefined;
    const windowMs = RATE_LIMIT_WINDOW_MINUTES * 60_000;
    const withinWindow =
      Boolean(rateData) && now.getTime() - toMillis(rateData!.windowStart) < windowMs;

    if (withinWindow && rateData!.count >= RATE_LIMIT_MAX_REQUESTS) {
      limited = true;
      return;
    }

    if (ipRef) {
      const nextIpWindow = tickWindow(
        ipSnap!.data() as WindowCounterDoc | undefined,
        'requestOtp-ip',
        now,
        IP_RATE_LIMIT_WINDOW_MINUTES * 60_000,
        IP_REQUEST_MAX,
      );
      if (!nextIpWindow) {
        // Same reason tag as the per-email cap. A caller learns "too many",
        // never which of the two limits it hit — the second would tell an
        // attacker exactly how to shape the next attempt.
        limited = true;
        return;
      }
      tx.set(ipRef, nextIpWindow);
    }

    /*
     * No `satisfies RateLimitDoc` / `satisfies OtpCodeDoc` on these two, and
     * that is the cost of the `Date` rule above rather than an oversight: both
     * interfaces type their time fields as `Timestamp`, which is the shape they
     * have when *read*. Asserting the write against the read shape would force
     * a `Timestamp` back in here and reintroduce the bug.
     */
    tx.set(rateLimitRef, {
      eventId: EVENT_ID,
      email,
      count: withinWindow ? rateData!.count + 1 : 1,
      windowStart: withinWindow ? rateData!.windowStart : now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + windowMs),
    });

    tx.set(db.collection(COLLECTIONS.otpCodes).doc(id), {
      eventId: EVENT_ID,
      email,
      code,
      expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000),
      attempts: 0,
      createdAt: now,
    });
  });

  if (limited) return { ok: false, reason: 'resource-exhausted' };

  // Loud, because this is the one skip in the project that breaks a flow rather
  // than a courtesy. A receipt that does not go out is an annoyance; a sign-in
  // code that does not go out means no attendee can get into the app at all.
  // It carries the address, not the code, and it fires on configuration rather
  // than on any property of the caller, so it observes nothing about who asked.
  if (!emailEnabled()) {
    console.error(
      '[requestSignInCode] RESEND_API_KEY is not set — no sign-in code was delivered to',
      email,
    );
  }

  // Awaited, not fired and forgotten: a serverless instance may be frozen the
  // moment the response is returned, so a floating promise here is a send that
  // sometimes happens. `sendSignInCode` never throws, so awaiting it cannot add
  // a failure path — and therefore cannot add one that varies with the address.
  await sendSignInCode(db, { to: email, code, ttlMinutes: CODE_TTL_MINUTES });

  return { ok: true };
}

async function findActiveRegistration(
  db: Firestore,
  email: string,
): Promise<RegistrationDoc | undefined> {
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

/**
 * One fixed-window counter keyed on the caller's IP, consumed before anything
 * else `verifySignInCode` does.
 *
 * Its own transaction rather than a share of the OTP one, because the two must
 * not be atomic with each other: a wrong guess has to increment the IP counter
 * *and* increment `attempts` on the code, and folding them into one transaction
 * would mean a rejected guess discards its own IP tick. Free guesses is exactly
 * what this limit exists to prevent.
 */
async function ipLimitExceeded(db: Firestore, ip: string): Promise<boolean> {
  const ref = db.collection(COLLECTIONS.rateLimits).doc(ipCounterId('verifyOtp', ip));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = tickWindow(
      snap.data() as WindowCounterDoc | undefined,
      'verifyOtp-ip',
      new Date(),
      IP_RATE_LIMIT_WINDOW_MINUTES * 60_000,
      IP_VERIFY_MAX,
    );
    if (!next) return true;
    tx.set(ref, next);
    return false;
  });
}

type CodeOutcome = 'ok' | 'no-code' | 'expired' | 'exhausted' | 'wrong-code';

/**
 * Redeem a code and mint a custom token.
 *
 * BRUTE-FORCE PROTECTION: up to `MAX_ATTEMPTS` (5) wrong guesses are tolerated
 * — `otpCodes/{id}.attempts` increments on each — and the call *after* the
 * fifth, whatever code it submits, finds `attempts` already at the cap and
 * invalidates the document rather than checking it: a code cannot be redeemed
 * by guessing right on attempt six just because six is when the cap check runs.
 * That is a separate question from expiry — attempts exhausted kills the code
 * with eight minutes still on its TTL.
 *
 * The transaction can only READ its own failure. Firestore discards every
 * queued write the moment a transaction callback throws, so a wrong-code
 * attempt cannot both increment `attempts` and signal the error by throwing in
 * the same attempt. It returns an outcome tag instead, and the caller maps it
 * once the mutation has committed.
 *
 * ROLES: a successful redemption checks `registrations` for an active ticket
 * (primary email or `altEmails`) and refuses outright if there is none — this
 * is the only gate between "correct code" and "attendee of a ticketed
 * conference", now that `requestSignInCode` deliberately never looks. Claims
 * are minted ONLY when the Auth account is created, always as
 * `{ registered: true, roles: ['attendee'], eventId }`. A *returning* account's
 * claims are left alone as long as `registered` is already set: `roles` may by
 * then include `organizer`/`speaker`, granted by hand via `npm run claims`, and
 * re-deriving `['attendee']` on every sign-in would silently erase that grant.
 * The one exception is an account missing `registered` entirely — only possible
 * if a prior verify created the user but crashed before its own
 * `setCustomUserClaims` — which is repaired using whatever `roles` it already
 * has, never reset to attendee-only.
 */
export async function verifySignInCode(
  db: Firestore,
  auth: Auth,
  rawEmail: string,
  rawCode: string,
  ip: string | undefined,
): Promise<VerifyOutcome> {
  const email = normaliseEmail(rawEmail);
  const code = String(rawCode ?? '');
  if (!EMAIL_SHAPE.test(email) || !CODE_SHAPE.test(code)) {
    return { ok: false, reason: 'invalid-argument' };
  }

  if (ip && (await ipLimitExceeded(db, ip))) {
    return { ok: false, reason: 'resource-exhausted' };
  }

  const otpRef = db.collection(COLLECTIONS.otpCodes).doc(otpDocId(email));

  const outcome = await db.runTransaction<CodeOutcome>(async (tx) => {
    const snap = await tx.get(otpRef);
    if (!snap.exists) return 'no-code';

    const data = snap.data() as OtpCodeDoc;
    const now = Date.now();

    if (toMillis(data.expiresAt) <= now) {
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

  if (outcome !== 'ok') return { ok: false, reason: outcome };

  const registration = await findActiveRegistration(db, email);
  if (!registration) return { ok: false, reason: 'no-registration' };

  const existing = await auth.getUserByEmail(email).catch((err: { code?: string }) => {
    if (err.code === 'auth/user-not-found') return undefined;
    throw err;
  });

  let uid: string;
  if (existing) {
    uid = existing.uid;
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
    await auth.setCustomUserClaims(uid, {
      registered: true,
      roles: ['attendee'],
      eventId: EVENT_ID,
    });

    /**
     * The profile, created here and nowhere else on this path.
     *
     * Two things depend on it. AGENTS.md records that **nothing creates
     * `users/{uid}`** — a real attendee signing in has no profile document, so
     * their name and privacy switches fall back to defaults; this closes that
     * gap for every account the code flow mints. And `mustSetPassword` is what
     * tells `/change-password` that there is no existing password to
     * reauthenticate against, because an account created from an email code has
     * an address and no credential.
     *
     * `merge: true` rather than a bare `set`: an account can be *created* here
     * while a profile already exists, if a purchase wrote one before the
     * attendee ever signed in. Overwriting it would discard their name.
     *
     * ⚠️ A plain `Date`, not `FieldValue.serverTimestamp()`. AGENTS.md gotcha 8:
     * three copies of `firebase-admin` exist in this repo, sentinels are class
     * instances validated with `instanceof`, and one constructed inside
     * `@kgc/scripts` and handed to a store created in `apps/web` fails the
     * entire write. This module runs under both.
     */
    await db
      .collection(COLLECTIONS.users)
      .doc(uid)
      .set(
        {
          eventId: EVENT_ID,
          email,
          name: registration.name ?? email,
          interests: [],
          // `onboarded: false` so the app can still ask for a name and a photo.
          // The registration carries a name, which is enough to render a row —
          // it is not enough to call the profile finished.
          onboarded: false,
          /**
           * ⚠️ Opt-**out** of the directory, deliberately, even though it makes
           * a new attendee invisible under People until they choose otherwise.
           *
           * The alternative — defaulting to visible — publishes somebody's name
           * and company to every other delegate as a side effect of signing in,
           * which is not a thing they agreed to at a checkout. The seed sets
           * this per-attendee because it is inventing consent for fixtures; a
           * real account has nobody to invent it on behalf of.
           */
          visibleInDirectory: false,
          messagingEnabled: true,
          notificationPrefs: { announcements: true, messages: true, sessionReminders: true },
          roles: ['attendee'],
          mustChangePassword: true,
          mustSetPassword: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { merge: true },
      );
  }

  return { ok: true, token: await auth.createCustomToken(uid) };
}
