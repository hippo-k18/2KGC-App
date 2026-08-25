import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS, EVENT_ID, type RegistrationDoc } from "@kgc/shared";
import { claimCode, emailHash, normaliseEmail, qrSecret, registrationId } from "./ids.js";

/**
 * Turning a paid-for seat into a registration.
 *
 * ── Why this lives in `@kgc/scripts` ────────────────────────────────────────
 *
 * Three callers need it and no two of them can import each other: the public
 * website's Stripe webhook, the organizer dashboard's mark-invoice-paid action,
 * and the Whova importer. `@kgc/scripts` is the only Admin-SDK package all
 * three already depend on — `apps/web` has imported `lib/ids.js` from here
 * since the first ticket was sold — so this is where shared server-side domain
 * logic goes, notwithstanding the package's name.
 *
 * A second copy of this function would be a genuinely dangerous kind of
 * duplication. It owns `qrSecret` and `claimCode`, and the day the two copies
 * disagreed about when to mint them is the day somebody's badge stops scanning
 * while they are standing in front of the desk holding it.
 *
 * ── `db` is a parameter, not an import ──────────────────────────────────────
 *
 * Each app initialises its own Firestore handle with its own credential rules.
 * Taking the store as an argument keeps this function free of that decision —
 * and makes it directly testable against the emulator without any module
 * mocking.
 *
 * ── ⚠️ Never construct a Firestore sentinel in this file ────────────────────
 *
 * `FieldValue.serverTimestamp()` and `Timestamp.now()` are **class instances**,
 * and Firestore validates them with `instanceof`. `apps/web`, `apps/organizer`
 * and this package each resolve their *own* copy of `firebase-admin` — they are
 * not npm workspace members, by deliberate design — so a sentinel built here is
 * a different class from the one the caller's Firestore instance expects. The
 * write then fails with:
 *
 *     Value for argument "data" is not a valid Firestore document.
 *     Couldn't serialize object of type "l" (found in field "createdAt").
 *
 * That is not hypothetical: it took the entire purchase flow down the first
 * time this module was called from `apps/web`, and the emulator tests did not
 * catch it because they resolve a single copy.
 *
 * A native `Date` has no such problem — it is a global, Firestore converts it
 * to a `Timestamp` on write, and it works from any caller. The cost is that
 * these are the *server process's* clock rather than Firestore's own, which is
 * immaterial for audit fields written by a trusted server we control.
 */

/** What a caller needs back. Never includes `qrSecret`. */
export interface FulfilledRegistration {
  registrationId: string;
  email: string;
  name?: string;
  ticketType?: string;
  claimCode: string;
  /** True when this call created the registration rather than updating one. */
  created: boolean;
}

export interface EnsureRegistrationInput {
  email: string;
  name: string;
  /** `TicketTypeDoc.name`-shaped label, e.g. "All Access (VIP)". */
  ticketType: string;
}

/**
 * Idempotent on the attendee's email address.
 *
 * The document id is `registrationId(email)` — derived rather than random —
 * because the same person arrives more than once by design: Stripe redirects
 * the buyer *and* posts a webhook, the webhook is retried until acknowledged,
 * a colleague is added to a second invoice, and the Whova importer may have
 * already written them. All of those must converge on one document.
 *
 * **`qrSecret` and `claimCode` survive a repeat purchase.** Both may already be
 * printed on a badge or pasted into the app; regenerating them silently
 * invalidates a badge that is physically in someone's hand. So they are minted
 * only on first creation, and an attendee who has already claimed their
 * registration is not un-claimed by a second ticket.
 */
export async function ensureRegistration(
  store: Firestore,
  input: EnsureRegistrationInput,
): Promise<FulfilledRegistration> {
  const email = normaliseEmail(input.email);
  const rid = registrationId(email);
  const regRef = store.collection(COLLECTIONS.registrations).doc(rid);

  const result = await store.runTransaction(async (tx) => {
    const existing = await tx.get(regRef);
    // A native Date, never a sentinel — see the docblock above.
    const now = new Date();

    if (existing.exists) {
      const prev = existing.data() as RegistrationDoc;

      // `createdAt`, `qrSecret`, `claimCode`, `altEmails` and `claimedByUid`
      // are deliberately absent from this write. See the docblock above.
      tx.update(regRef, {
        email,
        emailHash: emailHash(email),
        name: input.name,
        ticketType: input.ticketType,
        status: "active",
        updatedAt: now,
      });

      return {
        registrationId: rid,
        email,
        name: input.name,
        ticketType: input.ticketType,
        // Registrations imported before claim codes existed may have none.
        claimCode: prev.claimCode ?? claimCode(),
        created: false,
        backfillClaimCode: prev.claimCode ? undefined : true,
      };
    }

    const fresh: Omit<RegistrationDoc, "createdAt" | "updatedAt"> = {
      eventId: EVENT_ID,
      email,
      emailHash: emailHash(email),
      altEmails: [],
      name: input.name,
      ticketType: input.ticketType,
      status: "active",
      claimCode: claimCode(),
      // Random and opaque, and the only value that ever goes into a badge QR.
      // A uid here would let anyone who photographs a badge learn an identity.
      qrSecret: qrSecret(),
    };

    tx.set(regRef, { ...fresh, createdAt: now, updatedAt: now });

    return {
      registrationId: rid,
      email,
      name: input.name,
      ticketType: input.ticketType,
      claimCode: fresh.claimCode!,
      created: true,
      backfillClaimCode: undefined,
    };
  });

  // Outside the transaction: it read no document that this write invalidates,
  // and a claim code minted for a pre-claim-code registration is a repair
  // rather than part of the purchase.
  if (result.backfillClaimCode) {
    await regRef.update({ claimCode: result.claimCode });
  }

  return {
    registrationId: result.registrationId,
    email: result.email,
    name: result.name,
    ticketType: result.ticketType,
    claimCode: result.claimCode,
    created: result.created,
  };
}
