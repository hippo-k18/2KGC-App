import { describe, expect, it } from "vitest";
import {
  MERCH_SEED,
  cleanMerchLines,
  encodeMerchChoice,
  merchLineLabel,
  merchPickupList,
  merchTotalCents,
  metadataProblem,
  priceMerchCart,
  toMerchItem,
  type MerchItem,
} from "./merch";

const items: MerchItem[] = MERCH_SEED.map((s) => toMerchItem(s.id, { ...s.doc, eventId: "kgc-2027", active: true }));

describe("priceMerchCart", () => {
  it("prices from the items, never from the post", () => {
    const r = priceMerchCart(
      [encodeMerchChoice({ itemId: "socks", quantity: 2 }), "tshirt|et-al|L|1|1"],
      items,
    );
    expect(r).toEqual({
      ok: true,
      lines: [
        { itemId: "socks", name: "KGC socks", quantity: 2, unitPriceCents: 1500 },
        { itemId: "tshirt", name: "T-shirt", optionId: "et-al", optionLabel: "Et al.", size: "L", quantity: 1, unitPriceCents: 3500 },
      ],
    });
    if (r.ok) expect(merchTotalCents(r.lines)).toBe(6500);
  });

  it("skips zero lines and merges repeats", () => {
    const r = priceMerchCart(["socks|||0", "tshirt|et-al|M|1", "tshirt|et-al|M|2"], items);
    expect(r.ok && r.lines).toEqual([
      { itemId: "tshirt", name: "T-shirt", optionId: "et-al", optionLabel: "Et al.", size: "M", quantity: 3, unitPriceCents: 3500 },
    ]);
  });

  it("refuses a missing design or size, an unknown item and a silly quantity", () => {
    expect(priceMerchCart(["tshirt||L|1"], items)).toMatchObject({ ok: false, error: /design/ });
    expect(priceMerchCart(["tshirt|et-al||1"], items)).toMatchObject({ ok: false, error: /size/ });
    expect(priceMerchCart(["tshirt|et-al|XXXL|1"], items)).toMatchObject({ ok: false, error: /size/ });
    expect(priceMerchCart(["mug|||1"], items)).toMatchObject({ ok: false });
    expect(priceMerchCart(["socks|||1.5"], items)).toMatchObject({ ok: false });
    expect(priceMerchCart(["socks|||-1"], items)).toMatchObject({ ok: false });
    expect(priceMerchCart(["socks|||11"], items)).toMatchObject({ ok: false });
  });

  it("refuses an item that is switched off (not in the list)", () => {
    expect(priceMerchCart(["socks|||1"], items.filter((i) => i.id !== "socks"))).toMatchObject({ ok: false });
  });

  it("allows a T-shirt with its size option removed", () => {
    const noSizes = items.map((i) => ({ ...i, sizes: [] }));
    expect(priceMerchCart(["tshirt|choose-on-site||1"], noSizes)).toMatchObject({ ok: true });
  });
});

describe("cleanMerchLines", () => {
  it("keeps good lines and drops malformed ones instead of throwing", () => {
    expect(
      cleanMerchLines([
        { itemId: "socks", name: "KGC socks", quantity: 2, unitPriceCents: 1500 },
        { itemId: "tshirt", name: "T-shirt", optionId: "et-al", optionLabel: "Et al.", size: "L", quantity: 1, unitPriceCents: 3500 },
        { itemId: "x", quantity: 1.5, unitPriceCents: 1 },
        { itemId: "", quantity: 1, unitPriceCents: 1 },
        { itemId: "y", quantity: 1, unitPriceCents: -1 },
        { itemId: "z", quantity: 1, unitPriceCents: 1, size: "XXXL" },
        null,
      ]),
    ).toEqual([
      { itemId: "socks", name: "KGC socks", quantity: 2, unitPriceCents: 1500 },
      { itemId: "tshirt", name: "T-shirt", optionId: "et-al", optionLabel: "Et al.", size: "L", quantity: 1, unitPriceCents: 3500 },
      { itemId: "z", name: "z", quantity: 1, unitPriceCents: 1 },
    ]);
    expect(cleanMerchLines(undefined)).toEqual([]);
    expect(cleanMerchLines("socks")).toEqual([]);
  });
});

describe("metadataProblem", () => {
  it("names the first Stripe limit broken", () => {
    expect(metadataProblem({ a: "x".repeat(500) })).toBeNull();
    expect(metadataProblem({ a: "x".repeat(501) })).toBe("a is 501 characters");
    expect(metadataProblem({ ["k".repeat(41)]: "x" })).toMatch(/too long/);
    expect(metadataProblem(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, "x"])))).toBe("51 keys");
  });
});

describe("merchPickupList", () => {
  const line = (size: "S" | "L", quantity: number) => ({
    itemId: "tshirt",
    name: "T-shirt",
    optionId: "et-al",
    optionLabel: "Et al.",
    size,
    quantity,
    unitPriceCents: 3500,
  });
  it("counts paid and partly refunded orders, per item, design and size", () => {
    const rows = merchPickupList([
      { status: "paid", merch: [line("L", 1), { itemId: "socks", name: "KGC socks", quantity: 2, unitPriceCents: 1500 }] },
      { status: "partially_refunded", merch: [line("L", 2), line("S", 1)] },
      { status: "refunded", merch: [line("L", 5)] },
      { status: "pending", merch: [line("L", 5)] },
      { status: "paid", channel: "demo", merch: [line("L", 5)] },
      { status: "paid" },
    ]);
    expect(rows).toEqual([
      { itemId: "socks", name: "KGC socks", quantity: 2 },
      { itemId: "tshirt", name: "T-shirt", optionLabel: "Et al.", size: "S", quantity: 1 },
      { itemId: "tshirt", name: "T-shirt", optionLabel: "Et al.", size: "L", quantity: 3 },
    ]);
  });
});

it("labels a line", () => {
  expect(merchLineLabel({ name: "T-shirt", optionLabel: "Et al.", size: "L" })).toBe("T-shirt (Et al., L)");
  expect(merchLineLabel({ name: "KGC socks" })).toBe("KGC socks");
});

it("seeds both items switched off, the T-shirt with three designs and S to XXL", () => {
  expect(MERCH_SEED.map((s) => [s.id, s.doc.priceCents, s.doc.active])).toEqual([
    ["socks", 1500, false],
    ["tshirt", 3500, false],
  ]);
  expect(MERCH_SEED[1]!.doc.options!.map((o) => o.label)).toEqual([
    "Et al.",
    "a little semantics goes a long way",
    "Choose on site",
  ]);
  expect(MERCH_SEED[1]!.doc.sizes).toEqual(["S", "M", "L", "XL", "XXL"]);
});
