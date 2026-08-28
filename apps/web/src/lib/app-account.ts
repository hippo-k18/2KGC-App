import 'server-only';

import { getAuth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { registrationId } from '@kgc/scripts/src/lib/ids';
import { db } from './firestore';
import { DEMO_APP_PASSWORD } from './demo-credentials';

/**
 * Turning a ticket purchase into an account that can sign into the app.
 *
 * Buying a ticket used to write a `registrations` document and stop. The
 * confirmation page then told the buyer to "sign in with this address", which
 * was true of the design and false of the deployment — no Firebase Auth account
 * existed for them, so the app answered "that email and password do not match
 * an account". Fine while every attendee was seeded by a script. Not fine as
 * the middle of a demo, where buy-a-ticket-then-open-the-app is the single most
 * persuasive thing the product does.
 *
 * This closes that gap from the website, which is allowed to: `apps/web` runs
 * the Admin SDK on a trusted server, and custom claims need exactly that. It is
 * the same work the `verifyOtp` Cloud Function will do when the project moves
 * to Blaze — look the address up, create the account, stamp `registered` — just
 * from a Next.js server action rather than from GCP.
 *
 * ── Why it is confined to demo mode ─────────────────────────────────────────
 *
 * It sets a **shared, publicly printed password** on a real account. That is
 * acceptable for a database of invented attendees and is a complete compromise
 * of a real one: anyone who knows an attendee's email address would be able to
 * sign in as them and read their messages. Production is the six-digit code
 * mailed to the address, which proves the buyer controls it. Nothing here
 * proves that, so the caller checks `demoMode()` first and this module refuses
 * to be the only gate.
 */

/** What the confirmation page prints, so the buyer can sign in immediately. */
export interface AppAccount {
  email: string;
  password: string;
}

/**
 * The uid is derived from the email, not auto-assigned.
 *
 * Same derivation as the registration id, so `users/{uid}`, `directory/{uid}`
 * and `registrations/{rid}` all share one key for a given address. Buying twice
 * therefore updates one account rather than orphaning the first, and the app's
 * badge lookup — a query on `registrations.email` — lines up with the profile
 * without a second index.
 */
function uidFor(email: string): string {
  return registrationId(email);
}

export async function provisionAppAccount(input: {
  email: string;
  name: string;
  company?: string;
  title?: string;
}): Promise<AppAccount | null> {
  const email = input.email.trim().toLowerCase();
  const uid = uidFor(email);
  const auth = getAuth();

  try {
    // `getUser` then create, rather than create-and-catch: the buyer may be a
    // seeded attendee buying a second ticket, in which case the account exists
    // under a *different* uid and creating one here would collide on email.
    let existing = null;
    try {
      existing = await auth.getUser(uid);
    } catch {
      // No account under this uid. It may still exist under another one — a
      // seeded attendee, say — so ask by email before creating.
      try {
        existing = await auth.getUserByEmail(email);
      } catch {
        existing = null;
      }
    }

    const account = existing
      ? await auth.updateUser(existing.uid, {
          displayName: input.name,
          // Reset on every purchase, deliberately: the confirmation page is
          // about to print this password, and a page that prints a password
          // which does not work is worse than one that prints nothing.
          password: DEMO_APP_PASSWORD,
        })
      : await auth.createUser({
          uid,
          email,
          displayName: input.name,
          password: DEMO_APP_PASSWORD,
        });

    /**
     * The claims the security rules actually read.
     *
     * `registered` is the gate — `firestore.rules` rejects every attendee read
     * without it — and it lands in the token at *sign-in*, not now. That is why
     * this has to happen before the buyer opens the app rather than the first
     * time they do: a token minted a moment too early carries no claim and the
     * app looks empty for up to an hour.
     */
    await auth.setCustomUserClaims(account.uid, {
      registered: true,
      roles: ['attendee'],
      eventId: EVENT_ID,
    });

    /**
     * The profile, and its directory projection.
     *
     * `directory/{uid}` is normally written by the `mirrorDirectory` trigger,
     * which is not deployed — the project is on Spark. `seed-demo.ts` dual-writes
     * it for the same reason, so this does too. Without it the buyer signs in
     * successfully and is invisible to every other attendee, which reads as the
     * directory being broken rather than as a missing trigger.
     */
    const now = Timestamp.now();
    const profile = {
      eventId: EVENT_ID,
      email,
      name: input.name,
      title: input.title,
      company: input.company,
      interests: [] as string[],
      onboarded: true,
      visibleInDirectory: true,
      messagingEnabled: true,
      notificationPrefs: { announcements: true, messages: true, sessionReminders: true },
      roles: ['attendee'],
      updatedAt: now,
    };

    await db().collection(COLLECTIONS.users).doc(account.uid).set(
      { ...profile, createdAt: now },
      { merge: true },
    );

    await db().collection(COLLECTIONS.directory).doc(account.uid).set(
      {
        eventId: EVENT_ID,
        uid: account.uid,
        name: input.name,
        title: input.title,
        company: input.company,
        interests: [],
        updatedAt: now,
      },
      { merge: true },
    );

    return { email, password: DEMO_APP_PASSWORD };
  } catch (err) {
    /**
     * Never fatal. The ticket is already sold and the registration already
     * exists; failing the purchase because an account could not be created
     * would lose the thing that matters to keep the thing that is convenient.
     * The confirmation page falls back to its ordinary copy when this returns
     * null.
     */
    console.error('[app-account] could not provision an app account for', email, err);
    return null;
  }
}
