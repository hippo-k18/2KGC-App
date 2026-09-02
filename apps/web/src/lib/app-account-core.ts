/**
 * Turning a paid ticket into an identity — the part that is safe to test.
 *
 * ── Why this is a separate module from `app-account.ts` ─────────────────────
 *
 * `app-account.ts` imports `server-only`, and a module that imports it throws
 * the moment Vitest loads it. The repo's answer to that is the split
 * `lib/conflicts-core.ts` (pure, tested) versus `lib/conflicts.ts`
 * (`server-only`, fetches), and this follows it: the decisions live here and
 * take `auth` and `db` as arguments, the `server-only` wrapper supplies the
 * real ones. Fulfilment is the one path in this repo where "it typechecked" is
 * not evidence, so the logic has to be reachable from a test.
 *
 * ⚠️ **No Firestore sentinels in this file.** `apps/web`, `apps/organizer` and
 * `scripts` each resolve their own `firebase-admin`, and `FieldValue` /
 * `Timestamp` are class instances validated with `instanceof` — one built
 * against a different copy fails the *entire* write with "Couldn't serialize
 * object of type l". This module is imported from two resolution contexts (the
 * Next build, and `tests/commerce` at the repo root) while the `Firestore` it
 * writes through is injected, so the two can differ. `new Date()` is a global,
 * converts to a Timestamp on write, and cannot mismatch. That is AGENTS.md
 * gotcha 8, applied rather than merely acknowledged.
 *
 * ── What provisioning is, and what it is not ────────────────────────────────
 *
 * It creates the Firebase Auth account, stamps the `registered` custom claim
 * that `firestore.rules` gates every attendee read on, and writes the
 * `users/{uid}` profile with its `directory/{uid}` projection — which nothing
 * else does, because the `mirrorDirectory` trigger is undeployed.
 *
 * ⚠️ **It sets a password again, as of 2026-09-02, and that is a reversal.**
 * This block used to say it did not and that no caller could ask it to. The
 * shipping sign-in is still the six-digit code in `functions/src/callable/` —
 * `requestOtp` proves the buyer controls the address, `verifyOtp` returns a
 * custom token — and that remains the mechanism the product is built around.
 * What has been added beside it, deliberately and on request, is the shared
 * demo password from `@kgc/scripts/src/lib/demo-password.ts`: printed on the
 * confirmation page, mailed in the receipt, and identical for every buyer.
 *
 * The objection the old text raised was right and has not gone away — a shared,
 * publicly printed password is a credential anyone can use as anyone else. What
 * answers it is that this one is not the credential the attendee keeps.
 * `mustChangePassword` is stamped on every profile created holding it, and the
 * app refuses to render anything until that flag is cleared, so the shared
 * value opens the door exactly once. That is the difference between this and
 * the demo password BUILD-PLAN 1.4 deleted, which had no such rotation and is
 * still live on ~50 accounts (`OWNER-ACTIONS.md` §4).
 *
 * Set `DEMO_ATTENDEE_PASSWORD=` empty and every word of the paragraph above
 * stops applying: no password is set, no flag is stamped, and the OTP code is
 * the only way in again.
 *
 * ── Agreeing with `verifyOtp` about the uid ─────────────────────────────────
 *
 * `verify-otp.ts` looks an account up *by email* and only creates one when
 * there is none, with an auto-assigned uid. This looks up by derived uid, then
 * by email, and only creates when both miss. So whichever of the two runs
 * first owns the uid and the other adopts it. Two accounts for one address is
 * the failure this ordering exists to prevent — the second would hold the
 * claim while the first holds the profile, and the app would look empty.
 */

import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  type EntitlementDoc,
  type UserDoc,
} from '@kgc/shared';
import { normaliseEmail, registrationId } from '@kgc/scripts/src/lib/ids';
import { demoPassword } from '@kgc/scripts/src/lib/demo-password';

/**
 * The uid is derived from the email, not auto-assigned.
 *
 * Same derivation as the registration id, so `users/{uid}`, `directory/{uid}`
 * and `registrations/{rid}` share one key for a given address. Buying twice
 * updates one account rather than orphaning the first.
 */
export function uidForEmail(email: string): string {
  return registrationId(normaliseEmail(email));
}

export interface ProvisionInput {
  email: string;
  name: string;
  company?: string;
  title?: string;
}

export interface ProvisionResult {
  /**
   * `created` — this call made the Auth account.
   * `existing` — one was already there, under this uid or under the address.
   * `failed` — nothing was created and the sale must still stand.
   */
  status: 'created' | 'existing' | 'failed';
  uid: string | null;
  /** True when this call wrote the `registered` claim. False on a replay. */
  claimsStamped: boolean;
  /** True when this call wrote `users/{uid}`. False on a replay. */
  profileCreated: boolean;
  /**
   * The shared password this call set, when it set one. `null` whenever the
   * feature is off or the account already existed.
   *
   * Returned rather than re-read from the environment by the caller so that the
   * receipt and the confirmation page cannot print a password that was never
   * actually set — the two would drift the moment somebody changed the variable
   * between the write and the render.
   */
  demoPassword?: string | null;
  /** Present only on `failed`. The message, for the log and the audit entry. */
  error?: string;
}

/**
 * Create the account for a buyer, or adopt the one they already have.
 *
 * Every step is conditional on the thing not already being there, because
 * Stripe redelivers an event for up to three days and this runs on each
 * delivery. The rule is not "run once" — nothing can guarantee that — it is
 * "the second run changes nothing".
 *
 * Never throws. The ticket is sold and the registration is written before this
 * is called; a purchase that 500s because an account could not be made is worse
 * than a purchase with an account still to make, and the OTP flow creates one
 * on first sign-in anyway. The caller reports the failure; it does not retry.
 */
export async function provisionAttendeeAccount(
  auth: Auth,
  db: Firestore,
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const email = normaliseEmail(input.email);
  const derivedUid = uidForEmail(email);

  try {
    // `getUser` then `getUserByEmail` then create, rather than create-and-catch.
    // The buyer may be a seeded attendee, or may have signed in through OTP
    // already, in which case the account exists under a *different* uid and
    // creating one here would fail on the duplicate address — after having
    // already decided the account did not exist.
    let existing = await auth.getUser(derivedUid).catch(() => null);
    if (!existing) existing = await auth.getUserByEmail(email).catch(() => null);

    /**
     * The demo password, and why it is only ever set on a *new* account.
     *
     * `demoPassword()` returns `null` when the feature is switched off, which
     * restores the previous behaviour of provisioning no credential at all.
     * When it returns a value, the account is created holding it and the
     * profile below is stamped `mustChangePassword` so the app forces a
     * rotation before letting the attendee anywhere.
     *
     * ⚠️ Never applied to an account that already exists. Somebody who bought
     * a second ticket, or who signed in through OTP first, may already have
     * chosen a password — resetting it to the shared one on a later purchase
     * would silently hand their account to anybody who can read a receipt, and
     * would do it to the people most engaged with the event. `created` is the
     * whole condition, and a Stripe redelivery cannot re-enter this branch
     * because the account exists by then.
     */
    const sharedPassword = demoPassword();

    let created = false;
    if (!existing) {
      existing = await auth.createUser({
        uid: derivedUid,
        email,
        displayName: input.name || undefined,
        ...(sharedPassword ? { password: sharedPassword } : {}),
      });
      created = true;
    }

    const uid = existing.uid;

    /**
     * The claim the security rules actually read.
     *
     * `registered` is the gate — `firestore.rules` rejects every attendee read
     * without it — and it lands in the token at *sign-in*, not now. That is why
     * it is stamped at purchase rather than the first time the app opens: a
     * token minted a moment too early carries no claim and the app looks empty
     * for up to an hour.
     *
     * Stamped only when it is missing, and carrying forward whatever roles are
     * already there. A replay that rewrote this would undo a manual `npm run
     * claims` grant — an organizer demoted to attendee by a webhook retry, with
     * nothing in any log to say why. Same reasoning, same shape, as the
     * self-heal in `functions/src/callable/verify-otp.ts`.
     */
    const claims = (existing.customClaims ?? {}) as { registered?: boolean; roles?: string[] };
    let claimsStamped = false;
    if (!claims.registered) {
      await auth.setCustomUserClaims(uid, {
        registered: true,
        roles: claims.roles ?? ['attendee'],
        eventId: EVENT_ID,
      });
      claimsStamped = true;
    }

    /**
     * The profile, and its directory projection — written once, never merged
     * over.
     *
     * A merge on every delivery would walk back anything the attendee has since
     * changed: a title they corrected, notifications they turned off, and above
     * all `visibleInDirectory`. Opting out of the directory *deletes*
     * `directory/{uid}` (see `DirectoryDoc`), so re-writing it on a webhook
     * retry would republish someone who had opted out — a privacy regression
     * caused by a retry, which is the kind of bug nobody goes looking for.
     *
     * Existence of the profile is the flag. A buyer who already has one already
     * has a directory entry or has deliberately removed it, and either way this
     * has nothing to add.
     */
    const userRef = db.collection(COLLECTIONS.users).doc(uid);
    const already = await userRef.get();

    let profileCreated = false;
    if (!already.exists) {
      const now = new Date();
      const profile: Omit<UserDoc, 'createdAt' | 'updatedAt'> & {
        createdAt: Date;
        updatedAt: Date;
      } = {
        eventId: EVENT_ID,
        email,
        name: input.name,
        title: input.title,
        company: input.company,
        interests: [],
        onboarded: true,
        visibleInDirectory: true,
        messagingEnabled: true,
        notificationPrefs: { announcements: true, messages: true, sessionReminders: true },
        roles: ['attendee'],
        /**
         * Stamped only when this call also created the Auth account holding the
         * shared password. A profile written for an account that already
         * existed must not carry it — that attendee's password is their own.
         */
        ...(created && sharedPassword ? { mustChangePassword: true } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await userRef.set(profile);

      await db.collection(COLLECTIONS.directory).doc(uid).set({
        eventId: EVENT_ID,
        uid,
        name: input.name,
        title: input.title,
        company: input.company,
        interests: [],
        updatedAt: now,
      });
      profileCreated = true;
    }

    return {
      status: created ? 'created' : 'existing',
      uid,
      claimsStamped,
      profileCreated,
      demoPassword: created ? sharedPassword : null,
    };
  } catch (err) {
    return {
      status: 'failed',
      uid: null,
      claimsStamped: false,
      profileCreated: false,
      demoPassword: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Entitlements — what the ticket actually unlocks
//
// `TicketTypeDoc` carries `includesWorkshops` and `includesVideoLibrary`, the
// dashboard has always been able to edit them, and until now nothing wrote the
// grant they imply. A tier could sell a video library that no surface would
// ever let anyone watch.
//
// One document per kind, keyed by the kind itself rather than by the order.
// Two orders that both include workshops are one entitlement, not two, which
// is what "does this person have access?" actually means — and it makes the
// write idempotent under replay for free.
// ---------------------------------------------------------------------------

/** What a tier's two entitlement booleans grant. */
export function entitlementKinds(tier: {
  includesWorkshops?: boolean;
  includesVideoLibrary?: boolean;
}): EntitlementDoc['kind'][] {
  const kinds: EntitlementDoc['kind'][] = [];
  if (tier.includesWorkshops) kinds.push('workshop');
  if (tier.includesVideoLibrary) kinds.push('video-library');
  return kinds;
}

/**
 * Grant what a purchase unlocks. Best-effort: a lost entitlement is a support
 * ticket, a failed webhook is a retry storm that eventually disables the
 * endpoint for everyone.
 */
export async function grantOrderEntitlements(
  db: Firestore,
  uid: string,
  kinds: EntitlementDoc['kind'][],
): Promise<number> {
  if (kinds.length === 0) return 0;
  const now = new Date();
  let written = 0;
  for (const kind of kinds) {
    await db
      .collection(COLLECTIONS.users)
      .doc(uid)
      .collection(SUBCOLLECTIONS.entitlements)
      .doc(kind)
      .set({ eventId: EVENT_ID, kind, source: 'order', grantedAt: now });
    written += 1;
  }
  return written;
}

/**
 * Take back what the money paid for, when the money goes back.
 *
 * Only `source: 'order'` grants. A comp, a speaker grant or a staff pass was
 * never bought and must survive a refund — deleting the subcollection wholesale
 * would revoke a speaker's video access because they refunded a workshop.
 *
 * The caller decides *whether* to withdraw: this runs only when the refund
 * actually cancelled the registration, so somebody with a second, still-paid
 * order keeps everything.
 */
export async function withdrawOrderEntitlements(db: Firestore, uid: string): Promise<number> {
  const snap = await db
    .collection(COLLECTIONS.users)
    .doc(uid)
    .collection(SUBCOLLECTIONS.entitlements)
    .where('source', '==', 'order')
    .get();

  await Promise.all(snap.docs.map((d) => d.ref.delete()));
  return snap.size;
}
