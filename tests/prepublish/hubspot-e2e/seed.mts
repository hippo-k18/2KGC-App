// Sessions for the owner and four non-owner team members, two ticket types, a
// paid order with its registration, one person holding two tickets from two
// orders, and the registrations Sync all now sends.
// Refuses to run without the private emulator on 8333, so it can never touch live.
import { randomBytes } from 'node:crypto';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { memberIdFor } from '../../../apps/organizer/src/lib/team-core.ts';
import { BACKFILL_N, MEMBERS, MULTI, MULTI_EMAIL, ORDER_EMAIL, ORDER_ID, ORDER_REG, OWNER, bfEmail, bfReg, sha } from './people.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST || !/^(127\.0\.0\.1|localhost):8333$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  console.error('seed.mts only runs against the private emulator on 8333');
  process.exit(1);
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-hubspot-e2e' });
const db = getFirestore();
const now = new Date();

await db.collection(COLLECTIONS.ownerSessions).doc(sha(OWNER)).set({ epoch: randomBytes(16).toString('hex'), updatedAt: now });
for (const [role, email] of Object.entries(MEMBERS)) {
  await db.collection(COLLECTIONS.teamMembers).doc(memberIdFor(email)).set({
    email,
    name: role,
    roles: [role],
    status: 'active',
    sessionEpoch: randomBytes(16).toString('hex'),
    eventId: EVENT_ID,
    invitedBy: OWNER,
    updatedBy: OWNER,
    createdAt: now,
    updatedAt: now,
  });
}

const tier = (name: string, priceCents: number, inPerson: boolean, sortOrder: number) => ({
  eventId: EVENT_ID,
  name,
  priceCents,
  currency: 'usd',
  includesVideoLibrary: true,
  includesWorkshops: false,
  tagline: name,
  includes: [],
  inPerson,
  visible: true,
  sortOrder,
  audience: 'general',
  createdAt: now,
  updatedAt: now,
});
await db.collection(COLLECTIONS.ticketTypes).doc('main-conference').set(tier('Main Conference', 79900, true, 1));
await db.collection(COLLECTIONS.ticketTypes).doc('virtual').set(tier('Virtual Pass', 19900, false, 2));

const reg = (email: string, name: string, ticketType: string, extra: Record<string, unknown> = {}) => ({
  eventId: EVENT_ID,
  email,
  emailHash: sha(email),
  altEmails: [],
  name,
  company: 'Graph Labs',
  title: 'Engineer',
  ticketType,
  status: 'active',
  createdAt: now,
  updatedAt: now,
  ...extra,
});

await db.collection(COLLECTIONS.orders).doc(ORDER_ID).set({
  eventId: EVENT_ID,
  externalId: 'cs_test_e2e_1',
  provider: 'stripe',
  channel: 'checkout',
  email: ORDER_EMAIL,
  buyerName: 'Ada Lovelace',
  status: 'paid',
  items: [
    { ticketTypeId: 'main-conference', ticketTypeName: 'Main Conference', quantity: 1, unitPriceCents: 79900, attendeeEmail: ORDER_EMAIL, attendeeName: 'Ada Lovelace' },
  ],
  totalCents: 71910,
  currency: 'usd',
  promotionCode: 'EARLYBIRD',
  registrationIds: [ORDER_REG],
  purchasedAt: new Date('2026-10-20T15:00:00Z'),
  createdAt: now,
  updatedAt: now,
});
await db.collection(COLLECTIONS.registrations).doc(ORDER_REG).set(reg(ORDER_EMAIL, 'Ada Lovelace', 'Main Conference', { orderId: ORDER_ID, seat: 0 }));

for (const [n, m] of MULTI.entries()) {
  await db.collection(COLLECTIONS.orders).doc(m.order).set({
    eventId: EVENT_ID,
    externalId: `cs_test_e2e_m${n + 1}`,
    provider: 'stripe',
    channel: 'checkout',
    email: MULTI_EMAIL,
    buyerName: 'Mary Multi',
    status: 'paid',
    items: [{ ticketTypeId: m.tier, ticketTypeName: m.name, quantity: 1, unitPriceCents: m.cents, attendeeEmail: MULTI_EMAIL, attendeeName: 'Mary Multi' }],
    totalCents: m.cents,
    currency: 'usd',
    registrationIds: [m.reg],
    purchasedAt: new Date(`2026-10-2${n + 1}T15:00:00Z`),
    createdAt: now,
    updatedAt: now,
  });
  await db.collection(COLLECTIONS.registrations).doc(m.reg).set(reg(MULTI_EMAIL, 'Mary Multi', m.name, { orderId: m.order, seat: 0 }));
}

for (let i = 0; i < BACKFILL_N; i += 400) {
  const batch = db.batch();
  for (let j = i; j < Math.min(BACKFILL_N, i + 400); j++) {
    batch.set(db.collection(COLLECTIONS.registrations).doc(bfReg(j)), reg(bfEmail(j), `Back Fill ${j}`, j % 2 ? 'Virtual Pass' : 'Main Conference'));
  }
  await batch.commit();
}
console.log(`[seed] owner, ${Object.keys(MEMBERS).length} members, 2 ticket types, 1 paid order, 1 person with 2 orders, ${BACKFILL_N} registrations`);
