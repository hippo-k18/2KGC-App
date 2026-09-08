import type { Firestore } from "firebase-admin/firestore";
import {
  COLLECTIONS,
  EVENT_ID,
  type CompPassDoc,
  type OrderDoc,
  type OrderLine,
  type TicketTypeDoc,
} from "@kgc/shared";
import { ensureRegistration } from "./fulfilment.js";
import { normaliseEmail } from "./ids.js";

/**
 * Complimentary passes: turning "includes 4 full conference passes" into four
 * registrations that actually exist.
 *
 * ── The defect this replaces ────────────────────────────────────────────────
 *
 * A sponsor tier's passes were bullets in `TicketTypeDoc.includes`, and nothing
 * read them. The catalogue said a Gold sponsorship included four passes; buying
 * one produced a single registration for the buyer and nothing else. The tier
 * is now carrying a real number — `TicketTypeDoc.complimentaryPasses` — and
 * this module is what turns it into people.
 *
 * ── Why it lives in `@kgc/scripts` ──────────────────────────────────────────
 *
 * The same reason `ensureRegistration` does, one file over: it is server-side
 * domain logic that more than one Admin-SDK caller needs, and `apps/organizer`
 * and `apps/web` cannot import each other. It takes the store as a parameter
 * for the same reason too — each app initialises its own handle, and a
 * parameter keeps this function testable against the emulator with no mocking.
 *
 * ⚠️ **Never construct a Firestore sentinel in this file.**
 * `FieldValue.serverTimestamp()` and `Timestamp.now()` are class instances that
 * Firestore validates with `instanceof`, and this package resolves its own copy
 * of `firebase-admin`, separate from either website's. A native `Date` converts
 * on write from any caller. See the docblock in `fulfilment.ts`.
 *
 * ── A pass is not a fourth registration product ─────────────────────────────
 *
 * `CFA-PLAN.md` §1.3 settled the equivalent question for speakers: a comped
 * seat goes through the existing path at zero rather than growing a parallel
 * product. So redemption here does exactly one thing a purchase does not — it
 * takes a seat out of an allocation — and then calls the same
 * `ensureRegistration` a paid seat calls, so the badge that comes out is the
 * same badge, minted by the one function that owns `qrSecret` and `claimCode`.
 *
 * It reaches no payment processor and must not: a comp costs nothing, so there
 * is nothing for one to do.
 */

/**
 * A ceiling on how many seats one package may declare.
 *
 * Redemption reads every seat of an allocation inside a transaction, so the
 * number is also the size of that read. It is a guard against a typo — `40`
 * typed as `400` — rather than a product limit; no real sponsorship comes near
 * it, and a package that genuinely needs more seats than this is a group ticket
 * with a quantity, not a bundle of comps.
 */
export const MAX_COMP_PASSES = 100;

/**
 * The document id for one seat.
 *
 * Deterministic, so the allocation needs no query and no composite index: the
 * seats of an order are `getAll` on ids this function computes. It is also what
 * makes the allocation safe — `create` on a taken id fails, where a query-count
 * followed by a write would race.
 */
export function compPassSeatId(orderId: string, seat: number): string {
  return `${orderId}__seat-${seat}`;
}

/** One package's contribution to an order's entitlement. */
export interface CompPassSource {
  ticketTypeId: string;
  ticketTypeName: string;
  /** Passes per unit, from the tier. */
  perUnit: number;
  quantity: number;
}

/**
 * How many passes an order's lines entitle it to, and which packages granted
 * them.
 *
 * Pure, so the arithmetic is testable without an emulator. Quantity matters: a
 * procurement department buying two Gold sponsorships on one purchase order is
 * a single order with `quantity: 2`, and it is owed eight passes rather than
 * four.
 *
 * ⚠️ The per-unit figure is read from the **current** catalogue rather than
 * snapshotted onto the order. That is deliberate and it is the same contract
 * the price already has on these screens ("a price edited here is the price
 * charged on the next request"): what a package includes is one editable fact
 * in one place. The cost is that lowering a tier's count below what a sponsor
 * has already named leaves them over-issued rather than retroactively
 * un-issuing anybody, which `remaining` clamps to zero and the screen reports.
 */
export function compPassesForOrder(
  items: OrderLine[] | undefined,
  perUnitByTier: Map<string, number>,
): { total: number; sources: CompPassSource[] } {
  const sources: CompPassSource[] = [];

  for (const line of items ?? []) {
    const perUnit = perUnitByTier.get(line.ticketTypeId) ?? 0;
    if (perUnit <= 0) continue;

    const quantity = Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 1;
    sources.push({
      ticketTypeId: line.ticketTypeId,
      ticketTypeName: line.ticketTypeName,
      perUnit,
      quantity,
    });
  }

  const total = sources.reduce((n, s) => n + s.perUnit * s.quantity, 0);
  return { total: Math.min(total, MAX_COMP_PASSES), sources };
}

export interface IssuedCompPass {
  id: string;
  seat: number;
  name: string;
  email: string;
  registrationId?: string;
  ticketTypeId: string;
  ticketTypeName: string;
  issuedAt?: string;
  issuedBy: string;
}

export interface CompPassAllocation {
  orderId: string;
  buyerName: string;
  buyerEmail: string;
  companyName?: string;
  orderStatus: OrderDoc["status"];
  total: number;
  sources: CompPassSource[];
  issued: IssuedCompPass[];
  /**
   * Derived, every time, from what exists. Never stored — a stored remainder is
   * a counter, and a counter is what lets two clicks issue the same last pass.
   */
  remaining: number;
}

function isoOf(value: unknown): string | undefined {
  const t = value as { toDate?: () => Date } | undefined;
  try {
    return typeof t?.toDate === "function" ? t.toDate().toISOString() : undefined;
  } catch {
    return undefined;
  }
}

function toIssued(id: string, seat: number, d: CompPassDoc): IssuedCompPass {
  return {
    id,
    seat,
    name: d.name,
    email: d.email,
    registrationId: d.registrationId,
    ticketTypeId: d.ticketTypeId,
    ticketTypeName: d.ticketTypeName,
    issuedAt: isoOf(d.issuedAt),
    issuedBy: d.issuedBy,
  };
}

/** Every tier that grants passes, as the map `compPassesForOrder` wants. */
export async function compPassesPerUnit(store: Firestore): Promise<Map<string, number>> {
  const snap = await store
    .collection(COLLECTIONS.ticketTypes)
    .where("eventId", "==", EVENT_ID)
    .get();

  const out = new Map<string, number>();
  for (const doc of snap.docs) {
    const t = doc.data() as TicketTypeDoc;
    const n = t.complimentaryPasses;
    if (typeof n === "number" && Number.isInteger(n) && n > 0) {
      out.set(doc.id, Math.min(n, MAX_COMP_PASSES));
    }
  }
  return out;
}

/**
 * What one sponsorship is owed, and who has been named against it.
 *
 * Returns `null` for an order that does not exist or belongs to another event —
 * the caller renders "not found" rather than an allocation of zero, because
 * those are different answers to the organizer's question.
 */
export async function readCompPassAllocation(
  store: Firestore,
  orderId: string,
): Promise<CompPassAllocation | null> {
  const orderSnap = await store.collection(COLLECTIONS.orders).doc(orderId).get();
  if (!orderSnap.exists) return null;

  const order = orderSnap.data() as OrderDoc;
  if (order.eventId !== EVENT_ID) return null;

  const perUnit = await compPassesPerUnit(store);
  const { total, sources } = compPassesForOrder(order.items, perUnit);

  /**
   * Read by query, not by the seat ids, and the difference matters at exactly
   * one edge: a tier whose count was lowered after passes were named. Those
   * seats sit *beyond* `total`, so computing the ids would not find them — and
   * they must be found, because the person holding one has a real registration
   * and a screen that omitted them would report a sponsorship as under-issued
   * while quietly having over-issued it.
   *
   * The redemption transaction reads seats by id instead. That is not an
   * inconsistency: inside the transaction the addressable seats *are* the
   * allocation, and a query there would take a wider lock than the handful of
   * documents it returns.
   */
  const snap = await store
    .collection(COLLECTIONS.compPasses)
    .where("eventId", "==", EVENT_ID)
    .where("orderId", "==", orderId)
    .orderBy("seat")
    .get();

  const issued = snap.docs.map((d) => {
    const data = d.data() as CompPassDoc;
    return toIssued(d.id, data.seat, data);
  });

  return {
    orderId,
    buyerName: order.buyerName ?? "",
    buyerEmail: order.email,
    companyName: order.companyName,
    orderStatus: order.status,
    total,
    sources,
    issued,
    remaining: Math.max(0, total - issued.length),
  };
}

/** Every issued pass for the event, for the index that lists sponsorships. */
export async function listCompPasses(
  store: Firestore,
): Promise<(IssuedCompPass & { orderId: string })[]> {
  const snap = await store
    .collection(COLLECTIONS.compPasses)
    .where("eventId", "==", EVENT_ID)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as CompPassDoc;
    return { ...toIssued(d.id, data.seat, data), orderId: data.orderId };
  });
}

export type CompPassResult =
  | {
      ok: true;
      seat: number;
      registrationId: string;
      claimCode: string;
      email: string;
      name: string;
      ticketTypeId: string;
      ticketTypeName: string;
      remaining: number;
      total: number;
    }
  | { ok: false; error: string };

export type RenameCompPassResult =
  | { ok: true; seat: number; registrationId: string; email: string; name: string }
  | { ok: false; error: string };

export interface RedeemCompPassInput {
  orderId: string;
  name: string;
  email: string;
  /** The organizer recorded on the pass. */
  actor: string;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Name one attendee against a sponsorship's complimentary passes.
 *
 * ── Refusing the fifth pass on a four-pass sponsorship ──────────────────────
 *
 * The seat is claimed inside a transaction that reads **every** seat of the
 * allocation and `create`s the lowest one that does not exist. Two organizers
 * pressing the button on the last remaining pass at the same moment therefore
 * cannot both succeed: Firestore serialises the two transactions on the
 * documents they read, so the loser re-reads, finds every seat taken and is
 * refused. `create` (rather than `set`) is the second line of defence — it
 * fails outright on an id that already exists, so even a transaction that
 * somehow saw stale seats cannot overwrite somebody else's pass.
 *
 * That is the `booths` shape, chosen for the `booths` reason. A read-then-write
 * — count the passes, compare with the total, write if there is room — hands
 * out a free ticket twice under two simultaneous clicks, and the second holder
 * finds out at the door.
 *
 * ── Why the seat is claimed before the registration is minted ───────────────
 *
 * The opposite order would mint the badge and *then* ask whether the sponsor
 * was entitled to it, which is a free conference ticket every time the answer
 * is no. Claiming first means the worst case is the mirror image and a much
 * smaller one: a seat claimed for a registration that failed to write. That
 * case is compensated below by deleting the claim, so the pass returns to the
 * allocation rather than evaporating.
 */
export async function redeemCompPass(
  store: Firestore,
  input: RedeemCompPassInput,
): Promise<CompPassResult> {
  const name = input.name.trim();
  const email = normaliseEmail(input.email);

  if (name.length < 2) return { ok: false, error: "Enter the attendee's full name." };
  if (!EMAIL_SHAPE.test(email)) return { ok: false, error: "Enter a valid email address." };

  const allocation = await readCompPassAllocation(store, input.orderId);
  if (!allocation) {
    return { ok: false, error: "That order does not exist for this event." };
  }
  if (allocation.total === 0) {
    return {
      ok: false,
      error:
        "Nothing on this order includes complimentary passes. Set a pass count on the package first.",
    };
  }

  /**
   * Which package pays for this seat.
   *
   * Only interesting when an order mixes packages that both grant passes, which
   * is rare and legitimate. Seats are filled in catalogue order, so the seat
   * number decides: the first source's passes are seats 1..n, the next one's
   * follow. It is denormalised onto the pass because the tier may be renamed
   * after the sponsorship is signed.
   */
  const sourceForSeat = (seat: number): CompPassSource | undefined => {
    let cursor = 0;
    for (const s of allocation.sources) {
      cursor += s.perUnit * s.quantity;
      if (seat <= cursor) return s;
    }
    return allocation.sources[allocation.sources.length - 1];
  };

  const seats = Array.from({ length: allocation.total }, (_, i) =>
    store.collection(COLLECTIONS.compPasses).doc(compPassSeatId(input.orderId, i + 1)),
  );

  let claimed: { seat: number; source: CompPassSource } | undefined;

  try {
    const outcome = await store.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...seats);

      /**
       * One person, one pass on one sponsorship.
       *
       * `ensureRegistration` is idempotent on the email address, so naming the
       * same person twice would spend a second seat and produce no second
       * attendee — the sponsor would silently be one pass short. Refusing is
       * the honest answer; the organizer meant to correct the name.
       */
      const already = snaps.find((s) => s.exists && (s.data() as CompPassDoc).email === email);
      if (already) {
        return {
          ok: false as const,
          error: `${email} already holds seat ${(already.data() as CompPassDoc).seat} on this sponsorship.`,
        };
      }

      const index = snaps.findIndex((s) => !s.exists);
      if (index === -1) {
        return {
          ok: false as const,
          error: `All ${allocation.total} complimentary passes on this sponsorship have been issued.`,
        };
      }

      const seat = index + 1;
      const source = sourceForSeat(seat);

      // A native `Date`, never a sentinel — see the docblock at the top.
      tx.create(seats[index], {
        eventId: EVENT_ID,
        orderId: input.orderId,
        seat,
        ticketTypeId: source?.ticketTypeId ?? "",
        ticketTypeName: source?.ticketTypeName ?? "",
        name,
        email,
        issuedAt: new Date(),
        issuedBy: input.actor,
      } satisfies Omit<CompPassDoc, "issuedAt"> & { issuedAt: Date });

      return { ok: true as const, seat, source };
    });

    if (!outcome.ok) return outcome;
    claimed = { seat: outcome.seat, source: outcome.source ?? allocation.sources[0] };
  } catch (err) {
    /**
     * `ALREADY_EXISTS` from the `create` above, which means a concurrent
     * redemption took the seat between the read and the commit. It is a
     * refusal, not a crash: the allocation held, and the organizer's next look
     * at the screen shows the seat gone.
     */
    const message = err instanceof Error ? err.message : String(err);
    if (/already exists/i.test(message)) {
      return {
        ok: false,
        error: "That pass was issued a moment ago by somebody else. Reload and try the next seat.",
      };
    }
    throw err;
  }

  const source = claimed.source;

  try {
    /**
     * The same function a paid seat goes through, at zero.
     *
     * `ticketType` is the *sponsorship's* package name, because that is what
     * was actually bought and what Ticket Session Mapping reads to decide which
     * sessions the holder is admitted to. Inventing a "Complimentary Pass" tier
     * here would be the fourth registration product §1.3 refused.
     */
    const registration = await ensureRegistration(store, {
      email,
      name,
      ticketType: source?.ticketTypeName ?? "Complimentary pass",
    });

    await seats[claimed.seat - 1].update({ registrationId: registration.registrationId });

    return {
      ok: true,
      seat: claimed.seat,
      registrationId: registration.registrationId,
      claimCode: registration.claimCode,
      email,
      name,
      ticketTypeId: source?.ticketTypeId ?? "",
      ticketTypeName: source?.ticketTypeName ?? "",
      total: allocation.total,
      remaining: Math.max(0, allocation.total - allocation.issued.length - 1),
    };
  } catch (err) {
    /**
     * The compensation. A claimed seat with no registration behind it is a pass
     * the sponsor has lost without anybody receiving it, so the claim is
     * released and the failure reported. Deleting is safe precisely because
     * nothing references the seat yet — the registration is what would have.
     */
    await seats[claimed.seat - 1].delete().catch(() => undefined);
    return {
      ok: false,
      error: `The pass could not be issued: ${err instanceof Error ? err.message : String(err)}. The seat was returned to the allocation.`,
    };
  }
}

/**
 * Correct the name on a pass that has already been issued.
 *
 * The registration is updated through `ensureRegistration` rather than by
 * writing to `registrations` directly, because that function is the only thing
 * that may decide when `qrSecret` and `claimCode` are minted — and on an
 * existing registration it deliberately leaves both alone. A badge already in
 * somebody's hand keeps working; only the printed name changes.
 *
 * The address is **not** editable here. Changing it would mean the pass points
 * at a different registration and the old one stays active, which is a free
 * ticket nobody is tracking; withdrawing a registration is the refund path's
 * job, not this screen's.
 */
export async function renameCompPass(
  store: Firestore,
  input: { orderId: string; seat: number; name: string },
): Promise<RenameCompPassResult> {
  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: "Enter the attendee's full name." };

  const ref = store
    .collection(COLLECTIONS.compPasses)
    .doc(compPassSeatId(input.orderId, input.seat));
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "That pass has not been issued." };

  const pass = snap.data() as CompPassDoc;
  if (pass.eventId !== EVENT_ID) {
    return { ok: false, error: "That pass belongs to another event." };
  }

  const registration = await ensureRegistration(store, {
    email: pass.email,
    name,
    ticketType: pass.ticketTypeName,
  });

  await ref.update({ name, registrationId: registration.registrationId });

  return {
    ok: true,
    seat: pass.seat,
    registrationId: registration.registrationId,
    email: pass.email,
    name,
  };
}
