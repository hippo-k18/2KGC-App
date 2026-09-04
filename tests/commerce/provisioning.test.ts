/**
 * The buyer's identity: what a paid ticket has to create besides a ticket.
 *
 * The only thing in this repo that gave a buyer a Firebase Auth account used to
 * be `provisionAppAccount()`, whose single call site sat inside
 * `if (!stripeEnabled())` *and* behind a `DEMO_MODE` check. With a real Stripe
 * key control never reached it, so a paying customer got a registration, an
 * order and a receipt — and no account, no `registered` claim, and an app that
 * `firestore.rules` denies at every read. Both that function and demo mode are
 * gone; these tests pin the replacement that runs on the webhook path.
 *
 * Every case here is a way this can be wrong *on the second delivery* rather
 * than the first, because Stripe redelivers an event for up to three days and
 * the first delivery is the easy one:
 *
 *   - a replay creating a second Auth account for one address, so the claim
 *     lands on one and the profile on the other and the app looks empty;
 *   - a replay resetting a password, or clobbering an `organizer` role granted
 *     by hand, with nothing in any log to say why;
 *   - a replay rewriting `directory/{uid}` for somebody who opted out —
 *     republishing a person because a webhook was retried;
 *   - a replay handing the same refunded seat back to `quantitySold` twice,
 *     which oversells the tier rather than merely miscounting it.
 *
 * They run against the **Firestore and Auth emulators with the Admin SDK**,
 * not through `firestore.rules`: this code deliberately bypasses rules, so a
 * rules-unit-testing harness would be testing the wrong thing.
 *
 * Run with: npm run test:commerce
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, SUBCOLLECTIONS, type TicketTypeDoc } from '@kgc/shared';

import {
  entitlementKinds,
  grantOrderEntitlements,
  provisionAttendeeAccount,
  uidForEmail,
  withdrawOrderEntitlements,
} from '../../apps/web/src/lib/app-account-core.js';
import { decideRefund } from '../../apps/web/src/lib/refund-core.js';


const FIRESTORE_EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST;

/**
 * A password, to prove none was set.
 *
 * Any string would do — the assertion is that `signInWithPassword` fails, and it
 * fails for an account that has no password whatever is typed. It used to be a
 * verbatim copy of the demo path's shared password, which made this file one
 * more place a live credential was committed for no reason: the test never
 * needed the real value.
 */
const ANY_PASSWORD = 'not-the-password-of-any-account';

let db: Firestore;
let auth: Auth;

beforeAll(() => {
  /**
   * Refuse to run against anything real.
   *
   * These tests create and delete Auth accounts. Pointed at the live project by
   * a stray environment variable they would delete real attendees, so the guard
   * is a hard failure rather than a warning — and it names the Auth emulator
   * separately, because `npm run test:commerce` used to start Firestore alone
   * and a half-configured run would have deleted nothing and asserted nothing.
   */
  if (!FIRESTORE_EMULATOR || !AUTH_EMULATOR) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST must both be set. These ' +
        'tests create and delete Auth accounts and must never run against the live ' +
        'project. Use: npm run test:commerce',
    );
  }
  if (!getApps().length) initializeApp({ projectId: 'kgc-conference-app-and-website' });
  db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  auth = getAuth();
});

async function clear(collection: string) {
  const snap = await db.collection(collection).where('eventId', '==', EVENT_ID).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

/**
 * Deleting `users/{uid}` does not delete `users/{uid}/entitlements`.
 *
 * Firestore subcollections are independent of their parent document, so the
 * grants written by one test survived into the next and the count assertions
 * read two documents where they expected one. A collection group query is the
 * only way to find them once the parent is gone.
 */
async function clearEntitlements() {
  const snap = await db.collectionGroup(SUBCOLLECTIONS.entitlements).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

async function clearAuth() {
  const { users } = await auth.listUsers(1000);
  if (users.length > 0) await auth.deleteUsers(users.map((u) => u.uid));
}

beforeEach(async () => {
  await clearEntitlements();
  await Promise.all([
    clear(COLLECTIONS.users),
    clear(COLLECTIONS.directory),
    clear(COLLECTIONS.ticketTypes),
    clearAuth(),
  ]);
});

const buyer = { email: 'Ada.Nakamura@Example.com', name: 'Ada Nakamura' };
const lowercased = 'ada.nakamura@example.com';

/**
 * Can somebody sign in with this address and this password?
 *
 * Asked of the Auth emulator's own REST endpoint rather than inferred from the
 * `UserRecord`, because "no password is set" is a claim about *sign-in* and the
 * only honest way to check it is to try. The emulator accepts any API key.
 */
async function canSignIn(email: string, password: string): Promise<boolean> {
  const res = await fetch(
    `http://${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  return res.ok;
}

describe('provisioning an account from a paid ticket', () => {
  it('creates the account, the claim and the profile the app needs', async () => {
    const result = await provisionAttendeeAccount(auth, db, buyer);

    expect(result.status).toBe('created');
    expect(result.claimsStamped).toBe(true);
    expect(result.profileCreated).toBe(true);

    const user = await auth.getUser(result.uid!);
    expect(user.email).toBe(lowercased);
    // `registered` is the claim `firestore.rules` gates every attendee read on.
    // Without it the buyer signs in successfully and sees an empty app.
    expect(user.customClaims).toMatchObject({
      registered: true,
      roles: ['attendee'],
      eventId: EVENT_ID,
    });

    const profile = await db.collection(COLLECTIONS.users).doc(result.uid!).get();
    expect(profile.exists).toBe(true);
    expect(profile.data()?.email).toBe(lowercased);
  });

  it('normalises the address, so the account and the registration share one key', async () => {
    const result = await provisionAttendeeAccount(auth, db, buyer);
    expect(result.uid).toBe(uidForEmail('  ADA.NAKAMURA@example.com '));
  });

  it('writes the directory projection, which nothing else in the deployment does', async () => {
    // `mirrorDirectory` is undeployed (the project is on Spark), so without this
    // the buyer signs in successfully and is invisible to every other attendee —
    // which reads as the directory being broken rather than a missing trigger.
    const { uid } = await provisionAttendeeAccount(auth, db, {
      ...buyer,
      company: 'Cornell Tech',
      title: 'Research Lead',
    });

    const entry = await db.collection(COLLECTIONS.directory).doc(uid!).get();
    expect(entry.exists).toBe(true);
    expect(entry.data()).toMatchObject({ name: 'Ada Nakamura', company: 'Cornell Tech' });
  });

  /**
   * ⚠️ This block used to assert the opposite — "sets no password, because the
   * way in is the code emailed to the address". Provisioning now issues a
   * temporary one, and these are the properties that keep that from being the
   * mistake the old test guarded against.
   */
  it('sets a six-digit password that actually signs in', async () => {
    const result = await provisionAttendeeAccount(auth, db, buyer);

    expect(result.temporaryPassword).toMatch(/^\d{6}$/);
    // Asserted against Auth rather than against the return value: a result
    // object claiming a password that was never set is exactly the drift the
    // receipt and the confirmation page would then print.
    expect(await canSignIn(lowercased, result.temporaryPassword!)).toBe(true);
  });

  it('issues a different password to every buyer', async () => {
    // The property the shared-password version did not have, and the reason
    // this was changed. Two accounts, two provisions, two values.
    const a = await provisionAttendeeAccount(auth, db, buyer);
    const b = await provisionAttendeeAccount(auth, db, {
      email: 'second.buyer@example.com',
      name: 'Second Buyer',
    });

    expect(a.temporaryPassword).not.toBe(b.temporaryPassword);
    // And one buyer's password must not open the other's account.
    expect(await canSignIn('second.buyer@example.com', a.temporaryPassword!)).toBe(false);
    expect(await canSignIn(lowercased, b.temporaryPassword!)).toBe(false);
  });

  it('still refuses a password that is not the issued one', async () => {
    await provisionAttendeeAccount(auth, db, buyer);
    expect(await canSignIn(lowercased, ANY_PASSWORD)).toBe(false);
  });

  it('stores the password on the registration so the page can show it', async () => {
    // Random per buyer means it cannot be recomputed, so the confirmation page
    // reads it back from here. `rid` and `uid` are the same hash of the email.
    // Its own address, for the reason spelled out in the switched-off test.
    const result = await provisionAttendeeAccount(auth, db, {
      email: 'stored-password-probe@example.com',
      name: 'Probe',
    });
    const reg = await db.collection(COLLECTIONS.registrations).doc(result.uid!).get();
    expect(reg.data()?.tempPassword).toBe(result.temporaryPassword);
  });

  it('stamps mustChangePassword, which is what stops it being permanent', async () => {
    // Six digits is a weak secret and is not meant to survive. Without this
    // flag the app has no reason to ask for a replacement.
    const { uid } = await provisionAttendeeAccount(auth, db, buyer);
    const profile = await db.collection(COLLECTIONS.users).doc(uid!).get();
    expect(profile.data()?.mustChangePassword).toBe(true);
  });

  it('never resets the password of an account that already exists', async () => {
    // The important one. Somebody who bought a second ticket may have already
    // chosen their own password; reissuing on a later purchase would break the
    // credential they are actually using.
    const first = await provisionAttendeeAccount(auth, db, buyer);
    await auth.updateUser(first.uid!, { password: 'their-own-choice' });
    await db.collection(COLLECTIONS.users).doc(first.uid!).update({ mustChangePassword: false });

    const again = await provisionAttendeeAccount(auth, db, buyer);

    expect(again.status).toBe('existing');
    expect(again.temporaryPassword).toBeNull();
    expect(await canSignIn(lowercased, 'their-own-choice')).toBe(true);
    expect(await canSignIn(lowercased, first.temporaryPassword!)).toBe(false);
    const profile = await db.collection(COLLECTIONS.users).doc(first.uid!).get();
    expect(profile.data()?.mustChangePassword).toBe(false);
  });

  it('sets no password at all when the feature is switched off', async () => {
    // `ISSUE_TEMPORARY_PASSWORDS=0` restores the pre-2026-09-02 behaviour
    // without a code change, which is the whole point of the switch.
    //
    // ⚠️ Its own address, deliberately. `beforeEach` clears `users`,
    // `directory`, `ticketTypes` and Auth but NOT `registrations` — and it must
    // not, because `fulfilment.test.ts` runs against the same emulator and owns
    // fixtures in that collection. A shared address would read a `tempPassword`
    // left by an earlier test in this file and assert on somebody else's data.
    const email = 'switch-off-probe@example.com';
    const previous = process.env.ISSUE_TEMPORARY_PASSWORDS;
    process.env.ISSUE_TEMPORARY_PASSWORDS = '0';
    try {
      const result = await provisionAttendeeAccount(auth, db, { email, name: 'Probe' });
      expect(result.status).toBe('created');
      expect(result.temporaryPassword).toBeNull();
      const profile = await db.collection(COLLECTIONS.users).doc(result.uid!).get();
      expect(profile.data()?.mustChangePassword).toBeUndefined();
      const reg = await db.collection(COLLECTIONS.registrations).doc(result.uid!).get();
      expect(reg.data()?.tempPassword).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.ISSUE_TEMPORARY_PASSWORDS;
      else process.env.ISSUE_TEMPORARY_PASSWORDS = previous;
    }
  });

  it('reports the failure instead of throwing, so a purchase is never lost to it', async () => {
    // An address Firebase Auth refuses. The ticket is already sold by the time
    // this runs; a purchase that 500s because an account could not be made is
    // worse than a purchase with an account still to make.
    const result = await provisionAttendeeAccount(auth, db, { email: 'not-an-address', name: 'X' });

    expect(result.status).toBe('failed');
    expect(result.uid).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe('a replayed webhook delivery', () => {
  it('creates exactly one account, however many times Stripe delivers the event', async () => {
    const first = await provisionAttendeeAccount(auth, db, buyer);
    const second = await provisionAttendeeAccount(auth, db, buyer);
    const third = await provisionAttendeeAccount(auth, db, buyer);

    expect(first.status).toBe('created');
    expect(second.status).toBe('existing');
    expect(third.status).toBe('existing');
    expect(second.uid).toBe(first.uid);
    expect(third.uid).toBe(first.uid);

    const { users } = await auth.listUsers(1000);
    expect(users).toHaveLength(1);
  });

  it('does not re-stamp a claim it already wrote', async () => {
    const first = await provisionAttendeeAccount(auth, db, buyer);
    const second = await provisionAttendeeAccount(auth, db, buyer);

    expect(first.claimsStamped).toBe(true);
    expect(second.claimsStamped).toBe(false);
  });

  it('does not demote an organizer granted by hand', async () => {
    // `npm run claims` grants the role out of band. A webhook retry that reset
    // the claim would demote them with nothing anywhere to say why, and the
    // symptom would be an organizer who can no longer open the desk.
    const { uid } = await provisionAttendeeAccount(auth, db, buyer);
    await auth.setCustomUserClaims(uid!, {
      registered: true,
      roles: ['attendee', 'organizer'],
      eventId: EVENT_ID,
    });

    await provisionAttendeeAccount(auth, db, buyer);

    const user = await auth.getUser(uid!);
    expect(user.customClaims?.roles).toEqual(['attendee', 'organizer']);
  });

  it('repairs a claim that is genuinely missing rather than only ever writing once', async () => {
    // A prior delivery that created the account and then failed before the
    // claim landed would otherwise leave it claim-less for ever: nothing else
    // revisits an existing account. Same self-heal as `verify-otp.ts`.
    const { uid } = await provisionAttendeeAccount(auth, db, buyer);
    await auth.setCustomUserClaims(uid!, {});

    const repaired = await provisionAttendeeAccount(auth, db, buyer);

    expect(repaired.claimsStamped).toBe(true);
    expect((await auth.getUser(uid!)).customClaims?.registered).toBe(true);
  });

  it('does not overwrite a profile the attendee has since edited', async () => {
    const { uid } = await provisionAttendeeAccount(auth, db, buyer);
    await db
      .collection(COLLECTIONS.users)
      .doc(uid!)
      .update({ title: 'Head of Ontology', messagingEnabled: false });

    const replay = await provisionAttendeeAccount(auth, db, buyer);

    expect(replay.profileCreated).toBe(false);
    const profile = (await db.collection(COLLECTIONS.users).doc(uid!).get()).data();
    expect(profile?.title).toBe('Head of Ontology');
    expect(profile?.messagingEnabled).toBe(false);
  });

  it('does not republish somebody who opted out of the directory', async () => {
    // Opting out *deletes* `directory/{uid}` — rules can hide documents but not
    // fields, which is why the directory is a separate projection at all. A
    // replay that recreated it would undo a privacy choice because Stripe
    // retried an event.
    const { uid } = await provisionAttendeeAccount(auth, db, buyer);
    await db.collection(COLLECTIONS.users).doc(uid!).update({ visibleInDirectory: false });
    await db.collection(COLLECTIONS.directory).doc(uid!).delete();

    await provisionAttendeeAccount(auth, db, buyer);

    expect((await db.collection(COLLECTIONS.directory).doc(uid!).get()).exists).toBe(false);
  });

  it('does not set a password on a replay either', async () => {
    await provisionAttendeeAccount(auth, db, buyer);
    await provisionAttendeeAccount(auth, db, buyer);
    expect(await canSignIn(lowercased, ANY_PASSWORD)).toBe(false);
  });
});

describe('an account that already exists under a different uid', () => {
  it('adopts the one verifyOtp created rather than making a second', async () => {
    // `verify-otp.ts` creates with an auto-assigned uid when somebody signs in
    // before the webhook lands. Two accounts for one address would put the
    // claim on one and the profile on the other, and the app would look empty.
    const seeded = await auth.createUser({ email: lowercased, displayName: 'Ada Nakamura' });

    const result = await provisionAttendeeAccount(auth, db, buyer);

    expect(result.status).toBe('existing');
    expect(result.uid).toBe(seeded.uid);
    expect(result.uid).not.toBe(uidForEmail(lowercased));

    const { users } = await auth.listUsers(1000);
    expect(users).toHaveLength(1);
  });
});

describe('a multi-seat invoice', () => {
  /**
   * An invoice is **one** order with several `items`, not one order per seat.
   * The identities it has to create are per *attendee*: the billing contact who
   * paid may not be coming at all, and each of the four people it covers needs
   * their own account, claim and profile.
   */
  const seats = [
    { email: 'ada@acme.test', name: 'Ada Nakamura' },
    { email: 'bo@acme.test', name: 'Bo Adeyemi' },
    { email: 'cai@acme.test', name: 'Cai Ruiz' },
    { email: 'dee@acme.test', name: 'Dee Okonkwo' },
  ];

  it('makes one account per attendee', async () => {
    for (const seat of seats) await provisionAttendeeAccount(auth, db, seat);

    const { users } = await auth.listUsers(1000);
    expect(users).toHaveLength(4);
    expect(users.every((u) => u.customClaims?.registered === true)).toBe(true);
  });

  it('makes no more of them when the invoice event is redelivered', async () => {
    for (const seat of seats) await provisionAttendeeAccount(auth, db, seat);
    for (const seat of seats) await provisionAttendeeAccount(auth, db, seat);

    const { users } = await auth.listUsers(1000);
    expect(users).toHaveLength(4);
  });

  it('gives the billing contact nothing, because they may not be attending', async () => {
    for (const seat of seats) await provisionAttendeeAccount(auth, db, seat);

    const emails = (await auth.listUsers(1000)).users.map((u) => u.email);
    expect(emails).not.toContain('accounts.payable@acme.test');
  });
});

describe('what the ticket unlocks', () => {
  const tier = (over: Partial<TicketTypeDoc> = {}) =>
    ({ includesWorkshops: false, includesVideoLibrary: false, ...over }) as TicketTypeDoc;

  it('grants nothing for a tier that includes nothing beyond admission', () => {
    expect(entitlementKinds(tier())).toEqual([]);
  });

  it('reads both entitlement booleans the dashboard has always been able to set', () => {
    expect(entitlementKinds(tier({ includesWorkshops: true }))).toEqual(['workshop']);
    expect(entitlementKinds(tier({ includesVideoLibrary: true }))).toEqual(['video-library']);
    expect(
      entitlementKinds(tier({ includesWorkshops: true, includesVideoLibrary: true })),
    ).toEqual(['workshop', 'video-library']);
  });

  it('writes them under the buyer, so the app can gate playback without knowing about money', async () => {
    const { uid } = await provisionAttendeeAccount(auth, db, buyer);
    await grantOrderEntitlements(db, uid!, ['workshop', 'video-library']);

    const snap = await db
      .collection(COLLECTIONS.users)
      .doc(uid!)
      .collection(SUBCOLLECTIONS.entitlements)
      .get();

    expect(snap.docs.map((d) => d.id).sort()).toEqual(['video-library', 'workshop']);
    expect(snap.docs[0].data().source).toBe('order');
  });

  it('leaves one document per kind when the event is redelivered', async () => {
    const { uid } = await provisionAttendeeAccount(auth, db, buyer);
    await grantOrderEntitlements(db, uid!, ['video-library']);
    await grantOrderEntitlements(db, uid!, ['video-library']);

    const snap = await db
      .collection(COLLECTIONS.users)
      .doc(uid!)
      .collection(SUBCOLLECTIONS.entitlements)
      .get();
    expect(snap.size).toBe(1);
  });

  it('withdraws what the money bought and leaves a speaker grant standing', async () => {
    const { uid } = await provisionAttendeeAccount(auth, db, buyer);
    await grantOrderEntitlements(db, uid!, ['workshop', 'video-library']);
    await db
      .collection(COLLECTIONS.users)
      .doc(uid!)
      .collection(SUBCOLLECTIONS.entitlements)
      .doc('speaker-video')
      .set({ eventId: EVENT_ID, kind: 'video-library', source: 'speaker', grantedAt: new Date() });

    const removed = await withdrawOrderEntitlements(db, uid!);

    expect(removed).toBe(2);
    const left = await db
      .collection(COLLECTIONS.users)
      .doc(uid!)
      .collection(SUBCOLLECTIONS.entitlements)
      .get();
    expect(left.docs.map((d) => d.id)).toEqual(['speaker-video']);
  });

  it('withdraws nothing twice, so a redelivered refund is a no-op', async () => {
    const { uid } = await provisionAttendeeAccount(auth, db, buyer);
    await grantOrderEntitlements(db, uid!, ['workshop']);

    expect(await withdrawOrderEntitlements(db, uid!)).toBe(1);
    expect(await withdrawOrderEntitlements(db, uid!)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The refund decision, imported rather than re-implemented.
//
// `fulfilment.test.ts` used to carry its own copy of these rules beside a note
// saying to import them if they ever moved somewhere importable. They have:
// `apps/web/src/lib/refund-core.ts`, split out of the `server-only`
// `registrations.ts` for exactly this.
// ---------------------------------------------------------------------------

describe('the refund decision', () => {
  const order = (over: Partial<{ status: string; totalCents: number; items: unknown[] }> = {}) =>
    ({
      status: 'paid',
      totalCents: 79_900,
      items: [{ ticketTypeId: 'main-conference', ticketTypeName: 'Main Conference', quantity: 1 }],
      ...over,
    }) as Parameters<typeof decideRefund>[0];

  it('treats a refund of the full amount as voiding the ticket', () => {
    const d = decideRefund(order(), { reason: 'refunded', refundedCents: 79_900 });
    expect(d.fullyRefunded).toBe(true);
    expect(d.status).toBe('refunded');
    expect(d.newlyRefunded).toBe(true);
  });

  it('leaves the ticket valid when only part of the money goes back', () => {
    // $200 back on an $800 registration: they are still coming, and revoking
    // the badge for it would be a worse bug than the one refunds exist to fix.
    const d = decideRefund(order(), { reason: 'refunded', refundedCents: 20_000 });
    expect(d.fullyRefunded).toBe(false);
    expect(d.status).toBe('partially_refunded');
    // And no seat goes back, because the seat is still occupied.
    expect(d.newlyRefunded).toBe(false);
  });

  it('reports newlyRefunded once, on the delivery that voided the ticket', () => {
    // Stripe reports the same cumulative `amount_refunded` on every delivery,
    // so `fullyRefunded` is true every time and is the wrong thing to guard on.
    const first = decideRefund(order(), { reason: 'refunded', refundedCents: 79_900 });
    const replay = decideRefund(order({ status: 'refunded' }), {
      reason: 'refunded',
      refundedCents: 79_900,
    });

    expect(first.newlyRefunded).toBe(true);
    expect(replay.fullyRefunded).toBe(true);
    expect(replay.newlyRefunded).toBe(false);
  });

  it('releases the seat when a partial refund is topped up to a full one', () => {
    const d = decideRefund(order({ status: 'partially_refunded' }), {
      reason: 'refunded',
      refundedCents: 79_900,
    });
    expect(d.newlyRefunded).toBe(true);
  });

  it('names one line per seat, which is how a four-seat invoice gives four back', () => {
    const d = decideRefund(
      order({
        totalCents: 319_600,
        items: [
          { ticketTypeId: 'main-conference', quantity: 1 },
          { ticketTypeId: 'main-conference', quantity: 1 },
          { ticketTypeId: 'all-access', quantity: 2 },
          // No tier recorded — an invoice raised straight in the Stripe
          // dashboard. There is no counter to correct, so it is dropped.
          { ticketTypeId: '', quantity: 1 },
        ],
      }),
      { reason: 'refunded', refundedCents: 319_600 },
    );

    expect(d.lines).toEqual([
      { ticketTypeId: 'main-conference', quantity: 1 },
      { ticketTypeId: 'main-conference', quantity: 1 },
      { ticketTypeId: 'all-access', quantity: 2 },
    ]);
  });

  it('stamps a refund date only when money actually went back', () => {
    expect(decideRefund(order(), { reason: 'refunded' }).stampRefundedAt).toBe(true);
    // Nothing was ever charged, so a "refunded" row would describe a sale that
    // never happened.
    expect(decideRefund(order(), { reason: 'payment_failed' }).stampRefundedAt).toBe(false);
    // A chargeback is money held, not money returned, and it may yet come back.
    expect(decideRefund(order(), { reason: 'disputed' }).stampRefundedAt).toBe(false);
  });
});

describe('the sold counter under a replayed refund', () => {
  /**
   * The webhook's own loop, driven by the real `decideRefund` against a real
   * Firestore document.
   *
   * `incrementSold` itself is `server-only` and cannot be imported here, so the
   * increment is spelled out — but the part that has been wrong, and the part
   * this is here to pin, is the *guard* rather than the arithmetic.
   */
  async function applyRefund(tierId: string, orderState: { status: string; totalCents: number }) {
    const decision = decideRefund(
      { ...orderState, items: [{ ticketTypeId: tierId, ticketTypeName: 'X', quantity: 1 }] } as Parameters<
        typeof decideRefund
      >[0],
      { reason: 'refunded', refundedCents: orderState.totalCents },
    );
    if (decision.newlyRefunded) {
      for (const line of decision.lines) {
        await db
          .collection(COLLECTIONS.ticketTypes)
          .doc(line.ticketTypeId)
          .update({ quantitySold: FieldValue.increment(-line.quantity) });
      }
    }
    return decision;
  }

  it('gives one seat back on the first delivery and none on the second', async () => {
    await db
      .collection(COLLECTIONS.ticketTypes)
      .doc('main-conference')
      .set({ eventId: EVENT_ID, name: 'Main Conference', quantityTotal: 10, quantitySold: 5 });

    // First delivery: the order is still `paid`.
    await applyRefund('main-conference', { status: 'paid', totalCents: 79_900 });
    // Redelivery: the order is now `refunded`, and Stripe reports the same
    // cumulative amount. Without the guard this line oversells the tier.
    await applyRefund('main-conference', { status: 'refunded', totalCents: 79_900 });
    await applyRefund('main-conference', { status: 'refunded', totalCents: 79_900 });

    const after = (
      await db.collection(COLLECTIONS.ticketTypes).doc('main-conference').get()
    ).data() as TicketTypeDoc;
    expect(after.quantitySold).toBe(4);
  });

  it('gives nothing back for a partial refund, because the ticket is still valid', async () => {
    await db
      .collection(COLLECTIONS.ticketTypes)
      .doc('main-conference')
      .set({ eventId: EVENT_ID, name: 'Main Conference', quantityTotal: 10, quantitySold: 5 });

    const decision = decideRefund(
      {
        status: 'paid',
        totalCents: 79_900,
        items: [{ ticketTypeId: 'main-conference', ticketTypeName: 'X', quantity: 1 }],
      } as Parameters<typeof decideRefund>[0],
      { reason: 'refunded', refundedCents: 20_000 },
    );
    expect(decision.newlyRefunded).toBe(false);

    const after = (
      await db.collection(COLLECTIONS.ticketTypes).doc('main-conference').get()
    ).data() as TicketTypeDoc;
    expect(after.quantitySold).toBe(5);
  });
});
