/**
 * What the dashboard does to orders: manual orders, erasing a person, and the
 * abandoned-checkout list (T135, T136). Real dashboard code against the
 * Firestore emulator; email is unset, so confirmations log as skipped.
 *
 * Run with: npm run test:dashboard-orders
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireOrganizer: async () => 'organizer@example.com',
  requirePassphrase: () => false,
}));
vi.mock('../../apps/organizer/node_modules/next/cache.js', () => ({ revalidatePath: () => {} }));
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type OrderDoc, type RegistrationDoc } from '@kgc/shared';
import { registrationId } from '@kgc/scripts/src/lib/ids';
import { db as dashDb } from '@/lib/firestore';
import { isAbandoned } from '@/lib/commerce';
import { recordManualOrder } from '@/lib/manual-orders';
import { erasePerson, resolvePerson } from '@/lib/person-data';

let db: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:dashboard-orders');
  }
  db = dashDb() as unknown as Firestore;
});

async function wipe(collection: string) {
  const snap = await db.collection(collection).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  delete process.env.RESEND_API_KEY;
  await Promise.all(
    [COLLECTIONS.registrations, COLLECTIONS.orders, COLLECTIONS.ticketTypes, COLLECTIONS.auditLog, COLLECTIONS.emailLog, COLLECTIONS.users, COLLECTIONS.stripeIgnored].map(wipe),
  );
  for (const [id, name, total] of [
    ['main-conference', 'Main Conference', 100],
    ['virtual', 'Virtual', 100],
    ['platinum', 'Platinum Sponsor', 1],
  ] as const) {
    await db.collection(COLLECTIONS.ticketTypes).doc(id).set({
      eventId: EVENT_ID,
      name,
      priceCents: 50_000,
      currency: 'usd',
      quantityTotal: total,
      quantitySold: 0,
    });
  }
});

const sold = async (tier: string) => (await db.collection(COLLECTIONS.ticketTypes).doc(tier).get()).data()?.quantitySold;
const manualOrders = async () =>
  (await db.collection(COLLECTIONS.orders).where('channel', '==', 'manual').get()).docs.map((d) => d.data() as OrderDoc);

const manual = (over: Partial<Parameters<typeof recordManualOrder>[0]> = {}) =>
  recordManualOrder({
    email: 'ada@example.com',
    name: 'Ada Nakamura',
    ticketTypeId: 'main-conference',
    amountCents: 50_000,
    note: 'Cheque 1001',
    actor: 'organizer@example.com',
    ...over,
  });

describe('manual orders (S8/TK-283, N1)', () => {
  it('a second order for the same person and package adds a ticket, and keeps the first order', async () => {
    expect((await manual({ requestId: 'req-first-0001' })).ok).toBe(true);
    expect((await manual({ requestId: 'req-second-002', amountCents: 20_000, note: 'Wire 2002' })).ok).toBe(true);

    const orders = await manualOrders();
    expect(orders.map((o) => [o.totalCents, o.outOfBandNote]).sort()).toEqual([
      [20_000, 'Wire 2002'],
      [50_000, 'Cheque 1001'],
    ]);
    expect(await sold('main-conference')).toBe(2);
    const regs = await db.collection(COLLECTIONS.registrations).where('email', '==', 'ada@example.com').get();
    expect(regs.size).toBe(2);
    expect(new Set(orders.flatMap((o) => o.registrationIds)).size).toBe(2);
  });

  it('the same form posted twice at once is one order and one seat', async () => {
    const [a, b] = await Promise.all([manual({ requestId: 'req-double-001' }), manual({ requestId: 'req-double-001' })]);
    expect(a.ok && b.ok).toBe(true);
    expect(await manualOrders()).toHaveLength(1);
    expect(await sold('main-conference')).toBe(1);
  });

  it('refuses a sold-out package instead of issuing a ticket past capacity', async () => {
    expect((await manual({ ticketTypeId: 'platinum', email: 'acme@example.com', requestId: 'req-plat-0001' })).ok).toBe(true);
    const second = await manual({ ticketTypeId: 'platinum', email: 'globex@example.com', requestId: 'req-plat-0002' });
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/sold out/);
    expect(await sold('platinum')).toBe(1);
    expect(await manualOrders()).toHaveLength(1);
  });

  it('gives somebody who already holds a paid ticket a second ticket, not a rewritten one (N1)', async () => {
    const rid = registrationId('ada@example.com');
    await db.collection(COLLECTIONS.orders).doc('ord_paid_virtual').set({
      eventId: EVENT_ID, externalId: 'cs_x', provider: 'stripe', channel: 'checkout', email: 'ada@example.com',
      status: 'paid', totalCents: 12_900, currency: 'usd', registrationIds: [rid],
      items: [{ ticketTypeId: 'virtual', ticketTypeName: 'Virtual', quantity: 1, unitPriceCents: 12_900 }],
    });
    await db.collection(COLLECTIONS.registrations).doc(rid).set({
      eventId: EVENT_ID, email: 'ada@example.com', name: 'Ada Nakamura', ticketType: 'Virtual', status: 'active',
      orderId: 'ord_paid_virtual', seat: 0, claimCode: 'ABCD-EFGH', qrSecret: 'q'.repeat(32), altEmails: [],
    });

    const res = await manual({ requestId: 'req-n1-000001' });
    expect(res.ok).toBe(true);
    expect(res.registrationId).not.toBe(rid);
    expect(((await db.collection(COLLECTIONS.registrations).doc(rid).get()).data() as RegistrationDoc).ticketType).toBe('Virtual');
  });
});

describe('erasing a person (TK-502)', () => {
  it('gives their seat back and takes their ticket off the order, which stays paid', async () => {
    const res = await manual({ requestId: 'req-erase-0001' });
    const rid = res.registrationId!;
    expect(await sold('main-conference')).toBe(1);

    const identity = await resolvePerson({ registrationId: rid });
    const erased = await erasePerson(identity!, 'ada@example.com', 'organizer@example.com');
    expect(erased.ok).toBe(true);

    expect((await db.collection(COLLECTIONS.registrations).doc(rid).get()).exists).toBe(false);
    expect(await sold('main-conference')).toBe(0);
    const [order] = await manualOrders();
    expect(order.status).toBe('paid');
    expect(order.registrationIds).toEqual([]);
    expect(order.erasedRegistrationIds).toEqual([rid]);
    expect(order.releasedSeats).toEqual({ [rid]: 'main-conference' });
    expect(order.email).toBeFalsy();
  });

  it('leaves Attendee Orders and the email log readable afterwards (T138B, TK-301)', async () => {
    const res = await manual({ requestId: 'req-erase-0002' });
    await manual({ requestId: 'req-other-0001', email: 'ben@example.com', name: 'Ben Olsen' });
    const identity = await resolvePerson({ registrationId: res.registrationId! });
    await erasePerson(identity!, 'ada@example.com', 'organizer@example.com');
    // An emailLog row whose recipient was erased.
    await db.collection(COLLECTIONS.emailLog).add({ eventId: EVENT_ID, to: null, template: 'purchase-confirmation', subject: 'x', status: 'sent', at: new Date() });

    const { listOrders, recentEmails } = await import('@/lib/commerce');
    const rows = await listOrders();
    expect(rows.map((r) => typeof r.email)).toEqual(['string', 'string']);
    expect((await recentEmails()).every((e) => typeof e.to === 'string')).toBe(true);

    const { renderToStaticMarkup } = await import('../../apps/organizer/node_modules/react-dom/server.js');
    const { default: AttendeeOrdersPage } = await import('@/app/(dash)/tickets/orders-and-transactions/attendee-orders/page');
    for (const q of ['', 'ben']) {
      const el = await AttendeeOrdersPage({ searchParams: Promise.resolve(q ? { q } : {}) });
      const html = renderToStaticMarkup(el);
      expect(html).toContain('ben@');
    }
  });
});

describe('abandoned checkouts (TK-303)', () => {
  const row = (over: Partial<Parameters<typeof isAbandoned>[0]>) => ({ status: 'cancelled' as const, registrationIds: [], ...over });

  it('lists an unpaid cancelled checkout', () => {
    expect(isAbandoned(row({}))).toBe(true);
  });

  it('leaves out a paid order a chargeback cancelled, with or without disputedAt', () => {
    expect(isAbandoned(row({ disputedAt: '2026-10-01T12:00:00.000Z' }))).toBe(false);
    expect(isAbandoned(row({ registrationIds: ['reg_1'] }))).toBe(false);
  });

  it('leaves out every other status', () => {
    expect(isAbandoned(row({ status: 'paid' }))).toBe(false);
    expect(isAbandoned(row({ status: 'pending' }))).toBe(false);
  });
});

describe('sales figures count ticket orders only (T142)', () => {
  it('leaves a refund stub with no ticket line out of revenue', async () => {
    await manual({ requestId: 'req-sale-000001' });
    // What a Payment Link refund wrote before T136: no lines, only a refunded amount.
    await db.collection(COLLECTIONS.orders).doc('ord_stub').set({
      eventId: EVENT_ID, externalId: 'cs_plink', provider: 'stripe', email: '', status: 'refunded',
      totalCents: 0, refundedCents: 17_500, currency: 'usd', purchasedAt: new Date(),
    });
    const { salesSummary } = await import('@/lib/commerce');
    const sales = await salesSummary();
    expect(sales.grossCents).toBe(50_000);
    expect(sales.refundedCents).toBe(0);
    expect(sales.netCents).toBe(50_000);
  });

  it('lists ignored Stripe activity, newest first, and none of it as an order', async () => {
    await db.collection(COLLECTIONS.stripeIgnored).doc('a').set({ eventId: EVENT_ID, eventType: 'invoice.paid', kind: 'invoice', stripeId: 'in_1', amountCents: 500_000, currency: 'usd', email: null, at: new Date('2026-10-01T12:00:00Z') });
    await db.collection(COLLECTIONS.stripeIgnored).doc('b').set({ eventId: EVENT_ID, eventType: 'checkout.session.completed', kind: 'payment', stripeId: 'cs_1', amountCents: 250_000, currency: 'usd', email: 'sponsor@example.com', at: new Date('2026-10-02T12:00:00Z') });
    const { recentIgnoredStripe, listOrders } = await import('@/lib/commerce');
    const rows = await recentIgnoredStripe();
    expect(rows.map((r) => r.stripeId)).toEqual(['cs_1', 'in_1']);
    expect(rows[1].email).toBeUndefined();
    expect(await listOrders()).toHaveLength(0);
  });
});

describe('Workshops recorded from the dashboard (T169, T186)', () => {
  /** The Workshops price in this fixture catalogue; assertions read it from here. */
  const WS = 19_900;
  beforeEach(async () => {
    await db.collection(COLLECTIONS.ticketTypes).doc('workshops').set({
      eventId: EVENT_ID, name: 'Workshops', priceCents: WS, currency: 'usd', quantitySold: 0,
      kind: 'extra', addOnFor: 'main-conference', includesWorkshops: true,
    });
    await db.collection(COLLECTIONS.ticketTypes).doc('all-access').set({
      eventId: EVENT_ID, name: 'All Access (VIP)', priceCents: 69_900, currency: 'usd', quantitySold: 0,
      includesWorkshops: true,
    });
  });

  const workshops = (over: Partial<Parameters<typeof recordManualOrder>[0]> = {}) =>
    manual({ ticketTypeId: 'workshops', amountCents: WS, note: 'Cheque 3003', ...over });

  it('records Workshops alone as a Workshops-only badge, and a Main Conference comp later joins it', async () => {
    const ws = await workshops({ requestId: 'req-ws-none-01' });
    expect(ws.ok).toBe(true);
    const r = (await db.collection(COLLECTIONS.registrations).doc(ws.registrationId!).get()).data() as RegistrationDoc;
    expect(r).toMatchObject({ ticketType: 'Workshops', status: 'active' });
    expect(r.extras).toBeUndefined();
    expect(await sold('workshops')).toBe(1);
    const mails = (await db.collection(COLLECTIONS.emailLog).get()).docs.map((d) => d.data().template);
    expect(mails).toEqual(['purchase-confirmation']);

    const comp = await manual({ requestId: 'req-ws-comp-01', amountCents: 0, note: 'Speaker comp' });
    expect(comp.ok).toBe(true);
    expect(comp.registrationId).toBe(ws.registrationId);
    expect(comp.message).toMatch(/on the same badge as their Workshops \(Main Conference \+ Workshops\)/);
    const after = (await db.collection(COLLECTIONS.registrations).doc(ws.registrationId!).get()).data() as RegistrationDoc;
    expect(after.qrSecret).toBe(r.qrSecret);
    expect(after.ticketType).toBe('Main Conference');
    expect(after.extraNames).toEqual(['Workshops']);
    expect(await sold('main-conference')).toBe(1);
    const wsOrder = (await manualOrders()).find((o) => o.totalCents === WS)!;
    expect(wsOrder.extraRegistrationIds).toEqual([ws.registrationId]);
  });

  it('refuses Workshops for an All Access holder and twice, and adds it to a Virtual badge', async () => {
    expect((await manual({ ticketTypeId: 'all-access', requestId: 'req-ws-aa-0001' })).ok).toBe(true);
    expect((await workshops({ requestId: 'req-ws-aa-0002' })).error).toMatch(/holds All Access \(VIP\), which already includes Workshops/);
    expect((await manual({ email: 'bo@example.com', ticketTypeId: 'virtual', requestId: 'req-ws-vi-0001' })).ok).toBe(true);
    const vi = await workshops({ email: 'bo@example.com', requestId: 'req-ws-vi-0002' });
    expect(vi.message).toMatch(/added to their existing ticket \(Virtual \+ Workshops\)/);
    expect((await workshops({ email: 'bo@example.com', requestId: 'req-ws-vi-0003' })).error).toBe(
      'bo@example.com already has Workshops. Nothing was recorded.',
    );
  });

  it('the scanner checks a Workshops-only badge in with a "Workshops only" notice, except at a workshop', async () => {
    const ws = await workshops({ requestId: 'req-ws-scan-01' });
    const main = await manual({ email: 'cy@example.com', requestId: 'req-ws-scan-02' });
    await db.collection(COLLECTIONS.checkInLists).doc('door-t186').set({ eventId: EVENT_ID, name: 'Door', kind: 'event' });
    await db.collection(COLLECTIONS.checkInLists).doc('ws-t186').set({ eventId: EVENT_ID, name: 'Graph labs', kind: 'workshop' });
    const { submitScanAction } = await import('@/app/(dash)/attendees/check-in-and-checkout/check-in/actions');
    const code = async (rid: string) =>
      ((await db.collection(COLLECTIONS.registrations).doc(rid).get()).data() as RegistrationDoc).qrSecret!;
    const scan = async (listId: string, rid: string, n: string) =>
      submitScanAction({ listId, code: await code(rid), deviceId: 'dev-t186', clientScanId: n, stationLabel: 'Desk', source: 'typed' });

    const door = await scan('door-t186', ws.registrationId!, '1');
    expect(door).toMatchObject({ outcome: 'ok', ticketType: 'Workshops', onlyExtra: 'Workshops' });
    const lab = await scan('ws-t186', ws.registrationId!, '2');
    expect(lab.outcome).toBe('ok');
    expect(lab.onlyExtra).toBeUndefined();
    const conf = await scan('door-t186', main.registrationId!, '3');
    expect(conf.outcome).toBe('ok');
    expect(conf.onlyExtra).toBeUndefined();
  });

  it('warns at a workshop door when the badge has no Workshops (T259 #10)', async () => {
    const { resetScanCaches } = await import('@/lib/checkin');
    resetScanCaches();
    const main = await manual({ email: 'nows@example.com', requestId: 'req-t267-ws-01' });
    const ws = await workshops({ email: 'hasws@example.com', requestId: 'req-t267-ws-02' });
    await db.collection(COLLECTIONS.checkInLists).doc('ws-t267').set({ eventId: EVENT_ID, name: 'Lab', kind: 'workshop' });
    const { submitScanAction } = await import('@/app/(dash)/attendees/check-in-and-checkout/check-in/actions');
    const code = async (rid: string) =>
      ((await db.collection(COLLECTIONS.registrations).doc(rid).get()).data() as RegistrationDoc).qrSecret!;
    const scan = async (rid: string, n: string) =>
      submitScanAction({ listId: 'ws-t267', code: await code(rid), deviceId: 'dev-t267', clientScanId: n, stationLabel: 'Lab', source: 'camera' });

    const mainOnly = await scan(main.registrationId!, 'ws-1');
    expect(mainOnly).toMatchObject({ outcome: 'ok', noWorkshops: true });
    const holder = await scan(ws.registrationId!, 'ws-2');
    expect(holder.outcome).toBe('ok');
    expect(holder.noWorkshops).toBeUndefined();
  });

  it('the edit panel lists the extras beside the ticket type (T183 gap)', async () => {
    const main = await manual({ requestId: 'req-ws-edit-01' });
    await workshops({ requestId: 'req-ws-edit-02' });
    const { getAttendeeForEdit } = await import('@/lib/attendee-admin');
    const a = await getAttendeeForEdit(main.registrationId!);
    expect(a).toMatchObject({ ticketType: 'Main Conference', extraNames: ['Workshops'] });
  });

  it('adds Workshops to the Main Conference badge, which the desk and the list then show', async () => {
    const main = await manual({ requestId: 'req-ws-main-01' });
    const res = await workshops({ requestId: 'req-ws-add-001' });
    expect(res.ok).toBe(true);
    expect(res.registrationId).toBe(main.registrationId);
    expect(res.message).toMatch(/added to their existing ticket \(Main Conference \+ Workshops\)/);

    const r = (await db.collection(COLLECTIONS.registrations).doc(main.registrationId!).get()).data() as RegistrationDoc;
    expect(r.ticketType).toBe('Main Conference');
    expect(r.extraNames).toEqual(['Workshops']);
    const order = (await manualOrders()).find((o) => o.totalCents === WS)!;
    expect(order.extraRegistrationIds).toEqual([main.registrationId]);
    expect(await sold('workshops')).toBe(1);
    expect((await db.collection(COLLECTIONS.registrations).where('email', '==', 'ada@example.com').get()).size).toBe(1);

    // The confirmation is "added to your ticket", not a new ticket.
    const mails = (await db.collection(COLLECTIONS.emailLog).get()).docs.map((d) => d.data());
    expect(mails.map((m) => m.template).sort()).toEqual(['extra-added', 'purchase-confirmation']);

    // Check-in desk, attendee list and badges all read the whole label.
    const { listRegistrations } = await import('@/lib/checkin');
    const desk = (await listRegistrations()).find((x) => x.row.id === main.registrationId)!;
    expect(desk.row.ticketType).toBe('Main Conference + Workshops');
    const { listAttendees } = await import('@/lib/data');
    const row = (await listAttendees()).find((a) => a.registrationId === main.registrationId)!;
    expect(row.ticketLabel).toBe('Main Conference + Workshops');
    expect(row.ticketType).toBe('Main Conference');
  });

  it('marks an invoice paid with Main Conference and Workshops for one person as one badge', async () => {
    const { markInvoicePaidOutOfBand } = await import('@/lib/invoice-admin');
    const id = 'ord_inv_ws_0001';
    await db.collection(COLLECTIONS.orders).doc(id).set({
      eventId: EVENT_ID, externalId: 'in_ws_1', provider: 'stripe', channel: 'invoice', email: 'billing@acme.example',
      status: 'pending', totalCents: 79_800, currency: 'usd',
      items: [
        { ticketTypeId: 'workshops', ticketTypeName: 'Workshops', quantity: 1, unitPriceCents: 19_900, attendeeName: 'Ada Nakamura', attendeeEmail: 'ada@example.com' },
        { ticketTypeId: 'main-conference', ticketTypeName: 'Main Conference', quantity: 1, unitPriceCents: 59_900, attendeeName: 'Ada Nakamura', attendeeEmail: 'ada@example.com' },
      ],
    });
    const rids = await markInvoicePaidOutOfBand({
      order: { id, totalCents: 79_800, currency: 'usd', poNumber: undefined } as never,
      actor: 'organizer@example.com',
      note: 'Wire 4004',
    });
    expect(rids).toHaveLength(1);
    const r = (await db.collection(COLLECTIONS.registrations).doc(rids[0]!).get()).data() as RegistrationDoc;
    expect([r.ticketType, r.extraNames]).toEqual(['Main Conference', ['Workshops']]);
    expect(await sold('workshops')).toBe(1);
    expect(await sold('main-conference')).toBe(1);
  });
});

describe('cancelling a Main Conference + Workshops badge on the dashboard (T170)', () => {
  beforeEach(async () => {
    await db.collection(COLLECTIONS.ticketTypes).doc('workshops').set({
      eventId: EVENT_ID, name: 'Workshops', priceCents: 19_900, currency: 'usd', quantitySold: 0,
      kind: 'extra', addOnFor: 'main-conference', includesWorkshops: true,
    });
  });

  it('gives back both seats, and reinstating takes both again', async () => {
    const main = await manual({ requestId: 'req-cx-main-01' });
    expect((await manual({ ticketTypeId: 'workshops', amountCents: 19_900, note: 'Cheque 5005', requestId: 'req-cx-ws-001' })).ok).toBe(true);
    expect([await sold('main-conference'), await sold('workshops')]).toEqual([1, 1]);

    const { cancelAttendee, reinstateAttendee } = await import('@/lib/attendee-admin');
    const res = await cancelAttendee(main.registrationId!, 'organizer@example.com');
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/So is their Workshops seat/);
    expect([await sold('main-conference'), await sold('workshops')]).toEqual([0, 0]);

    // Twice is still once.
    expect((await cancelAttendee(main.registrationId!, 'organizer@example.com')).ok).toBe(false);
    expect(await sold('workshops')).toBe(0);

    expect((await reinstateAttendee(main.registrationId!, 'organizer@example.com')).ok).toBe(true);
    expect([await sold('main-conference'), await sold('workshops')]).toEqual([1, 1]);
    const r = (await db.collection(COLLECTIONS.registrations).doc(main.registrationId!).get()).data() as RegistrationDoc;
    expect(r.extraSeatReleases).toBeUndefined();
  });
});

describe('the door (T259 #3, #5, #11, #12)', () => {
  const scanIn = async (listId: string, code: string, n: string) => {
    const { submitScanAction } = await import('@/app/(dash)/attendees/check-in-and-checkout/check-in/actions');
    return submitScanAction({ listId, code, deviceId: 'dev-door', clientScanId: n, stationLabel: 'Desk', source: 'typed' });
  };
  const qr = async (rid: string) =>
    ((await db.collection(COLLECTIONS.registrations).doc(rid).get()).data() as RegistrationDoc).qrSecret!;
  const runId = Date.now().toString(36);

  beforeEach(async () => {
    const { resetScanCaches } = await import('@/lib/checkin');
    resetScanCaches();
  });

  it('finds the badge by its QR and by a typed claim code, and nothing for a wrong code', async () => {
    const ada = await manual({ email: `door-${runId}@example.com`, requestId: `req-door-${runId}-1` });
    const reg = (await db.collection(COLLECTIONS.registrations).doc(ada.registrationId!).get()).data() as RegistrationDoc;
    const list = `door-lookup-${runId}`;
    expect(await scanIn(list, reg.qrSecret!, `${runId}-a`)).toMatchObject({ outcome: 'ok', matchedOn: 'qrSecret' });
    expect(await scanIn(list, reg.claimCode!.toLowerCase(), `${runId}-b`)).toMatchObject({ outcome: 'duplicate', matchedOn: 'claimCode' });
    expect((await scanIn(list, 'not-a-real-code-at-all-0000000000', `${runId}-c`)).outcome).toBe('unknown');
  });

  it('a resend of the same scan is a replay, never a second check-in', async () => {
    const bo = await manual({ email: `replay-${runId}@example.com`, requestId: `req-door-${runId}-2` });
    const list = `door-replay-${runId}`;
    const code = await qr(bo.registrationId!);
    const first = await scanIn(list, code, `${runId}-same`);
    const again = await scanIn(list, code, `${runId}-same`);
    expect(first.outcome).toBe('ok');
    expect(again).toMatchObject({ outcome: 'duplicate', scanEventReplayed: true });
  });

  it('a Day list starts each day from zero, mirrors onto the Main Door, and its undo takes the mirror back', async () => {
    const { DEFAULT_LIST_ID } = await import('@/lib/checkin');
    const { undoCheckInAction } = await import('@/app/(dash)/attendees/check-in-and-checkout/check-in/actions');
    const cy = await manual({ email: `days-${runId}@example.com`, requestId: `req-door-${runId}-3` });
    const rid = cy.registrationId!;
    const code = await qr(rid);
    const door = db.collection(COLLECTIONS.checkInLists).doc(DEFAULT_LIST_ID).collection('checkIns').doc(rid);

    expect((await scanIn('day-2027-05-04', code, `${runId}-d1`)).outcome).toBe('ok');
    expect((await door.get()).data()?.mirroredFrom).toBe('day-2027-05-04');
    // Day two: a fresh list, so not ALREADY CHECKED IN.
    expect((await scanIn('day-2027-05-05', code, `${runId}-d2`)).outcome).toBe('ok');
    expect((await door.get()).data()?.mirroredFrom).toBe('day-2027-05-04');

    await undoCheckInAction('day-2027-05-05', rid);
    expect((await door.get()).exists).toBe(true);
    await undoCheckInAction('day-2027-05-04', rid);
    expect((await door.get()).exists).toBe(false);
  });

  it('reissuing a badge QR stops the old code and the new one scans', async () => {
    const { reissueBadgeQr } = await import('@/lib/attendee-admin');
    const di = await manual({ email: `reissue-${runId}@example.com`, requestId: `req-door-${runId}-4` });
    const old = await qr(di.registrationId!);
    const res = await reissueBadgeQr(di.registrationId!, 'organizer@example.com');
    expect(res.ok).toBe(true);
    const fresh = await qr(di.registrationId!);
    expect(fresh).not.toBe(old);
    expect(fresh).toHaveLength(old.length);

    const list = `door-reissue-${runId}`;
    expect((await scanIn(list, old, `${runId}-r1`)).outcome).toBe('unknown');
    expect((await scanIn(list, fresh, `${runId}-r2`)).outcome).toBe('ok');
    const audit = await db.collection(COLLECTIONS.auditLog).where('action', '==', 'attendee.reissueQr').get();
    expect(audit.size).toBe(1);
    expect(JSON.stringify(audit.docs[0].data())).not.toContain(fresh);
  });
});

describe('app access with several tickets on one address (T259 #7, #14)', () => {
  const hasAuth = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const runId = Date.now().toString(36);

  it.skipIf(!hasAuth)('cancelling one of two tickets keeps the app; cancelling the last one ends it', async () => {
    const { getAuth } = await import('../../apps/organizer/node_modules/firebase-admin/lib/auth/index.js');
    const { cancelAttendee } = await import('@/lib/attendee-admin');
    const email = `two-${runId}@example.com`;
    const first = await manual({ email, requestId: `req-acc-${runId}-1` });
    const second = await manual({ email, requestId: `req-acc-${runId}-2` });
    expect(second.registrationId).not.toBe(first.registrationId);

    const auth = getAuth();
    const user = await auth.createUser({ email });
    await auth.setCustomUserClaims(user.uid, { registered: true, roles: ['attendee'], eventId: EVENT_ID });

    expect((await cancelAttendee(first.registrationId!, 'organizer@example.com')).ok).toBe(true);
    expect((await auth.getUser(user.uid)).customClaims?.registered).toBe(true);

    expect((await cancelAttendee(second.registrationId!, 'organizer@example.com')).ok).toBe(true);
    expect((await auth.getUser(user.uid)).customClaims?.registered).toBe(false);
  });

  it.skipIf(!hasAuth)('correcting an address moves the same app account to it', async () => {
    const { getAuth } = await import('../../apps/organizer/node_modules/firebase-admin/lib/auth/index.js');
    const { updateAttendee } = await import('@/lib/attendee-admin');
    const from = `typo-${runId}@exmaple.com`;
    const to = `fixed-${runId}@example.com`;
    const ticket = await manual({ email: from, requestId: `req-acc-${runId}-3` });

    const auth = getAuth();
    const user = await auth.createUser({ email: from });
    await auth.setCustomUserClaims(user.uid, { registered: true, roles: ['attendee'], eventId: EVENT_ID });
    await db.collection(COLLECTIONS.users).doc(user.uid).set({ eventId: EVENT_ID, email: from, name: 'Ada' });

    const res = await updateAttendee(ticket.registrationId!, { name: 'Ada Nakamura', email: to, title: '', company: '' }, 'organizer@example.com');
    expect(res.ok).toBe(true);

    const moved = await auth.getUser(user.uid);
    expect(moved.email).toBe(to);
    expect(moved.customClaims?.registered).toBe(true);
    expect((await db.collection(COLLECTIONS.users).doc(user.uid).get()).data()?.email).toBe(to);
    await expect(auth.getUserByEmail(from)).rejects.toThrow();
  });
});

