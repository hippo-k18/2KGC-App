/**
 * Integration test for `verifyOtp` (functions/SPEC.md #10), an HTTPS
 * callable run against the real Firestore, Auth and Functions emulators —
 * `npm run test:functions` starts all three now that this function exists.
 *
 * Covers the two protections added on top of the bare SPEC.md row: brute
 * force (`otpCodes/{id}.attempts` caps at 5, and the call *after* the fifth
 * wrong guess is dead even if it finally submits the right code) and the
 * Phase 0 role decision (a ticket in `registrations` is required for a
 * first sign-in to mint `registered: true`, and a *returning* account's
 * claims — which may by then include a hand-granted role — are never
 * touched here).
 *
 * Run with: npm run test:functions
 */
import { createHash } from 'node:crypto';

import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import type { Auth } from 'firebase-admin/auth';
import type { CollectionReference, Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { callCallable, connectAuthEmulator, connectToEmulator } from './lib/emulator.js';

const normaliseEmail = (email: string) => email.trim().toLowerCase();
const otpDocId = (email: string) => createHash('sha256').update(email).digest('hex').slice(0, 24);
const registrationId = (email: string) =>
  `reg_${createHash('sha256').update(normaliseEmail(email)).digest('hex').slice(0, 24)}`;

const EMAIL_TICKETED = 'verifyotp-ticketed@example.test';
const EMAIL_NO_TICKET = 'verifyotp-no-ticket@example.test';
const EMAIL_ALT_PRIMARY = 'verifyotp-alt-primary@example.test';
const EMAIL_ALT = 'verifyotp-alt@example.test';
const EMAIL_ATTEMPTS = 'verifyotp-attempts@example.test';
const EMAIL_EXPIRED = 'verifyotp-expired@example.test';
const EMAIL_NO_CODE = 'verifyotp-no-code@example.test';
const EMAIL_CANCELLED_WITH_ALT = 'verifyotp-cancelled-with-alt@example.test';
const EMAIL_ALT_PRIMARY_2 = 'verifyotp-alt-primary-2@example.test';
const EMAIL_HEAL = 'verifyotp-heal@example.test';

const ALL_EMAILS = [
  EMAIL_TICKETED,
  EMAIL_NO_TICKET,
  EMAIL_ALT_PRIMARY,
  EMAIL_ALT,
  EMAIL_ATTEMPTS,
  EMAIL_EXPIRED,
  EMAIL_NO_CODE,
  EMAIL_CANCELLED_WITH_ALT,
  EMAIL_ALT_PRIMARY_2,
  EMAIL_HEAL,
];

let db: Firestore;
let auth: Auth;
let otpCodesRef: CollectionReference;
let registrationsRef: CollectionReference;

function registrationFixture(email: string, altEmails: string[] = [], status: string = 'active') {
  const now = new Date();
  return {
    eventId: EVENT_ID,
    email,
    emailHash: 'unused-in-test',
    altEmails,
    status,
    qrSecret: 'test-qr-secret',
    createdAt: now,
    updatedAt: now,
  };
}

async function codeFor(email: string): Promise<string> {
  const snap = await otpCodesRef.doc(otpDocId(email)).get();
  if (!snap.exists) throw new Error(`no otpCodes doc for ${email} — did requestOtp run first?`);
  return snap.data()!.code as string;
}

async function otpDocExists(email: string): Promise<boolean> {
  return (await otpCodesRef.doc(otpDocId(email)).get()).exists;
}

async function deleteAuthUserIfExists(email: string) {
  const user = await auth.getUserByEmail(email).catch(() => undefined);
  if (user) await auth.deleteUser(user.uid);
}

async function cleanupFixtures() {
  for (const email of ALL_EMAILS) {
    await otpCodesRef.doc(otpDocId(email)).delete();
    await registrationsRef.doc(registrationId(email)).delete();
    await deleteAuthUserIfExists(email);
  }
}

beforeAll(async () => {
  db = connectToEmulator();
  auth = connectAuthEmulator();
  otpCodesRef = db.collection(COLLECTIONS.otpCodes);
  registrationsRef = db.collection(COLLECTIONS.registrations);

  await cleanupFixtures();
  await registrationsRef.doc(registrationId(EMAIL_TICKETED)).create(registrationFixture(EMAIL_TICKETED));
  await registrationsRef
    .doc(registrationId(EMAIL_ALT_PRIMARY))
    .create(registrationFixture(EMAIL_ALT_PRIMARY, [EMAIL_ALT]));
  // A cancelled primary registration of its own, PLUS a listing as an
  // altEmail on someone else's active one — regression coverage for
  // findActiveRegistration() falling through to the altEmails check even
  // when a primary match exists but isn't active.
  await registrationsRef
    .doc(registrationId(EMAIL_CANCELLED_WITH_ALT))
    .create(registrationFixture(EMAIL_CANCELLED_WITH_ALT, [], 'cancelled'));
  await registrationsRef
    .doc(registrationId(EMAIL_ALT_PRIMARY_2))
    .create(registrationFixture(EMAIL_ALT_PRIMARY_2, [EMAIL_CANCELLED_WITH_ALT]));
  await registrationsRef.doc(registrationId(EMAIL_HEAL)).create(registrationFixture(EMAIL_HEAL));
}, 20_000);

afterAll(async () => {
  await cleanupFixtures();
});

describe('verifyOtp', () => {
  it('verifies a ticketed email and mints attendee-only claims on first sign-in', async () => {
    expect((await callCallable('requestOtp', { email: EMAIL_TICKETED })).status).toBe(200);
    const code = await codeFor(EMAIL_TICKETED);

    const res = await callCallable<{ token: string }>('verifyOtp', { email: EMAIL_TICKETED, code });
    expect(res.status).toBe(200);
    expect(typeof res.result?.token).toBe('string');
    expect(res.result?.token.length).toBeGreaterThan(0);

    expect(await otpDocExists(EMAIL_TICKETED)).toBe(false);

    const user = await auth.getUserByEmail(EMAIL_TICKETED);
    expect(user.customClaims).toEqual({ registered: true, roles: ['attendee'], eventId: EVENT_ID });
  }, 20_000);

  it('preserves a hand-granted role on a returning sign-in instead of re-deriving attendee-only', async () => {
    // Depends on the previous test having already created the account.
    const before = await auth.getUserByEmail(EMAIL_TICKETED);
    await auth.setCustomUserClaims(before.uid, { registered: true, roles: ['attendee', 'organizer'], eventId: EVENT_ID });

    expect((await callCallable('requestOtp', { email: EMAIL_TICKETED })).status).toBe(200);
    const code = await codeFor(EMAIL_TICKETED);

    const res = await callCallable<{ token: string }>('verifyOtp', { email: EMAIL_TICKETED, code });
    expect(res.status).toBe(200);

    const after = await auth.getUserByEmail(EMAIL_TICKETED);
    expect(after.uid).toBe(before.uid);
    expect(after.customClaims?.roles).toEqual(['attendee', 'organizer']);
  }, 20_000);

  it('accepts a code requested for an altEmails address', async () => {
    expect((await callCallable('requestOtp', { email: EMAIL_ALT })).status).toBe(200);
    const code = await codeFor(EMAIL_ALT);

    const res = await callCallable<{ token: string }>('verifyOtp', { email: EMAIL_ALT, code });
    expect(res.status).toBe(200);
    expect(res.result?.token.length).toBeGreaterThan(0);
  }, 20_000);

  it('rejects a correct code with no active registration, without creating an Auth account', async () => {
    expect((await callCallable('requestOtp', { email: EMAIL_NO_TICKET })).status).toBe(200);
    const code = await codeFor(EMAIL_NO_TICKET);

    const res = await callCallable('verifyOtp', { email: EMAIL_NO_TICKET, code });
    expect(res.status).toBe(403);
    expect(res.error?.status).toBe('PERMISSION_DENIED');

    // The code was correct, so it's consumed even though the ticket check failed.
    expect(await otpDocExists(EMAIL_NO_TICKET)).toBe(false);
    await expect(auth.getUserByEmail(EMAIL_NO_TICKET)).rejects.toMatchObject({ code: 'auth/user-not-found' });
  }, 20_000);

  it('tolerates 5 wrong guesses but invalidates the code on the 6th call, even with the right code', async () => {
    expect((await callCallable('requestOtp', { email: EMAIL_ATTEMPTS })).status).toBe(200);
    const code = await codeFor(EMAIL_ATTEMPTS);
    const wrongCode = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      const res = await callCallable('verifyOtp', { email: EMAIL_ATTEMPTS, code: wrongCode });
      expect(res.status).toBe(400);
      expect(res.error?.status).toBe('INVALID_ARGUMENT');
    }

    const sixth = await callCallable('verifyOtp', { email: EMAIL_ATTEMPTS, code });
    expect(sixth.status).toBe(429);
    expect(sixth.error?.status).toBe('RESOURCE_EXHAUSTED');
    expect(await otpDocExists(EMAIL_ATTEMPTS)).toBe(false);
  }, 30_000);

  it('rejects an expired code', async () => {
    const past = new Date(Date.now() - 60_000);
    await otpCodesRef.doc(otpDocId(EMAIL_EXPIRED)).set({
      eventId: EVENT_ID,
      email: EMAIL_EXPIRED,
      code: '123456',
      expiresAt: past,
      attempts: 0,
      createdAt: past,
    });

    const res = await callCallable('verifyOtp', { email: EMAIL_EXPIRED, code: '123456' });
    expect(res.status).toBe(400);
    expect(res.error?.status).toBe('FAILED_PRECONDITION');
    expect(await otpDocExists(EMAIL_EXPIRED)).toBe(false);
  }, 20_000);

  it('rejects a code when none was ever requested', async () => {
    const res = await callCallable('verifyOtp', { email: EMAIL_NO_CODE, code: '123456' });
    expect(res.status).toBe(400);
    expect(res.error?.status).toBe('FAILED_PRECONDITION');
  }, 20_000);

  it('rejects a malformed request', async () => {
    const res = await callCallable('verifyOtp', { email: 'not-an-email', code: 'abc' });
    expect(res.status).toBe(400);
    expect(res.error?.status).toBe('INVALID_ARGUMENT');
  }, 20_000);

  it('falls through to an altEmails match when the primary registration exists but is cancelled', async () => {
    expect((await callCallable('requestOtp', { email: EMAIL_CANCELLED_WITH_ALT })).status).toBe(200);
    const code = await codeFor(EMAIL_CANCELLED_WITH_ALT);

    const res = await callCallable<{ token: string }>('verifyOtp', { email: EMAIL_CANCELLED_WITH_ALT, code });
    expect(res.status).toBe(200);
    expect(res.result?.token.length).toBeGreaterThan(0);
  }, 20_000);

  it('repairs a claims-less existing account without resetting roles already granted', async () => {
    const created = await auth.createUser({ email: EMAIL_HEAL, emailVerified: true });
    expect(created.customClaims).toBeUndefined();

    expect((await callCallable('requestOtp', { email: EMAIL_HEAL })).status).toBe(200);
    const code = await codeFor(EMAIL_HEAL);

    const res = await callCallable<{ token: string }>('verifyOtp', { email: EMAIL_HEAL, code });
    expect(res.status).toBe(200);

    const healed = await auth.getUserByEmail(EMAIL_HEAL);
    expect(healed.uid).toBe(created.uid);
    expect(healed.customClaims).toEqual({ registered: true, roles: ['attendee'], eventId: EVENT_ID });
  }, 20_000);
});
