import { describe, expect, it } from "vitest";

import type { LearnBlock, LearnPageContent, LearnSection } from "./learn-page.js";
import { LEARN_LIBRARY_SAMPLE, LEARN_PAGE_KITCHEN_SINK_V2 } from "./learn-page-sample.js";
import { parseLearnPageContent, parseLearnSection } from "./learn-page-view-core.js";
import {
  ANCHOR_RE,
  EMBED_DEFAULT_HEIGHT,
  EMBED_PROVIDERS,
  EMBED_SANDBOX,
  LEARN_COLORS,
  SECTION_LAYOUT_COLUMNS,
  blockOptionClasses,
  colorHex,
  countdownParts,
  embedBox,
  embedSrc,
  expandReusableBlocks,
  headingIds,
  isAnchor,
  isColorToken,
  isDarkBackground,
  learnColor,
  parseColorValue,
  reusableIds,
  richPlainText,
  sectionColumns,
  sectionIsDark,
  sectionOptionClasses,
  slugifyAnchor,
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
const reusable = (id: string, libraryId: string): LearnBlock => ({ id, kind: "reusable", libraryId });
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

  it("slugifies accents, punctuation and case", () => {
    expect(slugifyAnchor("Héllo, Wörld!")).toBe("hello-world");
    expect(slugifyAnchor("François Scharffe")).toBe("francois-scharffe");
    expect(slugifyAnchor("  --What's new?--  ")).toBe("what-s-new");
    expect(slugifyAnchor("KGC | Learn & 2027")).toBe("kgc-learn-2027");
    expect(slugifyAnchor("!!!")).toBe("");
    expect(slugifyAnchor("日本語")).toBe("");
  });

  it("cuts at 60 characters and never ends on a dash", () => {
    expect(slugifyAnchor("a".repeat(100))).toBe("a".repeat(60));
    const cut = slugifyAnchor(`${"a".repeat(59)} bcd`);
    expect(cut).toBe("a".repeat(59));
    expect(isAnchor(cut)).toBe(true);
    for (const s of ["word ".repeat(30), "Aé ".repeat(40), "x-".repeat(50)]) {
      const slug = slugifyAnchor(s);
      expect(slug.length).toBeLessThanOrEqual(60);
      expect(isAnchor(slug)).toBe(true);
    }
  });
});

describe("richPlainText", () => {
  it("strips v1 Markdown and folds whitespace", () => {
    expect(richPlainText(undefined)).toBe("");
    expect(richPlainText("Meet the **KGC | Learn**\nTeam")).toBe("Meet the KGC | Learn Team");
    expect(richPlainText("A [link](/tickets) and *em* and `code`")).toBe("A link and em and code");
  });

  it("joins a document's words, with a space between blocks and for a line break", () => {
    expect(
      richPlainText({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "One" }, { type: "hardBreak" }, { type: "text", text: "two", marks: [{ type: "bold" }] }] },
          { type: "paragraph", content: [{ type: "text", text: "Three" }] },
          { type: "horizontalRule" },
          { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "four" }] }] }] },
        ],
      }),
    ).toBe("One two Three four");
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

describe("embedSrc", () => {
  it("lists ten providers, each with a default height", () => {
    expect(EMBED_PROVIDERS).toHaveLength(10);
    for (const p of EMBED_PROVIDERS) expect(EMBED_DEFAULT_HEIGHT[p]).toBeGreaterThan(0);
    expect(EMBED_SANDBOX).not.toContain("allow-top-navigation");
  });

  it("youtube", () => {
    const out = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10",
      "https://youtube.com/watch?v=dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "  https://youtu.be/dQw4w9WgXcQ  ",
    ]) {
      expect(embedSrc("youtube", url)).toBe(out);
    }
    for (const url of [
      "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      "https://evil.example/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=<script>",
      "https://www.youtube.com/watch/dQw4w9WgXcQ",
      "https://www.youtube.com/channel/dQw4w9WgXcQ",
      "javascript:alert(1)",
      "not a url",
      "https://vimeo.com/76979871",
    ]) {
      expect(embedSrc("youtube", url)).toBeNull();
    }
  });

  it("vimeo", () => {
    const out = "https://player.vimeo.com/video/76979871?dnt=1";
    expect(embedSrc("vimeo", "https://vimeo.com/76979871")).toBe(out);
    expect(embedSrc("vimeo", "https://www.vimeo.com/76979871")).toBe(out);
    expect(embedSrc("vimeo", "https://player.vimeo.com/video/76979871?h=abc")).toBe(out);
    expect(embedSrc("vimeo", "https://vimeo.com/channels/staffpicks/76979871")).toBe(out);
    for (const url of ["http://vimeo.com/76979871", "https://vimeo.com/about", "https://vimeo.com.evil.example/76979871", "https://youtu.be/dQw4w9WgXcQ"]) {
      expect(embedSrc("vimeo", url)).toBeNull();
    }
  });

  it("google-maps keeps only the embed address and its pb parameter", () => {
    const pb = "!1m18!1m12!1m3!1d3022.3!2d-73.98!3d40.75!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1";
    const out = `https://www.google.com/maps/embed?pb=${pb}`;
    expect(embedSrc("google-maps", `https://www.google.com/maps/embed?pb=${pb}`)).toBe(out);
    expect(embedSrc("google-maps", `https://google.com/maps/embed?pb=${pb}&extra=<x>`)).toBe(out);
    expect(embedSrc("google-maps", "https://www.google.com/maps/embed?pb=a:b*c")).toBe("https://www.google.com/maps/embed?pb=a:b*c");
    for (const url of [
      `http://www.google.com/maps/embed?pb=${pb}`,
      `https://maps.google.com/maps/embed?pb=${pb}`,
      `https://www.google.com.evil.example/maps/embed?pb=${pb}`,
      `https://www.google.com/maps/embed/extra?pb=${pb}`,
      "https://www.google.com/maps/place/Bryant+Park",
      "https://www.google.com/maps/embed",
      "https://www.google.com/maps/embed?pb=",
      "https://www.google.com/maps/embed?pb=a%22onload%3D",
      "https://www.google.com/maps/embed?pb=a<b",
    ]) {
      expect(embedSrc("google-maps", url)).toBeNull();
    }
  });

  it("google-forms", () => {
    expect(embedSrc("google-forms", "https://docs.google.com/forms/d/e/1FAIpQLSf_abc-123/viewform?usp=sf_link")).toBe(
      "https://docs.google.com/forms/d/e/1FAIpQLSf_abc-123/viewform?embedded=true",
    );
    expect(embedSrc("google-forms", "https://docs.google.com/forms/d/1AbC_def-9/edit")).toBe("https://docs.google.com/forms/d/1AbC_def-9/viewform?embedded=true");
    for (const url of [
      "http://docs.google.com/forms/d/e/abc/viewform",
      "https://docs.google.com.evil.example/forms/d/e/abc/viewform",
      "https://evil.example/forms/d/e/abc/viewform",
      "https://docs.google.com/forms/d/e",
      "https://docs.google.com/document/d/abc/edit",
      "https://docs.google.com/forms/x/abc",
      "https://docs.google.com/forms/d/a.b/edit",
      "javascript:alert(1)",
    ]) {
      expect(embedSrc("google-forms", url)).toBeNull();
    }
  });

  it("google-docs", () => {
    expect(embedSrc("google-docs", "https://docs.google.com/document/d/1AbC_def-9/edit?usp=sharing")).toBe("https://docs.google.com/document/d/1AbC_def-9/preview");
    expect(embedSrc("google-docs", "https://docs.google.com/document/d/e/2PACX-1vT/pub")).toBe("https://docs.google.com/document/d/e/2PACX-1vT/pub?embedded=true");
    for (const url of [
      "http://docs.google.com/document/d/abc/edit",
      "https://docs.google.com.evil.example/document/d/abc/edit",
      "https://docs.google.com/spreadsheets/d/abc/edit",
      "https://docs.google.com/document/abc",
      "https://docs.google.com/document/d/a%20b/edit",
    ]) {
      expect(embedSrc("google-docs", url)).toBeNull();
    }
  });

  it("google-slides", () => {
    expect(embedSrc("google-slides", "https://docs.google.com/presentation/d/1AbC_def-9/edit#slide=id.p")).toBe("https://docs.google.com/presentation/d/1AbC_def-9/embed");
    expect(embedSrc("google-slides", "https://docs.google.com/presentation/d/e/2PACX-1vT/pub?start=false")).toBe("https://docs.google.com/presentation/d/e/2PACX-1vT/embed");
    for (const url of [
      "http://docs.google.com/presentation/d/abc/edit",
      "https://docs.google.com.evil.example/presentation/d/abc/edit",
      "https://docs.google.com/document/d/abc/edit",
      "https://docs.google.com/presentation/abc",
    ]) {
      expect(embedSrc("google-slides", url)).toBeNull();
    }
  });

  it("calendly", () => {
    expect(embedSrc("calendly", "https://calendly.com/kgc")).toBe("https://calendly.com/kgc?hide_gdpr_banner=1");
    expect(embedSrc("calendly", "https://www.calendly.com/kgc/30min?month=2027-05")).toBe("https://calendly.com/kgc/30min?hide_gdpr_banner=1");
    for (const url of [
      "http://calendly.com/kgc",
      "https://calendly.com",
      "https://calendly.com/kgc/30min/extra",
      "https://calendly.com.evil.example/kgc",
      "https://evilcalendly.com/kgc",
      "https://calendly.com/k.g.c",
    ]) {
      expect(embedSrc("calendly", url)).toBeNull();
    }
  });

  it("typeform, including on a subdomain, never a lookalike", () => {
    const out = "https://form.typeform.com/to/AbC123";
    expect(embedSrc("typeform", "https://form.typeform.com/to/AbC123")).toBe(out);
    expect(embedSrc("typeform", "https://kgc.typeform.com/to/AbC123?typeform-source=x")).toBe(out);
    expect(embedSrc("typeform", "https://typeform.com/to/AbC123")).toBe(out);
    for (const url of [
      "http://form.typeform.com/to/AbC123",
      "https://typeform.com.evil.example/to/AbC123",
      "https://eviltypeform.com/to/AbC123",
      "https://evil-typeform.com/to/AbC123",
      "https://typeform.co/to/AbC123",
      "https://form.typeform.com/AbC123",
      "https://form.typeform.com/to/",
    ]) {
      expect(embedSrc("typeform", url)).toBeNull();
    }
  });

  it("loom", () => {
    const out = "https://www.loom.com/embed/abc123def";
    expect(embedSrc("loom", "https://www.loom.com/share/abc123def?sid=1")).toBe(out);
    expect(embedSrc("loom", "https://loom.com/embed/abc123def")).toBe(out);
    for (const url of ["http://www.loom.com/share/abc123def", "https://www.loom.com/looms/abc123def", "https://loom.com.evil.example/share/abc", "https://www.loom.com/share/"]) {
      expect(embedSrc("loom", url)).toBeNull();
    }
  });

  it("spotify", () => {
    expect(embedSrc("spotify", "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x")).toBe("https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC");
    expect(embedSrc("spotify", "https://open.spotify.com/embed/episode/abc")).toBe("https://open.spotify.com/embed/episode/abc");
    for (const kind of ["album", "playlist", "show", "artist"]) {
      expect(embedSrc("spotify", `https://open.spotify.com/${kind}/abc`)).toBe(`https://open.spotify.com/embed/${kind}/abc`);
    }
    for (const url of [
      "http://open.spotify.com/track/abc",
      "https://spotify.com/track/abc",
      "https://open.spotify.com.evil.example/track/abc",
      "https://open.spotify.com/user/abc",
      "https://open.spotify.com/track/abc/extra",
      "https://open.spotify.com/intl-de/track/abc",
      "https://open.spotify.com/track",
    ]) {
      expect(embedSrc("spotify", url)).toBeNull();
    }
  });

  it("refuses non-https schemes and garbage for every provider", () => {
    for (const p of EMBED_PROVIDERS) {
      for (const url of ["javascript:alert(1)", "data:text/html,<script>", "", "   ", "//evil.example/x", "ftp://docs.google.com/forms/d/abc"]) {
        expect(embedSrc(p, url)).toBeNull();
      }
    }
    expect(embedSrc("nope" as never, "https://youtu.be/dQw4w9WgXcQ")).toBeNull();
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

describe("expandReusableBlocks", () => {
  const lib = (): Record<string, LearnSection | undefined> => ({
    "lib-cta": parseLearnSection(LEARN_LIBRARY_SAMPLE["lib-cta"]),
    "lib-mixed": section("lib-mixed", [
      text("keep", "Kept", { anchor: "lib-anchor" }),
      text("hid", "Hidden", { hidden: true }),
      reusable("nested", "lib-cta"),
    ]),
    "lib-hidden": section("lib-hidden", [text("h", "H")], { hidden: true }),
    "lib-deleted": undefined,
  });

  it("returns the same object when there is nothing to expand", () => {
    const content = pageOf(section("s", [text("a", "A")]));
    expect(expandReusableBlocks(content, lib())).toBe(content);
    expect(expandReusableBlocks(content, new Map())).toBe(content);
  });

  it("replaces a reusable block with the library blocks, ids prefixed", () => {
    const untouched = section("s0", [text("x", "X")]);
    const content = pageOf(untouched, section("s1", [text("a", "A"), reusable("r1", "lib-cta"), text("b", "B")]));
    const out = expandReusableBlocks(content, lib());
    expect(out).not.toBe(content);
    expect(out.sections[0]).toBe(untouched);
    expect(out.sections[1]!.blocks.map((b) => b.id)).toEqual(["a", "r1--cta-h", "r1--cta-b", "b"]);
    expect(out.sections[1]!.blocks[1]).toMatchObject({ kind: "heading", text: "From the library: ready to start?" });
    // The input is not mutated.
    expect(content.sections[1]!.blocks.map((b) => b.id)).toEqual(["a", "r1", "b"]);
  });

  it("keeps ids unique when one library section is used twice", () => {
    const out = expandReusableBlocks(pageOf(section("s", [reusable("r1", "lib-cta"), reusable("r2", "lib-cta")])), lib());
    const ids = out.sections[0]!.blocks.map((b) => b.id);
    expect(ids).toEqual(["r1--cta-h", "r1--cta-b", "r2--cta-h", "r2--cta-b"]);
  });

  it("drops hidden inner blocks, inner anchors, and does not follow a nested reusable", () => {
    const out = expandReusableBlocks(pageOf(section("s", [reusable("r", "lib-mixed")])), lib());
    expect(out.sections[0]!.blocks).toHaveLength(1);
    expect(out.sections[0]!.blocks[0]).toMatchObject({ id: "r--keep", kind: "text" });
    expect(out.sections[0]!.blocks[0]!.anchor).toBeUndefined();
  });

  it("drops a block whose library entry is missing, deleted or hidden, and a section left empty", () => {
    const content = pageOf(
      section("s1", [reusable("a", "nope"), reusable("b", "lib-deleted"), reusable("c", "lib-hidden")]),
      section("s2", [text("t", "T"), reusable("d", "nope")]),
    );
    const out = expandReusableBlocks(content, lib());
    expect(out.sections.map((s) => s.id)).toEqual(["s2"]);
    expect(out.sections[0]!.blocks.map((b) => b.id)).toEqual(["t"]);
  });

  it("does not read the library object's prototype", () => {
    const out = expandReusableBlocks(pageOf(section("s", [text("t", "T"), reusable("r", "toString")])), {});
    expect(out.sections[0]!.blocks.map((b) => b.id)).toEqual(["t"]);
  });

  it("takes a Map as well as a record", () => {
    const out = expandReusableBlocks(pageOf(section("s", [reusable("r", "lib-cta")])), new Map(Object.entries(lib())));
    expect(out.sections[0]!.blocks.map((b) => b.id)).toEqual(["r--cta-h", "r--cta-b"]);
  });

  it("puts expanded blocks in the reusable block's column", () => {
    const content = pageOf(
      section("s", [text("a", "A"), reusable("r", "lib-cta")], { layout: "two-equal", blockColumn: { a: 0, r: 1 } }),
    );
    const before = { ...content.sections[0]!.blockColumn };
    const out = expandReusableBlocks(content, lib());
    expect(out.sections[0]!.blockColumn).toMatchObject({ a: 0, "r--cta-h": 1, "r--cta-b": 1 });
    expect(content.sections[0]!.blockColumn).toEqual(before);
    const cols = sectionColumns(out.sections[0]!.layout, out.sections[0]!.blocks, out.sections[0]!.blockColumn);
    expect(cols.map((c) => c.map((b) => b.id))).toEqual([["a"], ["r--cta-h", "r--cta-b"]]);
  });

  it("leaves blockColumn absent when the section had none", () => {
    const out = expandReusableBlocks(pageOf(section("s", [reusable("r", "lib-cta")])), lib());
    expect(out.sections[0]!.blockColumn).toBeUndefined();
  });

  it("expands the v2 kitchen sink with its library", () => {
    const content = parseLearnPageContent(LEARN_PAGE_KITCHEN_SINK_V2)!;
    expect(reusableIds(content)).toEqual(["lib-cta"]);
    const out = expandReusableBlocks(content, lib());
    expect(reusableIds(out)).toEqual([]);
    const ids = out.sections.flatMap((s) => s.blocks.map((b) => b.id));
    expect(ids).toContain("v2-reuse--cta-h");
    expect(ids).not.toContain("v2-reuse");
  });
});

describe("reusableIds", () => {
  it("lists each library id once, in page order", () => {
    const content = pageOf(section("s1", [reusable("a", "x"), text("t", "T"), reusable("b", "y")]), section("s2", [reusable("c", "x")]));
    expect(reusableIds(content)).toEqual(["x", "y"]);
    expect(reusableIds(pageOf(section("s", [text("t", "T")])))).toEqual([]);
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

describe("fixes found while testing", () => {
  it("refuses a Google Docs or Slides address with `e` and no id", () => {
    expect(embedSrc("google-docs", "https://docs.google.com/document/d/e")).toBeNull();
    expect(embedSrc("google-slides", "https://docs.google.com/presentation/d/e/")).toBeNull();
    expect(embedSrc("google-forms", "https://docs.google.com/forms/d/e//viewform")).toBeNull();
  });

  it("does not read a reusable block's column from the object prototype, and drops its own key", () => {
    const content: LearnPageContent = {
      seoTitle: "T",
      seoDescription: "",
      sections: [
        {
          id: "s",
          label: "S",
          background: "plain",
          width: "normal",
          paddingTop: "none",
          paddingBottom: "none",
          blockColumn: { r: 1 },
          blocks: [
            { id: "toString", kind: "reusable", libraryId: "L" },
            { id: "r", kind: "reusable", libraryId: "L" },
          ],
        },
      ],
    };
    const lib = { L: { id: "L", label: "", background: "plain", width: "normal", paddingTop: "none", paddingBottom: "none", blocks: [{ id: "x", kind: "divider" }] } as LearnSection };
    const out = expandReusableBlocks(content, lib).sections[0]!;
    expect(out.blockColumn).toEqual({ "r--x": 1 });
  });
});
