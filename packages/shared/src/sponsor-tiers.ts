/**
 * Sponsor tiers as data: the list an organizer edits on Sponsor Tiering, and
 * the grouping every surface applies to it.
 *
 * Tiers were a four-value union, which made "Diamond" a code change and a
 * release of the app. They are now `settings/sponsorTiers`, and the four that
 * used to be the union are the fallback, so an event that has never opened the
 * screen renders exactly as it did.
 *
 * Pure on purpose. The dashboard, the website and the app each fetch the list
 * their own way and all three group with the functions below, so the order on
 * a phone cannot differ from the order on the public page.
 */

/** One tier. `id` is what `SponsorDoc.tier` stores and is never regenerated. */
export interface SponsorTierDef {
  id: string;
  name: string;
  /** Logo size step on the public sponsor page. 3 is the largest. */
  size: number;
}

/** The tiers the live site sells, with the size weight its own widget uses. */
export const DEFAULT_SPONSOR_TIERS: SponsorTierDef[] = [
  { id: "platinum", name: "Platinum", size: 3 },
  { id: "gold", name: "Gold", size: 2 },
  { id: "silver", name: "Silver", size: 1 },
  { id: "bronze", name: "Bronze", size: 1 },
];

export const MAX_SPONSOR_TIERS = 12;
export const MAX_TIER_NAME = 40;

/** Clamp a stored size to the three steps the logo cards have. */
export function tierSize(size: unknown): 1 | 2 | 3 {
  return size === 3 ? 3 : size === 2 ? 2 : 1;
}

/**
 * The stored list, or the defaults when it is missing or unusable.
 *
 * Entries without an id or a name are dropped and a repeated id keeps its first
 * position, so one bad row cannot blank the sponsor page.
 */
export function resolveSponsorTiers(stored: unknown): SponsorTierDef[] {
  if (!Array.isArray(stored)) return DEFAULT_SPONSOR_TIERS;
  const seen = new Set<string>();
  const out: SponsorTierDef[] = [];
  for (const raw of stored) {
    if (!raw || typeof raw !== "object") continue;
    const { id, name, size } = raw as Record<string, unknown>;
    if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim()) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: name.trim(), size: tierSize(size) });
  }
  return out.length > 0 ? out : DEFAULT_SPONSOR_TIERS;
}

/** "Diamond Partner" → "diamond-partner". Empty when the name has no letters or digits. */
export function tierIdFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** The display name for a stored tier id, title-casing an id nobody has defined. */
export function tierName(tiers: readonly SponsorTierDef[], id: string): string {
  const hit = tiers.find((t) => t.id === id);
  if (hit) return hit.name;
  return id ? id[0].toUpperCase() + id.slice(1) : "";
}

/** Position of a tier in the list. Unknown tiers sort after every known one. */
export function tierRank(tiers: readonly SponsorTierDef[], id: string): number {
  const i = tiers.findIndex((t) => t.id === id);
  return i === -1 ? tiers.length : i;
}

export interface SponsorTierGroup<T> {
  tier: SponsorTierDef;
  sponsors: T[];
}

/**
 * Sponsors grouped in tier order, each group sorted by name.
 *
 * A sponsor whose tier is no longer in the list is not dropped: it lands in a
 * trailing group named after its stored id, at the smallest size. Deleting a
 * tier that still has sponsors is refused on the dashboard, so this is the
 * fallback for an import or an older document, not the normal path.
 */
export function groupSponsorsByTier<T extends { tier: string; name: string }>(
  tiers: readonly SponsorTierDef[],
  sponsors: readonly T[],
  opts: { keepEmpty?: boolean } = {},
): SponsorTierGroup<T>[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const groups: SponsorTierGroup<T>[] = tiers.map((tier) => ({
    tier,
    sponsors: sponsors.filter((s) => s.tier === tier.id).sort(byName),
  }));

  const known = new Set(tiers.map((t) => t.id));
  const strays = [...new Set(sponsors.filter((s) => !known.has(s.tier)).map((s) => s.tier))].sort();
  for (const id of strays) {
    groups.push({
      tier: { id, name: tierName([], id) || "Other", size: 1 },
      sponsors: sponsors.filter((s) => s.tier === id).sort(byName),
    });
  }

  return opts.keepEmpty ? groups : groups.filter((g) => g.sponsors.length > 0);
}

export type TierEdit =
  | { op: "add"; name: string; size: number }
  | { op: "rename"; id: string; name: string; size: number }
  | { op: "move"; id: string; dir: "up" | "down" }
  | { op: "remove"; id: string; inUse: number };

/**
 * Apply one edit to the list. Returns the new list or the reason it was refused.
 *
 * Ids are minted once from the first name and kept through every rename,
 * because `SponsorDoc.tier` points at them.
 */
export function applyTierEdit(
  tiers: readonly SponsorTierDef[],
  edit: TierEdit,
): { ok: true; tiers: SponsorTierDef[] } | { ok: false; error: string } {
  const list = tiers.map((t) => ({ ...t }));

  if (edit.op === "add" || edit.op === "rename") {
    const name = edit.name.trim();
    if (!name) return { ok: false, error: "Give the tier a name." };
    if (name.length > MAX_TIER_NAME) {
      return { ok: false, error: `Keep the tier name under ${MAX_TIER_NAME} characters.` };
    }
    const self = edit.op === "rename" ? edit.id : "";
    if (list.some((t) => t.id !== self && t.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: `There is already a tier called ${name}.` };
    }

    if (edit.op === "rename") {
      const row = list.find((t) => t.id === edit.id);
      if (!row) return { ok: false, error: "That tier no longer exists." };
      row.name = name;
      row.size = tierSize(edit.size);
      return { ok: true, tiers: list };
    }

    if (list.length >= MAX_SPONSOR_TIERS) {
      return { ok: false, error: `An event can have up to ${MAX_SPONSOR_TIERS} tiers.` };
    }
    const base = tierIdFromName(name);
    if (!base) return { ok: false, error: "Use letters or digits in the tier name." };
    let id = base;
    for (let n = 2; list.some((t) => t.id === id); n += 1) id = `${base}-${n}`;
    list.push({ id, name, size: tierSize(edit.size) });
    return { ok: true, tiers: list };
  }

  const at = list.findIndex((t) => t.id === edit.id);
  if (at === -1) return { ok: false, error: "That tier no longer exists." };

  if (edit.op === "move") {
    const to = edit.dir === "up" ? at - 1 : at + 1;
    if (to < 0 || to >= list.length) return { ok: true, tiers: list };
    [list[at], list[to]] = [list[to], list[at]];
    return { ok: true, tiers: list };
  }

  if (edit.inUse > 0) {
    return {
      ok: false,
      error: `${edit.inUse} sponsor${edit.inUse === 1 ? " is" : "s are"} in this tier. Move them first.`,
    };
  }
  if (list.length === 1) return { ok: false, error: "Keep at least one tier." };
  list.splice(at, 1);
  return { ok: true, tiers: list };
}
