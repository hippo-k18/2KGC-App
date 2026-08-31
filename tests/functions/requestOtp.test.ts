/**
 * Integration test for `requestOtp` (functions/SPEC.md #9), an HTTPS
 * callable rather than a Firestore trigger — invoked over the emulator's
 * callable HTTP protocol via `callCallable()` (see lib/emulator.ts for why
 * there's no client SDK involved).
 *
 * Run with: npm run test:functions
 */
import { readFile } from 'node:fs/promises';

import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { Timestamp, type CollectionReference, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ipCounterId } from '../../functions/src/lib/rate-limit.js';
import { callCallable, connectToEmulator } from './lib/emulator.js';

const EMAIL_VALID = 'requestotp-valid@example.test';
const EMAIL_THROTTLE = 'requestotp-throttle@example.test';
const EMAIL_IP_BLOCKED = 'requestotp-ip-blocked@example.test';
const EMAIL_IP_SPOOF = 'requestotp-ip-spoof@example.test';
const EMAIL_IP_OTHER = 'requestotp-ip-other@example.test';
const EMAIL_IP_PASS = 'requestotp-ip-pass@example.test';
const EMAIL_DELIVERY = 'requestotp-delivery@example.test';

/**
 * The anti-enumeration pair. One of these holds a ticket and one does not, and
 * the whole point of the pair is that nothing a caller can see says which.
 *
 * The registered one is seeded by `npm run seed`, which `npm run test:functions`
 * runs first — attendee 0, so it is the most stable row in the fixture. The
 * test asserts the registration is actually there rather than assuming it, so a
 * change to the seed fails as "the fixture moved" instead of quietly turning
 * this into two unregistered addresses comparing equal for the wrong reason.
 */
const EMAIL_ON_GUEST_LIST = 'amara.okonkwo@example.test';
const EMAIL_OFF_GUEST_LIST = 'requestotp-nobody@example.test';

/** Its own address, so the tick count below does not depend on test order. */
const EMAIL_UNDELIVERED = 'requestotp-undelivered@example.test';

/**
 * `X-Forwarded-For` as Google's front end presents it: whatever the client
 * sent, then the client's real address, then the front end's own. The
 * second-to-last entry is the one the client cannot choose, and is the one the
 * limit is keyed on — see `callerIp()` in functions/src/lib/rate-limit.ts.
 */
const REAL_IP = '203.0.113.9';
const GFE_IP = '130.211.0.1';
const forwardedFor = (...hops: string[]) => ({ 'x-forwarded-for': hops.join(', ') });

/** RFC 5737 documentation range, so no real address is ever written. */
const OTHER_IP = '198.51.100.7';

let db: Firestore;
let otpCodesRef: CollectionReference;
let rateLimitsRef: CollectionReference;
let emailLogRef: CollectionReference;

const FIXTURE_EMAILS = [
  EMAIL_VALID,
  EMAIL_THROTTLE,
  EMAIL_IP_BLOCKED,
  EMAIL_IP_SPOOF,
  EMAIL_IP_OTHER,
  EMAIL_IP_PASS,
  EMAIL_DELIVERY,
  EMAIL_ON_GUEST_LIST,
  EMAIL_OFF_GUEST_LIST,
  EMAIL_UNDELIVERED,
];

async function otpCodeFor(email: string) {
  const snap = await otpCodesRef.where('email', '==', email).limit(1).get();
  return snap.docs[0]?.data();
}

async function rateLimitFor(email: string) {
  const snap = await rateLimitsRef.where('email', '==', email).limit(1).get();
  return snap.docs[0]?.data();
}

/**
 * Every send attempt writes one `emailLog` row — sent, failed, or skipped. That
 * makes the log the only place a test can observe delivery: nothing else about
 * a send is visible from outside the function, and it must stay that way (see
 * the anti-enumeration block below).
 *
 * A single equality filter on purpose. Adding `template` would be a two-field
 * equality query, which Firestore serves without a composite index but the
 * emulator would not have told us either way — and AGENTS.md is emphatic that
 * queries which pass locally and fail in production are how two screens shipped
 * broken here.
 */
async function signInCodeMailFor(email: string) {
  const snap = await emailLogRef.where('to', '==', email).get();
  return snap.docs.map((d) => d.data()).filter((d) => d.template === 'sign-in-code');
}

async function deleteWhereEmail(collection: CollectionReference, email: string) {
  const snap = await collection.where('email', '==', email).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

async function deleteWhereTo(collection: CollectionReference, email: string) {
  const snap = await collection.where('to', '==', email).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

async function cleanupFixtures() {
  for (const email of FIXTURE_EMAILS) {
    await deleteWhereEmail(otpCodesRef, email);
    await deleteWhereEmail(rateLimitsRef, email);
    await deleteWhereTo(emailLogRef, email);
  }
  for (const ip of [REAL_IP, OTHER_IP]) {
    await rateLimitsRef.doc(ipCounterId('requestOtp', ip)).delete();
  }
}

/**
 * Puts an IP's counter at the cap without making 120 real calls. The cap is
 * deliberately generous — a NAT'd conference venue shares one address, see the
 * constants in request-otp.ts — so exercising it by hammering the endpoint
 * would make this file the slowest in the suite to prove nothing extra.
 */
async function fillIpWindow(ip: string, count: number) {
  await rateLimitsRef.doc(ipCounterId('requestOtp', ip)).set({
    kind: 'requestOtp-ip',
    count,
    windowStart: Timestamp.now(),
    updatedAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + 15 * 60_000),
  });
}

beforeAll(async () => {
  db = connectToEmulator();
  otpCodesRef = db.collection(COLLECTIONS.otpCodes);
  rateLimitsRef = db.collection(COLLECTIONS.rateLimits);
  emailLogRef = db.collection(COLLECTIONS.emailLog);
  await cleanupFixtures();
}, 20_000);

afterAll(async () => {
  await cleanupFixtures();
});

describe('requestOtp', () => {
  it('writes a 6-digit code for a valid email and normalises it to lower case', async () => {
    const res = await callCallable<{ ok: boolean }>('requestOtp', { email: ` ${EMAIL_VALID.toUpperCase()} ` });

    expect(res.status).toBe(200);
    expect(res.result?.ok).toBe(true);

    const otp = await otpCodeFor(EMAIL_VALID);
    expect(otp).toBeDefined();
    expect(otp?.email).toBe(EMAIL_VALID);
    expect(otp?.eventId).toBe(EVENT_ID);
    expect(otp?.code).toMatch(/^\d{6}$/);
    expect(otp?.attempts).toBe(0);

    const ttlMinutes = (otp?.expiresAt.toMillis() - otp?.createdAt.toMillis()) / 60_000;
    expect(ttlMinutes).toBeCloseTo(10, 1);
  }, 20_000);

  it('rejects a malformed email without writing a code', async () => {
    const res = await callCallable('requestOtp', { email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.error?.status).toBe('INVALID_ARGUMENT');
    expect(await otpCodeFor('not-an-email')).toBeUndefined();
  }, 20_000);

  it('throttles a sixth request within the same hour', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await callCallable<{ ok: boolean }>('requestOtp', { email: EMAIL_THROTTLE });
      expect(res.status).toBe(200);
    }

    const sixth = await callCallable('requestOtp', { email: EMAIL_THROTTLE });
    expect(sixth.status).toBe(429);
    expect(sixth.error?.status).toBe('RESOURCE_EXHAUSTED');

    const rateLimit = await rateLimitFor(EMAIL_THROTTLE);
    expect(rateLimit?.count).toBe(5);
  }, 30_000);
});

/**
 * The per-email cap above is the one the audit called defeated: an attacker
 * cycles addresses and never trips it, while every request still costs an
 * invocation and two writes. These cover the limit that sees that shape.
 */
describe('requestOtp per-IP rate limit', () => {
  it('counts a request against the caller IP, not just the email', async () => {
    const res = await callCallable('requestOtp', { email: EMAIL_IP_OTHER }, forwardedFor(OTHER_IP, GFE_IP));
    expect(res.status).toBe(200);

    const counter = await rateLimitsRef.doc(ipCounterId('requestOtp', OTHER_IP)).get();
    expect(counter.exists).toBe(true);
    expect(counter.data()?.count).toBe(1);
    // The address itself is never stored — the id is a hash of it.
    expect(JSON.stringify(counter.data())).not.toContain(OTHER_IP);
  }, 20_000);

  it('refuses a fresh, never-seen email once the caller IP is at its cap', async () => {
    await fillIpWindow(REAL_IP, 120);

    const res = await callCallable('requestOtp', { email: EMAIL_IP_BLOCKED }, forwardedFor(REAL_IP, GFE_IP));

    expect(res.status).toBe(429);
    expect(res.error?.status).toBe('RESOURCE_EXHAUSTED');
    // The whole point: this address has never asked for anything, so the
    // per-email cap would have let it through.
    expect(await otpCodeFor(EMAIL_IP_BLOCKED)).toBeUndefined();
  }, 20_000);

  it('is not escaped by prepending a forged X-Forwarded-For entry', async () => {
    await fillIpWindow(REAL_IP, 120);

    const res = await callCallable(
      'requestOtp',
      { email: EMAIL_IP_SPOOF },
      forwardedFor('1.2.3.4', REAL_IP, GFE_IP),
    );

    // Reading `parts[0]` — the conventional reading of this header — would
    // have keyed on the forged 1.2.3.4 and let this through.
    expect(res.status).toBe(429);
    expect(await otpCodeFor(EMAIL_IP_SPOOF)).toBeUndefined();
  }, 20_000);

  it('does not block a different caller behind the same cap', async () => {
    await fillIpWindow(REAL_IP, 120);

    const res = await callCallable('requestOtp', { email: EMAIL_IP_PASS }, forwardedFor(OTHER_IP, GFE_IP));

    expect(res.status).toBe(200);
    expect(await otpCodeFor(EMAIL_IP_PASS)).toBeDefined();
  }, 20_000);
});

/**
 * Delivery — BUILD-PLAN 1.2.
 *
 * Before this, `requestOtp` wrote the code to Firestore and printed it to the
 * function's console, which is not a delivery channel for a credential: anyone
 * with Logs Viewer on the project could read every attendee's sign-in code.
 *
 * ⚠️ These run with no `RESEND_API_KEY`, and that is deliberate rather than a
 * limitation. It means the suite never touches Resend and never sends mail to a
 * real address, and it means every assertion below is made about the *worse*
 * case — a send that did not go out — which is the case the caller must still
 * be unable to detect.
 */
describe('requestOtp delivery', () => {
  it('attempts to email the code, and records the attempt', async () => {
    const res = await callCallable<{ ok: boolean }>('requestOtp', { email: EMAIL_DELIVERY });
    expect(res.status).toBe(200);

    const mail = await signInCodeMailFor(EMAIL_DELIVERY);
    expect(mail).toHaveLength(1);
    expect(mail[0].to).toBe(EMAIL_DELIVERY);
    expect(mail[0].eventId).toBe(EVENT_ID);
    // No API key on the emulator, so the shared sender's degradation path runs
    // and says so in as many words. The point is that it is *recorded*: a
    // deployment that is not sending must be visibly not sending, never
    // apparently succeeding.
    expect(mail[0].status).toBe('skipped');
    expect(mail[0].reason).toContain('RESEND_API_KEY');
  }, 20_000);

  it('keeps the code out of the record it writes about the code', async () => {
    const otp = await otpCodeFor(EMAIL_DELIVERY);
    expect(otp?.code).toMatch(/^\d{6}$/);

    const mail = await signInCodeMailFor(EMAIL_DELIVERY);
    // `emailLog` is a diagnostic read by support, and a credential sitting in a
    // diagnostic is the same hole as one sitting in a console log — just with a
    // longer retention. The subject line carries the worst of it, because
    // subjects survive in gateways and on lock screens that never see a body.
    expect(JSON.stringify(mail)).not.toContain(otp?.code);
    expect(mail[0].subject).not.toMatch(/\d{6}/);
  }, 20_000);

  it('never prints the code, at any log level', async () => {
    const source = await readFile(
      new URL('../../functions/src/callable/request-otp.ts', import.meta.url),
      'utf8',
    );

    /*
     * A source assertion, because the artefact this pins — what Cloud Logging
     * receives — is not observable from a test: the functions emulator writes
     * function output to the stdout of the process that spawned it, which is
     * `firebase emulators:exec`, not this file. The regression it guards is
     * concrete and has happened once already, so pinning it imperfectly beats
     * not pinning it. Matching the `code` *identifier* rather than the word
     * lets the prose in the surviving `console.error` say "sign-in code".
     */
    const calls = source.match(/console\.\w+\([\s\S]*?\);/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).not.toMatch(/\$\{\s*code\s*\}|[(,]\s*code\s*[,)]/);
    }
  });
});

/**
 * ★ The anti-enumeration property, which is the one worth pinning.
 *
 * `requestOtp` deliberately never consults `registrations`, so that asking for
 * a code cannot be used to ask "is this person coming?" — the same reason
 * `registrationIsMine` in `firestore.rules` is shaped the way it is. Wiring up
 * delivery is the easiest possible way to lose that, because every natural way
 * to write it ("look up the ticket, then send") reintroduces the branch.
 *
 * So the tests compare an address that holds a seeded ticket against one that
 * has never existed, and require them to be indistinguishable in everything a
 * caller can reach.
 */
describe('requestOtp does not reveal who holds a ticket', () => {
  it('answers identically for a registered and an unregistered address', async () => {
    const registered = await db
      .collection(COLLECTIONS.registrations)
      .where('email', '==', EMAIL_ON_GUEST_LIST)
      .limit(1)
      .get();
    expect(registered.empty, `seed fixture missing: ${EMAIL_ON_GUEST_LIST}`).toBe(false);

    const onList = await callCallable<{ ok: boolean }>('requestOtp', { email: EMAIL_ON_GUEST_LIST });
    const offList = await callCallable<{ ok: boolean }>('requestOtp', { email: EMAIL_OFF_GUEST_LIST });

    // Byte-identical, not merely both-successful: a difference anywhere in the
    // envelope is a difference an attacker can script against.
    expect(onList.status).toBe(offList.status);
    expect(JSON.stringify(onList)).toBe(JSON.stringify(offList));
    expect(onList).toEqual({ status: 200, result: { ok: true } });

    // And identical on the server side too, so nothing downstream of the
    // response can grow a branch on it later.
    const [mailOn] = await signInCodeMailFor(EMAIL_ON_GUEST_LIST);
    const [mailOff] = await signInCodeMailFor(EMAIL_OFF_GUEST_LIST);
    expect(mailOn.status).toBe(mailOff.status);
    expect(mailOn.reason).toBe(mailOff.reason);

    // A stranger's address gets a real, storable code — this is the part that
    // costs an email and buys the property.
    expect((await otpCodeFor(EMAIL_OFF_GUEST_LIST))?.code).toMatch(/^\d{6}$/);
  }, 30_000);

  it('answers `ok` even though the code was not delivered', async () => {
    const res = await callCallable<{ ok: boolean }>('requestOtp', { email: EMAIL_UNDELIVERED });

    // The undelivered case, which is the whole comparison: no API key, so this
    // send definitively did not reach anyone, and the caller is told exactly
    // what a successful one would have told them. A bounce, a rejected address
    // and an unknown address must all land here.
    const [mail] = await signInCodeMailFor(EMAIL_UNDELIVERED);
    expect(mail.status).not.toBe('sent');

    expect(res.status).toBe(200);
    expect(res.result).toEqual({ ok: true });
    expect(res.error).toBeUndefined();
  }, 20_000);

  it('does not refund the rate-limit tick when delivery did not happen', async () => {
    // The previous test already spent one tick on this address and its send did
    // not go out. If a failed send rolled the tick back, the counter would
    // still read 1 after a second request — and any address a provider rejects
    // would become an unmetered way to make this function run. The limit has to
    // count requests, because requests are what cost money.
    expect((await rateLimitFor(EMAIL_UNDELIVERED))?.count).toBe(1);

    await callCallable('requestOtp', { email: EMAIL_UNDELIVERED });
    expect((await rateLimitFor(EMAIL_UNDELIVERED))?.count).toBe(2);
  }, 20_000);
});
