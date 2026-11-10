import { describe, expect, it } from "vitest";
import {
  MERCH_SEED,
  MAX_MERCH_LINES,
  decodeMerchMetadata,
  encodeMerchChoice,
  encodeMerchMetadata,
  merchLineLabel,
  merchPickupList,
  merchTotalCents,
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

describe("metadata round trip", () => {
  it("survives Stripe and stays under the 500-character cap at the line limit", () => {
    const r = priceMerchCart(["socks|||2", "tshirt|a-little-semantics|XXL|1"], items);
    if (!r.ok) throw new Error(r.error);
    const value = encodeMerchMetadata(r.lines);
    const names = (id: string, opt?: string) => {
      const item = items.find((i) => i.id === id);
      return { name: item?.name, optionLabel: item?.options.find((o) => o.id === opt)?.label };
    };
    expect(decodeMerchMetadata(value, names)).toEqual(r.lines);

    const many = Array.from({ length: MAX_MERCH_LINES }, (_, i) => ({
      itemId: `item-with-a-long-slug-${i}`,
      name: "x",
      optionId: "a-little-semantics-goes-a-long-way",
      size: "XXL" as const,
      quantity: 10,
      unitPriceCents: 3500,
    }));
    expect(encodeMerchMetadata(many.slice(0, 6)).length).toBeLessThanOrEqual(500);
  });

  it("drops malformed lines instead of throwing", () => {
    expect(decodeMerchMetadata("socks~~~x~1500|~~~1~1|tshirt~et-al~L~1~3500")).toEqual([
      { itemId: "tshirt", name: "tshirt", optionId: "et-al", optionLabel: "et-al", size: "L", quantity: 1, unitPriceCents: 3500 },
    ]);
    expect(decodeMerchMetadata(undefined)).toEqual([]);
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
