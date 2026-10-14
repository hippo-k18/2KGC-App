/**
 * T266: the pure and Auth-level halves of the payment edge-case fixes.
 *
 *  - `endAppAccessIfNoTicket`: a refund or dispute that leaves an address with
 *    no active ticket ends its app access, as the dashboard's
 *    `setAppAccess(email, false)` does (T259 #6). Against the Auth emulator.
 *  - `decideRefund` on a `pending` order touches nothing (T257 #4).
 *  - `checkoutExpiresAt`: an hour, or the next price change, never under
 *    Stripe's 30 minutes (T257 #6).
 *
 * Run with: npm run test:commerce
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type OrderDoc } from '@kgc/shared';

import { endAppAccessIfNoTicket } from '../../apps/web/src/lib/app-account-core.js';
import { decideRefund } from '../../apps/web/src/lib/refund-core.js';
import { checkoutExpiresAt } from '../../apps/web/src/lib/checkout-expiry.js';

let db: Firestore;
let auth: Auth;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('These tests change Auth accounts and run only on the emulators. Use: npm run test:commerce');
  }
  if (!getApps().length) initializeApp({ projectId: 'kgc-conference-app-and-website' });
  db = getFirestore();
  auth = getAuth();
});

beforeEach(async () => {
  const snap = await db.collection(COLLECTIONS.registrations).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
  const { users } = await auth.listUsers(1000);
  if (users.length > 0) await auth.deleteUsers(users.map((u) => u.uid));
});

async function attendee(email: string, roles: string[] = ['attendee']) {
  const user = await auth.createUser({ email });
  await auth.setCustomUserClaims(user.uid, { registered: true, roles, eventId: EVENT_ID });
  return user.uid;
}

async function ticket(id: string, email: string, status: 'active' | 'cancelled', altEmails: string[] = []) {
  await db.collection(COLLECTIONS.registrations).doc(id).set({ eventId: EVENT_ID, email, status, altEmails });
}

const claims = async (uid: string) => (await auth.getUser(uid)).customClaims;

describe('ending app access after a refund or dispute (T259 #6)', () => {
  it('clears `registered` and revokes tokens when no active ticket is left', async () => {
    const uid = await attendee('ada@example.com');
    await ticket('reg_a', 'ada@example.com', 'cancelled');
    expect(await endAppAccessIfNoTicket(auth, db, 'Ada@Example.com')).toBe('revoked');
    expect(await claims(uid)).toMatchObject({ registered: false, roles: ['attendee'] });
    expect((await auth.getUser(uid)).tokensValidAfterTime).toBeTruthy();
  });

  it('keeps access while another ticket on the address is still active', async () => {
    const uid = await attendee('ada@example.com');
    await ticket('reg_a', 'ada@example.com', 'cancelled');
    await ticket('reg_b', 'ada@example.com', 'active');
    expect(await endAppAccessIfNoTicket(auth, db, 'ada@example.com')).toBe('kept');
    expect(await claims(uid)).toMatchObject({ registered: true });
  });

  it('keeps access for a ticket that lists the address as an alternative', async () => {
    const uid = await attendee('ada@work.example');
    await ticket('reg_c', 'ada@example.com', 'active', ['ada@work.example']);
    expect(await endAppAccessIfNoTicket(auth, db, 'ada@work.example')).toBe('kept');
    expect(await claims(uid)).toMatchObject({ registered: true });
  });

  it('keeps access for a speaker or staff member, whatever their tickets', async () => {
    const uid = await attendee('sam@example.com', ['attendee', 'speaker']);
    expect(await endAppAccessIfNoTicket(auth, db, 'sam@example.com')).toBe('kept');
    expect(await claims(uid)).toMatchObject({ registered: true });
  });

  it('does nothing for an address with no account', async () => {
    expect(await endAppAccessIfNoTicket(auth, db, 'nobody@example.com')).toBe('none');
  });
});

describe('a refund or dispute on an order still pending (T257 #4)', () => {
  const pending = {
    status: 'pending',
    totalCents: 30_000,
    items: [{ ticketTypeId: 'main-conference', quantity: 3 }],
  } as unknown as OrderDoc;

  it.each(['refunded', 'disputed'] as const)('%s: closes the order, returns no seat, voids no ticket', (reason) => {
    const d = decideRefund(pending, { reason, refundedCents: 30_000 });
    expect(d).toMatchObject({ unfulfilled: true, newlyRefunded: false, lines: [] });
    expect(d.status).toBe(reason === 'refunded' ? 'refunded' : 'cancelled');
  });

  it('a paid order is unchanged: its seats come back once', () => {
    const d = decideRefund({ ...pending, status: 'paid' }, { reason: 'refunded', refundedCents: 30_000 });
    expect(d).toMatchObject({ unfulfilled: false, newlyRefunded: true, lines: [{ ticketTypeId: 'main-conference', quantity: 3 }] });
  });
});

describe('Checkout session expiry (T257 #6)', () => {
  const now = new Date('2026-11-30T20:00:00Z');
  const secs = (d: Date) => Math.floor(d.getTime() / 1000);
  const plus = (min: number) => new Date(now.getTime() + min * 60_000);

  it('is an hour with nothing scheduled', () => {
    expect(checkoutExpiresAt(now)).toBe(secs(plus(60)));
  });
  it('ends at the next price change when that is sooner', () => {
    expect(checkoutExpiresAt(now, plus(45))).toBe(secs(plus(45)));
  });
  it('never goes under the 30 minutes Stripe allows', () => {
    expect(checkoutExpiresAt(now, plus(5))).toBe(secs(plus(31)));
  });
  it('ignores a change after the hour', () => {
    expect(checkoutExpiresAt(now, plus(600))).toBe(secs(plus(60)));
  });
});
