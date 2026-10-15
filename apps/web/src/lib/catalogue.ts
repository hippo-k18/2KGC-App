import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  TIME_ZONE,
  dayInZone,
  isExtraTier,
  localWallClockToIso,
  priceNow,
  type EntitlementDoc,
  type TicketAudience,
  type TicketTypeDoc,
} from '@kgc/shared';
import { db } from './firestore';
import { entitlementKinds } from './app-account-core';
import type { AddOn, Tier } from './tickets';

/**
 * Reading the ticket catalogue out of Firestore.
 *
 * This is the only thing that turns a tier id into money. `startCheckout` looks
 * the price up through here from an id posted by the form, because a price in a
 * form field is a price the buyer can edit — the classic version of that bug
 * charges $1 for a $1,199 ticket.
 *
 * ── There is no fallback, on purpose ────────────────────────────────────────
 *
 * An empty `ticketTypes` collection throws rather than quietly reverting to a
 * hard-coded list. A stale fallback price is indistinguishable from a correct
 * one at the moment it is charged, and the person who finds out is the buyer's
 * finance department. `npm run seed` populates the collection; the fix for an
 * empty catalogue is to run it, not to guess.
 *
 * ── No composite index ──────────────────────────────────────────────────────
 *
 * One equality filter on `eventId`, sorted in memory. The emulator does not
 * enforce composite indexes, so `where(eventId) + orderBy(sortOrder)` would
 * pass locally and fail in production with `failed-precondition` — a bug that
 * has already shipped twice on this project. Four documents sort instantly.
 */

/** Firestore keeps no `undefined`; this drops the key instead of writing null. */
function optional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : value;
}

/**
 * Whether a tier can be bought right now, and if not, why.
 *
 * Evaluated at read time rather than stored, because "on sale" is a function of
 * the clock and a stored boolean is a boolean that needs a cron job to stay
 * true.
 */
function availability(t: TicketTypeDoc, now: Date, taken: number): Pick<Tier, 'onSale' | 'unavailableReason'> {
  // An add-on is only ever bought inside its bundle. An extra (Workshops) is
  // sold on its own, with or without a conference ticket (2026-10-07).
  if (t.addOnFor && !isExtraTier(t)) return { onSale: false, unavailableReason: 'Sold only as an add-on' };
  return windowAndCapacity(t, now, taken);
}

/**
 * The seats a tier has given up: its own sales, plus every bundle sold with it
 * inside (T257 #8).
 *
 * A bundle sale ("Main Conference + Continuing education units") moves only
 * the bundle's own `quantitySold`, and that stays so: the dashboard's cancel,
 * reinstate and reconcile all count a bundle seat under the bundle, and a
 * second counter moved only by the website would drift from all three. So the
 * bundle's seats are added to each part here, where capacity is decided, and a
 * cap on Main Conference counts the bundle buyers who are in the room.
 */
function seatsTaken(id: string, t: TicketTypeDoc, all: Map<string, TicketTypeDoc>): number {
  let taken = t.quantitySold ?? 0;
  for (const [otherId, other] of all) {
    if (otherId !== id && other.bundleOf?.includes(id)) taken += other.quantitySold ?? 0;
  }
  return taken;
}

/** Seats left under one tier's own cap, or undefined when it has none. */
function capLeft(id: string, t: TicketTypeDoc, all: Map<string, TicketTypeDoc>): number | undefined {
  return typeof t.quantityTotal === 'number' ? Math.max(0, t.quantityTotal - seatsTaken(id, t, all)) : undefined;
}

/**
 * A hidden tier is not for sale on the website (T262).
 *
 * `visible: false` used to hide a tier from the page and nothing else, so
 * anybody who posted its id (a slug of its name, `speaker-comp`) could buy it.
 * The dashboard tells organizers to untick "Show on the website" for a comp
 * rate, which made that a discounted rate open to anyone who guessed it. A
 * comp rate is a comp pass or a discount code now.
 *
 * The one hidden tier that does sell is a bundle whose base ticket is on the
 * page: "Main Conference + Continuing education units" is what a buyer gets by
 * ticking the add-on, and it has never had a card of its own.
 */
function hiddenFromSale(t: TicketTypeDoc, all: Map<string, TicketTypeDoc>): boolean {
  if (t.visible !== false) return false;
  const base = t.bundleOf?.[0];
  return !(base && all.get(base) && all.get(base)!.visible !== false);
}

/** The price phase in force on `now`, read in the tier's own sales zone. */
function phaseNow(t: TicketTypeDoc, now: Date) {
  return priceNow(t, now, t.salesTimeZone ?? TIME_ZONE);
}

/**
 * The clock, the price phase and the seat count, without the add-on rule. A
 * bundle checks its parts with this.
 */
function windowAndCapacity(
  t: TicketTypeDoc,
  now: Date,
  /** `seatsTaken`, which counts bundles sold with this tier inside. */
  taken: number,
): Pick<Tier, 'onSale' | 'unavailableReason'> {
  if (t.salesOpenAt && t.salesOpenAt.toDate() > now) {
    return { onSale: false, unavailableReason: 'Not on sale yet' };
  }
  if (t.salesCloseAt && t.salesCloseAt.toDate() < now) {
    return { onSale: false, unavailableReason: 'Sales closed' };
  }
  if (typeof t.quantityTotal === 'number' && taken >= t.quantityTotal) {
    return { onSale: false, unavailableReason: 'Sold out' };
  }
  // A phase with no agreed price, or one marked off sale, sells nothing.
  const phase = phaseNow(t, now);
  if (!phase.onSale) return { onSale: false, unavailableReason: phase.unavailableReason };
  return { onSale: true };
}

/**
 * A bundle's price and state, from its parts.
 *
 * The price is the sum of the parts' current phase prices, so "Main
 * Conference + Workshops" follows Main Conference up the price ladder without
 * anybody editing a second document. It is on sale only while every part is inside its window and under
 * its cap: a closed Main Conference must close the bundle too. A missing part
 * closes it rather than pricing it at whatever is left, because a partial sum
 * is a price nobody set.
 */
function bundlePricing(
  id: string,
  t: TicketTypeDoc,
  parts: Map<string, TicketTypeDoc>,
  now: Date,
): Pick<Tier, 'priceCents' | 'onSale' | 'unavailableReason'> {
  const ids = t.bundleOf ?? [];
  const docs = ids.map((id) => parts.get(id));
  if (docs.length === 0 || docs.some((d) => !d || d.currency !== t.currency)) {
    return { priceCents: t.priceCents, onSale: false, unavailableReason: 'Unavailable' };
  }
  const priceCents = docs.reduce((sum, d) => sum + phaseNow(d!, now).priceCents, 0);
  // "Main Conference + Workshops" retired when Workshops became its own ticket
  // (2026-10-06). The document stays for past orders; it sells nothing.
  if (docs.some((d) => isExtraTier(d))) return { priceCents, onSale: false, unavailableReason: 'No longer sold' };
  const states = [
    windowAndCapacity(t, now, seatsTaken(id, t, parts)),
    ...ids.map((partId, i) => windowAndCapacity(docs[i]!, now, seatsTaken(partId, docs[i]!, parts))),
  ];
  for (const state of states) {
    if (!state.onSale) return { priceCents, ...state };
  }
  return { priceCents, onSale: true };
}

function toTier(
  id: string,
  t: TicketTypeDoc,
  now: Date,
  /** The whole catalogue: a bundle's parts, and the bundles that count against this tier. */
  parts: Map<string, TicketTypeDoc> = new Map(),
): Tier {
  const phase = phaseNow(t, now);
  const extra = isExtraTier(t);
  return {
    id,
    name: t.name,
    priceCents: phase.priceCents,
    currency: t.currency,
    tagline: t.tagline ?? '',
    includes: t.includes ?? [],
    groups: optional(t.groups),
    featured: optional(t.featured),
    inPerson: t.inPerson ?? true,
    // Absent on documents written before the field existed; those are all
    // attendee tiers, which is the only slice that was sellable at the time.
    audience: t.audience ?? 'attendee',
    taxCode: t.taxCode ?? 'txcd_20030000',
    stripeProductId: optional(t.stripeProductId),
    phase: optional(phase.phase),
    earlierPhases: phase.earlier.length ? phase.earlier : undefined,
    risesOn: optional(phase.risesOn),
    badge: t.badge?.trim() || undefined,
    includesWorkshops: Boolean(t.includesWorkshops),
    ...(extra ? { kind: 'extra' as const } : {}),
    ...availability(t, now, seatsTaken(id, t, parts)),
    ...(t.bundleOf?.length ? { baseTierId: t.bundleOf[0], ...bundlePricing(id, t, parts, now) } : {}),
    ...(hiddenFromSale(t, parts) ? { onSale: false, unavailableReason: 'Not on public sale' } : {}),
  };
}

/**
 * The add-ons offered on a tier's checkout, and the bundle each combination buys.
 *
 * Found through the bundles rather than stored on the base tier, so the
 * documents cannot disagree: a bundle names the base tier first and its add-ons
 * after, and every add-on names the base tier in `addOnFor`. So Main Conference
 * with Workshops and Continuing education units needs three bundles, one per
 * combination, and a combination with no bundle simply cannot be ticked.
 *
 * Only bundles on sale count, which is what keeps an add-on off the checkout
 * while its own price phase is off sale. An add-on's price is its own current
 * phase price, which is exactly what its bundle adds.
 */
function addOnsFor(
  baseId: string,
  rows: { id: string; doc: TicketTypeDoc }[],
  byId: Map<string, TicketTypeDoc>,
  now: Date,
): Pick<Tier, 'addOns' | 'bundles'> {
  const addOns = new Map<string, AddOn>();
  const bundles: NonNullable<Tier['bundles']> = [];
  for (const { id, doc } of rows) {
    const [base, ...extras] = doc.bundleOf ?? [];
    if (base !== baseId || extras.length === 0) continue;
    const parts = extras.map((e) => byId.get(e));
    if (parts.some((p) => !p || p.addOnFor !== baseId || isExtraTier(p))) continue;
    if (!toTier(id, doc, now, byId).onSale) continue;
    bundles.push({ tierId: id, addOnIds: extras });
    extras.forEach((extra, i) => {
      const part = parts[i]!;
      if (!addOns.has(extra)) {
        addOns.set(extra, {
          id: extra,
          name: part.name,
          tagline: part.tagline ?? '',
          priceCents: phaseNow(part, now).priceCents,
        });
      }
    });
  }
  if (bundles.length === 0) return {};
  // In catalogue order, so Workshops sits above Continuing education units.
  const order = (id: string) => byId.get(id)?.sortOrder ?? 0;
  return {
    addOns: [...addOns.values()].sort((a, b) => order(a.id) - order(b.id)),
    bundles,
  };
}

async function loadAll(): Promise<{ id: string; doc: TicketTypeDoc }[]> {
  const snap = await db().collection(COLLECTIONS.ticketTypes).where('eventId', '==', EVENT_ID).get();
  return snap.docs.map((d) => ({ id: d.id, doc: d.data() as TicketTypeDoc }));
}

/**
 * The catalogue, or nothing — never a guess.
 *
 * ── Why this exists when `data.ts` already has `safely()` ──────────────────
 *
 * The public site's other reads degrade to an empty page when the database is
 * unreachable, because an unknown agenda is a state a conference genuinely has.
 * Prices are different in kind: a stale or invented figure is indistinguishable
 * from a correct one at the moment a card is charged, and the person who finds
 * out is the buyer's finance department.
 *
 * So `listTiers` still throws on an empty collection — that is a
 * misconfiguration and must be loud. What this adds is the narrower case of the
 * database being *unreachable*: no credentials, a network failure, a revoked
 * key. There the honest answer is "we cannot tell you the price right now",
 * which the tickets page renders as a closed state rather than a 500.
 *
 * ⚠️ The distinction that matters: this returns `null`, never an empty array.
 * A caller cannot mistake "the shop is closed" for "there are no tickets", and
 * `startCheckout` is unaffected — it reads a tier by id and still refuses an
 * unknown one, so nothing can be bought at a price this function did not
 * produce.
 */
export async function tiersOrNull(audience: TicketAudience = 'attendee'): Promise<Tier[] | null> {
  try {
    return await listTiers(audience);
  } catch (err) {
    console.error('[catalogue] could not read the catalogue; the page will say so', err);
    return null;
  }
}

/**
 * Every tier one audience may see, in catalogue order.
 *
 * Hidden tiers (`visible: false`) are excluded, and since T262 `tierById`
 * refuses to sell them too, bar a bundle; see `hiddenFromSale`.
 *
 * ── Why the audience is a parameter rather than a constant ──────────────────
 *
 * This filtered to `attendee` unconditionally, which meant an exhibitor or
 * sponsor tier created in the dashboard had **no page anywhere that would sell
 * it**. The organizer could price a booth and nobody could buy one, and the
 * only symptom was an empty catalogue on a screen nobody had reason to open.
 * Exhibitor and sponsor registration are genuinely different conversations —
 * different copy, different questions, different audiences — so they are
 * different pages over the same price list, which is exactly what Whova does.
 *
 * A tier with no `audience` at all counts as an attendee tier: the field was
 * added after the first seed, and documents written before it must not vanish
 * from the page that has always sold them.
 */
export async function listTiers(audience: TicketAudience = 'attendee'): Promise<Tier[]> {
  const now = new Date();
  const rows = await loadAll();
  if (rows.length === 0) {
    throw new Error(
      'The `ticketTypes` collection is empty, so there is nothing to sell.\n' +
        'Run `npm run seed` (against the emulator) or `npm run seed -- --confirm-live`.\n' +
        'This throws rather than falling back to hard-coded prices on purpose: a stale ' +
        'price is indistinguishable from a correct one at the moment it is charged.',
    );
  }

  const byId = new Map(rows.map(({ id, doc }) => [id, doc]));
  return rows
    .filter(({ doc }) => (doc.audience ?? 'attendee') === audience)
    .filter(({ doc }) => doc.visible !== false)
    .sort(
      (a, b) =>
        (a.doc.sortOrder ?? 0) - (b.doc.sortOrder ?? 0) || a.doc.name.localeCompare(b.doc.name),
    )
    .map(({ id, doc }) => ({ ...toTier(id, doc, now, byId), ...addOnsFor(id, rows, byId, now) }));
}

/**
 * One tier by id, visible or not.
 *
 * Returns `undefined` for an unknown id rather than throwing, because the id
 * arrives from a query string and a form field — both attacker-controlled — and
 * "choose a ticket type" is the right answer to a bad one, not a 500.
 */
/**
 * A tier id as the forms post it. Anything else is not a tier: an id with a
 * `/` in it is a path to Firestore, and `doc()` threw on it, which answered a
 * crafted POST with a 500 instead of "Choose a ticket type" (T135B, TK-404).
 */
const TIER_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The whole catalogue by id. One query: whether a tier has seats left depends
 * on the bundles that contain it, and whether a bundle sells on its parts, so
 * reading one document was never enough (T257 #8).
 */
async function catalogueById(): Promise<Map<string, TicketTypeDoc>> {
  return new Map((await loadAll()).map(({ id, doc }) => [id, doc]));
}

export async function tierById(id: string): Promise<Tier | undefined> {
  if (!id || !TIER_ID.test(id)) return undefined;
  const all = await catalogueById();
  const data = all.get(id);
  if (!data) return undefined;
  return toTier(id, data, new Date(), all);
}

/**
 * What fulfilment needs to know about a tier, in one read.
 *
 * Two questions get asked at the same moment and used to need two round trips:
 * how many seats are left (the capacity re-check on `invoice.paid` — an invoice
 * on net-30 terms can clear thirty days after the check at the point it was
 * raised, and a tier can sell out in between), and what the ticket unlocks
 * (`includesWorkshops` / `includesVideoLibrary`, which become
 * `users/{uid}/entitlements`).
 *
 * Deliberately not folded into `Tier`. That shape is passed to the client
 * checkout form as props, and neither the entitlement booleans nor the raw
 * capacity figures have any business in a browser chunk.
 */
export interface TierFulfilment {
  id: string;
  name: string;
  /**
   * Undefined means unlimited capacity, which is the honest reading of an absent
   * cap. Counts bundles sold with this tier inside, and for a bundle it is the
   * tightest of its own cap and its parts' (T257 #8).
   */
  remaining?: number;
  /** A bundle's parts, base ticket first. Each needs a seat for every bundle sold. */
  bundleOf: string[];
  onSale: boolean;
  unavailableReason?: string;
  entitlements: EntitlementDoc['kind'][];
  /** An extra (Workshops): added to the holder's badge, not a ticket of its own. */
  extra: boolean;
}

export async function tierFulfilment(tierId: string): Promise<TierFulfilment | null> {
  if (!tierId || !TIER_ID.test(tierId)) return null;
  const all = await catalogueById();
  const t = all.get(tierId);
  if (!t) return null;

  const state = availability(t, new Date(), seatsTaken(tierId, t, all));
  const caps = [tierId, ...(t.bundleOf ?? [])]
    .map((id) => (all.get(id) ? capLeft(id, all.get(id)!, all) : undefined))
    .filter((n): n is number => n !== undefined);
  return {
    id: tierId,
    name: t.name,
    remaining: caps.length ? Math.min(...caps) : undefined,
    bundleOf: t.bundleOf ?? [],
    entitlements: entitlementKinds(t),
    extra: isExtraTier(t),
    ...state,
  };
}

/**
 * Count a sale against a tier's capacity — or give a seat back.
 *
 * ⚠️ This is a **counter, not a reservation.** Firestore offers no way to hold a
 * seat across the Checkout redirect, so two buyers can both pass the capacity
 * check and both pay. At KGC's volumes the right response is a refund and an
 * apology; if a tier genuinely needs to stop selling, close it in the dashboard.
 *
 * Called from fulfilment, never from checkout creation — an abandoned Checkout
 * session must not consume a seat.
 *
 * `by` is negative on a **full** refund, which is what stops the counter being
 * the one-way ratchet audit B found: ten refunds used to consume ten seats for
 * ever, and no screen could correct it. A *partial* refund never gets here —
 * the attendee still holds a valid ticket, so the seat is still sold. The
 * caller owns the replay guard, because `increment` is not idempotent and this
 * function cannot see whether it has already run.
 */
export async function incrementSold(tierId: string, by = 1): Promise<void> {
  const { FieldValue } = await import('firebase-admin/firestore');
  try {
    await db()
      .collection(COLLECTIONS.ticketTypes)
      .doc(tierId)
      .update({ quantitySold: FieldValue.increment(by), updatedAt: FieldValue.serverTimestamp() });
  } catch (err) {
    // A tier deleted after the sale, most likely. The sale is real and the
    // registration is written; losing the counter must not fail fulfilment.
    console.error('[catalogue] could not increment quantitySold for', tierId, err);
  }
}

/**
 * The tiers now sold past their cap, among `tierIds` and the parts of any
 * bundle among them.
 *
 * Read after fulfilment has counted a sale. The cap is a counter, not a
 * reservation, so two card buyers can both pay for the last seat; the invoice
 * path has always told organizers when that happened and the card path said
 * nothing (T257 #5). This is what lets it say so.
 */
export async function overCapacity(
  tierIds: string[],
): Promise<{ id: string; name: string; sold: number; total: number }[]> {
  const all = await catalogueById();
  const ids = new Set<string>();
  for (const id of tierIds) {
    ids.add(id);
    for (const part of all.get(id)?.bundleOf ?? []) ids.add(part);
  }
  const over: { id: string; name: string; sold: number; total: number }[] = [];
  for (const id of ids) {
    const t = all.get(id);
    if (!t || typeof t.quantityTotal !== 'number') continue;
    const sold = seatsTaken(id, t, all);
    if (sold > t.quantityTotal) over.push({ id, name: t.name, sold, total: t.quantityTotal });
  }
  return over;
}

/**
 * The next moment any of `tierIds` (or a bundle's parts) stops selling at the
 * price checkout is about to charge: its sales window closes, or its next price
 * phase starts. Undefined when nothing is scheduled.
 *
 * A Checkout session keeps the price and availability fixed when it was made,
 * so without this a session opened on 30 November could pay Early Bird until
 * the next evening (T257 #6). `startCheckout` ends the session at this moment
 * when it comes sooner than its usual hour.
 */
export async function nextSaleChange(tierIds: string[], now: Date): Promise<Date | undefined> {
  const all = await catalogueById();
  const ids = new Set<string>();
  for (const id of tierIds) {
    ids.add(id);
    for (const part of all.get(id)?.bundleOf ?? []) ids.add(part);
  }
  let soonest: number | undefined;
  const consider = (ms: number) => {
    if (Number.isFinite(ms) && ms > now.getTime() && (soonest === undefined || ms < soonest)) soonest = ms;
  };
  for (const id of ids) {
    const t = all.get(id);
    if (!t) continue;
    if (t.salesCloseAt) consider(t.salesCloseAt.toDate().getTime());
    const zone = t.salesTimeZone ?? TIME_ZONE;
    const today = dayInZone(now, zone);
    for (const phase of t.pricePhases ?? []) {
      if (phase.startsOn && phase.startsOn > today) {
        consider(Date.parse(localWallClockToIso(`${phase.startsOn}T00:00`, zone)));
      }
    }
  }
  return soonest === undefined ? undefined : new Date(soonest);
}
