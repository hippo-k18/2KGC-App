import { describe, expect, it } from "vitest";

import { LEARN_PAGE_DEFAULT, type LearnBlock } from "./learn-page.js";
import { LEARN_PAGE_KITCHEN_SINK } from "./learn-page-sample.js";
import {
  focalPosition,
  hasLearnImage,
  isDrawableLearnBlock,
  isLearnImageSrc,
  learnPageOrDefault,
  learnRichParagraphs,
  parseLearnPageContent,
  videoEmbed,
} from "./learn-page-view-core.js";

const page = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({
  seoTitle: "T",
  seoDescription: "D",
  sections: [{ id: "s", label: "S", background: "plain", width: "normal", paddingTop: "large", paddingBottom: "large", blocks, ...extra }],
});
const blocksOf = (v: unknown): LearnBlock[] => parseLearnPageContent(v)?.sections[0]?.blocks ?? [];

describe("LEARN_PAGE_DEFAULT", () => {
  it("validates, and parsing it changes nothing", () => {
    expect(parseLearnPageContent(LEARN_PAGE_DEFAULT)).toEqual(LEARN_PAGE_DEFAULT);
  });

  it("has today's four bands, three founders and six roster names", () => {
    expect(LEARN_PAGE_DEFAULT.sections.map((s) => s.id)).toEqual(["hero", "team", "continuing-education", "programmes"]);
    const people = LEARN_PAGE_DEFAULT.sections.flatMap((s) => s.blocks).filter((b) => b.kind === "people");
    expect(people.map((b) => (b.kind === "people" ? b.people.length : 0))).toEqual([3, 6]);
  });

  it("survives a JSON round trip, which is what Firestore and the cache do to it", () => {
    expect(parseLearnPageContent(JSON.parse(JSON.stringify(LEARN_PAGE_DEFAULT)))).toEqual(LEARN_PAGE_DEFAULT);
  });
});

describe("parseLearnPageContent", () => {
  it("refuses a document that is not a page", () => {
    for (const bad of [null, undefined, 42, "x", [], {}, { seoTitle: 42, sections: "nope" }, { seoTitle: "T" }, { seoTitle: "T", sections: [] }]) {
      expect(parseLearnPageContent(bad)).toBeNull();
      expect(learnPageOrDefault(bad)).toBe(LEARN_PAGE_DEFAULT);
    }
  });

  it("refuses a page whose every section is hidden or empty", () => {
    expect(parseLearnPageContent(page([{ id: "a", kind: "text", text: "x" }], { hidden: true }))).toBeNull();
    expect(parseLearnPageContent(page([]))).toBeNull();
  });

  it("drops hidden blocks and kinds it does not know, keeping the rest", () => {
    const blocks = blocksOf(page([
      { id: "a", kind: "text", text: "kept" },
      { id: "b", kind: "text", text: "hidden", hidden: true },
      { id: "c", kind: "carousel", slides: [] },
    ]));
    expect(blocks.map((b) => b.id)).toEqual(["a"]);
  });

  it("falls back to defaults for unknown options instead of failing", () => {
    const parsed = parseLearnPageContent(page([{ id: "a", kind: "image", image: { src: "/a.png", alt: "", width: 10, height: 10 }, width: "huge", shape: "star" }], { background: "red", width: "giant" }));
    expect(parsed?.sections[0]).toMatchObject({ background: "plain", width: "normal" });
    expect(parsed?.sections[0]?.blocks[0]).toMatchObject({ width: "medium", shape: "original" });
  });

  it("never lets an unsafe link or image source through", () => {
    const blocks = blocksOf(page([
      { id: "a", kind: "buttons", buttons: [{ label: "x", href: "javascript:alert(1)", style: "primary" }, { label: "ok", href: "/tickets", style: "primary" }] },
      { id: "b", kind: "image", image: { src: "javascript:alert(1)", alt: "", width: 1, height: 1 }, width: "small", shape: "square" },
      { id: "c", kind: "image", image: { src: "//evil.example/x.png", alt: "", width: 1, height: 1 }, width: "small", shape: "square" },
      { id: "d", kind: "people", style: "list", columns: 2, people: [{ id: "p", name: "P", role: "", linkedin: "javascript:x" }] },
    ]));
    expect(blocks.map((b) => b.id)).toEqual(["a", "d"]);
    expect(blocks[0]).toMatchObject({ buttons: [{ label: "ok" }] });
    expect(blocks[1]?.kind === "people" && blocks[1].people[0]?.linkedin).toBeUndefined();
  });

  it("clamps a focal point into the image", () => {
    const [b] = blocksOf(page([{ id: "a", kind: "image", image: { src: "/a.png", alt: "", width: 10, height: 10, focusX: -1, focusY: 3 }, width: "small", shape: "square" }]));
    expect(b?.kind === "image" && focalPosition(b.image)).toBe("0% 100%");
  });

  it("keeps the kitchen sink minus exactly its hidden and disallowed parts", () => {
    const parsed = parseLearnPageContent(LEARN_PAGE_KITCHEN_SINK)!;
    expect(parsed.sections.map((s) => s.id)).not.toContain("s-hidden");
    const ids = parsed.sections.flatMap((s) => s.blocks.map((b) => b.id));
    expect(ids).not.toContain("b-hidden");
    expect(ids).not.toContain("b-bad");
    const kinds = new Set(parsed.sections.flatMap((s) => s.blocks.map((b) => b.kind)));
    expect([...kinds].sort()).toEqual(["buttons", "columns", "divider", "heading", "image", "list", "people", "spacer", "text", "video"]);
  });
});

describe("videoEmbed", () => {
  it("accepts YouTube and Vimeo addresses in their usual shapes", () => {
    const yt = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
    expect(videoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")?.src).toBe(yt);
    expect(videoEmbed("https://youtu.be/dQw4w9WgXcQ")?.src).toBe(yt);
    expect(videoEmbed("https://www.youtube.com/shorts/dQw4w9WgXcQ")?.src).toBe(yt);
    expect(videoEmbed("https://m.youtube.com/embed/dQw4w9WgXcQ")?.src).toBe(yt);
    expect(videoEmbed("https://vimeo.com/76979871")?.src).toBe("https://player.vimeo.com/video/76979871?dnt=1");
    expect(videoEmbed("https://player.vimeo.com/video/76979871")?.provider).toBe("vimeo");
  });

  it("refuses everything else", () => {
    for (const url of ["https://example.com/v.mp4", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "not a url", "https://www.youtube.com/watch?v=<script>"]) {
      expect(videoEmbed(url)).toBeNull();
    }
  });
});

describe("learnRichParagraphs and isLearnImageSrc", () => {
  it("keeps single line breaks and splits paragraphs on a blank line", () => {
    const p = learnRichParagraphs("Meet the **KGC**\nTeam\n\nSecond");
    expect(p).toHaveLength(2);
    expect(p[0]).toHaveLength(2);
    expect(p[0]?.[0]).toEqual([{ kind: "text", text: "Meet the " }, { kind: "strong", text: "KGC" }]);
  });

  it("allows site paths and http(s) only", () => {
    expect(isLearnImageSrc("/kgc/a.png")).toBe(true);
    expect(isLearnImageSrc("https://firebasestorage.googleapis.com/v0/b/x/o/a")).toBe(true);
    expect(isLearnImageSrc("//evil.example/a.png")).toBe(false);
    expect(isLearnImageSrc("data:image/png;base64,AAAA")).toBe(false);
  });
});

describe("blocks not filled in yet (T314 F1)", () => {
  const emptyImage = { id: "i", kind: "image", image: { src: "", alt: "", width: 0, height: 0 }, width: "medium", shape: "original" };
  const emptyVideo = { id: "v", kind: "video", url: "" };
  const text = { id: "t", kind: "text", text: "Hi" };

  it("parseLearnPageContent drops an empty Image or Video block and keeps the rest", () => {
    expect(blocksOf(page([emptyImage, emptyVideo, text])).map((b) => b.id)).toEqual(["t"]);
  });

  it("isDrawableLearnBlock skips them, and hidden blocks, for a renderer handed a raw draft", () => {
    expect(isDrawableLearnBlock(emptyImage as LearnBlock)).toBe(false);
    expect(isDrawableLearnBlock(emptyVideo as LearnBlock)).toBe(false);
    expect(isDrawableLearnBlock({ ...emptyVideo, url: "  " } as LearnBlock)).toBe(false);
    expect(isDrawableLearnBlock({ ...text, hidden: true } as LearnBlock)).toBe(false);
    expect(isDrawableLearnBlock(text as LearnBlock)).toBe(true);
    expect(isDrawableLearnBlock({ ...emptyImage, image: { src: "/kgc/a.png", alt: "", width: 1, height: 1 } } as LearnBlock)).toBe(true);
  });

  it("hasLearnImage is false for a missing or empty optional image", () => {
    expect(hasLearnImage(undefined)).toBe(false);
    expect(hasLearnImage({ src: "", alt: "", width: 0, height: 0 })).toBe(false);
    expect(hasLearnImage({ src: "/kgc/a.png", alt: "", width: 1, height: 1 })).toBe(true);
  });
});
