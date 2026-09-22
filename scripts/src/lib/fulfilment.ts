import type { Firestore } from "firebase-admin/firestore";
import {
  COLLECTIONS,
  EVENT_ID,
  SETTINGS_KEYS,
  categoryFromRule,
  resolveAttendeeCategories,
  resolveTicketRules,
  type RegistrationDoc,
} from "@kgc/shared";
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
 *
 * **The ticket rule is applied here**, because this is the one place a
 * purchase, an invoice, an import and a hand-added attendee all pass through.
 * `settings/attendeeCategories` is read inside the transaction and the ticket
 * type is resolved with `categoryFromRule`, which leaves a category an
 * organizer set by hand alone and does nothing when no rule names the ticket.
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
    const bag = (await tx.get(store.collection(COLLECTIONS.settings).doc(SETTINGS_KEYS.attendeeCategories))).data();
    const stored = bag?.eventId === EVENT_ID ? bag.values : undefined;
    const categories = resolveAttendeeCategories(stored?.categories);
    const rules = resolveTicketRules(stored?.ticketRules, categories);
    // A native Date, never a sentinel — see the docblock above.
    const now = new Date();

    const byRule = (current: Pick<RegistrationDoc, "categorySource">) => {
      const next = categoryFromRule(current, categories, rules, input.ticketType);
      return next === "keep" ? undefined : next;
    };

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
        ...(byRule(prev) ?? {}),
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
      ...(byRule({}) ?? {}),
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

/**
 * Who holds the seat an order paid for, now.
 *
 * The order names the buyer, and `registrationId(order.email)` is the document
 * that address maps to. After a transfer that document is `status:
 * 'transferred'` and the ticket is somebody else's — so refunding the order and
 * cancelling the id derived from the buyer's address withdraws a ticket that
 * was already dead and leaves the new holder's badge scanning. The money goes
 * back and the person walks in.
 *
 * So the forward link is followed to the end of the chain. A ticket can move
 * more than once, and `transferredTo` on each step is written in the same batch
 * that marks the step transferred, so the chain is never half-written.
 *
 * Returns `null` when nothing is there to cancel: no registration at that id at
 * all, or a chain that points at a document which has since been deleted. The
 * caller must treat that as "no ticket to withdraw" rather than cancelling the
 * id it started with.
 *
 * `limit` is a cycle guard, not a policy. A chain longer than this is a repair
 * job, and looping forever inside a Stripe webhook is the one outcome that
 * makes it worse.
 */
export async function currentHolder(
  store: Firestore,
  startId: string,
  limit = 10,
): Promise<{ id: string; email: string; status: RegistrationDoc["status"] } | null> {
  const seen = new Set<string>();
  let id = startId;

  for (let hop = 0; hop < limit; hop += 1) {
    if (seen.has(id)) return null;
    seen.add(id);

    const snap = await store.collection(COLLECTIONS.registrations).doc(id).get();
    const reg = snap.data() as RegistrationDoc | undefined;
    if (!reg || reg.eventId !== EVENT_ID) return null;

    const next = reg.status === "transferred" ? reg.transferredTo : undefined;
    if (!next) return { id, email: reg.email, status: reg.status };
    id = next;
  }

  return null;
}
