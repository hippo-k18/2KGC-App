/**
 * The shared demo login (T223) holds a working badge and a profile, both marked
 * `demo: true`. The dashboard lists it but must not count it: not in the
 * attendee totals (`countWhereEvent`) and not in the check-in denominator
 * (`listRegistrations` rows through `countsAsAttendee`).
 *
 * Lives beside the account-deletion dashboard test because it needs the same
 * thing: the dashboard's own data functions against the private emulator from
 * `npm run test:account-deletion`.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';

vi.mock('../../apps/organizer/node_modules/next/cache.js', () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (f: unknown) => f,
}));

import { attendeeListStats, cancelledOrTransferred, countsAsAttendee } from '../../apps/organizer/src/lib/attendees-core';
import { listRegistrations } from '../../apps/organizer/src/lib/checkin';
import { adoptionCounts, countActiveRegistrations, countSignedInAttendees, countWhereEvent, listAttendees } from '../../apps/organizer/src/lib/data';

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-account-deletion';
let db: Firestore;

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run with npm run test:account-deletion.');
  const app = getApps().find((a) => a.name === 'demo-counts') ?? initializeApp({ projectId: PROJECT }, 'demo-counts');
  db = getFirestore(app);
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });

  const reg = (email: string, extra: Record<string, unknown> = {}) => ({
    eventId: EVENT_ID, email, altEmails: [], status: 'active', ticketType: 'All Access (VIP)', qrSecret: email, ...extra,
  });
  await db.doc(`${COLLECTIONS.registrations}/reg_ada`).set(reg('ada@example.com'));
  await db.doc(`${COLLECTIONS.registrations}/reg_ben`).set(reg('ben@example.com'));
  await db.doc(`${COLLECTIONS.registrations}/reg_gone`).set(reg('gone@example.com', { status: 'cancelled' }));
  await db.doc(`${COLLECTIONS.registrations}/reg_demo`).set(reg('demo@knowledgegraph.tech', { demo: true }));
  for (const [uid, demo] of [['ada', false], ['ben', false], ['demo', true]] as const) {
    await db.doc(`${COLLECTIONS.users}/${uid}`).set({
      eventId: EVENT_ID, name: uid, email: demo ? 'demo@knowledgegraph.tech' : `${uid}@example.com`, ...(demo ? { demo: true } : {}),
    });
  }
  await db.doc(`${COLLECTIONS.speakers}/sp1`).set({ eventId: EVENT_ID, name: 'A Speaker' });
});

describe('the shared demo login on the dashboard', () => {
  it('is left out of the registration and user counts', async () => {
    expect(await countWhereEvent(COLLECTIONS.registrations)).toBe(3);
    expect(await countWhereEvent(COLLECTIONS.users)).toBe(2);
  });

  it('is listed at the desk but left out of the check-in total', async () => {
    const rows = (await listRegistrations()).map((r) => r.row);
    expect(rows.find((r) => r.id === 'reg_demo')?.demo).toBe(true);
    expect(rows.filter(countsAsAttendee).map((r) => r.id).sort()).toEqual(['reg_ada', 'reg_ben']);
    // The banner: one cancelled badge, and the demo is not called cancelled.
    expect(cancelledOrTransferred(rows)).toBe(1);
  });

  /*
   * Active tickets only since T268: the cancelled ticket and the demo login
   * are both left out, so "Holding a ticket" is 2, the same figure every
   * registration count on the dashboard reads (T280, gate A#3 and A#6).
   */
  it('reads "Holding a ticket: 2", the same as every registration count', async () => {
    const stats = attendeeListStats(await listAttendees());
    expect(stats.ticketHolders).toBe(2);
    expect(await countActiveRegistrations()).toBe(2);
    expect((await adoptionCounts()).registrations).toBe(2);
  });

  it('still counts a collection the demo has nothing in', async () => {
    expect(await countWhereEvent(COLLECTIONS.speakers)).toBe(1);
  });

  /*
   * T284 (gate N2): Tools › Report and Content › Basics counted every profile,
   * so a cancelled ticket holder who had signed in read "Signed in 3 · 150% of
   * tickets" beside 2 active registrations. Signed in now means an active
   * ticket whose holder has a profile, the header's own figure.
   */
  it('counts only active ticket holders as signed in, as the header does', async () => {
    await db.doc(`${COLLECTIONS.users}/gone`).set({ eventId: EVENT_ID, name: 'gone', email: 'gone@example.com' });
    await db.doc(`${COLLECTIONS.users}/org`).set({ eventId: EVENT_ID, name: 'org', email: 'organizer@example.com' });
    expect(await countWhereEvent(COLLECTIONS.users)).toBe(4);
    expect(await countSignedInAttendees()).toBe(2);
    expect((await adoptionCounts()).signedIn).toBe(2);
  });
});
