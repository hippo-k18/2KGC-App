import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  type EmailLogDoc,
  type OrderDoc,
  type TicketAudience,
  type TicketTypeDoc,
  type WithId,
} from '@kgc/shared';
import { db } from './firestore';

/**
 * Every read the Tickets tab does.
 *
 * All of it runs on the server with the Admin SDK — there is no Firebase client
 * in this app at all, so there is nothing for a browser chunk to leak.
 *
 * ── Money is never recomputed from a price list ─────────────────────────────
 *
 * Every figure on these screens comes from the `orders` collection, which
 * records what was actually charged. It would be easy to multiply
 * `ticketTypes.priceCents` by a count and call it revenue; that number would be
 * wrong the moment a discount code, a tax line or a partial refund existed, and
 * it would be wrong *plausibly*, which is worse than being obviously broken.
 *
 * ── No composite index ──────────────────────────────────────────────────────
 *
 * Every query here is a single equality filter on `eventId`, sorted in memory.
 * The emulator does not enforce composite indexes, so `where(eventId) +
 * orderBy(purchasedAt)` passes locally and fails in production with
 * `failed-precondition` — a bug that has shipped twice on this project. A
 * conference's orders number in the low thousands and sort in milliseconds.
 */

/** A plain object safe to hand to a client component — no Timestamps. */
export interface OrderRow {
  id: string;
  externalId: string;
  email: string;
  buyerName?: string;
  companyName?: string;
  status: OrderDoc['status'];
  channel: NonNullable<OrderDoc['channel']>;
  ticketNames: string[];
  /**
   * The tier ids behind `ticketNames`, in the same order.
   *
   * Carried because the *name* cannot answer "was this an exhibitor order?" —
   * audience lives on the ticket type and the only path to it is the id. This
   * was dropped from the read model originally, and the cost was three screens
   * (Exhibitor Orders, Sponsor Orders, and the per-audience confirmation logs)
   * that could describe the join they needed but not perform it.
   *
   * Possibly empty on an order written before the field existed, and possibly
   * pointing at a deleted tier. Both are handled by treating an unresolvable id
   * as "unknown audience" rather than as "attendee", because guessing here
   * moves money into the wrong column of a ledger.
   */
  ticketTypeIds: string[];
  seatCount: number;
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  refundedCents: number;
  /** What the event actually keeps. Total minus whatever went back. */
  netCents: number;
  currency: string;
  /** ISO 8601, so the client can format without a Timestamp class. */
  purchasedAt: string;
  refundedAt?: string;
  promotionCode?: string;
  poNumber?: string;
  stripePaymentIntentId?: string;
  stripeInvoiceId?: string;
  hostedInvoiceUrl?: string;
  registrationIds: string[];
  markedPaidBy?: string;
  /** True when a refund can be issued from here — a paid Stripe card payment. */
  refundable: boolean;
}

function iso(t: { toDate(): Date } | undefined): string | undefined {
  try {
    return t?.toDate().toISOString();
  } catch {
    // A malformed timestamp on one legacy order must not take the page down.
    return undefined;
  }
}

function toRow(id: string, o: OrderDoc): OrderRow {
  const refundedCents = o.refundedCents ?? 0;
  const items = o.items ?? [];

  return {
    id,
    externalId: o.externalId,
    email: o.email,
    buyerName: o.buyerName,
    companyName: o.companyName,
    status: o.status,
    // Orders written before the in-house move carry no channel. They all came
    // through Checkout, so that is the honest default rather than 'manual'.
    channel: o.channel ?? 'checkout',
    ticketNames: items.map((i) => i.ticketTypeName).filter(Boolean),
    ticketTypeIds: items.map((i) => i.ticketTypeId).filter(Boolean),
    seatCount: items.reduce((n, i) => n + (i.quantity || 1), 0) || 1,
    subtotalCents: o.subtotalCents ?? o.totalCents,
    taxCents: o.taxCents ?? 0,
    discountCents: o.discountCents ?? 0,
    totalCents: o.totalCents,
    refundedCents,
    netCents: o.totalCents - refundedCents,
    currency: o.currency,
    purchasedAt: iso(o.purchasedAt) ?? new Date(0).toISOString(),
    refundedAt: iso(o.refundedAt),
    promotionCode: o.promotionCode,
    poNumber: o.poNumber,
    stripePaymentIntentId: o.stripePaymentIntentId,
    stripeInvoiceId: o.stripeInvoiceId,
    hostedInvoiceUrl: o.hostedInvoiceUrl,
    registrationIds: o.registrationIds ?? [],
    markedPaidBy: o.markedPaidBy,
    /**
     * Refundable means all four of these at once, and each exclusion is a
     * different way the button would otherwise lie:
     *
     *   `paid`               — a pending or already-refunded order has nothing
     *                          to send back.
     *   a payment intent     — Stripe needs something to refund *against*, and
     *                          legacy or manually-recorded orders have none.
     *   not a demo           — no money was ever taken, so there is none to
     *                          return; the button would fail at Stripe.
     *   not an invoice       — invoice refunds are credit notes, a different
     *                          Stripe API with different accounting. Out of
     *                          scope here rather than silently wrong.
     */
    refundable:
      o.status === 'paid' &&
      Boolean(o.stripePaymentIntentId) &&
      (o.channel ?? 'checkout') !== 'demo' &&
      (o.channel ?? 'checkout') !== 'invoice',
  };
}

/** Every order for this event, newest purchase first. */
export async function listOrders(): Promise<OrderRow[]> {
  const snap = await db().collection(COLLECTIONS.orders).where('eventId', '==', EVENT_ID).get();
  return snap.docs
    .map((d) => toRow(d.id, d.data() as OrderDoc))
    .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
}

export async function getOrder(id: string): Promise<OrderRow | null> {
  const doc = await db().collection(COLLECTIONS.orders).doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as OrderDoc;
  if (data.eventId !== EVENT_ID) return null;
  return toRow(doc.id, data);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface TierSales {
  ticketTypeId: string;
  name: string;
  sold: number;
  refunded: number;
  grossCents: number;
  netCents: number;
}

export interface SalesSummary {
  currency: string;
  /** Everything charged, before refunds. */
  grossCents: number;
  refundedCents: number;
  /** What the event keeps. This is the number that matters. */
  netCents: number;
  taxCents: number;
  discountCents: number;
  /** Orders that resulted in at least one live registration. */
  paidOrders: number;
  refundedOrders: number;
  /** Raised, sent, and not yet paid. Money the event is owed. */
  outstandingInvoices: number;
  outstandingCents: number;
  ticketsSold: number;
  byTier: TierSales[];
  /** ISO date → net cents, ascending. Drives the sales-over-time strip. */
  daily: { date: string; netCents: number; orders: number }[];
  /** Test purchases, counted separately so they never pollute revenue. */
  demoOrders: number;
}

/**
 * The Summary screen's numbers, computed in one pass over the orders.
 *
 * Demo orders are excluded from every money figure and counted on their own.
 * A test purchase writes a real order document by design — that is what makes
 * the demo faithful — and letting it into revenue would make the first live
 * figure the organizer sees be wrong by however many times somebody clicked
 * the test button.
 */
export async function salesSummary(): Promise<SalesSummary> {
  const orders = await listOrders();

  const real = orders.filter((o) => o.channel !== 'demo');
  const demoOrders = orders.length - real.length;

  const counted = real.filter((o) => o.status === 'paid' || o.status === 'partially_refunded');
  const refundedOrders = real.filter(
    (o) => o.status === 'refunded' || o.status === 'partially_refunded',
  ).length;

  const outstanding = real.filter((o) => o.status === 'pending' && o.channel === 'invoice');

  const sum = (rows: OrderRow[], pick: (o: OrderRow) => number) =>
    rows.reduce((n, o) => n + pick(o), 0);

  // Gross counts fully-refunded orders too: money did change hands, and hiding
  // it makes gross and net differ by an amount nothing on the page explains.
  const settled = real.filter((o) => o.status !== 'pending' && o.status !== 'cancelled');

  const byTierMap = new Map<string, TierSales>();
  for (const o of settled) {
    for (const name of o.ticketNames.length > 0 ? o.ticketNames : ['(unknown)']) {
      const key = name;
      const entry = byTierMap.get(key) ?? {
        ticketTypeId: key,
        name,
        sold: 0,
        refunded: 0,
        grossCents: 0,
        netCents: 0,
      };
      const share = Math.round(o.totalCents / Math.max(1, o.ticketNames.length || 1));
      const netShare = Math.round(o.netCents / Math.max(1, o.ticketNames.length || 1));
      entry.sold += o.status === 'refunded' ? 0 : 1;
      entry.refunded += o.status === 'refunded' ? 1 : 0;
      entry.grossCents += share;
      entry.netCents += netShare;
      byTierMap.set(key, entry);
    }
  }

  const dailyMap = new Map<string, { netCents: number; orders: number }>();
  for (const o of settled) {
    const date = o.purchasedAt.slice(0, 10);
    const entry = dailyMap.get(date) ?? { netCents: 0, orders: 0 };
    entry.netCents += o.netCents;
    entry.orders += 1;
    dailyMap.set(date, entry);
  }

  return {
    // One currency across the event. Taken from the data rather than assumed,
    // so a future EUR tier shows its own symbol instead of a wrong one.
    currency: settled[0]?.currency ?? 'usd',
    grossCents: sum(settled, (o) => o.totalCents),
    refundedCents: sum(settled, (o) => o.refundedCents),
    netCents: sum(settled, (o) => o.netCents),
    taxCents: sum(settled, (o) => o.taxCents),
    discountCents: sum(settled, (o) => o.discountCents),
    paidOrders: counted.length,
    refundedOrders,
    outstandingInvoices: outstanding.length,
    outstandingCents: sum(outstanding, (o) => o.totalCents),
    ticketsSold: sum(counted, (o) => o.seatCount),
    byTier: [...byTierMap.values()].sort((a, b) => b.netCents - a.netCents),
    daily: [...dailyMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    demoOrders,
  };
}

// ---------------------------------------------------------------------------
// Ticket types
// ---------------------------------------------------------------------------

export interface TicketTypeRow {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  tagline: string;
  visible: boolean;
  sortOrder: number;
  inPerson: boolean;
  featured: boolean;
  quantityTotal?: number;
  quantitySold: number;
  /**
   * Typed as the union, not as `string`. It decides which public page sells the
   * tier and which ledger an order lands in, so a widened type here means every
   * caller has to re-narrow it — and one of them will forget.
   */
  audience: TicketAudience;
  includes: string[];
  /**
   * Entitlements, not display copy. `attendees/ticket-session-mapping` derives
   * workshop access from `includesWorkshops` — deriving it by pattern-matching
   * the `includes` bullet list instead would grant access to any tier whose
   * prose happened to mention the word.
   */
  includesWorkshops: boolean;
  includesVideoLibrary: boolean;
  salesOpenAt?: string;
  salesCloseAt?: string;
}

function toTicketRow(id: string, t: TicketTypeDoc): TicketTypeRow {
  return {
    id,
    name: t.name,
    priceCents: t.priceCents,
    currency: t.currency,
    tagline: t.tagline ?? '',
    visible: t.visible !== false,
    sortOrder: t.sortOrder ?? 0,
    inPerson: t.inPerson ?? true,
    featured: t.featured ?? false,
    quantityTotal: t.quantityTotal,
    quantitySold: t.quantitySold ?? 0,
    audience: t.audience ?? 'attendee',
    includes: t.includes ?? [],
    includesWorkshops: t.includesWorkshops === true,
    includesVideoLibrary: t.includesVideoLibrary === true,
    salesOpenAt: iso(t.salesOpenAt),
    salesCloseAt: iso(t.salesCloseAt),
  };
}

export async function listTicketTypes(): Promise<TicketTypeRow[]> {
  const snap = await db()
    .collection(COLLECTIONS.ticketTypes)
    .where('eventId', '==', EVENT_ID)
    .get();
  return snap.docs
    .map((d) => toTicketRow(d.id, d.data() as TicketTypeDoc))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export async function getTicketType(id: string): Promise<WithId<TicketTypeDoc> | null> {
  const doc = await db().collection(COLLECTIONS.ticketTypes).doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as TicketTypeDoc;
  if (data.eventId !== EVENT_ID) return null;
  return { id: doc.id, ...data };
}

// ---------------------------------------------------------------------------
// Email log
// ---------------------------------------------------------------------------

export interface EmailRow {
  id: string;
  to: string;
  template: EmailLogDoc['template'];
  subject: string;
  status: EmailLogDoc['status'];
  error?: string;
  reason?: string;
  /**
   * The order a receipt belongs to, when it is a receipt.
   *
   * Absent on `bulk-message` rows, which is the distinction that matters: it is
   * the only way to tell an organizer's newsletter from a transactional receipt
   * without matching on the template name, and it is what lets a per-audience
   * confirmation log join through the order to the ticket type.
   */
  orderId?: string;
  at: string;
}

/**
 * Recent transactional email, newest first.
 *
 * Exists so "I never got my confirmation" has an answer other than a shrug.
 * Capped rather than paged: this is a diagnostic strip on the transaction
 * screen, not a mailbox.
 */
export async function recentEmails(limit = 100): Promise<EmailRow[]> {
  const snap = await db().collection(COLLECTIONS.emailLog).where('eventId', '==', EVENT_ID).get();
  return snap.docs
    .map((d) => {
      const e = d.data() as EmailLogDoc;
      return {
        id: d.id,
        to: e.to,
        template: e.template,
        subject: e.subject,
        status: e.status,
        error: e.error,
        reason: e.reason,
        orderId: e.orderId,
        at: iso(e.at) ?? new Date(0).toISOString(),
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

/** `119900` → `$1,199.00`. Cents shown here, unlike the public site: this is a ledger. */
export function money(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
