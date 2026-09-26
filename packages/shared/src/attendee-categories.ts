/**
 * Attendee categories as data: the list an organizer edits on Attendees ›
 * Categories, and the rule that turns a ticket type into one.
 *
 * ── A category is a label, not a role ───────────────────────────────────────
 *
 * `roles` is a custom claim, `firestore.rules` branches on it, and it is minted
 * by the three places that already mint it. A category decides nothing about
 * access: it is what prints on the badge, shows on the holder's profile and
 * filters a list. Keeping the two apart is what lets an organizer invent
 * "Press" without a rules review, and it means there is still exactly one
 * claims path.
 *
 * It lives on the **registration** (`categoryId`, plus `category` as the name
 * the app prints, because a phone cannot read this settings bag). One per
 * person: a badge has one band.
 *
 * Pure on purpose, like `sponsor-tiers.ts`. `ensureRegistration` in
 * `@kgc/scripts` and the dashboard both resolve a ticket type through
 * `categoryForTicket`, so a purchase, an import and a hand edit cannot disagree.
 */

/** The badge band colours. A closed set so a printed sheet stays legible. */
export const CATEGORY_COLORS = ["blue", "green", "orange", "red", "purple", "grey"] as const;
export type CategoryColor = (typeof CATEGORY_COLORS)[number];

/** Band and text colour per key. Hex here because a print sheet has no theme. */
export const CATEGORY_COLOR_HEX: Record<CategoryColor, { band: string; text: string }> = {
  blue: { band: "#2180B2", text: "#FFFFFF" },
  green: { band: "#2E7D4F", text: "#FFFFFF" },
  orange: { band: "#F68621", text: "#1A1A1A" },
  red: { band: "#B3261E", text: "#FFFFFF" },
  purple: { band: "#6B4FA1", text: "#FFFFFF" },
  grey: { band: "#5F6B7A", text: "#FFFFFF" },
};

/** One category. `id` is what a registration stores and is never regenerated. */
export interface AttendeeCategoryDef {
  id: string;
  name: string;
  color: CategoryColor;
}

/** "Anyone holding this ticket type is in this category." */
export interface TicketCategoryRule {
  /** `TicketTypeDoc.name` as the registration stores it. Matched with `ticketKey`. */
  ticketType: string;
  categoryId: string;
}

/** How a registration came by its category. A hand assignment outranks a rule. */
export type CategorySource = "manual" | "ticket";

export const DEFAULT_ATTENDEE_CATEGORIES: AttendeeCategoryDef[] = [
  { id: "speaker", name: "Speaker", color: "blue" },
  { id: "sponsor", name: "Sponsor", color: "orange" },
  { id: "staff", name: "Staff", color: "green" },
  { id: "press", name: "Press", color: "purple" },
  { id: "vip", name: "VIP", color: "red" },
];

export const MAX_ATTENDEE_CATEGORIES = 20;
export const MAX_CATEGORY_NAME = 30;

export function categoryColor(color: unknown): CategoryColor {
  return (CATEGORY_COLORS as readonly unknown[]).includes(color) ? (color as CategoryColor) : "grey";
}

/**
 * The stored list, or the defaults when it is missing or unusable.
 *
 * Same contract as `resolveSponsorTiers`: a row without an id or a name is
 * dropped and a repeated id keeps its first position.
 */
export function resolveAttendeeCategories(stored: unknown): AttendeeCategoryDef[] {
  if (!Array.isArray(stored)) return DEFAULT_ATTENDEE_CATEGORIES;
  const seen = new Set<string>();
  const out: AttendeeCategoryDef[] = [];
  for (const raw of stored) {
    if (!raw || typeof raw !== "object") continue;
    const { id, name, color } = raw as Record<string, unknown>;
    if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim()) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: name.trim(), color: categoryColor(color) });
  }
  return out.length > 0 ? out : DEFAULT_ATTENDEE_CATEGORIES;
}

/**
 * How a ticket type is compared. Case and spacing are folded because the same
 * tier arrives as "Main Conference" from checkout and "main conference " from a
 * spreadsheet, and a rule that misses one of them looks like a rule that works.
 */
export function ticketKey(ticketType: string | undefined): string {
  return (ticketType ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** The stored rules that still point at a category, one per ticket type. */
export function resolveTicketRules(
  stored: unknown,
  categories: readonly AttendeeCategoryDef[],
): TicketCategoryRule[] {
  if (!Array.isArray(stored)) return [];
  const known = new Set(categories.map((c) => c.id));
  const seen = new Set<string>();
  const out: TicketCategoryRule[] = [];
  for (const raw of stored) {
    if (!raw || typeof raw !== "object") continue;
    const { ticketType, categoryId } = raw as Record<string, unknown>;
    if (typeof ticketType !== "string" || typeof categoryId !== "string") continue;
    const key = ticketKey(ticketType);
    if (!key || !known.has(categoryId) || seen.has(key)) continue;
    seen.add(key);
    out.push({ ticketType: ticketType.trim(), categoryId });
  }
  return out;
}

/** The category a ticket type maps to, or `undefined` when no rule names it. */
export function categoryForTicket(
  categories: readonly AttendeeCategoryDef[],
  rules: readonly TicketCategoryRule[],
  ticketType: string | undefined,
): AttendeeCategoryDef | undefined {
  const key = ticketKey(ticketType);
  if (!key) return undefined;
  const rule = rules.find((r) => ticketKey(r.ticketType) === key);
  return rule ? categories.find((c) => c.id === rule.categoryId) : undefined;
}

/**
 * What a registration write should do about its category, given its ticket.
 *
 * `keep` when an organizer set it by hand, or when no rule names the ticket:
 * a rule that does not exist must not erase a label, and a repeat purchase must
 * not undo a hand edit.
 */
export function categoryFromRule(
  current: { categorySource?: CategorySource | string },
  categories: readonly AttendeeCategoryDef[],
  rules: readonly TicketCategoryRule[],
  ticketType: string | undefined,
): { categoryId: string; category: string; categorySource: "ticket" } | "keep" {
  if (current.categorySource === "manual") return "keep";
  const hit = categoryForTicket(categories, rules, ticketType);
  if (!hit) return "keep";
  return { categoryId: hit.id, category: hit.name, categorySource: "ticket" };
}

/** "Media Partner" → "media-partner". Empty when the name has no letters or digits. */
export function categoryIdFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export type CategoryEdit =
  | { op: "add"; name: string; color: string }
  | { op: "rename"; id: string; name: string; color: string }
  | { op: "remove"; id: string };

/**
 * Apply one edit to the list. Returns the new list or the reason it was refused.
 *
 * Ids are minted once from the first name and kept through every rename,
 * because registrations and ticket rules point at them. Removing a category in
 * use is allowed: the caller clears it from the people who held it.
 */
export function applyCategoryEdit(
  categories: readonly AttendeeCategoryDef[],
  edit: CategoryEdit,
): { ok: true; categories: AttendeeCategoryDef[] } | { ok: false; error: string } {
  const list = categories.map((c) => ({ ...c }));

  if (edit.op === "remove") {
    const at = list.findIndex((c) => c.id === edit.id);
    if (at === -1) return { ok: false, error: "That category no longer exists." };
    if (list.length === 1) return { ok: false, error: "Keep at least one category." };
    list.splice(at, 1);
    return { ok: true, categories: list };
  }

  const name = edit.name.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Give the category a name." };
  if (name.length > MAX_CATEGORY_NAME) {
    return { ok: false, error: `Keep the name under ${MAX_CATEGORY_NAME} characters.` };
  }
  const self = edit.op === "rename" ? edit.id : "";
  if (list.some((c) => c.id !== self && c.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: `There is already a category called ${name}.` };
  }

  if (edit.op === "rename") {
    const row = list.find((c) => c.id === edit.id);
    if (!row) return { ok: false, error: "That category no longer exists." };
    row.name = name;
    row.color = categoryColor(edit.color);
    return { ok: true, categories: list };
  }

  if (list.length >= MAX_ATTENDEE_CATEGORIES) {
    return { ok: false, error: `An event can have up to ${MAX_ATTENDEE_CATEGORIES} categories.` };
  }
  const base = categoryIdFromName(name);
  if (!base) return { ok: false, error: "Use letters or digits in the name." };
  let id = base;
  for (let n = 2; list.some((c) => c.id === id); n += 1) id = `${base}-${n}`;
  list.push({ id, name, color: categoryColor(edit.color) });
  return { ok: true, categories: list };
}

/**
 * Set or clear the rule for one ticket type. An empty `categoryId` clears it.
 */
export function applyTicketRule(
  categories: readonly AttendeeCategoryDef[],
  rules: readonly TicketCategoryRule[],
  ticketType: string,
  categoryId: string,
): { ok: true; rules: TicketCategoryRule[] } | { ok: false; error: string } {
  const label = ticketType.trim().replace(/\s+/g, " ");
  const key = ticketKey(label);
  if (!key) return { ok: false, error: "Choose a ticket type." };
  if (categoryId && !categories.some((c) => c.id === categoryId)) {
    return { ok: false, error: "That category no longer exists." };
  }
  const rest = rules.filter((r) => ticketKey(r.ticketType) !== key);
  return { ok: true, rules: categoryId ? [...rest, { ticketType: label, categoryId }] : rest };
}
