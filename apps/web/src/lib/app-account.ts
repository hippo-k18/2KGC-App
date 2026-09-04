import 'server-only';

import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firestore';
import { COLLECTIONS, type RegistrationDoc, type UserDoc } from '@kgc/shared';
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
 * ⚠️ **As of 2026-09-02 it also sets a temporary password**, on request, and
 * this block used to say that must never happen. The objection it raised was
 * about a *constant* credential, and since 2026-09-04 there is not one: the
 * password is six random digits per buyer. What remains is a weak secret, and
 * the window is what handles it — `mustChangePassword` is stamped alongside,
 * and the app will not render anything until the attendee has replaced it. It
 * opens the door once rather than standing in for a credential.
 *
 * ★ **The better shape is still the one this file already named**, and it is
 * worth doing when the demo pressure is off: an Admin-SDK
 * `generatePasswordResetLink()` in the receipt — per-buyer, time-limited,
 * single-use — which needs no shared secret, no printed password and no forced
 * rotation, because there is nothing to rotate. `ISSUE_TEMPORARY_PASSWORDS=0`
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
 * The temporary password to show a buyer, or `null` if there is none to show.
 *
 * ── Two documents, and both have to agree ───────────────────────────────────
 *
 * `registrations/{rid}.tempPassword` is the value; `users/{uid}.mustChangePassword`
 * is whether it is still the account's actual password. Either one alone is a
 * wrong answer. The stored value with the flag already cleared is a password
 * the attendee has replaced — printing it would send somebody to the desk with
 * a credential that stopped working a week ago. The flag without a value is an
 * account provisioned before 2026-09-04, when the password was shared and
 * nothing was stored, and there is nothing truthful to print for it.
 *
 * They share a key, so this is two `get`s and no query: `rid` and `uid` are
 * both `sha256(email)`.
 *
 * ★ It also cleans up. Once the flag is down the stored credential has no
 * remaining purpose, and this is the one server-side path that reliably runs
 * afterwards — the app cannot write `registrations` under any rule, and the
 * trigger that would do it properly is undeployed. Opportunistic rather than
 * guaranteed: a buyer who never reopens their confirmation link leaves the
 * value until something else reads it. Worth doing anyway, and worth being
 * honest that it is a sweep rather than a delete-on-change.
 */
export async function pendingTemporaryPasswordFor(email: string): Promise<string | null> {
  const id = uidForEmail(email);

  try {
    const [profile, registration] = await Promise.all([
      db().collection(COLLECTIONS.users).doc(id).get(),
      db().collection(COLLECTIONS.registrations).doc(id).get(),
    ]);

    const stored = registration.exists
      ? (registration.data() as RegistrationDoc).tempPassword
      : undefined;
    const mustChange =
      profile.exists && (profile.data() as UserDoc).mustChangePassword === true;

    if (mustChange) return stored ?? null;

    if (stored) {
      await db()
        .collection(COLLECTIONS.registrations)
        .doc(id)
        .update({ tempPassword: FieldValue.delete() })
        .catch(() => {
          // A failed sweep is not worth a 500 on somebody's ticket page.
        });
    }
    return null;
  } catch {
    // A confirmation page that 500s because a profile read failed is a worse
    // outcome than one that omits the password block. The claim code, the badge
    // and the OTP route are all still on the page.
    return null;
  }
}
