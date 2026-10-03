/**
 * Rules tests for session seats: capacity, ticket eligibility and the waitlist.
 *
 * Same stance as `firestore.test.ts`: each test is a sentence you could say to
 * an attendee. Every write here is a batch, because that is what the app's
 * transaction commits and the rules check the two documents against each other
 * with `getAfter()`. A lone write to either one is itself one of the attacks.
 *
 * Run with: npm run test:rules
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  collection,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const A = 'attendeeA';
const B = 'attendeeB';
const C = 'attendeeC';
const ORG = 'organizerU';

const D = 'attendeeD';

const REG: Record<string, string> = { [A]: 'reg_a', [B]: 'reg_b', [C]: 'reg_c', [D]: 'reg_d' };

let env: RulesTestEnvironment;

const attendee = (uid: string) => ({
  registered: true,
  roles: ['attendee'],
  email: `${uid}@kgc.test`,
  email_verified: true,
});

// Unique per process, for the reason given at length in `firestore.test.ts`.
const PROJECT_ID = `kgc-seat-rules-test-${process.pid}`;

const as = (uid: string) => env.authenticatedContext(uid, attendee(uid)).firestore() as unknown as Firestore;

const CAPPED = 'capped'; // two seats, every ticket
const WORKSHOP = 'workshop'; // uncapped, Full Pass only
const OPEN = 'open'; // neither

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const session = { eventId: 'kgc-2027', status: 'published', title: 'x' };
    await setDoc(doc(db, `sessions/${CAPPED}`), { ...session, capacity: 2 });
    await setDoc(doc(db, `sessions/${WORKSHOP}`), { ...session, eligibleTicketTypes: ['Full Pass'] });
    await setDoc(doc(db, `sessions/${OPEN}`), session);
    await setDoc(doc(db, 'sessions/draft'), { ...session, status: 'draft', capacity: 2 });
    await setDoc(doc(db, 'registrations/reg_a'), {
      email: `${A}@kgc.test`, altEmails: [], status: 'active', ticketType: 'Full Pass',
    });
    await setDoc(doc(db, 'registrations/reg_b'), {
      email: `${B}@kgc.test`, altEmails: [], status: 'active', ticketType: 'Main Conference',
    });
    await setDoc(doc(db, 'registrations/reg_c'), {
      email: `${C}@kgc.test`, altEmails: [], status: 'active', ticketType: 'Full Pass',
    });
    await setDoc(doc(db, 'registrations/reg_cancelled'), {
      email: `${C}@kgc.test`, altEmails: [], status: 'cancelled', ticketType: 'Full Pass',
    });
  });
});

/** Puts the database in a given state with rules off. */
async function given(
  sessionId: string,
  state: { taken: number; waitlist: string[] },
  seats: Record<string, 'seated' | 'waitlisted'>,
) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `sessionSeats/${sessionId}`), {
      eventId: 'kgc-2027', sessionId, ...state, updatedAt: new Date(),
    });
    for (const [uid, status] of Object.entries(seats)) {
      await setDoc(doc(db, `sessionSeats/${sessionId}/seats/${uid}`), {
        eventId: 'kgc-2027', sessionId, uid, registrationId: REG[uid], status, createdAt: new Date(),
      });
    }
  });
}

const counter = (sessionId: string, taken: number, waitlist: string[]) => ({
  eventId: 'kgc-2027', sessionId, taken, waitlist, updatedAt: serverTimestamp(),
});

const seat = (
  sessionId: string,
  uid: string,
  status: 'seated' | 'waitlisted',
  registrationId = REG[uid],
) => ({ eventId: 'kgc-2027', sessionId, uid, registrationId, status, createdAt: serverTimestamp() });

/** What the app commits when `uid` joins: counter, seat and schedule entry. */
function join(
  uid: string,
  sessionId: string,
  next: { taken: number; waitlist: string[] },
  status: 'seated' | 'waitlisted',
  registrationId?: string,
) {
  const db = as(uid);
  const batch = writeBatch(db);
  batch.set(doc(db, `sessionSeats/${sessionId}`), counter(sessionId, next.taken, next.waitlist));
  batch.set(doc(db, `sessionSeats/${sessionId}/seats/${uid}`), seat(sessionId, uid, status, registrationId));
  batch.set(doc(db, `users/${uid}/savedSessions/${sessionId}`), {
    sessionId, savedAt: serverTimestamp(), remind: true,
  });
  return batch.commit();
}

describe('taking a seat', () => {
  it('the first attendee takes a seat and the session lands on their schedule', async () => {
    await assertSucceeds(join(A, CAPPED, { taken: 1, waitlist: [] }, 'seated'));
  });

  it('the last seat can be taken', async () => {
    await given(CAPPED, { taken: 1, waitlist: [] }, { [A]: 'seated' });
    await assertSucceeds(join(B, CAPPED, { taken: 2, waitlist: [] }, 'seated'));
  });

  it('nobody takes a seat beyond the cap', async () => {
    await given(CAPPED, { taken: 2, waitlist: [] }, { [A]: 'seated', [B]: 'seated' });
    await assertFails(join(C, CAPPED, { taken: 3, waitlist: [] }, 'seated'));
  });

  it('a seat cannot be written without moving the counter', async () => {
    const db = as(A);
    await assertFails(setDoc(doc(db, `sessionSeats/${CAPPED}/seats/${A}`), seat(CAPPED, A, 'seated')));
  });

  it('the counter cannot be moved without a seat', async () => {
    const db = as(A);
    await assertFails(setDoc(doc(db, `sessionSeats/${CAPPED}`), counter(CAPPED, 1, [])));
  });

  it('the counter cannot be lowered by somebody who holds no seat', async () => {
    await given(CAPPED, { taken: 2, waitlist: [] }, { [A]: 'seated', [B]: 'seated' });
    const db = as(C);
    await assertFails(setDoc(doc(db, `sessionSeats/${CAPPED}`), counter(CAPPED, 1, [])));
  });

  it('nobody takes two seats', async () => {
    await given(CAPPED, { taken: 1, waitlist: [] }, { [A]: 'seated' });
    await assertFails(join(A, CAPPED, { taken: 2, waitlist: [] }, 'seated'));
  });

  it('nobody takes a seat for somebody else', async () => {
    const db = as(A);
    const batch = writeBatch(db);
    batch.set(doc(db, `sessionSeats/${CAPPED}`), counter(CAPPED, 1, []));
    batch.set(doc(db, `sessionSeats/${CAPPED}/seats/${B}`), seat(CAPPED, B, 'seated'));
    await assertFails(batch.commit());
  });

  it('a seat has to name the caller\'s own registration', async () => {
    await assertFails(join(B, CAPPED, { taken: 1, waitlist: [] }, 'seated', 'reg_a'));
  });

  it('a cancelled ticket takes no seat', async () => {
    await assertFails(join(C, CAPPED, { taken: 1, waitlist: [] }, 'seated', 'reg_cancelled'));
  });

  it('an unpublished session takes no seats', async () => {
    await assertFails(join(A, 'draft', { taken: 1, waitlist: [] }, 'seated'));
  });

  it('a newcomer cannot take a free seat while others are waiting for it', async () => {
    await given(CAPPED, { taken: 1, waitlist: [B] }, { [A]: 'seated', [B]: 'waitlisted' });
    await assertFails(join(C, CAPPED, { taken: 2, waitlist: [B] }, 'seated'));
    await assertSucceeds(join(C, CAPPED, { taken: 1, waitlist: [B, C] }, 'waitlisted'));
  });
});

describe('ticket eligibility', () => {
  it('a ticket the session is for gets in', async () => {
    await assertSucceeds(join(A, WORKSHOP, { taken: 1, waitlist: [] }, 'seated'));
  });

  it('a ticket the session is not for is refused', async () => {
    await assertFails(join(B, WORKSHOP, { taken: 1, waitlist: [] }, 'seated'));
  });

  it('a restricted session cannot be put on a schedule without a seat', async () => {
    const db = as(B);
    await assertFails(
      setDoc(doc(db, `users/${B}/savedSessions/${WORKSHOP}`), {
        sessionId: WORKSHOP, savedAt: serverTimestamp(), remind: true,
      }),
    );
  });

  it('a capped session cannot be put on a schedule without a seat', async () => {
    const db = as(A);
    await assertFails(
      setDoc(doc(db, `users/${A}/savedSessions/${CAPPED}`), {
        sessionId: CAPPED, savedAt: serverTimestamp(), remind: true,
      }),
    );
  });

  it('an ordinary session is still a plain bookmark', async () => {
    const db = as(B);
    await assertSucceeds(
      setDoc(doc(db, `users/${B}/savedSessions/${OPEN}`), {
        sessionId: OPEN, savedAt: serverTimestamp(), remind: true,
      }),
    );
  });
});

describe('the waitlist', () => {
  const full = () => given(CAPPED, { taken: 2, waitlist: [] }, { [A]: 'seated', [B]: 'seated' });

  it('a full session takes a waitlist place', async () => {
    await full();
    await assertSucceeds(join(C, CAPPED, { taken: 2, waitlist: [C] }, 'waitlisted'));
  });

  it('nobody waitlists a session that still has seats', async () => {
    await given(CAPPED, { taken: 1, waitlist: [] }, { [A]: 'seated' });
    await assertFails(join(C, CAPPED, { taken: 1, waitlist: [C] }, 'waitlisted'));
  });

  it('nobody joins the front of the queue', async () => {
    await given(CAPPED, { taken: 2, waitlist: [B] }, { [A]: 'seated', [B]: 'waitlisted' });
    await assertFails(join(C, CAPPED, { taken: 2, waitlist: [C, B] }, 'waitlisted'));
  });

  it('a ticket the session is not for cannot wait for it either', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sessions/${WORKSHOP}`), { capacity: 1 }, { merge: true });
    });
    await given(WORKSHOP, { taken: 1, waitlist: [] }, { [A]: 'seated' });
    await assertFails(join(B, WORKSHOP, { taken: 1, waitlist: [B] }, 'waitlisted'));
  });

  it('giving up a seat hands it to the first person waiting', async () => {
    await given(CAPPED, { taken: 2, waitlist: [C] }, { [A]: 'seated', [B]: 'seated', [C]: 'waitlisted' });
    const db = as(A);
    const batch = writeBatch(db);
    batch.set(doc(db, `sessionSeats/${CAPPED}`), counter(CAPPED, 2, []));
    batch.delete(doc(db, `sessionSeats/${CAPPED}/seats/${A}`));
    batch.update(doc(db, `sessionSeats/${CAPPED}/seats/${C}`), {
      status: 'seated', promotedAt: serverTimestamp(),
    });
    batch.delete(doc(db, `users/${A}/savedSessions/${CAPPED}`));
    await assertSucceeds(batch.commit());
  });

  it('the rest of the queue keeps its order when the first is promoted', async () => {
    await given(
      CAPPED,
      { taken: 2, waitlist: [C, D, B] },
      { [A]: 'seated', [C]: 'waitlisted', [D]: 'waitlisted', [B]: 'waitlisted' },
    );
    const leave = (waitlist: string[]) => {
      const db = as(A);
      const batch = writeBatch(db);
      batch.set(doc(db, `sessionSeats/${CAPPED}`), counter(CAPPED, 2, waitlist));
      batch.delete(doc(db, `sessionSeats/${CAPPED}/seats/${A}`));
      batch.update(doc(db, `sessionSeats/${CAPPED}/seats/${C}`), {
        status: 'seated', promotedAt: serverTimestamp(),
      });
      return batch.commit();
    };
    await assertFails(leave([B, D]));
    await assertFails(leave([D]));
    await assertSucceeds(leave([D, B]));
  });

  it('a seat cannot be given up in a way that skips the waitlist', async () => {
    await given(CAPPED, { taken: 2, waitlist: [C] }, { [A]: 'seated', [B]: 'seated', [C]: 'waitlisted' });
    const db = as(A);
    const batch = writeBatch(db);
    batch.set(doc(db, `sessionSeats/${CAPPED}`), counter(CAPPED, 1, [C]));
    batch.delete(doc(db, `sessionSeats/${CAPPED}/seats/${A}`));
    await assertFails(batch.commit());
  });

  it('nobody promotes themselves past the person in front', async () => {
    await given(
      CAPPED,
      { taken: 2, waitlist: [B, C] },
      { [A]: 'seated', [B]: 'waitlisted', [C]: 'waitlisted' },
    );
    const db = as(C);
    await assertFails(
      writeBatch(db)
        .update(doc(db, `sessionSeats/${CAPPED}/seats/${C}`), { status: 'seated', promotedAt: serverTimestamp() })
        .commit(),
    );
    const batch = writeBatch(db);
    batch.set(doc(db, `sessionSeats/${CAPPED}`), counter(CAPPED, 2, [B]));
    batch.update(doc(db, `sessionSeats/${CAPPED}/seats/${C}`), { status: 'seated', promotedAt: serverTimestamp() });
    await assertFails(batch.commit());
  });

  it('nobody promotes a friend without giving up a seat of their own', async () => {
    await given(CAPPED, { taken: 2, waitlist: [C] }, { [A]: 'seated', [B]: 'seated', [C]: 'waitlisted' });
    const db = as(C);
    const batch = writeBatch(db);
    batch.set(doc(db, `sessionSeats/${CAPPED}`), counter(CAPPED, 2, []));
    batch.update(doc(db, `sessionSeats/${CAPPED}/seats/${C}`), { status: 'seated', promotedAt: serverTimestamp() });
    await assertFails(batch.commit());
  });

  it('first in line claims a seat once the cap is raised', async () => {
    await given(CAPPED, { taken: 2, waitlist: [C] }, { [A]: 'seated', [B]: 'seated', [C]: 'waitlisted' });
    const claim = () => {
      const db = as(C);
      const batch = writeBatch(db);
      batch.set(doc(db, `sessionSeats/${CAPPED}`), counter(CAPPED, 3, []));
      batch.update(doc(db, `sessionSeats/${CAPPED}/seats/${C}`), { status: 'seated', promotedAt: serverTimestamp() });
      return batch.commit();
    };
    await assertFails(claim());
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sessions/${CAPPED}`), { capacity: 3 }, { merge: true });
    });
    await assertSucceeds(claim());
  });

  it('leaving the waitlist keeps everybody else in order', async () => {
    await given(
      CAPPED,
      { taken: 2, waitlist: [B, C] },
      { [A]: 'seated', [B]: 'waitlisted', [C]: 'waitlisted' },
    );
    const db = as(B);
    const batch = writeBatch(db);
    batch.set(doc(db, `sessionSeats/${CAPPED}`), counter(CAPPED, 2, [C]));
    batch.delete(doc(db, `sessionSeats/${CAPPED}/seats/${B}`));
    await assertSucceeds(batch.commit());
  });

  it('nobody removes another person from the waitlist', async () => {
    await given(
      CAPPED,
      { taken: 2, waitlist: [B, C] },
      { [A]: 'seated', [B]: 'waitlisted', [C]: 'waitlisted' },
    );
    const db = as(C);
    await assertFails(setDoc(doc(db, `sessionSeats/${CAPPED}`), counter(CAPPED, 2, [C])));
    await assertFails(deleteDoc(doc(db, `sessionSeats/${CAPPED}/seats/${B}`)));
  });

  it('a seat given up with nobody waiting frees it', async () => {
    await given(CAPPED, { taken: 2, waitlist: [] }, { [A]: 'seated', [B]: 'seated' });
    const db = as(A);
    const batch = writeBatch(db);
    batch.set(doc(db, `sessionSeats/${CAPPED}`), counter(CAPPED, 1, []));
    batch.delete(doc(db, `sessionSeats/${CAPPED}/seats/${A}`));
    await assertSucceeds(batch.commit());
  });
});

describe('who can see what', () => {
  it('any ticket holder reads the count, only the holder reads a seat', async () => {
    await given(CAPPED, { taken: 1, waitlist: [] }, { [A]: 'seated' });
    await assertSucceeds(getDoc(doc(as(B), `sessionSeats/${CAPPED}`)));
    await assertSucceeds(getDoc(doc(as(A), `sessionSeats/${CAPPED}/seats/${A}`)));
    await assertFails(getDoc(doc(as(B), `sessionSeats/${CAPPED}/seats/${A}`)));
    await assertFails(getDocs(collection(as(B), `sessionSeats/${CAPPED}/seats`)));
  });

  it('somebody without a ticket reads nothing', async () => {
    await given(CAPPED, { taken: 1, waitlist: [] }, { [A]: 'seated' });
    const db = env.authenticatedContext('stranger', { email: 'x@kgc.test' }).firestore();
    await assertFails(getDoc(doc(db, `sessionSeats/${CAPPED}`)));
  });

  it('an organizer lists the seats of a session', async () => {
    await given(CAPPED, { taken: 1, waitlist: [] }, { [A]: 'seated' });
    const db = env
      .authenticatedContext(ORG, { ...attendee(ORG), roles: ['attendee', 'organizer'] })
      .firestore();
    await assertSucceeds(getDocs(collection(db, `sessionSeats/${CAPPED}/seats`)));
  });

  it('a counter is never deleted', async () => {
    await given(CAPPED, { taken: 0, waitlist: [] }, {});
    await assertFails(deleteDoc(doc(as(A), `sessionSeats/${CAPPED}`)));
  });
});
