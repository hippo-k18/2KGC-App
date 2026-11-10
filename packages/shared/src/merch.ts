/**
 * Merch: socks and T-shirts sold beside a ticket, and to ticket holders on
 * `/tickets/merch` (T380). Everything is picked up at the conference.
 *
 * Pure, so the website's checkout, its webhook and the dashboard's pickup list
 * all read a cart the same way, and so it can be tested without Firestore.
 *
 * ── Why the cart is kept on our side, not in Stripe metadata ──────────────
 *
 * A metadata value is capped at 500 characters and a session at 50 keys. The
 * first version put the whole cart in one value, which held for the seeded
 * ids and broke for an organizer's own long item and design names: six
 * lines of a hoodie with long design names passed 500 and Stripe refused the
 * checkout (T386 D1). So the priced cart is written to `merchCarts/{ref}`
 * before the redirect, as a group's seat list is, and the session carries only
 * `merchRef` and `merchCents`. Its own collection rather than a pending order,
 * so a single-seat purchase still writes no order before payment (the
 * abandoned-checkout reminder reads pending orders). The unit price that
 * reaches the webhook is the one the server charged, not one the browser
 * posted.
 */

/** The sizes a shirt can offer. An item lists the ones it actually has. */
export const MERCH_SIZES = ["S", "M", "L", "XL", "XXL"] as const;
export type MerchSize = (typeof MERCH_SIZES)[number];

/** Most of one line a buyer can take. A box of socks is not a cart. */
export const MAX_MERCH_QUANTITY = 10;
/** Lines on one purchase. A cart, not a stock list. */
export const MAX_MERCH_LINES = 12;

export const MERCH_PICKUP_NOTE = "Picked up at the conference, no shipping.";

/** One design a buyer chooses between, such as a T-shirt print. */
export interface MerchOption {
  /** A slug, assigned once; it is what a sold line records. */
  id: string;
  label: string;
}

/** `merchItems/{id}`. Managed on the dashboard, Tickets › Ticket Add-ons. */
export interface MerchItemDoc {
  eventId: string;
  name: string;
  /** Minor units, as every price here is. */
  priceCents: number;
  currency: string;
  /** Optional until the mock-ups arrive; the site shows a placeholder. */
  imageUrl?: string;
  /** Designs to choose between. Empty or absent: nothing to choose. */
  options?: MerchOption[];
  /** Sizes offered, from `MERCH_SIZES`. Empty or absent: one size. */
  sizes?: MerchSize[];
  /** Shown and sold only while on. Seeded off. */
  active: boolean;
  /** Display order, smallest first. */
  sort?: number;
}

/** An item as the website shows it. */
export interface MerchItem {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  imageUrl?: string;
  options: MerchOption[];
  sizes: MerchSize[];
}

/** A line sold: what the pickup desk hands over. */
export interface MerchLine {
  itemId: string;
  /** Denormalised: the item may be renamed or deleted after the sale. */
  name: string;
  optionId?: string;
  optionLabel?: string;
  size?: MerchSize;
  quantity: number;
  unitPriceCents: number;
}

export function toMerchItem(id: string, doc: MerchItemDoc): MerchItem {
  return {
    id,
    name: doc.name,
    priceCents: doc.priceCents,
    currency: doc.currency || "usd",
    ...(doc.imageUrl ? { imageUrl: doc.imageUrl } : {}),
    options: (doc.options ?? []).filter((o) => o.id && o.label),
    sizes: (doc.sizes ?? []).filter((s): s is MerchSize => (MERCH_SIZES as readonly string[]).includes(s)),
  };
}

/** `a little semantics goes a long way` → `a-little-semantics-goes-a-long-way`. */
export function merchSlug(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** "T-shirt (Et al., L)". */
export function merchLineLabel(line: Pick<MerchLine, "name" | "optionLabel" | "size">): string {
  const detail = [line.optionLabel, line.size].filter(Boolean).join(", ");
  return detail ? `${line.name} (${detail})` : line.name;
}

export function merchTotalCents(lines: readonly Pick<MerchLine, "quantity" | "unitPriceCents">[]): number {
  return lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);
}

/**
 * What a form posts for one line: `itemId|optionId|size|quantity`, one hidden
 * input per line. Ids only, never a price.
 */
export function encodeMerchChoice(c: { itemId: string; optionId?: string; size?: string; quantity: number }): string {
  return [c.itemId, c.optionId ?? "", c.size ?? "", String(c.quantity)].join("|");
}

export type MerchCartResult = { ok: true; lines: MerchLine[] } | { ok: false; error: string };

/**
 * Turn posted choices into priced lines, against the items on sale now.
 *
 * Refuses rather than drops: a buyer who chose a size the dashboard has just
 * removed should be told, not charged for a cart that silently lost a shirt.
 * Two posts of the same item, design and size are one line.
 */
export function priceMerchCart(posted: readonly string[], items: readonly MerchItem[]): MerchCartResult {
  const byId = new Map(items.map((i) => [i.id, i]));
  const lines: MerchLine[] = [];
  for (const raw of posted) {
    const [itemId = "", optionId = "", size = "", qty = ""] = String(raw).split("|");
    if (!itemId && !qty) continue;
    const quantity = Number(qty);
    if (!Number.isInteger(quantity) || quantity < 0) return { ok: false, error: "Choose a quantity for each item." };
    if (quantity === 0) continue;
    const item = byId.get(itemId);
    if (!item) return { ok: false, error: "One of the items is no longer available. Nothing was charged." };
    let option: MerchOption | undefined;
    if (item.options.length > 0) {
      option = item.options.find((o) => o.id === optionId);
      if (!option) return { ok: false, error: `Choose a design for the ${item.name}.` };
    }
    let chosenSize: MerchSize | undefined;
    if (item.sizes.length > 0) {
      chosenSize = item.sizes.find((s) => s === size);
      if (!chosenSize) return { ok: false, error: `Choose a size for the ${item.name}.` };
    }
    const same = lines.find((l) => l.itemId === item.id && l.optionId === option?.id && l.size === chosenSize);
    if (same) same.quantity += quantity;
    else
      lines.push({
        itemId: item.id,
        name: item.name,
        ...(option ? { optionId: option.id, optionLabel: option.label } : {}),
        ...(chosenSize ? { size: chosenSize } : {}),
        quantity,
        unitPriceCents: item.priceCents,
      });
  }
  if (lines.some((l) => l.quantity > MAX_MERCH_QUANTITY)) {
    return { ok: false, error: `Up to ${MAX_MERCH_QUANTITY} of each item.` };
  }
  if (lines.length > MAX_MERCH_LINES) return { ok: false, error: `Up to ${MAX_MERCH_LINES} different items.` };
  return { ok: true, lines };
}

/** `merchCarts/{ref}`: the priced cart a Checkout session points at (T387). */
export interface MerchCartDoc {
  eventId: string;
  lines: MerchLine[];
  merchCents: number;
}

/** Stripe's documented metadata limits. */
export const STRIPE_METADATA_LIMITS = { keys: 50, keyLength: 40, valueLength: 500 } as const;

/** The first limit a metadata object breaks, or null when Stripe will take it. */
export function metadataProblem(metadata: Record<string, string>): string | null {
  const entries = Object.entries(metadata);
  if (entries.length > STRIPE_METADATA_LIMITS.keys) return `${entries.length} keys`;
  for (const [k, v] of entries) {
    if (k.length > STRIPE_METADATA_LIMITS.keyLength) return `key ${k} is too long`;
    if (String(v).length > STRIPE_METADATA_LIMITS.valueLength) return `${k} is ${String(v).length} characters`;
  }
  return null;
}

/**
 * Lines read back from `merchCarts`. Our own document, but checked line by
 * line so a hand-edited one cannot throw in the webhook.
 */
export function cleanMerchLines(raw: unknown): MerchLine[] {
  if (!Array.isArray(raw)) return [];
  const out: MerchLine[] = [];
  for (const l of raw as Partial<MerchLine>[]) {
    if (!l || typeof l.itemId !== "string" || !l.itemId) continue;
    if (!Number.isInteger(l.quantity) || (l.quantity as number) <= 0) continue;
    if (!Number.isInteger(l.unitPriceCents) || (l.unitPriceCents as number) < 0) continue;
    out.push({
      itemId: l.itemId,
      name: typeof l.name === "string" && l.name ? l.name : l.itemId,
      ...(typeof l.optionId === "string" && l.optionId
        ? { optionId: l.optionId, optionLabel: typeof l.optionLabel === "string" ? l.optionLabel : l.optionId }
        : {}),
      ...(typeof l.size === "string" && (MERCH_SIZES as readonly string[]).includes(l.size) ? { size: l.size as MerchSize } : {}),
      quantity: l.quantity as number,
      unitPriceCents: l.unitPriceCents as number,
    });
  }
  return out;
}

/** One row of the pickup list: how many of this item, design and size to hand over. */
export interface PickupRow {
  itemId: string;
  name: string;
  optionLabel?: string;
  size?: MerchSize;
  quantity: number;
}

/**
 * What the merch desk needs, from orders. Fully refunded, cancelled and
 * pending orders hand over nothing; a partial refund still does, as it keeps
 * a ticket valid. Demo orders are left out.
 */
export function merchPickupList(
  orders: readonly { status: string; channel?: string; merch?: readonly MerchLine[] }[],
): PickupRow[] {
  const rows = new Map<string, PickupRow>();
  for (const o of orders) {
    if (o.status !== "paid" && o.status !== "partially_refunded") continue;
    if (o.channel === "demo") continue;
    for (const l of o.merch ?? []) {
      const key = [l.itemId, l.optionId ?? "", l.size ?? ""].join("|");
      const row = rows.get(key);
      if (row) row.quantity += l.quantity;
      else
        rows.set(key, {
          itemId: l.itemId,
          name: l.name,
          ...(l.optionLabel ? { optionLabel: l.optionLabel } : {}),
          ...(l.size ? { size: l.size } : {}),
          quantity: l.quantity,
        });
    }
  }
  const sizeRank = (s?: string) => (s ? MERCH_SIZES.indexOf(s as MerchSize) : -1);
  return [...rows.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      (a.optionLabel ?? "").localeCompare(b.optionLabel ?? "") ||
      sizeRank(a.size) - sizeRank(b.size),
  );
}

/** The two starter items, seeded off until prices are confirmed (Chase, 2026-11-09). */
export const MERCH_SEED: { id: string; doc: Omit<MerchItemDoc, "eventId"> }[] = [
  {
    id: "socks",
    doc: { name: "KGC socks", priceCents: 1500, currency: "usd", options: [], sizes: [], active: false, sort: 1 },
  },
  {
    id: "tshirt",
    doc: {
      name: "T-shirt",
      priceCents: 3500,
      currency: "usd",
      options: [
        { id: "et-al", label: "Et al." },
        { id: "a-little-semantics", label: "a little semantics goes a long way" },
        { id: "choose-on-site", label: "Choose on site" },
      ],
      sizes: ["S", "M", "L", "XL", "XXL"],
      active: false,
      sort: 2,
    },
  },
];
