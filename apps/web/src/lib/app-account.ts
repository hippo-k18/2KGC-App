import 'server-only';

import { getAuth } from 'firebase-admin/auth';
import { db } from './firestore';
import { provisionAttendeeAccount, type ProvisionResult } from './app-account-core';
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
 * `checkout.session.completed` and `invoice.paid`. It creates a password-less
 * account, stamps the `registered` claim and writes the profile. How anybody
 * actually gets *in* is the OTP flow in `functions/src/callable/` — a six-digit
 * code mailed to the address, which is what proves the buyer controls it.
 * Nothing here proves that, so nothing here may hand out a credential.
 *
 * There used to be a second export, `provisionAppAccount`, which did all of the
 * above and then set a shared password that the confirmation page printed. It
 * was the demo path and it is deleted: a constant credential on a real attendee
 * list means anyone who knows an address can read that person's messages. If
 * something ever needs to let a buyer in without a code, the shape is an
 * Admin-SDK `generatePasswordResetLink()` — per-buyer, time-limited,
 * single-use — never a constant.
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
