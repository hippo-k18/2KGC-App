/**
 * The Resend bounce webhook's writes (T258 #9), against the emulator: a bounce
 * lands on the contact, the attendee and the log row, a complaint on the
 * contact, and nothing is created for an address we do not hold.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { contactId } from '@kgc/scripts/src/lib/ids';
import { db as dashDb } from '@/lib/firestore';
import { recordDeliveryProblem } from '../../apps/web/src/lib/resend-webhook';

let db: Firestore;

beforeAll(() => {
  db = dashDb() as unknown as Firestore;
});

beforeEach(async () => {
  for (const c of [COLLECTIONS.contacts, COLLECTIONS.registrations, COLLECTIONS.emailLog]) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
});

describe('recording a bounce', () => {
  it('marks the contact, the registration and the log row, and keeps the first time', async () => {
    const at = new Date('2026-10-14T10:00:00Z');
    await db.collection(COLLECTIONS.contacts).doc(contactId('ada@example.com')).set({ eventId: EVENT_ID, email: 'ada@example.com', lists: ['x'] });
    await db.collection(COLLECTIONS.registrations).doc('reg_1').set({ eventId: EVENT_ID, email: 'ada@example.com', status: 'active' });
    await db.collection(COLLECTIONS.emailLog).doc('log_1').set({ eventId: EVENT_ID, to: 'ada@example.com', providerId: 'em_1', status: 'sent' });

    await recordDeliveryProblem({ kind: 'bounced', emails: ['ada@example.com'], emailId: 'em_1', at });
    await recordDeliveryProblem({ kind: 'bounced', emails: ['ada@example.com'], emailId: 'em_1', at: new Date() });

    const contact = await db.collection(COLLECTIONS.contacts).doc(contactId('ada@example.com')).get();
    const reg = await db.collection(COLLECTIONS.registrations).doc('reg_1').get();
    const log = await db.collection(COLLECTIONS.emailLog).doc('log_1').get();
    expect(contact.get('bouncedAt').toDate()).toEqual(at);
    expect(reg.get('bouncedAt').toDate()).toEqual(at);
    expect(log.get('bouncedAt').toDate()).toEqual(at);
    expect(log.get('status')).toBe('sent');
  });

  it('records a complaint, and creates nothing for an unknown address', async () => {
    await db.collection(COLLECTIONS.contacts).doc(contactId('bo@example.com')).set({ eventId: EVENT_ID, email: 'bo@example.com', lists: [] });
    await recordDeliveryProblem({ kind: 'complained', emails: ['bo@example.com', 'nobody@example.com'], at: new Date() });

    expect((await db.collection(COLLECTIONS.contacts).doc(contactId('bo@example.com')).get()).get('complainedAt')).toBeTruthy();
    expect((await db.collection(COLLECTIONS.contacts).doc(contactId('nobody@example.com')).get()).exists).toBe(false);
  });
});
