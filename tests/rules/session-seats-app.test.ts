/**
 * The app's own seat transactions, run against `firestore.rules`.
 *
 * `session-seats.test.ts` proves the rules refuse a forged request. This proves
 * the other half: that what the app really commits is accepted, including when
 * several phones press the button at once. It imports the app's module, not a
 * copy of it.
 *
 * Run with: npm run test:rules
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { claimSeat, joinSession, leaveSession } from '../../app/src/lib/data/session-seats-tx';

const PROJECT_ID = `kgc-seat-app-test-${process.pid}`;
const UIDS = ['u1', 'u2', 'u3', 'u4', 'u5'];
const email = (uid: string) => `${uid}@kgc.test`;

let env: RulesTestEnvironment;

const as = (uid: string) =>
  env
    .authenticatedContext(uid, { registered: true, roles: ['attendee'], email: email(uid), email_verified: true })
    .firestore() as unknown as Firestore;

async function admin<T>(fn: (db: Firestore) => Promise<T>): Promise<T> {
  let out!: T;
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = await fn(ctx.firestore() as unknown as Firestore);
  });
  return out;
}

const counterOf = (id: string) =>
  admin(async (db) => (await getDoc(doc(db, `sessionSeats/${id}`))).data() as { taken: number; waitlist: string[] });
const seatOf = (id: string, uid: string) =>
  admin(async (db) => (await getDoc(doc(db, `sessionSeats/${id}/seats/${uid}`))).data()?.status as string | undefined);
const onSchedule = (id: string, uid: string) =>
  admin(async (db) => (await getDoc(doc(db, `users/${uid}/savedSessions/${id}`))).exists());

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await admin(async (db) => {
    const session = { eventId: 'kgc-2027', status: 'published', title: 'x' };
    await setDoc(doc(db, 'sessions/capped'), { ...session, capacity: 2 });
    await setDoc(doc(db, 'sessions/workshop'), { ...session, eligibleTicketTypes: ['Full Pass', 'Workshop Pass'] });
    await setDoc(doc(db, 'sessions/open'), session);
    for (const uid of UIDS) {
      await setDoc(doc(db, `registrations/reg_${uid}`), {
        email: email(uid), altEmails: [], status: 'active',
        ticketType: uid === 'u5' ? 'Main Conference' : 'Full Pass',
      });
    }
  });
});

describe('the app joining and leaving', () => {
  it('seats up to the cap and waitlists the rest, even when everybody presses at once', async () => {
    const results = await Promise.all(UIDS.map((uid) => joinSession(as(uid), uid, email(uid), 'capped')));

    expect(results.filter((r) => r.outcome === 'seated')).toHaveLength(2);
    expect(results.filter((r) => r.outcome === 'waitlisted')).toHaveLength(3);

    const counter = await counterOf('capped');
    expect(counter.taken).toBe(2);
    expect(counter.waitlist).toHaveLength(3);
    for (const uid of UIDS) {
      expect(await seatOf('capped', uid)).toBe(counter.waitlist.includes(uid) ? 'waitlisted' : 'seated');
      expect(await onSchedule('capped', uid)).toBe(true);
    }
  });

  it('hands a seat given up to the first person waiting', async () => {
    for (const uid of ['u1', 'u2', 'u3', 'u4']) await joinSession(as(uid), uid, email(uid), 'capped');
    expect((await counterOf('capped')).waitlist).toEqual(['u3', 'u4']);

    await leaveSession(as('u1'), 'u1', 'capped');

    expect(await counterOf('capped')).toMatchObject({ taken: 2, waitlist: ['u4'] });
    expect(await seatOf('capped', 'u1')).toBeUndefined();
    expect(await onSchedule('capped', 'u1')).toBe(false);
    expect(await seatOf('capped', 'u3')).toBe('seated');
    expect(await seatOf('capped', 'u4')).toBe('waitlisted');
  });

  it('lets somebody leave the waitlist without moving anybody else', async () => {
    for (const uid of ['u1', 'u2', 'u3', 'u4']) await joinSession(as(uid), uid, email(uid), 'capped');
    await leaveSession(as('u3'), 'u3', 'capped');
    expect(await counterOf('capped')).toMatchObject({ taken: 2, waitlist: ['u4'] });
    expect(await seatOf('capped', 'u3')).toBeUndefined();
  });

  it('frees the seat when nobody is waiting, and it can be taken again', async () => {
    await joinSession(as('u1'), 'u1', email('u1'), 'capped');
    await joinSession(as('u2'), 'u2', email('u2'), 'capped');
    await leaveSession(as('u2'), 'u2', 'capped');
    expect((await counterOf('capped')).taken).toBe(1);
    expect((await joinSession(as('u3'), 'u3', email('u3'), 'capped')).outcome).toBe('seated');
  });

  it('refuses a ticket the session is not for, in words, and writes nothing', async () => {
    const result = await joinSession(as('u5'), 'u5', email('u5'), 'workshop');
    expect(result.outcome).toBe('ineligible');
    expect(result.message).toBe(
      'This session is for Full Pass and Workshop Pass tickets. Your ticket is Main Conference.',
    );
    expect(await seatOf('workshop', 'u5')).toBeUndefined();
    expect(await onSchedule('workshop', 'u5')).toBe(false);
  });

  it('seats a ticket the session is for', async () => {
    expect((await joinSession(as('u1'), 'u1', email('u1'), 'workshop')).outcome).toBe('seated');
    expect(await onSchedule('workshop', 'u1')).toBe(true);
  });

  it('keeps an ordinary session a plain bookmark with no seat', async () => {
    expect((await joinSession(as('u5'), 'u5', email('u5'), 'open')).outcome).toBe('saved');
    expect(await counterOf('open')).toBeUndefined();
    await leaveSession(as('u5'), 'u5', 'open');
    expect(await onSchedule('open', 'u5')).toBe(false);
  });

  it('lets the first in line claim a seat after the cap is raised, and nobody else', async () => {
    for (const uid of ['u1', 'u2', 'u3', 'u4']) await joinSession(as(uid), uid, email(uid), 'capped');
    expect(await claimSeat(as('u3'), 'u3', 'capped')).toBe(false);

    await admin((db) => setDoc(doc(db, 'sessions/capped'), { capacity: 3 }, { merge: true }));

    expect(await claimSeat(as('u4'), 'u4', 'capped')).toBe(false);
    expect(await claimSeat(as('u3'), 'u3', 'capped')).toBe(true);
    expect(await counterOf('capped')).toMatchObject({ taken: 3, waitlist: ['u4'] });
    expect(await seatOf('capped', 'u3')).toBe('seated');
  });
});
