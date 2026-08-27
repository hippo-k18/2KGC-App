import { randomInt } from 'node:crypto';

import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import type { OtpCodeDoc, RateLimitDoc } from '@kgc/shared';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { normaliseEmail, otpDocId } from '../lib/otp.js';

const CODE_TTL_MINUTES = 10;
const RATE_LIMIT_WINDOW_MINUTES = 60;
const RATE_LIMIT_MAX_REQUESTS = 5;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * HTTPS callable, no Firestore trigger — see functions/SPEC.md #9.
 *
 * Deliberately does not check `registrations` for a matching ticket. Doing
 * so would make this the enumeration oracle `registrationIsMine` in
 * `firestore.rules` was written to avoid: a response (or even a timing
 * difference) that varies with whether an address holds a ticket turns
 * "request a code" into "check if this email is on the guest list." So the
 * response shape here is identical for every syntactically valid email,
 * ticket or no ticket — the only two outcomes a caller can observe are a
 * malformed address (`invalid-argument`) and this address specifically
 * having asked too often (`resource-exhausted`), neither of which reveals
 * anything about who else is registered.
 *
 * Rate limit and code write happen in one transaction: without it, two
 * concurrent requests could each read `count: 4`, both decide they're under
 * the cap of 5, and both proceed — the exact TOCTOU gap `checkIns`'
 * `already-exists` idempotency was designed to avoid elsewhere in this repo,
 * just with a read-modify-write here instead of a duplicate `create`.
 *
 * No real email provider is wired up yet (Phase 5, per SPEC.md's Phase 0
 * decision log) — the code is only ever written to Firestore and logged to
 * this function's own console output. That is fine today because nothing in
 * this repo is deployed past Spark, but it is not something to carry into a
 * real deployment un-replaced: Cloud Functions logs are not a delivery
 * channel for a sign-in code.
 */
export const requestOtp = onCall<{ email?: unknown }>(async (request) => {
  const email = normaliseEmail(String(request.data?.email ?? ''));
  if (!EMAIL_SHAPE.test(email)) {
    throw new HttpsError('invalid-argument', 'A valid email address is required.');
  }

  const db = getFirestore();
  const id = otpDocId(email);
  const now = Timestamp.now();
  const code = generateCode();

  await db.runTransaction(async (tx) => {
    const rateLimitRef = db.collection(COLLECTIONS.rateLimits).doc(id);
    const rateSnap = await tx.get(rateLimitRef);
    const rateData = rateSnap.data() as RateLimitDoc | undefined;

    const windowMs = RATE_LIMIT_WINDOW_MINUTES * 60_000;
    const withinWindow = Boolean(rateData) && now.toMillis() - rateData!.windowStart.toMillis() < windowMs;

    if (withinWindow && rateData!.count >= RATE_LIMIT_MAX_REQUESTS) {
      throw new HttpsError('resource-exhausted', 'Too many code requests for this address. Try again later.');
    }

    tx.set(rateLimitRef, {
      eventId: EVENT_ID,
      email,
      count: withinWindow ? rateData!.count + 1 : 1,
      windowStart: withinWindow ? rateData!.windowStart : now,
      updatedAt: now,
    } satisfies RateLimitDoc);

    tx.set(db.collection(COLLECTIONS.otpCodes).doc(id), {
      eventId: EVENT_ID,
      email,
      code,
      expiresAt: Timestamp.fromMillis(now.toMillis() + CODE_TTL_MINUTES * 60_000),
      attempts: 0,
      createdAt: now,
    } satisfies OtpCodeDoc);
  });

  console.log(`[requestOtp] sign-in code for ${email}: ${code}`);

  return { ok: true };
});
