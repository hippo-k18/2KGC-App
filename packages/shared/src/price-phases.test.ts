import { describe, expect, it } from "vitest";
import {
  buyerFeeCents,
  dayInZone,
  monthName,
  parsePricePhases,
  pricePhasesToText,
  priceNow,
  type PricePhase,
} from "./price-phases";

const NY = "America/New_York";

const ALL_ACCESS: PricePhase[] = [
  { name: "Super Early Bird", priceCents: 59_900, soldOut: true },
  { name: "Early Bird", priceCents: 69_900, startsOn: "2026-09-15" },
  { name: "Standard", priceCents: 89_900, startsOn: "2026-12-01" },
  { name: "Extended", priceCents: 109_900, startsOn: "2027-03-01" },
];

const CEU: PricePhase[] = [
  { name: "Super Early Bird", priceCents: 4_500, soldOut: true },
  { name: "Early Bird", startsOn: "2026-09-15", offSale: true },
  { name: "Standard", priceCents: 32_900, startsOn: "2026-12-01" },
  { name: "Extended", priceCents: 39_900, startsOn: "2027-03-01" },
];

const at = (iso: string) => new Date(iso);

describe("priceNow", () => {
  it("sells a ticket without phases at its flat price", () => {
    expect(priceNow({ priceCents: 19_900 }, at("2026-10-01T12:00:00Z"), NY)).toEqual({
      priceCents: 19_900,
      onSale: true,
      earlier: [],
    });
  });

  it("charges Early Bird in October, with Super Early Bird struck through and a December rise", () => {
    const p = priceNow({ priceCents: 1, pricePhases: ALL_ACCESS }, at("2026-10-01T12:00:00Z"), NY);
    expect(p.priceCents).toBe(69_900);
    expect(p.phase).toBe("Early Bird");
    expect(p.onSale).toBe(true);
    expect(p.earlier).toEqual([{ name: "Super Early Bird", priceCents: 59_900, soldOut: true }]);
    expect(p.risesOn).toBe("2026-12-01");
  });

  it("changes phase at midnight New York time, not midnight UTC", () => {
    // 04:59 UTC on 1 Dec is 23:59 on 30 Nov in New York.
    expect(priceNow({ priceCents: 1, pricePhases: ALL_ACCESS }, at("2026-12-01T04:59:00Z"), NY).phase).toBe(
      "Early Bird",
    );
    expect(priceNow({ priceCents: 1, pricePhases: ALL_ACCESS }, at("2026-12-01T05:00:00Z"), NY).phase).toBe(
      "Standard",
    );
  });

  it("charges Standard in December and lists both earlier phases", () => {
    const p = priceNow({ priceCents: 1, pricePhases: ALL_ACCESS }, at("2026-12-15T12:00:00Z"), NY);
    expect(p.priceCents).toBe(89_900);
    expect(p.earlier.map((e) => e.name)).toEqual(["Super Early Bird", "Early Bird"]);
    expect(p.earlier[1].soldOut).toBe(false);
  });

  it("says nothing about a rise in the last phase", () => {
    const p = priceNow({ priceCents: 1, pricePhases: ALL_ACCESS }, at("2027-04-01T12:00:00Z"), NY);
    expect(p.phase).toBe("Extended");
    expect(p.risesOn).toBeUndefined();
  });

  it("keeps an off-sale phase off sale, then sells the next phase on its day", () => {
    const oct = priceNow({ priceCents: 1, pricePhases: CEU }, at("2026-10-01T12:00:00Z"), NY);
    expect(oct.onSale).toBe(false);
    expect(oct.unavailableReason).toBe("Not on sale yet");
    const dec = priceNow({ priceCents: 1, pricePhases: CEU }, at("2026-12-01T12:00:00Z"), NY);
    expect(dec).toMatchObject({ onSale: true, priceCents: 32_900, phase: "Standard" });
  });

  it("is not on sale before the first phase starts", () => {
    const p = priceNow({ priceCents: 1, pricePhases: ALL_ACCESS }, at("2026-09-01T12:00:00Z"), NY);
    expect(p.onSale).toBe(false);
    expect(p.priceCents).toBe(69_900);
  });

  it("is sold out when every started phase is sold out and nothing is ahead", () => {
    const p = priceNow(
      { priceCents: 1, pricePhases: [{ name: "Only", priceCents: 100, startsOn: "2026-01-01", soldOut: true }] },
      at("2026-10-01T12:00:00Z"),
      NY,
    );
    expect(p).toMatchObject({ onSale: false, unavailableReason: "Sold out" });
  });
});

describe("the dashboard text box", () => {
  it("round-trips the grid", () => {
    const text = pricePhasesToText(CEU);
    expect(text).toBe(
      [
        "Super Early Bird: 45, sold out",
        "Early Bird: from 2026-09-15, off sale",
        "Standard: 329, from 2026-12-01",
        "Extended: 399, from 2027-03-01",
      ].join("\n"),
    );
    expect(parsePricePhases(text)).toEqual({ ok: true, phases: CEU });
  });

  it("accepts dollar signs and thousands separators", () => {
    const r = parsePricePhases("Extended: $1,099, from 2027-03-01");
    expect(r).toEqual({ ok: true, phases: [{ name: "Extended", priceCents: 109_900, startsOn: "2027-03-01" }] });
  });

  it("refuses a phase with neither a price nor off sale", () => {
    expect(parsePricePhases("Early Bird: from 2026-09-15")).toMatchObject({ ok: false });
  });

  it("refuses a phase with neither a date nor sold out", () => {
    expect(parsePricePhases("Early Bird: 699")).toMatchObject({ ok: false });
  });

  it("refuses dates out of order", () => {
    const r = parsePricePhases("Standard: 899, from 2026-12-01\nEarly Bird: 699, from 2026-09-15");
    expect(r).toMatchObject({ ok: false, error: "Early Bird must start after Standard." });
  });

  it("refuses a day that does not exist", () => {
    expect(parsePricePhases("Standard: 899, from 2027-02-30")).toEqual({
      ok: false,
      error: "Line 1: 2027-02-30 is not a real date.",
    });
    expect(parsePricePhases("Standard: 899, from 2026-13-01")).toMatchObject({ ok: false });
    expect(parsePricePhases("Leap: 899, from 2028-02-29")).toMatchObject({ ok: true });
  });

  it("refuses a word it does not know rather than guessing", () => {
    expect(parsePricePhases("Early Bird: 699, from 2026-09-15, soon")).toMatchObject({ ok: false });
  });
});

describe("helpers", () => {
  it("names the month a rise happens in", () => {
    expect(monthName("2026-12-01")).toBe("December");
  });

  it("reads the calendar day in the zone", () => {
    expect(dayInZone(at("2026-12-01T03:00:00Z"), NY)).toBe("2026-11-30");
  });

  it("works out the buyer fee to the cent", () => {
    expect(buyerFeeCents(59_900)).toBe(3_738);
    expect(buyerFeeCents(0)).toBe(0);
  });
});
