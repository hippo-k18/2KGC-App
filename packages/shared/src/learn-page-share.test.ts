import { describe, expect, it } from "vitest";

import { LEARN_PAGE_DEFAULT } from "./learn-page.js";
import { isPreviewTokenShape, parseLearnPageMeta, previewTokenMatches, readLearnPage } from "./learn-page-share.js";

const TOKEN = "Ab3_-".repeat(8) + "xyz";
const STORAGE =
  "https://firebasestorage.googleapis.com/v0/b/kgc.firebasestorage.app/o/pageLayouts%2Flearn%2Fog.webp?alt=media&token=t";

describe("parseLearnPageMeta", () => {
  it("keeps a valid sharing image and noindex", () => {
    expect(
      parseLearnPageMeta({ ogImage: { src: STORAGE, alt: "Class", width: 1200, height: 630 }, noindex: true }),
    ).toEqual({ ogImage: { src: STORAGE, alt: "Class", width: 1200, height: 630 }, noindex: true });
  });

  it("accepts a site asset and fills in a missing size", () => {
    expect(parseLearnPageMeta({ ogImage: { src: "/kgc/learn-wordmark.png" } }).ogImage).toEqual({
      src: "/kgc/learn-wordmark.png",
      alt: "",
      width: 1200,
      height: 630,
    });
  });

  it("drops anything malformed rather than failing", () => {
    expect(parseLearnPageMeta(null)).toEqual({});
    expect(parseLearnPageMeta({ noindex: "yes", ogImage: { src: "javascript:alert(1)" } })).toEqual({});
    expect(parseLearnPageMeta({ ogImage: { src: "//evil.example/x.png" } })).toEqual({});
    expect(parseLearnPageMeta({ ogImage: "x" })).toEqual({});
  });
});

describe("readLearnPage", () => {
  it("adds the meta to a usable page", () => {
    const page = readLearnPage({ ...LEARN_PAGE_DEFAULT, noindex: true });
    expect(page?.noindex).toBe(true);
    expect(page?.sections.length).toBe(LEARN_PAGE_DEFAULT.sections.length);
  });

  it("is null for something that is not a page", () => {
    expect(readLearnPage({ noindex: true })).toBeNull();
    expect(readLearnPage(undefined)).toBeNull();
  });
});

describe("preview token", () => {
  it("accepts exactly 43 base64url characters", () => {
    expect(TOKEN).toHaveLength(43);
    expect(isPreviewTokenShape(TOKEN)).toBe(true);
    expect(isPreviewTokenShape(TOKEN.slice(1))).toBe(false);
    expect(isPreviewTokenShape(TOKEN + "a")).toBe(false);
    expect(isPreviewTokenShape(TOKEN.slice(1) + "=")).toBe(false);
    expect(isPreviewTokenShape(undefined)).toBe(false);
  });

  it("matches only the same token", () => {
    expect(previewTokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(previewTokenMatches(TOKEN, TOKEN.slice(0, 42) + "q")).toBe(false);
    expect(previewTokenMatches(TOKEN, "q" + TOKEN.slice(1))).toBe(false);
  });

  it("matches nothing when no token is stored (never made, or revoked)", () => {
    expect(previewTokenMatches(undefined, TOKEN)).toBe(false);
    expect(previewTokenMatches("", "")).toBe(false);
    expect(previewTokenMatches(null, null)).toBe(false);
  });
});
