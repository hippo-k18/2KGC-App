import { describe, expect, it } from "vitest";

import { brandPalette, contrastRatio, legibleOnWhite, mixHex, readableOn, whiteTextPasses } from "./brand-theme.js";

describe("brandPalette", () => {
  it("returns null for anything that is not a six-digit hex", () => {
    for (const bad of ["", "#fff", "2069BC", "#GGGGGG", null, undefined, 7]) {
      expect(brandPalette(bad)).toBeNull();
    }
  });

  it("derives the text, dark and soft steps from one colour", () => {
    const p = brandPalette("#2069bc");
    expect(p).toEqual({
      brand: "#2069BC",
      onBrand: "#FFFFFF",
      brandDark: "#164A84",
      brandSoft: "#E0EAF6",
      brandText: "#2069BC",
    });
  });

  it("puts dark text on a pale brand colour and darkens it for use on white", () => {
    const p = brandPalette("#FFD400");
    expect(p?.onBrand).toBe("#111111");
    expect(contrastRatio(p!.brandText, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("colour maths", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });

  it("mixes, picks a readable ink and leaves a legible colour alone", () => {
    expect(mixHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(readableOn("#263759")).toBe("#FFFFFF");
    expect(legibleOnWhite("#263759")).toBe("#263759");
    expect(whiteTextPasses("#263759")).toBe(true);
    expect(whiteTextPasses("#8DCCEE")).toBe(false);
  });
});
