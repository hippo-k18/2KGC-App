/**
 * Signing in with an emailed code, for somebody whose ticket is not stored at
 * `registrationId(email)` (T259 #7).
 *
 * A second purchase, a comp pass or a group seat gets its own registration id.
 * Sign-in looked only at the address's own id and its alternates, so a buyer
 * whose first order was refunded and whose second was paid was told they had
 * no ticket.
 *
 * Firestore and Auth emulators only. Run with: npm run test:commerce
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { registrationId } from '../../scripts/src/lib/ids.js';
import { otpDocId } from '../../scripts/src/lib/otp-ids.js';
import { verifySignInCode } from '../../scripts/src/lib/otp-core.js';

let db: Firestore;
let auth: Auth;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Needs the Firestore and Auth emulators. Use: npm run test:commerce');
  }
  if (!getApps().length) initializeApp({ projectId: 'kgc-conference-app-and-website' });
  db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  auth = getAuth();
});

async function clear(collection: string) {
  const snap = await db.collection(collection).where('eventId', '==', EVENT_ID).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  await Promise.all([clear(COLLECTIONS.registrations), clear(COLLECTIONS.otpCodes)]);
  const users = await auth.listUsers(1000);
  await Promise.all(users.users.map((u) => auth.deleteUser(u.uid)));
});

async function issueCode(email: string, code = '123456') {
  await db.doc(`${COLLECTIONS.otpCodes}/${otpDocId(email)}`).set({
    eventId: EVENT_ID,
    email,
    code,
    attempts: 0,
    expiresAt: new Date(Date.now() + 600_000),
    createdAt: new Date(),
  });
}

const reg = (id: string, email: string, status: string) =>
  db.collection(COLLECTIONS.registrations).doc(id).set({
    eventId: EVENT_ID,
    email,
    name: 'Ada Buyer',
    ticketType: 'Main Conference',
    status,
    qrSecret: id,
  });

describe('sign-in finds any active ticket on the address', () => {
  it('lets in the holder of a second, paid ticket when the first was refunded', async () => {
    await reg(registrationId('ada@example.com'), 'ada@example.com', 'cancelled');
    await reg('reg_second_order', 'ada@example.com', 'active');
    await issueCode('ada@example.com');

    const result = await verifySignInCode(db, auth, 'ada@example.com', '123456', undefined);
    expect(result.ok).toBe(true);
  });

  it('still refuses an address whose only tickets are cancelled', async () => {
    await reg(registrationId('bo@example.com'), 'bo@example.com', 'cancelled');
    await reg('reg_bo_second', 'bo@example.com', 'transferred');
    await issueCode('bo@example.com');

    const result = await verifySignInCode(db, auth, 'bo@example.com', '123456', undefined);
    expect(result).toEqual({ ok: false, reason: 'no-registration' });
  });
});
