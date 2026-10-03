/**
 * Attendee referrals on the emulator: minting a unique code per registration,
 * crediting the registrations a referred purchase makes, and the "Bring your
 * team" block in the confirmation email.
 *
 * Run with: npm run test:commerce
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type RegistrationDoc } from '@kgc/shared';
import { ensureRegistration } from '../../scripts/src/lib/fulfilment.js';
import {
  ensureReferralCode,
  inviteMailto,
  personalInviteUrl,
  recordReferral,
  resolveReferralCode,
} from '../../scripts/src/lib/referrals.js';
import { sendPurchaseConfirmation } from '../../scripts/src/lib/email.js';
import { fulfilPurchase } from '../../apps/web/src/lib/registrations.js';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
let db: Firestore;

beforeAll(() => {
  if (!EMULATOR) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:commerce');
  }
  if (!getApps().length) initializeApp({ projectId: 'kgc-conference-app-and-website' });
  db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
});

async function clear(collection: string) {
  const snap = await db.collection(collection).where('eventId', '==', EVENT_ID).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  await Promise.all(
    [COLLECTIONS.registrations, COLLECTIONS.orders, COLLECTIONS.referralCodes, COLLECTIONS.emailLog].map(clear),
  );
});

const register = (email: string, name = email.split('@')[0]!) =>
  ensureRegistration(db, { email, name, ticketType: 'Main Conference' });

async function reg(rid: string): Promise<RegistrationDoc> {
  return (await db.collection(COLLECTIONS.registrations).doc(rid).get()).data() as RegistrationDoc;
}

describe('ensureReferralCode', () => {
  it('mints a code, stores it on the registration and reserves it', async () => {
    const ada = await register('ada@example.com');
    const code = await ensureReferralCode(db, ada.registrationId);

    expect(code).toMatch(/^KGC27-[2-9A-HJKMNP-Z]{4}$/);
    expect((await reg(ada.registrationId)).referralCode).toBe(code);
    const reserved = (await db.collection(COLLECTIONS.referralCodes).doc(code!).get()).data();
    expect(reserved).toMatchObject({ eventId: EVENT_ID, registrationId: ada.registrationId });
  });

  it('keeps the same code for ever, so a resent email prints the same link', async () => {
    const ada = await register('ada@example.com');
    const first = await ensureReferralCode(db, ada.registrationId);
    const second = await ensureReferralCode(db, ada.registrationId);
    await register('ada@example.com'); // a repeat purchase updates the registration
    expect(second).toBe(first);
    expect(await ensureReferralCode(db, ada.registrationId)).toBe(first);
  });

  it('skips a code somebody already holds', async () => {
    const ada = await register('ada@example.com');
    const ben = await register('ben@example.com');
    await ensureReferralCode(db, ada.registrationId, () => 'KGC27-AAAA');

    let n = 0;
    const code = await ensureReferralCode(db, ben.registrationId, () => (n++ < 2 ? 'KGC27-AAAA' : 'KGC27-BBBB'));
    expect(code).toBe('KGC27-BBBB');
    expect((await reg(ada.registrationId)).referralCode).toBe('KGC27-AAAA');
  });

  it('refuses rather than sharing a code when every candidate is taken', async () => {
    const ada = await register('ada@example.com');
    const ben = await register('ben@example.com');
    await ensureReferralCode(db, ada.registrationId, () => 'KGC27-AAAA');
    await expect(ensureReferralCode(db, ben.registrationId, () => 'KGC27-AAAA')).rejects.toThrow(/no free referral code/);
    expect((await reg(ben.registrationId)).referralCode).toBeUndefined();
  });

  it('gives two hundred attendees two hundred different codes', async () => {
    const rids = await Promise.all(
      Array.from({ length: 200 }, (_, i) => register(`person${i}@example.com`).then((r) => r.registrationId)),
    );
    const codes = await Promise.all(rids.map((rid) => ensureReferralCode(db, rid)));
    expect(new Set(codes).size).toBe(200);
    const reserved = await db.collection(COLLECTIONS.referralCodes).where('eventId', '==', EVENT_ID).get();
    expect(reserved.size).toBe(200);
  });

  it('returns null for a registration that does not exist', async () => {
    expect(await ensureReferralCode(db, 'reg_missing')).toBeNull();
  });
});

describe('recordReferral', () => {
  async function referrer() {
    const ada = await register('ada@example.com', 'Ada Nakamura');
    const code = (await ensureReferralCode(db, ada.registrationId))!;
    return { rid: ada.registrationId, code };
  }

  it('credits every registration a referred purchase made, with the UTMs', async () => {
    const ada = await referrer();
    const ben = await fulfilPurchase({
      email: 'ben@example.com',
      name: 'Ben Olsen',
      ticketType: 'Main Conference',
      externalId: 'cs_test_ref_1',
      amountCents: 79_900,
      currency: 'usd',
      paid: true,
    });
    const cara = await register('cara@example.com');
    const utm = { source: 'attendee', medium: 'invite', campaign: 'kgc2027' };

    const result = await recordReferral(db, {
      registrationIds: [ben.registrationId, cara.registrationId],
      code: ada.code.toLowerCase(),
      utm,
    });

    expect(result.credited).toEqual([ben.registrationId, cara.registrationId]);
    for (const rid of [ben.registrationId, cara.registrationId]) {
      const r = await reg(rid);
      expect(r.referredBy).toMatchObject({ code: ada.code });
      // The referrer's id is not on the attendee-readable document.
      expect(Object.keys(r.referredBy!).sort()).toEqual(['at', 'code']);
      expect(r.utm).toEqual(utm);
    }
  });

  it('ignores an unknown or malformed code, and still keeps the UTMs', async () => {
    await referrer();
    const ben = await register('ben@example.com');
    for (const code of ['KGC27-ZZZZ', 'not-a-code', '../registrations/x']) {
      const result = await recordReferral(db, { registrationIds: [ben.registrationId], code, utm: { source: 'attendee' } });
      expect(result.invalidCode).toBe(true);
      expect(result.credited).toEqual([]);
    }
    const r = await reg(ben.registrationId);
    expect(r.referredBy).toBeUndefined();
    expect(r.utm).toEqual({ source: 'attendee' });
  });

  it('ignores a self-referral: the same ticket, or another ticket on the same address', async () => {
    const ada = await referrer();
    // Ada buys a second ticket for herself through her own link.
    const again = await fulfilPurchase({
      email: 'ADA@example.com',
      name: 'Ada Nakamura',
      ticketType: 'Main Conference',
      externalId: 'cs_test_ref_self',
      amountCents: 79_900,
      currency: 'usd',
      paid: true,
    });
    expect(again.registrationId).not.toBe(ada.rid);

    const result = await recordReferral(db, { registrationIds: [ada.rid, again.registrationId], code: ada.code });
    expect(result.credited).toEqual([]);
    expect(result.selfReferrals.sort()).toEqual([ada.rid, again.registrationId].sort());
    expect((await reg(ada.rid)).referredBy).toBeUndefined();
    expect((await reg(again.registrationId)).referredBy).toBeUndefined();
  });

  it('keeps the first credit when the purchase is replayed with another code', async () => {
    const ada = await referrer();
    const zed = await register('zed@example.com');
    const zedCode = (await ensureReferralCode(db, zed.registrationId))!;
    const ben = await register('ben@example.com');

    await recordReferral(db, { registrationIds: [ben.registrationId], code: ada.code, utm: { source: 'attendee' } });
    const replay = await recordReferral(db, { registrationIds: [ben.registrationId], code: zedCode, utm: { source: 'x' } });

    expect(replay.credited).toEqual([]);
    const r = await reg(ben.registrationId);
    expect(r.referredBy?.code).toBe(ada.code);
    expect(r.utm).toEqual({ source: 'attendee' });
  });

  it('resolves a code only to a registration that still exists', async () => {
    const ada = await referrer();
    expect(await resolveReferralCode(db, ada.code)).toMatchObject({ registrationId: ada.rid });
    await db.collection(COLLECTIONS.registrations).doc(ada.rid).delete();
    expect(await resolveReferralCode(db, ada.code)).toBeNull();
  });
});

describe('the confirmation email', () => {
  const sent: { html: string; text: string; subject: string }[] = [];

  beforeEach(() => {
    sent.length = 0;
    vi.stubEnv('RESEND_API_KEY', 're_test_not_real');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        sent.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('has the Bring your team block after the ticket details, with a prefilled mailto', async () => {
    const ada = await register('ada@example.com', 'Ada Nakamura');
    const outcome = await sendPurchaseConfirmation(db, {
      to: 'ada@example.com',
      name: 'Ada Nakamura',
      ticketType: 'Main Conference',
      amountCents: 79_900,
      currency: 'usd',
      orderUrl: 'https://staging.knowledgegraph.tech/order/tok',
      claimCode: 'ABCDEF',
      registrationId: ada.registrationId,
    });
    expect(outcome).toBe('sent');

    // No code was passed, so one was minted from the registration.
    const code = (await reg(ada.registrationId)).referralCode!;
    expect(code).toBeTruthy();
    const link = personalInviteUrl('https://staging.knowledgegraph.tech', code);
    const mailto = inviteMailto(link, 'Ada');

    const { html, text } = sent[0]!;
    expect(html.indexOf('Bring your team')).toBeGreaterThan(html.indexOf('View your ticket'));
    expect(html).toContain(
      'Most of what people take home from KGC happens between the sessions, and those conversations go further when the people you work with are in the room too!',
    );
    expect(html).toContain(`href="${mailto.replace(/&/g, '&amp;')}"`);
    expect(html).toContain('>Invite your team</a>');
    expect(text).toContain('Bring your team');
    expect(text).toContain(link);
  });

  it('uses the code it is given and leaves the block out when there is none', async () => {
    await sendPurchaseConfirmation(db, {
      to: 'ben@example.com',
      name: 'Ben',
      ticketType: 'Main Conference',
      amountCents: 0,
      currency: 'usd',
      orderUrl: 'https://staging.knowledgegraph.tech/order/tok',
      claimCode: 'ABCDEF',
      referralCode: 'KGC27-7QF2',
    });
    await sendPurchaseConfirmation(db, {
      to: 'cara@example.com',
      name: 'Cara',
      ticketType: 'Main Conference',
      amountCents: 0,
      currency: 'usd',
      orderUrl: 'https://staging.knowledgegraph.tech/order/tok',
      claimCode: 'ABCDEF',
    });
    expect(sent[0]!.text).toContain('ref=KGC27-7QF2');
    expect(sent[1]!.html).not.toContain('Bring your team');
    expect(sent[1]!.text).not.toContain('Bring your team');
  });
});
