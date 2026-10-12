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

import { countsAsAttendee } from '../../apps/organizer/src/lib/attendees-core';
import { listRegistrations } from '../../apps/organizer/src/lib/checkin';
import { countWhereEvent } from '../../apps/organizer/src/lib/data';

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
    await db.doc(`${COLLECTIONS.users}/${uid}`).set({ eventId: EVENT_ID, name: uid, ...(demo ? { demo: true } : {}) });
  }
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
  });
});
