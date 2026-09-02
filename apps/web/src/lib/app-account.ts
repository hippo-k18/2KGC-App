import 'server-only';

import { getAuth } from 'firebase-admin/auth';
import { db } from './firestore';
import { COLLECTIONS, type UserDoc } from '@kgc/shared';
import { demoPassword } from '@kgc/scripts/src/lib/demo-password';
import { provisionAttendeeAccount, uidForEmail, type ProvisionResult } from './app-account-core';
import { recordError } from './errors';

/**
 * Turning a ticket purchase into an account that can sign into the app.
 *
 * The decisions live in `app-account-core.ts`, which takes `auth` and `db` as
 * arguments so `tests/commerce` can exercise them; this file is the wiring that
 * supplies the real ones, plus the one behaviour that must never be shared.
 *
 * ── One caller, and no password anywhere on the path ────────────────────────
 *
 * `provisionPurchaserAccount` runs from the Stripe webhook on
 * `checkout.session.completed` and `invoice.paid`. It creates the account,
 * stamps the `registered` claim and writes the profile. The shipping way in is
 * still the OTP flow in `functions/src/callable/` — a six-digit code mailed to
 * the address, which is what proves the buyer controls it.
 *
 * ⚠️ **As of 2026-09-02 it also sets a shared demo password**, on request, and
 * this block used to say that must never happen. The objection it raised stands
 * on its own terms: a constant credential on a real attendee list means anyone
 * who knows an address can read that person's messages. What has changed is not
 * the objection but the window — `mustChangePassword` is stamped alongside, and
 * the app will not render anything until the attendee has replaced the shared
 * value. It opens the door once rather than standing in for a credential.
 *
 * ★ **The better shape is still the one this file already named**, and it is
 * worth doing when the demo pressure is off: an Admin-SDK
 * `generatePasswordResetLink()` in the receipt — per-buyer, time-limited,
 * single-use — which needs no shared secret, no printed password and no forced
 * rotation, because there is nothing to rotate. `DEMO_ATTENDEE_PASSWORD=` empty
 * is the switch that reverts to password-less provisioning in the meantime.
 */

export type { ProvisionResult } from './app-account-core';

/**
 * The production path: an account, a claim, a profile. No credential.
 *
 * Never throws — see the core module. A failure is reported here, once, in a
 * place a human will find it: the server log for whoever is watching the
 * deploy, and `auditLog` for the dashboard's activity feed. It is deliberately
 * not retried and deliberately not fatal. The registration and the order are
 * already written and the ticket is already valid; losing the sale to save the
 * account would be the wrong trade, and `verifyOtp` creates a missing account
 * on first sign-in in any case.
 */
export async function provisionPurchaserAccount(input: {
  email: string;
  name: string;
  company?: string;
  title?: string;
}): Promise<ProvisionResult> {
  const result = await provisionAttendeeAccount(getAuth(), db(), input);

  if (result.status === 'failed') {
    await recordError(
      'account.provision',
      new Error(`could not provision an app account for ${input.email}: ${result.error}`),
      { path: 'users', id: input.email },
    );
  }

  return result;
}

/**
 * The temporary password to print for a buyer, or `null` if there is none.
 *
 * ── Why this is derived rather than stored ──────────────────────────────────
 *
 * The confirmation page renders long after the webhook that provisioned the
 * account, and it is a capability link somebody can reopen next week. Storing
 * the password on the registration so the page could read it back would put a
 * live credential in Firestore, in a document the dashboard lists — which is a
 * worse thing to own than the shared password itself.
 *
 * So the page asks two questions instead. Is the feature on, and does this
 * account still carry `mustChangePassword`? Both true means the account still
 * holds whatever `DEMO_ATTENDEE_PASSWORD` currently is, and printing that value
 * is accurate. Either false means printing anything would be a guess.
 *
 * ★ The useful consequence is that the page **stops** showing a password the
 * moment the attendee changes theirs. A page that kept printing a replaced
 * credential would be confidently wrong, and would send somebody to the desk
 * with a password that has not worked for a week.
 *
 * The uid is derived from the address, so an account created by `verifyOtp`
 * under an auto-assigned uid has no profile at this key and this returns
 * `null`. That is the safe direction: no password is shown for an account this
 * function cannot positively identify as holding one.
 */
export async function pendingDemoPasswordFor(email: string): Promise<string | null> {
  const shared = demoPassword();
  if (!shared) return null;

  try {
    const snap = await db().collection(COLLECTIONS.users).doc(uidForEmail(email)).get();
    if (!snap.exists) return null;
    return (snap.data() as UserDoc).mustChangePassword === true ? shared : null;
  } catch {
    // A confirmation page that 500s because a profile read failed is a worse
    // outcome than one that omits the password block. The claim code, the badge
    // and the OTP route are all still on the page.
    return null;
  }
}
