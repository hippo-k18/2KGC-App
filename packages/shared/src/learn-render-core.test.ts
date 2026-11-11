import { describe, expect, it } from "vitest";

import type { LearnBlock, LearnPageContent, LearnSection } from "./learn-page.js";
import { LEARN_EMBED_PROVIDERS } from "./learn-embed-core.js";
import { LEARN_PAGE_KITCHEN_SINK_V2 } from "./learn-page-sample.js";
import { parseLearnPageContent } from "./learn-page-view-core.js";
import {
  ANCHOR_RE,
  EMBED_DEFAULT_HEIGHT,
  EMBED_SANDBOX,
  LEARN_COLORS,
  SECTION_LAYOUT_COLUMNS,
  blockOptionClasses,
  colorHex,
  countdownParts,
  embedBox,
  headingIds,
  isAnchor,
  isColorToken,
  isDarkBackground,
  learnColor,
  parseColorValue,
  sectionColumns,
  sectionIsDark,
  sectionOptionClasses,
  tocEntries,
  videoEmbedSrc,
} from "./learn-render-core.js";

const section = (id: string, blocks: LearnBlock[], extra: Partial<LearnSection> = {}): LearnSection => ({
  id,
  label: id,
  background: "plain",
  width: "normal",
  paddingTop: "large",
  paddingBottom: "large",
  blocks,
  ...extra,
});
const pageOf = (...sections: LearnSection[]): LearnPageContent => ({ seoTitle: "T", seoDescription: "D", sections });
const heading = (id: string, text: string, extra: Partial<LearnBlock> = {}, level: 1 | 2 | 3 | 4 = 2): LearnBlock =>
  ({ id, kind: "heading", level, text, ...extra }) as LearnBlock;
const text = (id: string, t: string, extra: Partial<LearnBlock> = {}): LearnBlock => ({ id, kind: "text", text: t, ...extra }) as LearnBlock;
type Embed = Extract<LearnBlock, { kind: "embed" }>;
const embed = (extra: Partial<Embed>): Embed => ({ id: "e", kind: "embed", provider: "youtube", url: "", aspect: "16:9", title: "E", ...extra });

describe("colours", () => {
  it("knows exactly the brand names", () => {
    expect(Object.keys(LEARN_COLORS).sort()).toEqual(["blue", "dark", "grey", "light-blue", "navy", "orange", "teal", "white"]);
    expect(isColorToken("navy")).toBe(true);
    expect(isColorToken("light-blue")).toBe(true);
    expect(isColorToken("red")).toBe(false);
    expect(isColorToken("toString")).toBe(false);
    expect(isColorToken("__proto__")).toBe(false);
    expect(isColorToken(1)).toBe(false);
  });

  it("parses brand names and #rrggbb only, lower-casing hex", () => {
    expect(parseColorValue("navy")).toBe("navy");
    expect(parseColorValue("#ABCDEF")).toBe("#abcdef");
    expect(parseColorValue("#b82105")).toBe("#b82105");
    for (const bad of ["#abc", "red", "#abcdeg", "abcdef", "#abcdef0", " #abcdef", "rgb(0,0,0)", "var(--x)", "", null, undefined, 0xabcdef, {}]) {
      expect(parseColorValue(bad)).toBeUndefined();
    }
  });

  it("splits a colour into a token or a checked hex", () => {
    expect(learnColor(undefined)).toEqual({});
    expect(learnColor("teal")).toEqual({ token: "teal" });
    expect(learnColor("#B82105" as never)).toEqual({ hex: "#b82105" });
    expect(learnColor("#abc" as never)).toEqual({});
    expect(learnColor("red; background:url(x)" as never)).toEqual({});
  });

  it("gives every colour as hex", () => {
    expect(colorHex("navy")).toBe("#263759");
    expect(colorHex("white")).toBe("#ffffff");
    expect(colorHex("#EEF6FC" as never)).toBe("#eef6fc");
    expect(colorHex("#abc" as never)).toBeUndefined();
  });

  it("calls navy dark, white and #eef6fc light", () => {
    expect(isDarkBackground("navy")).toBe(true);
    expect(isDarkBackground("dark")).toBe(true);
    expect(isDarkBackground("teal")).toBe(true);
    expect(isDarkBackground("blue")).toBe(true);
    expect(isDarkBackground("white")).toBe(false);
    expect(isDarkBackground("grey")).toBe(false);
    expect(isDarkBackground("light-blue")).toBe(false);
    expect(isDarkBackground("#eef6fc")).toBe(false);
    expect(isDarkBackground("#000000")).toBe(true);
    expect(isDarkBackground(undefined)).toBe(false);
    expect(isDarkBackground("#zzz" as never)).toBe(false);
  });

  it("calls a section dark from its colour, or from a photo under an overlay of at least 0.3", () => {
    const img = { src: "/a.png", alt: "", width: 1, height: 1 };
    expect(sectionIsDark({ backgroundColor: "navy" })).toBe(true);
    expect(sectionIsDark({ backgroundColor: "#eef6fc" })).toBe(false);
    expect(sectionIsDark({})).toBe(false);
    expect(sectionIsDark({ backgroundImage: img, overlay: 0.55 })).toBe(true);
    expect(sectionIsDark({ backgroundImage: img, overlay: 0.3 })).toBe(true);
    expect(sectionIsDark({ backgroundImage: img, overlay: 0.29 })).toBe(false);
    expect(sectionIsDark({ backgroundImage: img })).toBe(false);
    expect(sectionIsDark({ backgroundImage: img, overlay: 0.1, backgroundColor: "navy" })).toBe(true);
    // An overlay with no photo darkens nothing.
    expect(sectionIsDark({ overlay: 0.8, backgroundColor: "white" })).toBe(false);
  });
});

describe("anchors", () => {
  it("accepts lower-case letters, digits and inner dashes, up to 64", () => {
    for (const ok of ["a", "rich-text", "a1", "1", "x".repeat(64), "a--b"]) expect(isAnchor(ok)).toBe(true);
    for (const bad of ["", "-a", "a-", "A", "a b", "a_b", "é", "x".repeat(65), "#a", 1, null]) expect(isAnchor(bad)).toBe(false);
    expect(ANCHOR_RE.test("ok")).toBe(true);
  });
});


describe("headingIds and tocEntries", () => {
  it("uses a heading's own anchor, else its slug, unique against every anchor on the page", () => {
    const content = pageOf(
      section("s1", [heading("h1", "Overview"), heading("h2", "Overview"), heading("h3", "Pricing", { anchor: "custom" }), text("t", "x", { anchor: "overview-2" })], { anchor: "pricing" }),
      section("s2", [heading("h4", "Pricing"), heading("h5", "Overview"), heading("h6", "!!!"), heading("h7", "!!!")]),
    );
    const ids = headingIds(content);
    expect(Object.fromEntries(ids)).toEqual({
      h1: "overview",
      h2: "overview-3",
      h3: "custom",
      h4: "pricing-2",
      h5: "overview-4",
      h6: "section",
      h7: "section-2",
    });
    expect(new Set(ids.values()).size).toBe(ids.size);
  });

  it("skips hidden sections and blocks, and non-headings", () => {
    const content = pageOf(
      section("s1", [heading("a", "A", { hidden: true }), text("t", "T"), heading("b", "B")]),
      section("s2", [heading("c", "C")], { hidden: true }),
    );
    expect(Object.fromEntries(headingIds(content))).toEqual({ b: "b" });
  });

  it("lists levels 2 to 4 in page order, without level 1 or hidden ones", () => {
    const content = pageOf(
      section("s1", [heading("t", "Title", {}, 1), heading("a", "First **bold**"), heading("b", "Sub", {}, 3), heading("x", "Hidden", { hidden: true })]),
      section("s2", [heading("c", "Deep", {}, 4)]),
      section("s3", [heading("d", "Gone")], { hidden: true }),
    );
    expect(tocEntries(content)).toEqual([
      { id: "first-bold", text: "First bold", level: 2 },
      { id: "sub", text: "Sub", level: 3 },
      { id: "deep", text: "Deep", level: 4 },
    ]);
  });

  it("uses the ids it is given, and drops a heading with no id", () => {
    const content = pageOf(section("s", [heading("a", "A"), heading("b", "B")]));
    expect(tocEntries(content, new Map([["a", "x"]]))).toEqual([{ id: "x", text: "A", level: 2 }]);
  });

  it("covers the v2 kitchen sink", () => {
    const content = parseLearnPageContent(LEARN_PAGE_KITCHEN_SINK_V2)!;
    const toc = tocEntries(content);
    expect(toc.find((e) => e.text === "Learn page v2 sample")).toBeUndefined();
    expect(toc[0]).toEqual({ id: "rich-text", text: "Rich text", level: 2 });
    expect(toc.map((e) => e.id)).toContain("image-and-text");
    expect(new Set(toc.map((e) => e.id)).size).toBe(toc.length);
    expect(headingIds(content).get("v2-h1")).toBe("learn-page-v2-sample");
  });
});

describe("countdownParts", () => {
  it("splits the time left into whole units", () => {
    const now = 1_000_000;
    const left = ((3 * 24 + 4) * 3600 + 5 * 60 + 6) * 1000 + 999;
    expect(countdownParts(now + left, now)).toEqual({ done: false, days: 3, hours: 4, minutes: 5, seconds: 6 });
    expect(countdownParts(now + 1000, now)).toEqual({ done: false, days: 0, hours: 0, minutes: 0, seconds: 1 });
    expect(countdownParts(now + 86_400_000, now)).toEqual({ done: false, days: 1, hours: 0, minutes: 0, seconds: 0 });
  });

  it("is done, and never negative, at or after the time", () => {
    const zero = { done: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
    expect(countdownParts(5000, 5000)).toEqual(zero);
    expect(countdownParts(5000, 5999 + 1)).toEqual(zero);
    expect(countdownParts(5000, 4500)).toEqual(zero);
    expect(countdownParts(0, 10 ** 12)).toEqual(zero);
  });
});

describe("embed frames", () => {
  it("has a default height for each of T315's providers, and never lets a frame navigate the page", () => {
    expect(LEARN_EMBED_PROVIDERS).toHaveLength(10);
    for (const p of LEARN_EMBED_PROVIDERS) expect(EMBED_DEFAULT_HEIGHT[p]).toBeGreaterThan(0);
    expect(EMBED_SANDBOX).not.toContain("allow-top-navigation");
  });
});

describe("videoEmbedSrc", () => {
  it("accepts http and https for v1 video blocks", () => {
    expect(videoEmbedSrc(new URL("http://youtu.be/dQw4w9WgXcQ"))).toEqual({ provider: "youtube", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
    expect(videoEmbedSrc(new URL("https://vimeo.com/76979871"))).toEqual({ provider: "vimeo", src: "https://player.vimeo.com/video/76979871?dnt=1" });
    expect(videoEmbedSrc(new URL("ftp://youtu.be/dQw4w9WgXcQ"))).toBeNull();
    expect(videoEmbedSrc(new URL("https://youtu.be/short"))).toBeNull();
    expect(videoEmbedSrc(new URL("https://example.com/dQw4w9WgXcQ"))).toBeNull();
  });
});

describe("embedBox", () => {
  it("gives a ratio, or a height for auto", () => {
    expect(embedBox(embed({ aspect: "16:9" }))).toEqual({ ratio: "16 / 9" });
    expect(embedBox(embed({ aspect: "4:3" }))).toEqual({ ratio: "4 / 3" });
    expect(embedBox(embed({ aspect: "1:1" }))).toEqual({ ratio: "1 / 1" });
    expect(embedBox(embed({ aspect: "auto", height: 360 }))).toEqual({ height: 360 });
    expect(embedBox(embed({ aspect: "auto", height: 360.6 }))).toEqual({ height: 361 });
    expect(embedBox(embed({ aspect: "auto", provider: "google-forms" }))).toEqual({ height: 900 });
    expect(embedBox(embed({ aspect: "auto", provider: "spotify", height: 50 }))).toEqual({ height: 352 });
    expect(embedBox(embed({ aspect: "auto", provider: "calendly", height: 5000 }))).toEqual({ height: 700 });
  });
});



describe("sectionColumns", () => {
  const blocks = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("knows each layout's column count", () => {
    expect(SECTION_LAYOUT_COLUMNS).toEqual({ single: 1, "two-equal": 2, "two-wide-left": 2, "two-wide-right": 2, three: 3 });
  });

  it("puts everything in one column with no layout", () => {
    expect(sectionColumns(undefined, blocks, { b: 1 })).toEqual([blocks]);
    expect(sectionColumns("single", blocks, undefined)).toEqual([blocks]);
  });

  it("splits by column, keeping page order", () => {
    expect(sectionColumns("three", blocks, { a: 2, b: 0, c: 1, d: 2 }).map((c) => c.map((b) => b.id))).toEqual([["b"], ["c"], ["a", "d"]]);
  });

  it("sends a missing, out-of-range or odd column to the first", () => {
    const cols = sectionColumns("two-equal", blocks, { a: 2, b: -1, c: 1.5, d: 1, ...({ x: 1 } as Record<string, number>) });
    expect(cols.map((c) => c.map((b) => b.id))).toEqual([["a", "b", "c"], ["d"]]);
    const odd = sectionColumns("two-wide-left", blocks, { a: "1" as unknown as number, b: Number.NaN, c: 1 });
    expect(odd.map((c) => c.map((b) => b.id))).toEqual([["a", "b", "d"], ["c"]]);
    expect(sectionColumns("two-wide-right", [], undefined)).toEqual([[], []]);
  });
});

describe("blockOptionClasses", () => {
  it("is empty with no options", () => {
    expect(blockOptionClasses({})).toEqual({ classes: [], color: undefined });
    expect(blockOptionClasses({ visibleOn: "all", boxed: false })).toEqual({ classes: [], color: undefined });
  });

  it("maps every option to its class", () => {
    expect(blockOptionClasses({ visibleOn: "desktop", maxWidth: "medium", boxed: true, textColor: "teal" })).toEqual({
      classes: ["lp-vis-desktop", "lp-mw-medium", "lp-boxed", "lp-tc-teal"],
      color: undefined,
    });
    expect(blockOptionClasses({ visibleOn: "mobile", textColor: "#B82105" as never })).toEqual({ classes: ["lp-vis-mobile", "lp-tc"], color: "#b82105" });
  });

  it("drops a colour that is not one", () => {
    expect(blockOptionClasses({ textColor: "red;x:y" as never })).toEqual({ classes: [], color: undefined });
  });
});

describe("sectionOptionClasses", () => {
  const img = { src: "/a.png", alt: "", width: 1, height: 1 };

  it("is empty with no options", () => {
    expect(sectionOptionClasses({})).toEqual({ classes: [], band: undefined });
    expect(sectionOptionClasses({ visibleOn: "all", layout: "single" })).toEqual({ classes: [], band: undefined });
  });

  it("paints a brand colour by class and a custom one by variable", () => {
    expect(sectionOptionClasses({ backgroundColor: "navy" })).toEqual({ classes: ["lp-bgc", "lp-bgc-navy", "lp-on-dark"], band: undefined });
    expect(sectionOptionClasses({ backgroundColor: "white" })).toEqual({ classes: ["lp-bgc", "lp-bgc-white"], band: undefined });
    expect(sectionOptionClasses({ backgroundColor: "#eef6fc" })).toEqual({ classes: ["lp-bgc"], band: "#eef6fc" });
    expect(sectionOptionClasses({ backgroundColor: "#000000" })).toEqual({ classes: ["lp-bgc", "lp-on-dark"], band: "#000000" });
    expect(sectionOptionClasses({ backgroundColor: "nope" as never })).toEqual({ classes: [], band: undefined });
  });

  it("marks a photo, its overlay, visibility and a layout", () => {
    expect(sectionOptionClasses({ visibleOn: "mobile", backgroundImage: img, overlay: 0.55, layout: "two-equal" })).toEqual({
      classes: ["lp-vis-mobile", "lp-has-bgimg", "lp-on-dark", "lp-has-layout"],
      band: undefined,
    });
    expect(sectionOptionClasses({ visibleOn: "desktop", backgroundImage: img, overlay: 0.1, layout: "three" })).toEqual({
      classes: ["lp-vis-desktop", "lp-has-bgimg", "lp-has-layout"],
      band: undefined,
    });
  });
});

