import { describe, expect, it } from "vitest";

import {
  RESERVED_PAGE_SLUGS,
  normaliseSlug,
  slugProblem,
  sortPages,
} from "./custom-pages-core.js";

describe("normaliseSlug", () => {
  it("turns a title into an address", () => {
    expect(normaliseSlug("Wi-Fi & Power")).toBe("wi-fi-power");
    expect(normaliseSlug("  Getting here  ")).toBe("getting-here");
    expect(normaliseSlug("FAQ")).toBe("faq");
  });

  it("folds accents rather than dropping the letters", () => {
    expect(normaliseSlug("Café hours")).toBe("cafe-hours");
  });

  it("leaves no leading, trailing or doubled hyphen, even after truncation", () => {
    expect(normaliseSlug("--- hello --- world ---")).toBe("hello-world");
    expect(normaliseSlug(`${"a".repeat(59)} tail`)).toBe("a".repeat(59));
  });

  it("is idempotent", () => {
    const once = normaliseSlug("Getting to Roosevelt Island!");
    expect(normaliseSlug(once)).toBe(once);
  });
});

describe("slugProblem", () => {
  it("accepts an ordinary address", () => {
    expect(slugProblem("wifi")).toBeNull();
    expect(slugProblem("getting-here")).toBeNull();
  });

  it("refuses an address the website already answers", () => {
    expect(slugProblem("agenda")).toMatch(/already uses/);
    // Every reserved segment is one the site resolves before the dynamic route,
    // so none of them may be claimed.
    for (const reserved of RESERVED_PAGE_SLUGS) {
      expect(slugProblem(reserved)).not.toBeNull();
    }
  });

  it("refuses an address another page holds, and allows the page to keep its own", () => {
    expect(slugProblem("wifi", ["wifi", "travel"])).toMatch(/Another page/);
    expect(slugProblem("wifi", ["travel"])).toBeNull();
  });

  it("refuses shapes the router cannot serve", () => {
    expect(slugProblem("")).not.toBeNull();
    expect(slugProblem("a")).not.toBeNull();
    expect(slugProblem("Wi Fi")).not.toBeNull();
    expect(slugProblem("-wifi")).not.toBeNull();
    expect(slugProblem("wi--fi")).not.toBeNull();
  });
});

describe("sortPages", () => {
  it("orders by the organizer's number, then title, and treats a missing number as zero", () => {
    expect(
      sortPages([
        { title: "Travel", order: 2 },
        { title: "Zed" },
        { title: "Alpha" },
        { title: "Wi-Fi", order: 1 },
      ]).map((p) => p.title),
    ).toEqual(["Alpha", "Zed", "Wi-Fi", "Travel"]);
  });

  it("does not mutate its argument", () => {
    const input = [{ title: "B", order: 2 }, { title: "A", order: 1 }];
    sortPages(input);
    expect(input[0].title).toBe("B");
  });
});
