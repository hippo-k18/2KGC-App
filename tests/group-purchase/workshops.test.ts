/**
 * Workshops as its own ticket, added to the person's existing badge (T169,
 * owner's decisions 2026-10-06), and independent of the conference tickets
 * (T186, 2026-10-07): sold alone as a Workshops-only badge, joined by a
 * conference ticket bought later, and refunded each on its own.
 *
 * Runs the real checkout action, webhook and return route against the
 * Firestore emulator; Stripe, email and Auth accounts are faked.
 *
 * Run with: npm run test:group-purchase
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_workshops';
  process.env.WEB_ORDER_SECRET = 'test-order-secret-test-order-secret-0123';
  return {
    sessions: new Map<string, unknown>(),
    sessionByIntent: new Map<string, string>(),
    invoiceByIntent: new Map<string, string>(),
    created: [] as { metadata: Record<string, string>; line_items: { quantity: number; price_data: { unit_amount: number } }[] }[],
    sent: [] as { to: string; ticketType: string; registrationId?: string; addedExtra?: string; amountCents: number }[],
    refundMails: [] as { to: string; extraRemoved?: { name: string; remaining: string }; ticketCancelled?: boolean }[],
    stripeRefunds: [] as { payment_intent: string; amount?: number }[],
    refundsDenied: false,
  };
});

vi.mock('../../apps/web/node_modules/next/headers.js', () => ({
  headers: async () => new Headers({ host: 'www.knowledgegraph.tech', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.69' }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('../../apps/web/node_modules/next/navigation.js', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { url });
  },
}));
vi.mock('@/lib/data', () => ({
  ticketSalesOpen: async () => true,
  brandingSettings: async () => ({ chargeBuyerFee: false }),
}));
vi.mock('@/lib/checkout-limit', () => ({
  checkoutCallerIp: () => '203.0.113.69',
  checkoutStartAllowed: async () => true,
}));
vi.mock('@/lib/stripe', () => ({
  stripeEnabled: () => true,
  siteOrigin: () => 'https://www.knowledgegraph.tech',
  stripe: () => ({
    webhooks: { constructEventAsync: async (raw: string) => JSON.parse(raw) },
    checkout: {
      sessions: {
        create: async (params: (typeof mocks.created)[number]) => {
          mocks.created.push(params);
          const id = `cs_test_ws_${mocks.created.length}`;
          return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
        },
        retrieve: async (id: string) => mocks.sessions.get(id),
        list: async ({ payment_intent }: { payment_intent: string }) => {
          const id = mocks.sessionByIntent.get(payment_intent);
          return { data: id ? [mocks.sessions.get(id)] : [] };
        },
        listLineItems: async () => ({ data: [] }),
      },
    },
    invoicePayments: {
      list: async (q: { payment?: { payment_intent: string }; invoice?: string }) => {
        if (q.invoice) {
          // The payment that settled an invoice, as `invoice.paid` reads it.
          const pi = [...mocks.invoiceByIntent].find(([, inv]) => inv === q.invoice)?.[0];
          return { data: pi ? [{ invoice: q.invoice, payment: { type: 'payment_intent', payment_intent: pi } }] : [] };
        }
        const invoice = mocks.invoiceByIntent.get(q.payment!.payment_intent);
        return { data: invoice ? [{ invoice }] : [] };
      },
    },
    refunds: {
      create: async (params: { payment_intent: string; amount?: number }) => {
        if (mocks.refundsDenied) {
          throw Object.assign(new Error('The provided key does not have the required permissions'), { type: 'StripePermissionError' });
        }
        mocks.stripeRefunds.push({ payment_intent: params.payment_intent, amount: params.amount });
        return { id: `re_${mocks.stripeRefunds.length}` };
      },
    },
  }),
}));
vi.mock('@/lib/email', () => ({
  sendPurchaseConfirmation: async (input: (typeof mocks.sent)[number]) => {
    mocks.sent.push({
      to: input.to,
      ticketType: input.ticketType,
      registrationId: input.registrationId,
      addedExtra: input.addedExtra,
      amountCents: input.amountCents,
    });
    return 'sent';
  },
  sendRefundConfirmation: async (input: (typeof mocks.refundMails)[number]) => {
    mocks.refundMails.push(input);
    return 'sent';
  },
  sendTicketWithdrawn: async () => 'sent',
}));
vi.mock('@/lib/app-account', async () => {
  // The same uid the refund path derives, as the real provisioning uses.
  const { uidForEmail } = await import('@/lib/app-account-core');
  return {
    provisionPurchaserAccount: async ({ email }: { email: string }) => ({
      status: 'existing',
      uid: uidForEmail(email),
      temporaryPassword: null,
    }),
  };
});
vi.mock('@/lib/analytics', () => ({
  analyticsConfig: () => null,
  encodePurchase: () => '',
  decodePurchase: () => null,
  PURCHASE_COOKIE: 'kgc_purchase',
}));

import { NextRequest } from '../../apps/web/node_modules/next/server.js';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, SUBCOLLECTIONS, type OrderDoc, type RegistrationDoc } from '@kgc/shared';
import { normaliseEmail, registrationId } from '@kgc/scripts/src/lib/ids';
import { POST as webhook } from '@/app/api/stripe/webhook/route';
import { startCheckout } from '@/app/tickets/actions';
import { recordCartOrder, type CartSeat } from '@/app/tickets/cart-order';
import { db as webDb } from '@/lib/firestore';
import { uidForEmail } from '@/lib/app-account-core';
import { getRegistration, orderIdFor, recordInvoiceOrder, invoiceOrderId } from '@/lib/registrations';

let db: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:group-purchase');
  }
  db = webDb() as unknown as Firestore;
});

async function wipe(collection: string) {
  // Recursive: entitlements live under `users/{uid}`, which has no document
  // of its own in these tests.
  await db.recursiveDelete(db.collection(collection));
}

/** The Workshops price in this fixture catalogue. Every assertion reads it from here. */
const WS = 19_900;

const TIERS = {
  'all-access': { name: 'All Access (VIP)', priceCents: 69_900, includesWorkshops: true, includesVideoLibrary: true },
  'main-conference': { name: 'Main Conference', priceCents: 59_900, includesVideoLibrary: true },
  workshops: { name: 'Workshops', priceCents: WS, kind: 'extra', addOnFor: 'main-conference', includesWorkshops: true },
  virtual: { name: 'Virtual', priceCents: 12_900, inPerson: false },
  'main-conference-workshops': { name: 'Main Conference + Workshops', priceCents: 59_900 + WS, bundleOf: ['main-conference', 'workshops'], visible: false },
} as const;
type TierId = keyof typeof TIERS;

beforeEach(async () => {
  mocks.sessions.clear();
  mocks.sessionByIntent.clear();
  mocks.invoiceByIntent.clear();
  mocks.created.length = 0;
  mocks.sent.length = 0;
  mocks.refundMails.length = 0;
  mocks.stripeRefunds.length = 0;
  mocks.refundsDenied = false;
  await Promise.all(
    [COLLECTIONS.registrations, COLLECTIONS.orders, COLLECTIONS.ticketTypes, COLLECTIONS.auditLog, COLLECTIONS.emailLog, COLLECTIONS.users, COLLECTIONS.pendingAnswers, 'referralCodes'].map(wipe),
  );
  for (const [id, t] of Object.entries(TIERS)) {
    await db.collection(COLLECTIONS.ticketTypes).doc(id).set({
      eventId: EVENT_ID,
      currency: 'usd',
      inPerson: true,
      audience: 'attendee',
      visible: true,
      includesWorkshops: false,
      includesVideoLibrary: false,
      quantitySold: 0,
      tagline: '',
      includes: [],
      sortOrder: 10,
      taxCode: 'txcd_20030000',
      ...t,
    });
  }
});

type Seat = CartSeat & { ticketTypeId: TierId };
const seat = (name: string, email: string, tier: TierId, priceCents: number = TIERS[tier].priceCents): Seat => ({
  name,
  email,
  ticketType: TIERS[tier].name,
  ticketTypeId: tier,
  priceCents,
});

/** What `startCheckout` writes, and the session Stripe holds for it. */
/** `charged` is what Stripe took, after any promotion code; the list total when absent. */
async function bought(seats: Seat[], sessionId: string, charged?: number) {
  const [buyer] = seats;
  if (seats.length > 1) {
    await recordCartOrder({ sessionId, buyerEmail: buyer.email, buyerName: buyer.name, seats, currency: 'usd' });
  }
  const total = charged ?? seats.reduce((n, s) => n + s.priceCents, 0);
  const pi = `pi_${sessionId}`;
  mocks.sessionByIntent.set(pi, sessionId);
  mocks.sessions.set(sessionId, {
    id: sessionId,
    object: 'checkout.session',
    payment_status: 'paid',
    status: 'complete',
    payment_intent: pi,
    amount_total: total,
    amount_subtotal: total,
    currency: 'usd',
    customer_details: { email: buyer.email, name: buyer.name },
    customer_email: buyer.email,
    total_details: { amount_tax: 0, amount_discount: seats.reduce((n, x) => n + x.priceCents, 0) - total },
    metadata: { source: 'kgc-web', tier: buyer.ticketTypeId, ticketType: buyer.ticketType, name: buyer.name, seats: String(seats.length) },
  });
  const res = await deliver('checkout.session.completed', mocks.sessions.get(sessionId));
  expect(res.status).toBe(200);
  return { sessionId, pi, oid: orderIdFor(sessionId), total, body: await res.json() };
}

async function deliver(type: string, object: unknown, id = `evt_${type}_${Math.random()}`) {
  return webhook(
    new NextRequest('https://www.knowledgegraph.tech/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=x' },
      body: JSON.stringify({ id, type, data: { object } }),
    }),
  );
}
const refunded = (pi: string, amount: number) =>
  deliver('charge.refunded', { id: `ch_${pi}`, object: 'charge', payment_intent: pi, amount_refunded: amount, currency: 'usd' });

const order = async (oid: string) => (await db.collection(COLLECTIONS.orders).doc(oid).get()).data() as OrderDoc;
const reg = async (rid: string) => (await db.collection(COLLECTIONS.registrations).doc(rid).get()).data() as RegistrationDoc;
const sold = async (tier: TierId) => (await db.collection(COLLECTIONS.ticketTypes).doc(tier).get()).data()?.quantitySold;
const regsFor = async (email: string) =>
  (await db.collection(COLLECTIONS.registrations).where('email', '==', normaliseEmail(email)).get()).docs;
const grants = async (email: string) => {
  const uid = uidForEmail(email);
  const snap = await db.collection(COLLECTIONS.users).doc(uid).collection(SUBCOLLECTIONS.entitlements).get();
  return Object.fromEntries(snap.docs.map((d) => [d.id, (d.data().orders ?? []) as string[]]));
};

const ADA = 'ada@example.com';

function form(fields: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
  return f;
}
async function submit(f: FormData): Promise<{ error?: string; url?: string }> {
  try {
    return (await startCheckout({}, f)) as { error?: string };
  } catch (err) {
    const url = (err as { url?: string }).url;
    if (url) return { url };
    throw err;
  }
}

describe('Main Conference in October, Workshops in December', () => {
  it('is one person with one badge, one QR code and the label "Main Conference + Workshops"', async () => {
    const oct = await bought([seat('Ada Nakamura', ADA, 'main-conference')], 'cs_oct');
    const rid = registrationId(ADA);
    const before = await reg(rid);

    // December: the checkout lets her buy Workshops on its own.
    expect((await submit(form({ tier: 'workshops', name: 'Ada Nakamura', email: ADA }))).url).toMatch(/checkout\.stripe\.com/);

    const dec = await bought([seat('Ada Nakamura', ADA, 'workshops')], 'cs_dec');
    expect(dec.body.registrationId).toBe(rid);

    const docs = await regsFor(ADA);
    expect(docs).toHaveLength(1);
    const after = await reg(rid);
    expect(after.qrSecret).toBe(before.qrSecret);
    expect(after.claimCode).toBe(before.claimCode);
    expect(after.ticketType).toBe('Main Conference');
    expect(after.extraNames).toEqual(['Workshops']);
    expect(after.extras).toEqual([expect.objectContaining({ tierId: 'workshops', orderId: dec.oid, seat: 0 })]);
    expect((await getRegistration(rid))?.ticketType).toBe('Main Conference + Workshops');

    // Two orders, the second only extends the October badge.
    expect((await order(dec.oid)).registrationIds).toEqual([rid]);
    expect((await order(dec.oid)).extraRegistrationIds).toEqual([rid]);
    expect(await sold('main-conference')).toBe(1);
    expect(await sold('workshops')).toBe(1);

    // "Workshops added to your ticket", the same link, the whole label.
    expect(mocks.sent).toHaveLength(2);
    expect(mocks.sent[1]).toMatchObject({ to: ADA, registrationId: rid, addedExtra: 'Workshops', ticketType: 'Main Conference + Workshops' });

    // Entitlements per order: the workshop grant belongs to December's order.
    expect(await grants(ADA)).toEqual({ 'video-library': [oct.oid], workshop: [dec.oid] });

    // A replay adds nothing and counts nothing.
    await deliver('checkout.session.completed', mocks.sessions.get('cs_dec'));
    expect((await reg(rid)).extras).toHaveLength(1);
    expect(await sold('workshops')).toBe(1);
    expect(mocks.sent).toHaveLength(2);
  });

  it('finds the Main Conference badge through an alternate address', async () => {
    await bought([seat('Ada Nakamura', ADA, 'main-conference')], 'cs_alt_oct');
    await db.collection(COLLECTIONS.registrations).doc(registrationId(ADA)).update({ altEmails: ['ada@home.example'] });
    expect((await submit(form({ tier: 'workshops', name: 'Ada Nakamura', email: 'ada@home.example' }))).url).toBeDefined();
    await bought([seat('Ada Nakamura', 'ada@home.example', 'workshops')], 'cs_alt_dec');
    expect((await reg(registrationId(ADA))).extraNames).toEqual(['Workshops']);
    expect(await regsFor('ada@home.example')).toHaveLength(0);
  });

  it('goes on the newest of two active Main Conference badges', async () => {
    await bought([seat('Ada Nakamura', ADA, 'main-conference')], 'cs_two_1');
    await bought([seat('Ada Nakamura', ADA, 'main-conference')], 'cs_two_2');
    const docs = await regsFor(ADA);
    expect(docs).toHaveLength(2);
    const newest = docs.find((d) => d.id !== registrationId(ADA))!.id;
    await bought([seat('Ada Nakamura', ADA, 'workshops')], 'cs_two_ws');
    expect((await reg(newest)).extraNames).toEqual(['Workshops']);
    expect((await reg(registrationId(ADA))).extraNames).toBeUndefined();
  });
});

describe('Main Conference and Workshops in the same cart', () => {
  it('is one badge for the buyer, and one for a colleague, each with both tickets', async () => {
    expect(
      (
        await submit(
          form({
            tier: 'workshops',
            name: 'Ada Nakamura',
            email: ADA,
            seatName: ['Ada Nakamura', 'Ben Olsen', 'Ben Olsen'],
            seatEmail: [ADA, 'ben@example.com', 'ben@example.com'],
            seatTier: ['main-conference', 'workshops', 'main-conference'],
          }),
        )
      ).url,
    ).toBeDefined();
    // The buyer's Workshops seat swapped with her Main Conference seat, and
    // Workshops comes after Main Conference on the Stripe page.
    expect(mocks.created[0]!.metadata.tier).toBe('main-conference');

    const c = await bought(
      [
        seat('Ada Nakamura', ADA, 'main-conference'),
        seat('Ben Olsen', 'ben@example.com', 'main-conference'),
        seat('Ada Nakamura', ADA, 'workshops'),
        seat('Ben Olsen', 'ben@example.com', 'workshops'),
      ],
      'cs_same_cart',
    );
    for (const email of [ADA, 'ben@example.com']) {
      const docs = await regsFor(email);
      expect(docs).toHaveLength(1);
      const r = docs[0]!.data() as RegistrationDoc;
      expect(r.ticketType).toBe('Main Conference');
      expect(r.extraNames).toEqual(['Workshops']);
      expect(r.orderId).toBe(c.oid);
    }
    expect((await order(c.oid)).extraRegistrationIds ?? []).toEqual([]);
    expect(await sold('main-conference')).toBe(2);
    expect(await sold('workshops')).toBe(2);
    // One confirmation each, naming both tickets, never "added to".
    expect(mocks.sent.map((m) => [m.to, m.ticketType, m.addedExtra])).toEqual([
      ['ben@example.com', 'Main Conference + Workshops', undefined],
      [ADA, 'Main Conference + Workshops', undefined],
    ]);
  });

  it('a refund of the whole order cancels both badges and their Workshops', async () => {
    const c = await bought([seat('Ada Nakamura', ADA, 'main-conference'), seat('Ada Nakamura', ADA, 'workshops')], 'cs_cart_refund');
    await refunded(c.pi, c.total);
    expect((await reg(registrationId(ADA))).status).toBe('cancelled');
    expect(await sold('main-conference')).toBe(0);
    expect(await sold('workshops')).toBe(0);
    // Nothing else to refund: it was all one payment.
    expect(mocks.stripeRefunds).toEqual([]);
  });
});

describe('who may buy Workshops (T186)', () => {
  it('sells Workshops alone as a Workshops-only badge with its own QR code and a normal ticket email', async () => {
    expect((await submit(form({ tier: 'workshops', name: 'Ada Nakamura', email: ADA }))).url).toMatch(/checkout\.stripe\.com/);
    const c = await bought([seat('Ada Nakamura', ADA, 'workshops')], 'cs_alone');
    const docs = await regsFor(ADA);
    expect(docs).toHaveLength(1);
    const r = docs[0]!.data() as RegistrationDoc;
    expect(r).toMatchObject({ ticketType: 'Workshops', status: 'active', orderId: c.oid });
    expect(r.extras).toBeUndefined();
    expect(r.qrSecret).toBeTruthy();
    expect(r.claimCode).toBeTruthy();
    expect((await order(c.oid)).extraRegistrationIds).toBeUndefined();
    expect(await sold('workshops')).toBe(1);
    expect(mocks.sent).toEqual([expect.objectContaining({ to: ADA, ticketType: 'Workshops', addedExtra: undefined, amountCents: WS })]);
    expect(await grants(ADA)).toEqual({ workshop: [c.oid] });
    // Not a refusal: the team is not warned.
    const warnings = (await db.collection(COLLECTIONS.auditLog).get()).docs.map((d) => JSON.stringify(d.data()));
    expect(warnings.some((w) => w.includes('extra.notAdded'))).toBe(false);
    // A replay issues nothing more.
    await deliver('checkout.session.completed', mocks.sessions.get('cs_alone'));
    expect(await regsFor(ADA)).toHaveLength(1);
    expect(await sold('workshops')).toBe(1);
    expect(mocks.sent).toHaveLength(1);
  });

  it('sells Workshops to a colleague whose Main Conference is not in the cart', async () => {
    expect(
      (await submit(form({ tier: 'main-conference', name: 'Ada Nakamura', email: ADA, seatName: ['Ben Olsen'], seatEmail: ['ben@example.com'], seatTier: ['workshops'] }))).url,
    ).toBeDefined();
    await bought([seat('Ada Nakamura', ADA, 'main-conference'), seat('Ben Olsen', 'ben@example.com', 'workshops')], 'cs_colleague');
    expect((await reg(registrationId('ben@example.com'))).ticketType).toBe('Workshops');
    expect((await reg(registrationId(ADA))).extraNames).toBeUndefined();
  });

  it('puts Workshops on a Virtual badge: "Virtual + Workshops"', async () => {
    await bought([seat('Ada Nakamura', ADA, 'virtual')], 'cs_virtual');
    expect((await submit(form({ tier: 'workshops', name: 'Ada Nakamura', email: ADA }))).url).toBeDefined();
    await bought([seat('Ada Nakamura', ADA, 'workshops')], 'cs_virtual_ws');
    expect(await regsFor(ADA)).toHaveLength(1);
    expect((await getRegistration(registrationId(ADA)))?.ticketType).toBe('Virtual + Workshops');
    expect(mocks.sent.at(-1)).toMatchObject({ addedExtra: 'Workshops', ticketType: 'Virtual + Workshops' });
  });

  it('refuses an All Access holder, whose ticket includes the workshops', async () => {
    await bought([seat('Ada Nakamura', ADA, 'all-access')], 'cs_aa');
    const r = await submit(form({ tier: 'workshops', name: 'Ada Nakamura', email: ADA }));
    expect(r.error).toBe('ada@example.com holds All Access (VIP), which already includes Workshops. Nothing was charged.');
    const cart = await submit(form({ tier: 'all-access', name: 'Bo Lee', email: 'bo@example.com', seatName: ['Bo Lee'], seatEmail: ['bo@example.com'], seatTier: ['workshops'] }));
    expect(cart.error).toMatch(/bo@example.com holds All Access \(VIP\), which already includes Workshops/);
  });

  it('refuses Workshops twice, on a badge or as a Workshops-only badge', async () => {
    await bought([seat('Ada Nakamura', ADA, 'main-conference')], 'cs_twice_1');
    await bought([seat('Ada Nakamura', ADA, 'workshops')], 'cs_twice_2');
    expect((await submit(form({ tier: 'workshops', name: 'Ada Nakamura', email: ADA }))).error).toBe(
      'ada@example.com already has Workshops. Nothing was charged.',
    );
    await bought([seat('Bo Lee', 'bo@example.com', 'workshops')], 'cs_twice_3');
    expect((await submit(form({ tier: 'workshops', name: 'Bo Lee', email: 'bo@example.com' }))).error).toBe(
      'bo@example.com already has Workshops. Nothing was charged.',
    );
  });

  it('no longer sells the retired "Main Conference + Workshops" bundle', async () => {
    const r = await submit(form({ tier: 'main-conference-workshops', name: 'Ada Nakamura', email: ADA }));
    expect(r.error).toMatch(/not available \(no longer sold\)/);
  });

  it('warns the team when an All Access holder paid for Workshops anyway (a race)', async () => {
    await bought([seat('Ada Nakamura', ADA, 'all-access')], 'cs_race_aa');
    await bought([seat('Ada Nakamura', ADA, 'workshops')], 'cs_race_ws');
    const warnings = (await db.collection(COLLECTIONS.auditLog).get()).docs.map((d) => JSON.stringify(d.data()));
    expect(warnings.some((w) => w.includes('extra.notAdded') && w.includes('included'))).toBe(true);
  });
});

describe('Workshops first, a conference ticket later (T186)', () => {
  it('joins the Workshops-only badge: one QR code, "Main Conference + Workshops"', async () => {
    const ws = await bought([seat('Ada Nakamura', ADA, 'workshops')], 'cs_wf_ws');
    const rid = registrationId(ADA);
    const before = await reg(rid);
    expect((await submit(form({ tier: 'main-conference', name: 'Ada Nakamura', email: ADA }))).url).toBeDefined();
    const main = await bought([seat('Ada Nakamura', ADA, 'main-conference')], 'cs_wf_main');

    expect(await regsFor(ADA)).toHaveLength(1);
    const after = await reg(rid);
    expect(after.qrSecret).toBe(before.qrSecret);
    expect(after.claimCode).toBe(before.claimCode);
    expect(after.ticketType).toBe('Main Conference');
    expect(after.orderId).toBe(main.oid);
    expect(after.extraNames).toEqual(['Workshops']);
    expect(after.extras).toEqual([expect.objectContaining({ tierId: 'workshops', name: 'Workshops', orderId: ws.oid, seat: 0 })]);
    // The Workshops order now only extends the badge; Main Conference owns it.
    expect((await order(ws.oid)).extraRegistrationIds).toEqual([rid]);
    expect((await order(main.oid)).registrationIds).toEqual([rid]);
    expect((await order(main.oid)).extraRegistrationIds).toBeUndefined();
    expect(await sold('main-conference')).toBe(1);
    expect(await sold('workshops')).toBe(1);
    expect(mocks.sent.at(-1)).toMatchObject({ to: ADA, ticketType: 'Main Conference + Workshops', addedExtra: undefined });
    expect(await grants(ADA)).toEqual({ workshop: [ws.oid], 'video-library': [main.oid] });

    // A replay changes nothing and counts nothing.
    await deliver('checkout.session.completed', mocks.sessions.get('cs_wf_main'));
    const replayed = await reg(rid);
    expect(replayed.ticketType).toBe('Main Conference');
    expect(replayed.extras).toHaveLength(1);
    expect(await regsFor(ADA)).toHaveLength(1);
    expect(await sold('main-conference')).toBe(1);
    // And the Workshops order's replay does not take it for a duplicate.
    await deliver('checkout.session.completed', mocks.sessions.get('cs_wf_ws'));
    expect((await reg(rid)).extras).toHaveLength(1);
    expect(await sold('workshops')).toBe(1);
  });

  it('a Virtual ticket joins it too', async () => {
    await bought([seat('Ada Nakamura', ADA, 'workshops')], 'cs_wv_ws');
    await bought([seat('Ada Nakamura', ADA, 'virtual')], 'cs_wv_v');
    expect(await regsFor(ADA)).toHaveLength(1);
    expect((await getRegistration(registrationId(ADA)))?.ticketType).toBe('Virtual + Workshops');
  });

  it('refunding Workshops leaves Main Conference', async () => {
    const ws = await bought([seat('Ada Nakamura', ADA, 'workshops')], 'cs_wr_ws');
    await bought([seat('Ada Nakamura', ADA, 'main-conference')], 'cs_wr_main');
    const res = await refunded(ws.pi, WS);
    expect(await res.json()).toMatchObject({ registrationId: null, extrasRemoved: ['workshops'] });
    const after = await reg(registrationId(ADA));
    expect(after).toMatchObject({ status: 'active', ticketType: 'Main Conference', extraNames: [] });
    expect(await sold('workshops')).toBe(0);
    expect(await sold('main-conference')).toBe(1);
  });

  it('refunding Main Conference turns it back into the Workshops-only badge', async () => {
    const ws = await bought([seat('Ada Nakamura', ADA, 'workshops')], 'cs_wb_ws');
    await bought([seat('Ada Nakamura', ADA, 'main-conference')], 'cs_wb_main');
    await refunded('pi_cs_wb_main', 59_900);
    const after = await reg(registrationId(ADA));
    expect(after).toMatchObject({ status: 'active', ticketType: 'Workshops', orderId: ws.oid });
    expect(after.extras).toBeUndefined();
    expect((await order(ws.oid)).extraRegistrationIds).toEqual([]);
    expect(await sold('main-conference')).toBe(0);
    expect(await sold('workshops')).toBe(1);
  });
});

describe('the group rate (decision 2)', () => {
  it('does not count Workshops toward five, and never discounts it', async () => {
    const people = ['a', 'b', 'c', 'd'].map((x) => `${x}@example.com`);
    const f = form({
      tier: 'main-conference',
      name: 'Ada Nakamura',
      email: ADA,
      seatName: [...people.map((p) => `Person ${p[0]}`), 'Ada Nakamura'],
      seatEmail: [...people, ADA],
      seatTier: [...people.map(() => 'main-conference'), 'workshops'],
    });
    expect((await submit(f)).url).toBeDefined();
    // Five Main Conference seats: the rate applies to them and not to Workshops.
    const lines = mocks.created[0]!.line_items;
    expect(lines.map((l) => [l.quantity, l.price_data.unit_amount])).toEqual([
      [5, 53_910],
      [1, WS],
    ]);

    mocks.created.length = 0;
    const four = form({
      tier: 'main-conference',
      name: 'Ada Nakamura',
      email: ADA,
      seatName: [...people.slice(0, 3).map((p) => `Person ${p[0]}`), 'Ada Nakamura'],
      seatEmail: [...people.slice(0, 3), ADA],
      seatTier: [...people.slice(0, 3).map(() => 'main-conference'), 'workshops'],
    });
    expect((await submit(four)).url).toBeDefined();
    expect(mocks.created[0]!.line_items.map((l) => l.price_data.unit_amount)).toEqual([59_900, WS]);
    expect(mocks.created[0]!.metadata.groupRate).toBeUndefined();

    // Five Workshops alone earn nothing either.
    mocks.created.length = 0;
    const five = form({
      tier: 'workshops',
      name: 'Ada Nakamura',
      email: ADA,
      seatName: people.map((p) => `Person ${p[0]}`),
      seatEmail: people,
      seatTier: people.map(() => 'workshops'),
    });
    expect((await submit(five)).url).toBeDefined();
    expect(mocks.created[0]!.line_items.map((l) => [l.quantity, l.price_data.unit_amount])).toEqual([[5, WS]]);
    expect(mocks.created[0]!.metadata.groupRate).toBeUndefined();
  });
});

describe('refunds are independent (T186)', () => {
  const warnings = async () =>
    (await db.collection(COLLECTIONS.auditLog).get()).docs.map((d) => JSON.stringify(d.data()));

  it('refunding Workshops alone takes it off the badge and leaves Main Conference', async () => {
    const oct = await bought([seat('Ada Nakamura', ADA, 'main-conference')], 'cs_r1_oct');
    const dec = await bought([seat('Ada Nakamura', ADA, 'workshops')], 'cs_r1_dec');
    const rid = registrationId(ADA);
    const res = await refunded(dec.pi, WS);
    expect(await res.json()).toMatchObject({ registrationId: null, extrasRemoved: ['workshops'] });
    const after = await reg(rid);
    expect(after.status).toBe('active');
    expect(after.extras).toEqual([]);
    expect(after.extraNames).toEqual([]);
    expect(await sold('workshops')).toBe(0);
    expect(await sold('main-conference')).toBe(1);
    expect(await grants(ADA)).toEqual({ 'video-library': [oct.oid] });
    expect(mocks.refundMails.at(-1)).toMatchObject({
      to: ADA,
      ticketCancelled: false,
      extraRemoved: { name: 'Workshops', remaining: 'Main Conference' },
    });
    // A replay changes nothing.
    await refunded(dec.pi, WS);
    expect(await sold('workshops')).toBe(0);
  });

  it('refunding Main Conference keeps the badge as Workshops-only, with no cascade and no warning', async () => {
    const oct = await bought([seat('Ada Nakamura', ADA, 'main-conference')], 'cs_r2_oct');
    const dec = await bought([seat('Ada Nakamura', ADA, 'workshops')], 'cs_r2_dec');
    const rid = registrationId(ADA);
    const before = await reg(rid);
    const res = await refunded(oct.pi, 59_900);
    expect(await res.json()).toMatchObject({ registrationId: null, keptAs: 'Workshops' });
    const after = await reg(rid);
    expect(after).toMatchObject({ status: 'active', ticketType: 'Workshops', orderId: dec.oid, seat: 0 });
    expect(after.qrSecret).toBe(before.qrSecret);
    expect(after.extras).toBeUndefined();
    expect(after.releasedAdmissions).toEqual([oct.oid]);
    // The Workshops order owns the badge now.
    expect((await order(dec.oid)).extraRegistrationIds).toEqual([]);
    expect(mocks.stripeRefunds).toEqual([]);
    expect((await warnings()).some((w) => w.includes('extra.refundNeeded'))).toBe(false);
    expect(mocks.refundMails.at(-1)).toMatchObject({
      ticketCancelled: false,
      extraRemoved: { name: 'Main Conference', remaining: 'Workshops' },
    });
    expect(await sold('main-conference')).toBe(0);
    expect(await sold('workshops')).toBe(1);
    expect(await grants(ADA)).toEqual({ workshop: [dec.oid] });

    // A replay of the Main Conference refund leaves the badge alone.
    await refunded(oct.pi, 59_900);
    expect((await reg(rid)).status).toBe('active');
    expect(await sold('workshops')).toBe(1);

    // Then refunding Workshops cancels the badge, which now stands on it.
    await refunded(dec.pi, WS);
    expect((await reg(rid)).status).toBe('cancelled');
    expect(await sold('workshops')).toBe(0);
  });

  it('a Workshops line in a cart with other tickets keeps the badge too, and its own cart refund cancels it', async () => {
    await bought([seat('Ada Nakamura', ADA, 'main-conference')], 'cs_r3_oct');
    const dec = await bought(
      [seat('Cy Park', 'cy@example.com', 'main-conference'), seat('Ada Nakamura', ADA, 'workshops')],
      'cs_r3_dec',
    );
    expect((await reg(registrationId(ADA))).extraNames).toEqual(['Workshops']);
    await refunded('pi_cs_r3_oct', 59_900);
    expect(mocks.stripeRefunds).toEqual([]);
    expect(await reg(registrationId(ADA))).toMatchObject({ status: 'active', ticketType: 'Workshops', orderId: dec.oid });
    expect(await sold('workshops')).toBe(1);
    expect((await reg(registrationId('cy@example.com'))).status).toBe('active');
    // Refunding that whole cart takes Cy's ticket and Ada's Workshops badge.
    await refunded(dec.pi, dec.total);
    expect((await reg(registrationId(ADA))).status).toBe('cancelled');
    expect((await reg(registrationId('cy@example.com'))).status).toBe('cancelled');
    expect(await sold('workshops')).toBe(0);
  });

  it('a dispute on Main Conference keeps the Workshops-only badge and warns nobody about Workshops', async () => {
    await bought([seat('Ada Nakamura', ADA, 'main-conference')], 'cs_disp_oct');
    const dec = await bought([seat('Ada Nakamura', ADA, 'workshops')], 'cs_disp_dec');
    const res = await deliver('charge.dispute.created', { id: 'dp_ws', object: 'dispute', payment_intent: 'pi_cs_disp_oct', amount: 59_900 });
    expect(await res.json()).toMatchObject({ keptAs: 'Workshops' });
    expect(await reg(registrationId(ADA))).toMatchObject({ status: 'active', ticketType: 'Workshops', orderId: dec.oid });
    expect(mocks.stripeRefunds).toEqual([]);
    expect((await warnings()).some((w) => w.includes('extra.refundNeeded'))).toBe(false);
  });
});

describe('the invoice path', () => {
  async function paidInvoice(id: string, seats: Seat[]) {
    await recordInvoiceOrder({
      invoiceId: id,
      billingEmail: 'billing@acme.example',
      companyName: 'Acme',
      seats,
      currency: 'usd',
      totalCents: seats.reduce((n, s) => n + s.priceCents, 0),
    });
    const res = await deliver('invoice.paid', {
      id,
      object: 'invoice',
      metadata: { source: 'kgc-web' },
      total: seats.reduce((n, s) => n + s.priceCents, 0),
      currency: 'usd',
      customer_email: 'billing@acme.example',
      lines: { data: [] },
    });
    expect(res.status).toBe(200);
    return invoiceOrderId(id);
  }

  it('puts Workshops on a Main Conference badge bought on the same invoice, listed in either order', async () => {
    const oid = await paidInvoice('in_ws_1', [
      seat('Ada Nakamura', ADA, 'workshops'),
      seat('Ada Nakamura', ADA, 'main-conference'),
    ]);
    const docs = await regsFor(ADA);
    expect(docs).toHaveLength(1);
    expect((docs[0]!.data() as RegistrationDoc).extraNames).toEqual(['Workshops']);
    expect((await order(oid)).extraRegistrationIds ?? []).toEqual([]);
    expect(mocks.sent).toEqual([expect.objectContaining({ to: ADA, ticketType: 'Main Conference + Workshops' })]);
  });

  it('adds Workshops to a badge bought earlier by card', async () => {
    await bought([seat('Ada Nakamura', ADA, 'main-conference')], 'cs_inv_oct');
    const oid = await paidInvoice('in_ws_2', [seat('Ada Nakamura', ADA, 'workshops')]);
    expect((await reg(registrationId(ADA))).extraNames).toEqual(['Workshops']);
    expect((await order(oid)).extraRegistrationIds).toEqual([registrationId(ADA)]);
    expect(mocks.sent.at(-1)).toMatchObject({ addedExtra: 'Workshops', ticketType: 'Main Conference + Workshops' });
  });

  it('issues a Workshops-only badge for an attendee with no other ticket, and no warning (T186)', async () => {
    const oid = await paidInvoice('in_ws_3', [seat('Ada Nakamura', ADA, 'workshops')]);
    expect(await reg(registrationId(ADA))).toMatchObject({ ticketType: 'Workshops', status: 'active', orderId: oid });
    expect(mocks.sent).toEqual([expect.objectContaining({ to: ADA, ticketType: 'Workshops', addedExtra: undefined })]);
    const warnings = (await db.collection(COLLECTIONS.auditLog).get()).docs.map((d) => JSON.stringify(d.data()));
    expect(warnings.some((w) => w.includes('extra.notAdded'))).toBe(false);
  });

  it('lets a card purchase of Main Conference join an invoiced Workshops-only badge (T186)', async () => {
    const oid = await paidInvoice('in_ws_4', [seat('Ada Nakamura', ADA, 'workshops')]);
    await bought([seat('Ada Nakamura', ADA, 'main-conference')], 'cs_after_inv');
    expect(await regsFor(ADA)).toHaveLength(1);
    expect((await reg(registrationId(ADA))).extras).toEqual([expect.objectContaining({ orderId: oid, seat: 1 })]);
    expect((await order(oid)).extraRegistrationIds).toEqual([registrationId(ADA)]);
  });
});
