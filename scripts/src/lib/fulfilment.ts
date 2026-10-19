import type { Firestore, Query, QuerySnapshot } from "firebase-admin/firestore";
import {
  COLLECTIONS,
  EVENT_ID,
  SETTINGS_KEYS,
  categoryFromRule,
  chooseExtraBase,
  chooseExtraOnlyBadge,
  isExtraTier,
  resolveAttendeeCategories,
  resolveTicketRules,
  ticketLabel,
  type ExtraCandidate,
  type ExtraRefusal,
  type ExtraTierShape,
  type OrderDoc,
  type RegistrationDoc,
  type RegistrationExtra,
  type TicketTypeDoc,
} from "@kgc/shared";
import {
  claimCode,
  emailHash,
  normaliseEmail,
  purchaseRegistrationId,
  qrSecret,
  registrationId,
} from "./ids.js";

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

/** Order statuses that never issue or re-activate a ticket. */
const SETTLED: string[] = ["refunded", "cancelled"];

/**
 * Thrown by `ensureRegistration` when the order it is asked to issue a ticket
 * for has been refunded or cancelled. Recognise it by `code`, not
 * `instanceof`: each app resolves its own copy of this package's dependencies.
 */
export class OrderSettledError extends Error {
  readonly code = "order-settled";
  constructor(
    readonly orderId: string,
    readonly status: string,
  ) {
    super(`Order ${orderId} is ${status}, so no ticket was issued for it.`);
    this.name = "OrderSettledError";
  }
}

export function isOrderSettledError(err: unknown): err is OrderSettledError {
  return (err as { code?: unknown } | null)?.code === "order-settled";
}

/** What a caller needs back. Never includes `qrSecret`. */
export interface FulfilledRegistration {
  registrationId: string;
  email: string;
  name?: string;
  ticketType?: string;
  claimCode: string;
  /** True when this call created the registration rather than updating one. */
  created: boolean;
  /**
   * Set when the ticket was an extra (Workshops). `added` is true only on the
   * call that put it on the badge, so a replay counts nothing twice.
   * `extendedOnly` means this order added the extra to a badge another order
   * (or an import) issued: the order does not own that badge, and refunding
   * it takes off the extra rather than cancelling the badge. `refused` means
   * the person's ticket already includes it (or they already have it), so it
   * was issued apart and the team should be told. An extra with no other
   * ticket to join is a badge of its own: `extendedOnly` false, no `refused`.
   */
  extra?: {
    tierId: string;
    name: string;
    added: boolean;
    extendedOnly: boolean;
    refused?: ExtraRefusal;
    /** The badge's whole label after this call: "Main Conference + Workshops". */
    label?: string;
  };
  /**
   * Set when an admission ticket joined the person's Workshops-only badge
   * instead of issuing a second one (2026-10-07): same registration, QR code
   * and claim code, and Workshops moved into `extras`. `label` is the badge's
   * whole label after the join: "Main Conference + Workshops".
   */
  joined?: { label: string; added: boolean; extraOrderId?: string };
}

export interface EnsureRegistrationInput {
  email: string;
  name: string;
  /** `TicketTypeDoc.name`-shaped label, e.g. "All Access (VIP)". */
  ticketType: string;
  /**
   * The paid order and seat this ticket is for. Given by every path that takes
   * money (checkout, invoices); left out by imports, hand-adds and comp passes,
   * which keep the one-registration-per-address behaviour.
   *
   * With it, an address that already holds an active ticket from a different
   * purchase gets a second, separate ticket (`purchaseRegistrationId`). Without
   * it, the address's one registration is updated as before.
   */
  purchase?: { orderId: string; seat: number };
  /**
   * The `ticketTypes` id being issued, when the caller knows it. If that tier
   * is an extra (`kind: 'extra'`, Workshops), nothing new is issued: the extra
   * is added to the person's existing badge. See `addExtra` below.
   */
  ticketTypeId?: string;
}

/**
 * Idempotent on the attendee's email address, or on the order and seat when a
 * purchase is given.
 *
 * ⚠️ Since 2026-09-26 one address can hold several paid tickets (the owner's
 * call; the dashboard flags it). A purchase for an address that already holds
 * an active ticket from another order gets its own registration, keyed by
 * `purchaseRegistrationId`, with its own badge. Everything below still holds
 * for the address's first registration and for every path that passes no
 * purchase.
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
  const extraTier = input.ticketTypeId ? await extraTierById(store, input.ticketTypeId) : null;
  // Only a purchase joins a Workshops-only badge. Imports, hand-adds and
  // transfers keep their one-registration-per-address behaviour.
  if (!extraTier) return issueRegistration(store, input, input.purchase ? await extraNamesOf(store) : new Map());
  const added = await addExtra(store, { ...input, tier: extraTier });
  if ("registrationId" in added) return added;
  /**
   * No other ticket to join: a Workshops-only badge of its own, with its own
   * QR code and claim code (2026-10-07). `refused` is set only when the
   * person's ticket already includes the extra; the checkout refuses that, so
   * money moving anyway means the team is told.
   */
  const issued = await issueRegistration(store, input, new Map());
  return {
    ...issued,
    extra: {
      tierId: extraTier.tier.id,
      name: extraTier.tier.name,
      added: issued.created,
      extendedOnly: false,
      ...(added.refused ? { refused: added.refused } : {}),
    },
  };
}

/**
 * The names of the tiers that are extras (Workshops), which is how a
 * Workshops-only badge is recognised: its `ticketType` is one of them.
 */
export async function extraNamesOf(store: Firestore): Promise<Map<string, ExtraTierShape>> {
  const all = await store.collection(COLLECTIONS.ticketTypes).where("eventId", "==", EVENT_ID).get();
  const out = new Map<string, ExtraTierShape>();
  for (const d of all.docs) {
    const row = d.data() as TicketTypeDoc;
    if (isExtraTier(row) && !out.has(row.name)) out.set(row.name, shape(d.id, row));
  }
  return out;
}

async function issueRegistration(
  store: Firestore,
  input: EnsureRegistrationInput,
  /**
   * The extra tiers by name. An admission ticket for a person who holds a
   * Workshops-only badge joins that badge; empty when the ticket being issued
   * is itself the extra, which never joins anything here.
   */
  extras: Map<string, ExtraTierShape>,
): Promise<FulfilledRegistration> {
  const email = normaliseEmail(input.email);
  const baseId = registrationId(email);
  const regs = store.collection(COLLECTIONS.registrations);
  const purchase = input.purchase;

  const result = await store.runTransaction(async (tx) => {
    // Every read happens before any write, as a transaction requires.
    const base = await tx.get(regs.doc(baseId));
    const bag = (await tx.get(store.collection(COLLECTIONS.settings).doc(SETTINGS_KEYS.attendeeCategories))).data();
    const order = purchase ? await tx.get(store.collection(COLLECTIONS.orders).doc(purchase.orderId)) : null;
    const stored = bag?.eventId === EVENT_ID ? bag.values : undefined;
    const categories = resolveAttendeeCategories(stored?.categories);
    const rules = resolveTicketRules(stored?.ticketRules, categories);
    // A native Date, never a sentinel — see the docblock above.
    const now = new Date();

    const byRule = (current: Pick<RegistrationDoc, "categorySource">) => {
      const next = categoryFromRule(current, categories, rules, input.ticketType);
      return next === "keep" ? undefined : next;
    };

    /**
     * Which document this seat is. The address's own registration unless a
     * purchase is buying a further ticket for an address that already holds an
     * active one from somewhere else.
     *
     * "From somewhere else" is decided by what the registration and the order
     * say about each other, so a replay is always recognised as the same seat:
     * the registration names this order and seat, or (for one written before
     * `orderId` existed) this order already lists it.
     */
    /**
     * A refunded or cancelled order issues nothing, ever: not a new ticket and
     * not the old one back. A replayed sale, the buyer reopening the return
     * page from history, or a refund that reached us before the sale itself all
     * land here with the money already gone back, and an `active` write would
     * hand them a ticket the check-in desk accepts (T135, S12/S13). Re-enabling
     * a refunded or disputed ticket is an organizer's decision, made on the
     * dashboard.
     */
    if (purchase && SETTLED.includes((order?.data() as OrderDoc | undefined)?.status ?? "")) {
      throw new OrderSettledError(purchase.orderId, (order!.data() as OrderDoc).status);
    }

    /**
     * An admission ticket for somebody who holds only Workshops joins that
     * badge (2026-10-07: one person, one QR code, whichever ticket came
     * first). A replay of the same seat finds the badge it already joined.
     */
    const joinable = extras.size > 0 && !extras.has(input.ticketType);
    const rows = joinable ? await registrationsFor((q) => tx.get(q), store, email) : [];
    const replayed = purchase
      ? rows.find(({ reg }) => reg.orderId === purchase.orderId && (reg.seat ?? 0) === purchase.seat)
      : undefined;
    const join = replayed
      ? null
      : chooseExtraOnlyBadge(candidates(rows, purchase?.orderId), (n) => extras.get(n));
    if (join) {
      const row = rows.find((r) => r.id === join)!;
      const prev = row.reg;
      const tier = extras.get(prev.ticketType!)!;
      const extraOrder = prev.orderId ? await tx.get(store.collection(COLLECTIONS.orders).doc(prev.orderId)) : null;
      const moved: RegistrationExtra = {
        tierId: tier.id,
        name: prev.ticketType!,
        ...(prev.orderId ? { orderId: prev.orderId } : {}),
        ...(prev.seat !== undefined ? { seat: prev.seat } : {}),
        addedAt: prev.createdAt ?? now,
      };
      const extrasAfter = [moved, ...(prev.extras ?? [])];
      const ref = regs.doc(join);
      const next: Record<string, unknown> = {
        ...prev,
        name: prev.name || input.name,
        ticketType: input.ticketType,
        extras: extrasAfter,
        extraNames: [...new Set(extrasAfter.map((e) => e.name))],
        ...(byRule(prev) ?? {}),
        updatedAt: now,
      };
      // The badge now stands on this purchase; Workshops' order only extends it.
      delete next.orderId;
      delete next.seat;
      if (purchase) Object.assign(next, { orderId: purchase.orderId, seat: purchase.seat });
      tx.set(ref, next);
      if (extraOrder?.exists) {
        const listed = (extraOrder.data() as OrderDoc).extraRegistrationIds ?? [];
        if (!listed.includes(join)) {
          tx.update(extraOrder.ref, { extraRegistrationIds: [...listed, join], updatedAt: now });
        }
      }
      return {
        ref,
        registrationId: join,
        email: prev.email,
        name: (next.name as string) ?? input.name,
        ticketType: input.ticketType,
        claimCode: prev.claimCode ?? claimCode(),
        created: false,
        backfillClaimCode: prev.claimCode ? undefined : true,
        joined: {
          label: ticketLabel({ ticketType: input.ticketType, extraNames: next.extraNames as string[] }),
          added: true,
          ...(prev.orderId ? { extraOrderId: prev.orderId } : {}),
        },
      };
    }

    let snap = replayed ? await tx.get(regs.doc(replayed.id)) : base;
    if (purchase && base.exists && !replayed) {
      const prev = base.data() as RegistrationDoc;
      const listed = ((order?.data() as OrderDoc | undefined)?.registrationIds ?? []).includes(baseId);
      const sameSeat =
        prev.orderId === undefined ? listed : prev.orderId === purchase.orderId && (prev.seat ?? 0) === purchase.seat;
      if (prev.status === "active" && !sameSeat) {
        snap = await tx.get(regs.doc(purchaseRegistrationId(email, purchase.orderId, purchase.seat)));
      }
    }
    const ref = snap.ref;
    const stamp = purchase ? { orderId: purchase.orderId, seat: purchase.seat } : {};

    if (snap.exists) {
      const prev = snap.data() as RegistrationDoc;

      // `createdAt`, `qrSecret`, `claimCode`, `altEmails` and `claimedByUid`
      // are deliberately absent from this write. See the docblock above.
      tx.update(ref, {
        // A replay found by its order keeps the address the badge was issued
        // to, which may not be the one this purchase used (an alternate).
        ...(replayed ? {} : { email, emailHash: emailHash(email) }),
        name: input.name,
        ticketType: input.ticketType,
        status: "active",
        ...stamp,
        ...(byRule(prev) ?? {}),
        updatedAt: now,
      });

      return {
        ref,
        registrationId: ref.id,
        email: replayed ? prev.email : email,
        name: input.name,
        ticketType: input.ticketType,
        ...(replayed && (prev.extraNames?.length ?? 0) > 0
          ? { joined: { label: ticketLabel({ ticketType: input.ticketType, extraNames: prev.extraNames }), added: false } }
          : {}),
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
      ...stamp,
      ...(byRule({}) ?? {}),
    };

    tx.set(ref, { ...fresh, createdAt: now, updatedAt: now });

    return {
      ref,
      registrationId: ref.id,
      email,
      name: input.name,
      ticketType: input.ticketType,
      claimCode: fresh.claimCode!,
      created: true,
      backfillClaimCode: undefined,
      joined: undefined,
    };
  });

  // Outside the transaction: it read no document that this write invalidates,
  // and a claim code minted for a pre-claim-code registration is a repair
  // rather than part of the purchase.
  if (result.backfillClaimCode) {
    await result.ref.update({ claimCode: result.claimCode });
  }

  return {
    registrationId: result.registrationId,
    email: result.email,
    name: result.name,
    ticketType: result.ticketType,
    claimCode: result.claimCode,
    created: result.created,
    ...(result.joined ? { joined: result.joined } : {}),
  };
}

// ---------------------------------------------------------------------------
// Extras: a ticket added to an existing badge (Workshops)
// ---------------------------------------------------------------------------

interface ExtraContext {
  tier: ExtraTierShape;
  /** Every tier of the event, to read what a badge's `ticketType` is. */
  byName: Map<string, ExtraTierShape>;
}

function shape(id: string, t: TicketTypeDoc): ExtraTierShape {
  return {
    id,
    name: t.name,
    kind: t.kind,
    addOnFor: t.addOnFor,
    bundleOf: t.bundleOf,
    includesWorkshops: t.includesWorkshops,
    inPerson: t.inPerson,
  };
}

/** The tier and the catalogue, when `tierId` is an extra; otherwise null. */
export async function extraTierById(store: Firestore, tierId: string): Promise<ExtraContext | null> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tierId)) return null;
  const doc = await store.collection(COLLECTIONS.ticketTypes).doc(tierId).get();
  const t = doc.data() as TicketTypeDoc | undefined;
  if (!t || t.eventId !== EVENT_ID || !isExtraTier(t)) return null;
  const all = await store.collection(COLLECTIONS.ticketTypes).where("eventId", "==", EVENT_ID).get();
  const byName = new Map<string, ExtraTierShape>();
  for (const d of all.docs) {
    const row = d.data() as TicketTypeDoc;
    // A renamed tier keeps its old badges: the first tier with a name wins.
    if (!byName.has(row.name)) byName.set(row.name, shape(d.id, row));
  }
  return { tier: shape(doc.id, t), byName };
}

function millis(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  const ts = v as { toMillis?: () => number } | null | undefined;
  return typeof ts?.toMillis === "function" ? ts.toMillis() : 0;
}

/** Every registration this address holds, by its own address or as an alternate. */
async function registrationsFor(
  read: (q: Query) => Promise<QuerySnapshot>,
  store: Firestore,
  email: string,
): Promise<{ id: string; reg: RegistrationDoc }[]> {
  const regs = store.collection(COLLECTIONS.registrations);
  const [own, alt] = [
    await read(regs.where("email", "==", email)),
    await read(regs.where("altEmails", "array-contains", email)),
  ];
  const seen = new Map<string, RegistrationDoc>();
  for (const d of [...own.docs, ...alt.docs]) {
    const reg = d.data() as RegistrationDoc;
    if (reg.eventId === EVENT_ID) seen.set(d.id, reg);
  }
  return [...seen].map(([id, reg]) => ({ id, reg }));
}

function candidates(rows: { id: string; reg: RegistrationDoc }[], orderId?: string): ExtraCandidate[] {
  return rows.map(({ id, reg }) => ({
    registrationId: id,
    status: reg.status,
    ticketType: reg.ticketType,
    extras: reg.extras,
    // A badge the same order issued comes first: Main Conference and Workshops
    // bought together go on the same badge.
    createdAtMs: orderId && reg.orderId === orderId ? Number.MAX_SAFE_INTEGER : millis(reg.createdAt),
  }));
}

/**
 * Whether an address can take an extra, read outside any transaction. The
 * website's checkout and the dashboard ask this before any money moves.
 */
export async function extraVerdictFor(
  store: Firestore,
  rawEmail: string,
  ctx: ExtraContext,
): Promise<{ ok: true; registrationId?: string } | { ok: false; reason: ExtraRefusal; heldName?: string }> {
  const rows = await registrationsFor((q) => q.get(), store, normaliseEmail(rawEmail));
  return chooseExtraBase(ctx.tier, candidates(rows), (n) => ctx.byName.get(n));
}

/**
 * Put an extra on the person's badge, in one transaction. Returns why not when
 * no badge can take it, and the caller then issues a badge of its own: with
 * `refused` unset when the person simply holds no other ticket.
 *
 * Idempotent per order and seat: a replay finds the entry it wrote and changes
 * nothing. A refunded or cancelled order adds nothing, as for any ticket.
 */
async function addExtra(
  store: Firestore,
  input: EnsureRegistrationInput & { tier: ExtraContext },
): Promise<FulfilledRegistration | { refused?: ExtraRefusal }> {
  const email = normaliseEmail(input.email);
  const { tier, byName } = input.tier;
  const purchase = input.purchase;

  return store.runTransaction(async (tx) => {
    const rows = await registrationsFor((q) => tx.get(q), store, email);
    const order = purchase ? await tx.get(store.collection(COLLECTIONS.orders).doc(purchase.orderId)) : null;
    if (purchase && SETTLED.includes((order?.data() as OrderDoc | undefined)?.status ?? "")) {
      throw new OrderSettledError(purchase.orderId, (order!.data() as OrderDoc).status);
    }

    const result = (id: string, reg: RegistrationDoc, added: boolean): FulfilledRegistration => ({
      registrationId: id,
      email: reg.email,
      name: reg.name,
      ticketType: reg.ticketType,
      claimCode: reg.claimCode ?? "",
      created: false,
      extra: {
        tierId: tier.id,
        name: tier.name,
        added,
        extendedOnly: !purchase || reg.orderId !== purchase.orderId,
        label: ticketLabel({ ticketType: reg.ticketType, extraNames: (reg.extras ?? []).map((e) => e.name) }),
      },
    });

    // A replay: this order and seat already put the extra on a badge.
    if (purchase) {
      for (const { id, reg } of rows) {
        const mine = (reg.extras ?? []).some(
          (e) => e.tierId === tier.id && e.orderId === purchase.orderId && (e.seat ?? 0) === purchase.seat,
        );
        if (mine) return result(id, reg, false);
        // A Workshops-only badge this order and seat issued: a replay, which
        // `issueRegistration` recognises as the same seat.
        if (reg.orderId === purchase.orderId && (reg.seat ?? 0) === purchase.seat && reg.ticketType === tier.name) {
          return {};
        }
      }
    }

    const verdict = chooseExtraBase(tier, candidates(rows, purchase?.orderId), (n) => byName.get(n));
    if (!verdict.ok) {
      // Already on their badge from another order or a hand add: nothing new
      // is issued, and the caller is told so it can flag a paid duplicate.
      const held = verdict.reason === "already" ? rows.find((r) => r.id === verdict.registrationId) : undefined;
      if (held) {
        const same = result(held.id, held.reg, false);
        return purchase ? { ...same, extra: { ...same.extra!, refused: "already" } } : same;
      }
      return { refused: verdict.reason };
    }
    if (!verdict.registrationId) return {};
    const row = rows.find((r) => r.id === verdict.registrationId)!;
    const entry: RegistrationExtra = {
      tierId: tier.id,
      name: tier.name,
      ...(purchase ? { orderId: purchase.orderId, seat: purchase.seat } : {}),
      // A native Date, never a sentinel: see the docblock at the top.
      addedAt: new Date(),
    };
    const extras = [...(row.reg.extras ?? []), entry];
    tx.update(store.collection(COLLECTIONS.registrations).doc(row.id), {
      extras,
      extraNames: [...new Set(extras.map((e) => e.name))],
      updatedAt: new Date(),
    });
    return result(row.id, { ...row.reg, extras }, true);
  });
}

/**
 * Take off the extras one order paid for, leaving the badge and everything
 * else on it. Returns the tier ids removed, once each: a replay removes
 * nothing, which is what keeps a seat from being handed back twice.
 */
export async function removeOrderExtras(
  store: Firestore,
  registrationId: string,
  orderId: string,
): Promise<string[]> {
  const ref = store.collection(COLLECTIONS.registrations).doc(registrationId);
  return store.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const reg = snap.data() as RegistrationDoc | undefined;
    if (!reg) return [];
    const extras = reg.extras ?? [];
    const keep = extras.filter((e) => e.orderId !== orderId);
    if (keep.length === extras.length) return [];
    tx.update(ref, {
      extras: keep,
      extraNames: [...new Set(keep.map((e) => e.name))],
      updatedAt: new Date(),
    });
    return extras.filter((e) => e.orderId === orderId).map((e) => e.tierId);
  });
}

/**
 * The admission ticket on a badge was refunded or disputed: keep the badge
 * for the extras still paid for, or say it has nothing left (2026-10-07).
 *
 * Workshops and the conference tickets are independent, so refunding Main
 * Conference on a "Main Conference + Workshops" badge leaves a Workshops-only
 * badge: same registration, QR code and claim code, with the first extra
 * still standing moved into `ticketType` and its order now the badge's own.
 * Extras that `orderId` itself paid for go with it (a cart that bought both),
 * and so do extras whose order is already refunded or cancelled.
 *
 * Returns `kept: false` when nothing remains, or when another order issued
 * the badge, and the caller cancels it as before. Idempotent: the badge
 * records the order it was released from (`releasedAdmissions`), so a replay
 * of the same refund keeps it.
 */
export async function releaseAdmission(
  store: Firestore,
  registrationId: string,
  orderId: string,
): Promise<{ kept: false } | { kept: true; ticketType: string; label: string; ownerOrderId?: string }> {
  const ref = store.collection(COLLECTIONS.registrations).doc(registrationId);
  return store.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const reg = snap.data() as RegistrationDoc | undefined;
    if (!reg || reg.status !== "active") return { kept: false as const };
    // A replay of a refund that already left this badge standing on what else
    // it holds: nothing more to release, and the badge stays.
    if ((reg.releasedAdmissions ?? []).includes(orderId)) {
      return { kept: true as const, ticketType: reg.ticketType ?? "", label: ticketLabel(reg), ownerOrderId: reg.orderId };
    }
    // A badge some other order issued: not this order's to keep alive.
    if (reg.orderId && reg.orderId !== orderId) return { kept: false as const };
    const others = (reg.extras ?? []).filter((e) => e.orderId !== orderId);
    const orders = new Map<string, OrderDoc | undefined>();
    for (const id of new Set(others.map((e) => e.orderId).filter((id): id is string => Boolean(id)))) {
      orders.set(id, (await tx.get(store.collection(COLLECTIONS.orders).doc(id))).data() as OrderDoc | undefined);
    }
    const standing = others.filter((e) => !e.orderId || !SETTLED.includes(orders.get(e.orderId)?.status ?? "refunded"));
    if (standing.length === 0) return { kept: false as const };

    const [base, ...rest] = standing as [RegistrationExtra, ...RegistrationExtra[]];
    const now = new Date();
    const next: Record<string, unknown> = {
      ...reg,
      ticketType: base.name,
      extras: rest,
      extraNames: [...new Set(rest.map((e) => e.name))],
      releasedAdmissions: [...(reg.releasedAdmissions ?? []), orderId],
      updatedAt: now,
    };
    delete next.orderId;
    delete next.seat;
    if (base.orderId) Object.assign(next, { orderId: base.orderId, seat: base.seat ?? 0 });
    if (rest.length === 0) {
      delete next.extras;
      delete next.extraNames;
    }
    const owner = base.orderId ? orders.get(base.orderId) : undefined;
    tx.set(ref, next);
    if (base.orderId && owner) {
      // That order now owns the badge: refunding it later cancels the badge
      // rather than only taking Workshops off it.
      const listed = owner.extraRegistrationIds ?? [];
      if (listed.includes(registrationId)) {
        tx.update(store.collection(COLLECTIONS.orders).doc(base.orderId), {
          extraRegistrationIds: listed.filter((id) => id !== registrationId),
          updatedAt: now,
        });
      }
    }
    return {
      kept: true as const,
      ticketType: base.name,
      label: ticketLabel({ ticketType: base.name, extraNames: next.extraNames as string[] | undefined }),
      ...(base.orderId ? { ownerOrderId: base.orderId } : {}),
    };
  });
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
): Promise<{
  id: string;
  email: string;
  /** For greeting them in a mail. Absent on a registration nobody named. */
  name?: string;
  status: RegistrationDoc["status"];
} | null> {
  const seen = new Set<string>();
  let id = startId;

  for (let hop = 0; hop < limit; hop += 1) {
    if (seen.has(id)) return null;
    seen.add(id);

    const snap = await store.collection(COLLECTIONS.registrations).doc(id).get();
    const reg = snap.data() as RegistrationDoc | undefined;
    if (!reg || reg.eventId !== EVENT_ID) return null;

    const next = reg.status === "transferred" ? reg.transferredTo : undefined;
    if (!next) return { id, email: reg.email, name: reg.name, status: reg.status };
    id = next;
  }

  return null;
}

/**
 * Is some *other* order still paying for this seat?
 *
 * The question a refund has to ask before it withdraws a ticket. Someone who
 * bought twice — a workshop upgrade on top of a main-conference ticket — has
 * one registration backed by two orders, and refunding the first must not
 * revoke what the second still pays for.
 *
 * ── Why two addresses rather than one ───────────────────────────────────────
 *
 * After a transfer the buyer paid and somebody else holds the seat, and either
 * of them can be the reason it stays alive. The buyer's second order still
 * covers the registration they passed on; a colleague who was handed the seat
 * and also bought one of their own keeps the one they paid for. Asking only the
 * holder cancels a ticket the buyer is still paying for, and asking only the
 * buyer is what made a refund miss the holder in the first place. So the caller
 * passes both and this answers about the pair.
 *
 * `excludeOrderId` is the order being refunded. Its status has usually already
 * been moved to `refunded` by the time this runs, so the filter below would
 * drop it anyway — but that is an ordering accident, and a rule that means "no
 * *other* order" has to say so itself.
 *
 * Status is filtered in memory rather than in the query. `partially_refunded`
 * still paid for a ticket, so the set that keeps a registration alive is two
 * statuses rather than one, and `where('status', 'in', [...])` would be a third
 * filter shape to keep matched in `firestore.indexes.json`. One person has a
 * handful of orders; filtering after the read costs nothing and cannot fail
 * with `failed-precondition`.
 */
export async function stillPaidElsewhere(
  store: Firestore,
  emails: (string | null | undefined)[],
  excludeOrderId: string,
  /**
   * The registrations in question: the one the refunded order paid for and
   * whoever holds that seat now. When given, only an order that paid for one
   * of these counts. Since one address can hold several tickets
   * (2026-09-26), a second ticket's order no longer keeps the first alive.
   * An order written before `registrationIds` existed is read as paying for
   * `registrationId(order.email)`.
   */
  registrationIds?: string[],
): Promise<boolean> {
  const addresses = [
    ...new Set(emails.filter((e): e is string => Boolean(e)).map((e) => normaliseEmail(e))),
  ];

  for (const email of addresses) {
    const snap = await store
      .collection(COLLECTIONS.orders)
      .where("eventId", "==", EVENT_ID)
      .where("email", "==", email)
      .get();

    const paying = snap.docs.some((d) => {
      if (d.id === excludeOrderId) return false;
      const order = d.data() as OrderDoc;
      if (order.status !== "paid" && order.status !== "partially_refunded") return false;
      if (!registrationIds) return true;
      // An order that only added Workshops to the badge does not pay for the
      // badge itself: refunding Main Conference cancels it regardless.
      const extended = order.extraRegistrationIds ?? [];
      const covers = (order.registrationIds ?? [registrationId(order.email)]).filter((id) => !extended.includes(id));
      return covers.some((id) => registrationIds.includes(id));
    });
    if (paying) return true;
  }

  return false;
}
