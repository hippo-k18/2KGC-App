/**
 * Integration test for `requestOtp` (functions/SPEC.md #9), an HTTPS
 * callable rather than a Firestore trigger — invoked over the emulator's
 * callable HTTP protocol via `callCallable()` (see lib/emulator.ts for why
 * there's no client SDK involved).
 *
 * Run with: npm run test:functions
 */
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import type { CollectionReference, Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { callCallable, connectToEmulator } from './lib/emulator.js';

const EMAIL_VALID = 'requestotp-valid@example.test';
const EMAIL_THROTTLE = 'requestotp-throttle@example.test';

let db: Firestore;
let otpCodesRef: CollectionReference;
let rateLimitsRef: CollectionReference;

async function otpCodeFor(email: string) {
  const snap = await otpCodesRef.where('email', '==', email).limit(1).get();
  return snap.docs[0]?.data();
}

async function rateLimitFor(email: string) {
  const snap = await rateLimitsRef.where('email', '==', email).limit(1).get();
  return snap.docs[0]?.data();
}

async function deleteWhereEmail(collection: CollectionReference, email: string) {
  const snap = await collection.where('email', '==', email).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

async function cleanupFixtures() {
  for (const email of [EMAIL_VALID, EMAIL_THROTTLE]) {
    await deleteWhereEmail(otpCodesRef, email);
    await deleteWhereEmail(rateLimitsRef, email);
  }
}

beforeAll(async () => {
  db = connectToEmulator();
  otpCodesRef = db.collection(COLLECTIONS.otpCodes);
  rateLimitsRef = db.collection(COLLECTIONS.rateLimits);
  await cleanupFixtures();
}, 20_000);

afterAll(async () => {
  await cleanupFixtures();
});

describe('requestOtp', () => {
  it('writes a 6-digit code for a valid email and normalises it to lower case', async () => {
    const res = await callCallable<{ ok: boolean }>('requestOtp', { email: ` ${EMAIL_VALID.toUpperCase()} ` });

    expect(res.status).toBe(200);
    expect(res.result?.ok).toBe(true);

    const otp = await otpCodeFor(EMAIL_VALID);
    expect(otp).toBeDefined();
    expect(otp?.email).toBe(EMAIL_VALID);
    expect(otp?.eventId).toBe(EVENT_ID);
    expect(otp?.code).toMatch(/^\d{6}$/);
    expect(otp?.attempts).toBe(0);

    const ttlMinutes = (otp?.expiresAt.toMillis() - otp?.createdAt.toMillis()) / 60_000;
    expect(ttlMinutes).toBeCloseTo(10, 1);
  }, 20_000);

  it('rejects a malformed email without writing a code', async () => {
    const res = await callCallable('requestOtp', { email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.error?.status).toBe('INVALID_ARGUMENT');
    expect(await otpCodeFor('not-an-email')).toBeUndefined();
  }, 20_000);

  it('throttles a sixth request within the same hour', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await callCallable<{ ok: boolean }>('requestOtp', { email: EMAIL_THROTTLE });
      expect(res.status).toBe(200);
    }

    const sixth = await callCallable('requestOtp', { email: EMAIL_THROTTLE });
    expect(sixth.status).toBe(429);
    expect(sixth.error?.status).toBe('RESOURCE_EXHAUSTED');

    const rateLimit = await rateLimitFor(EMAIL_THROTTLE);
    expect(rateLimit?.count).toBe(5);
  }, 30_000);
});
