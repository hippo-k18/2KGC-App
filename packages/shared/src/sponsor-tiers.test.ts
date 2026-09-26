import { describe, expect, it } from "vitest";

import {
  DEFAULT_SPONSOR_TIERS,
  applyTierEdit,
  groupSponsorsByTier,
  resolveSponsorTiers,
  tierIdFromName,
  tierName,
} from "./sponsor-tiers.js";

const sponsors = [
  { name: "Zeta", tier: "gold" },
  { name: "Alpha", tier: "gold" },
  { name: "Stardog", tier: "platinum" },
  { name: "Legacy", tier: "startup" },
];

describe("resolveSponsorTiers", () => {
  it("falls back to the four defaults when nothing usable is stored", () => {
    expect(resolveSponsorTiers(undefined)).toEqual(DEFAULT_SPONSOR_TIERS);
    expect(resolveSponsorTiers([])).toEqual(DEFAULT_SPONSOR_TIERS);
    expect(resolveSponsorTiers([{ id: "", name: "x", size: 1 }, null])).toEqual(DEFAULT_SPONSOR_TIERS);
  });

  it("keeps stored order, drops repeats and clamps the size", () => {
    const out = resolveSponsorTiers([
      { id: "diamond", name: " Diamond ", size: 9 },
      { id: "gold", name: "Gold", size: 2 },
      { id: "diamond", name: "Again", size: 1 },
    ]);
    expect(out).toEqual([
      { id: "diamond", name: "Diamond", size: 1 },
      { id: "gold", name: "Gold", size: 2 },
    ]);
  });
});

describe("groupSponsorsByTier", () => {
  it("groups in tier order, sorts by name and keeps a sponsor on an unknown tier", () => {
    const groups = groupSponsorsByTier(DEFAULT_SPONSOR_TIERS, sponsors);
    expect(groups.map((g) => g.tier.id)).toEqual(["platinum", "gold", "startup"]);
    expect(groups[1].sponsors.map((s) => s.name)).toEqual(["Alpha", "Zeta"]);
    expect(groups[2].tier.name).toBe("Startup");
  });

  it("follows a reordered list and a renamed tier", () => {
    const tiers = [
      { id: "gold", name: "Headline", size: 3 },
      { id: "platinum", name: "Platinum", size: 2 },
    ];
    const groups = groupSponsorsByTier(tiers, sponsors);
    expect(groups[0].tier.name).toBe("Headline");
    expect(groups[0].sponsors).toHaveLength(2);
  });

  it("keeps empty tiers when asked", () => {
    expect(groupSponsorsByTier(DEFAULT_SPONSOR_TIERS, sponsors, { keepEmpty: true })).toHaveLength(5);
  });
});

describe("applyTierEdit", () => {
  it("adds a tier with an id minted from the name", () => {
    const res = applyTierEdit(DEFAULT_SPONSOR_TIERS, { op: "add", name: "Diamond Partner", size: 3 });
    expect(res.ok && res.tiers.at(-1)).toEqual({ id: "diamond-partner", name: "Diamond Partner", size: 3 });
  });

  it("refuses a repeated name and an empty one", () => {
    expect(applyTierEdit(DEFAULT_SPONSOR_TIERS, { op: "add", name: "gold", size: 1 }).ok).toBe(false);
    expect(applyTierEdit(DEFAULT_SPONSOR_TIERS, { op: "add", name: "  ", size: 1 }).ok).toBe(false);
  });

  it("renames without changing the id", () => {
    const res = applyTierEdit(DEFAULT_SPONSOR_TIERS, { op: "rename", id: "gold", name: "Headline", size: 3 });
    expect(res.ok && res.tiers[1]).toEqual({ id: "gold", name: "Headline", size: 3 });
  });

  it("moves a tier and ignores a move past either end", () => {
    const up = applyTierEdit(DEFAULT_SPONSOR_TIERS, { op: "move", id: "gold", dir: "up" });
    expect(up.ok && up.tiers.map((t) => t.id)).toEqual(["gold", "platinum", "silver", "bronze"]);
    const top = applyTierEdit(DEFAULT_SPONSOR_TIERS, { op: "move", id: "platinum", dir: "up" });
    expect(top.ok && top.tiers.map((t) => t.id)).toEqual(DEFAULT_SPONSOR_TIERS.map((t) => t.id));
  });

  it("refuses to remove a tier that still has sponsors", () => {
    const res = applyTierEdit(DEFAULT_SPONSOR_TIERS, { op: "remove", id: "gold", inUse: 2 });
    expect(res).toEqual({ ok: false, error: "2 sponsors are in this tier. Move them first." });
    expect(applyTierEdit(DEFAULT_SPONSOR_TIERS, { op: "remove", id: "bronze", inUse: 0 }).ok).toBe(true);
  });

  it("does not mutate the list it was given", () => {
    const before = JSON.stringify(DEFAULT_SPONSOR_TIERS);
    applyTierEdit(DEFAULT_SPONSOR_TIERS, { op: "rename", id: "gold", name: "X", size: 1 });
    expect(JSON.stringify(DEFAULT_SPONSOR_TIERS)).toBe(before);
  });
});

describe("names and ids", () => {
  it("slugs a name and title-cases an unknown id", () => {
    expect(tierIdFromName("  Café & Friends! ")).toBe("cafe-friends");
    expect(tierIdFromName("!!!")).toBe("");
    expect(tierName(DEFAULT_SPONSOR_TIERS, "gold")).toBe("Gold");
    expect(tierName(DEFAULT_SPONSOR_TIERS, "startup")).toBe("Startup");
  });
});
