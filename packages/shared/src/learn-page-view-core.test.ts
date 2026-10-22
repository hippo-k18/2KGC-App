import { describe, expect, it } from "vitest";

import { LEARN_PAGE_DEFAULT, type LearnBlock, type LearnPageContent, type RichDoc } from "./learn-page.js";
import { LEARN_LIBRARY_SAMPLE, LEARN_PAGE_KITCHEN_SINK, LEARN_PAGE_KITCHEN_SINK_V2, LEARN_RICH_DOC_SAMPLE } from "./learn-page-sample.js";
import {
  focalPosition,
  isLearnImageSrc,
  learnPageOrDefault,
  learnRichParagraphs,
  parseLearnPageContent,
  parseLearnSection,
  parseRichContent,
  parseRichDoc,
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

describe("v2", () => {
  const img = { src: "/kgc/a.png", alt: "A", width: 10, height: 10 };
  const doc = (...content: unknown[]) => ({ type: "doc", content });
  const p = (...content: unknown[]) => ({ type: "paragraph", content });
  const t = (text: string, ...marks: unknown[]) => (marks.length ? { type: "text", text, marks } : { type: "text", text });
  const sectionOf = (v: unknown) => parseLearnPageContent(v)?.sections[0];

  describe("the v2 kitchen sink", () => {
    const expected = (): LearnPageContent => {
      const c = structuredClone(LEARN_PAGE_KITCHEN_SINK_V2);
      for (const s of c.sections) {
        s.blocks = s.blocks.filter((b) => b.id !== "v2-embed-bad");
        for (const b of s.blocks) delete b.note;
      }
      return c;
    };

    it("parses to itself minus the disallowed embed and the editor note", () => {
      const parsed = parseLearnPageContent(LEARN_PAGE_KITCHEN_SINK_V2)!;
      const ids = parsed.sections.flatMap((s) => s.blocks.map((b) => b.id));
      expect(ids).not.toContain("v2-embed-bad");
      expect(JSON.stringify(parsed)).not.toContain("Never rendered");
      expect(JSON.stringify(parsed)).not.toContain("evil.example");
      expect(parsed).toEqual(expected());
    });

    it("keeps every v2 kind", () => {
      const parsed = parseLearnPageContent(LEARN_PAGE_KITCHEN_SINK_V2)!;
      const kinds = new Set(parsed.sections.flatMap((s) => s.blocks.map((b) => b.kind)));
      for (const k of ["imageText", "gallery", "quote", "callout", "accordion", "tabs", "stats", "cards", "logos", "embed", "countdown", "table", "toc", "reusable"]) {
        expect(kinds).toContain(k);
      }
    });

    it("survives a JSON round trip", () => {
      expect(parseLearnPageContent(JSON.parse(JSON.stringify(LEARN_PAGE_KITCHEN_SINK_V2)))).toEqual(expected());
    });

    it("is idempotent", () => {
      const once = parseLearnPageContent(LEARN_PAGE_KITCHEN_SINK_V2);
      expect(parseLearnPageContent(once)).toEqual(once);
      expect(parseLearnPageContent(JSON.parse(JSON.stringify(once)))).toEqual(once);
    });

    it("does not mutate its input", () => {
      const before = structuredClone(LEARN_PAGE_KITCHEN_SINK_V2);
      parseLearnPageContent(LEARN_PAGE_KITCHEN_SINK_V2);
      expect(LEARN_PAGE_KITCHEN_SINK_V2).toEqual(before);
    });

    it("parses the library sample section to itself", () => {
      expect(parseLearnSection(LEARN_LIBRARY_SAMPLE["lib-cta"])).toEqual(LEARN_LIBRARY_SAMPLE["lib-cta"]);
      expect(parseLearnSection({ id: "x", blocks: [] })).toBeUndefined();
      expect(parseLearnSection({ id: "x", hidden: true, blocks: [{ id: "a", kind: "divider" }] })).toBeUndefined();
      expect(parseLearnSection(null)).toBeUndefined();
    });
  });

  it("LEARN_PAGE_DEFAULT still parses to itself", () => {
    expect(parseLearnPageContent(LEARN_PAGE_DEFAULT)).toEqual(LEARN_PAGE_DEFAULT);
  });

  describe("parseRichDoc", () => {
    it("keeps the sample document whole", () => {
      expect(parseRichDoc(LEARN_RICH_DOC_SAMPLE)).toEqual(LEARN_RICH_DOC_SAMPLE);
      expect(parseRichDoc(JSON.parse(JSON.stringify(LEARN_RICH_DOC_SAMPLE)))).toEqual(LEARN_RICH_DOC_SAMPLE);
    });

    it("treats an empty or non-document value as absent", () => {
      for (const bad of [
        null,
        undefined,
        "text",
        42,
        [],
        {},
        { type: "paragraph", content: [t("x")] },
        doc(),
        { type: "doc" },
        { type: "doc", content: "x" },
        doc(p()),
        doc(p(t("   \n "))),
        doc(p({ type: "hardBreak" })),
        doc({ type: "bulletList", content: [] }),
        doc({ type: "image", src: "x.png" }),
      ]) {
        expect(parseRichDoc(bad)).toBeUndefined();
      }
      expect(parseRichDoc(doc({ type: "horizontalRule" }))).toEqual(doc({ type: "horizontalRule" }));
    });

    it("keeps a <script> typed as text as text", () => {
      const v = doc(p(t("<script>alert(1)</script>")));
      expect(parseRichDoc(v)).toEqual(v);
    });

    it("drops a javascript: link and keeps the words and other marks", () => {
      expect(parseRichDoc(doc(p(t("x", { type: "link", href: "javascript:alert(1)" }, { type: "bold" }))))).toEqual(doc(p(t("x", { type: "bold" }))));
      expect(parseRichDoc(doc(p(t("x", { type: "link", href: " JavaScript:alert(1)" }))))).toEqual(doc(p(t("x"))));
      expect(parseRichDoc(doc(p(t("x", { type: "link", href: "//evil.example" }))))).toEqual(doc(p(t("x"))));
      expect(parseRichDoc(doc(p(t("x", { type: "link" }))))).toEqual(doc(p(t("x"))));
    });

    it("keeps a safe link, trimmed, with newTab only when true", () => {
      expect(parseRichDoc(doc(p(t("x", { type: "link", href: " /tickets ", newTab: "yes", target: "_top" }))))).toEqual(doc(p(t("x", { type: "link", href: "/tickets" }))));
      expect(parseRichDoc(doc(p(t("x", { type: "link", href: "https://a.example", newTab: true }))))).toEqual(doc(p(t("x", { type: "link", href: "https://a.example", newTab: true }))));
    });

    it("never keeps a style or attrs field, or any unlisted key", () => {
      const v = doc(
        { type: "paragraph", style: "color:red", attrs: { style: "x" }, class: "evil", onclick: "x", content: [{ type: "text", text: "a", style: "x", attrs: {}, marks: [{ type: "bold", attrs: { style: "x" } }] }] },
        { type: "heading", level: 3, attrs: { id: "x" }, html: "<b>", content: [t("h")] },
        { type: "codeBlock", language: "js\"><script>", content: [t("c")] },
        { type: "orderedList", start: 4, attrs: { start: 9 }, content: [{ type: "listItem", attrs: {}, content: [p(t("i"))] }] },
        { type: "table", attrs: { style: "x" }, content: [{ type: "tableRow", style: "x", content: [{ type: "tableCell", attrs: { colwidth: [100] }, style: "x", content: [p(t("c"))] }] }] },
      );
      const out = parseRichDoc(v);
      expect(JSON.stringify(out)).not.toMatch(/style|attrs|class|onclick|html|language|colwidth/);
      expect(out).toEqual(
        doc(
          p(t("a", { type: "bold" })),
          { type: "heading", level: 3, content: [t("h")] },
          { type: "codeBlock", content: [t("c")] },
          { type: "orderedList", start: 4, content: [{ type: "listItem", content: [p(t("i"))] }] },
          { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p(t("c"))] }] }] },
        ),
      );
    });

    it("drops unknown marks and repeats, keeps each listed mark", () => {
      const out = parseRichDoc(doc(p(t("x", { type: "blink" }, { type: "bold" }, { type: "bold" }, "italic", null, { type: "italic" }))));
      expect(out).toEqual(doc(p(t("x", { type: "bold" }, { type: "italic" }))));
      for (const m of ["bold", "italic", "underline", "strike", "code", "superscript", "subscript"]) {
        expect(parseRichDoc(doc(p(t("x", { type: m, extra: 1 }))))).toEqual(doc(p(t("x", { type: m }))));
      }
    });

    it("keeps a colour only as a brand name or #rrggbb", () => {
      const mark = (type: string, color: unknown) => parseRichDoc(doc(p(t("x", { type, color }))));
      for (const type of ["color", "highlight"]) {
        expect(mark(type, "navy")).toEqual(doc(p(t("x", { type, color: "navy" }))));
        expect(mark(type, "#ABCDEF")).toEqual(doc(p(t("x", { type, color: "#abcdef" }))));
        for (const bad of ["#abc", "red", "#abcdeg", "url(x)", "#abcdef;x:y", 1, undefined]) expect(mark(type, bad)).toEqual(doc(p(t("x"))));
      }
    });

    it("keeps a font size only from the list", () => {
      expect(parseRichDoc(doc(p(t("x", { type: "fontSize", size: "large" }))))).toEqual(doc(p(t("x", { type: "fontSize", size: "large" }))));
      expect(parseRichDoc(doc(p(t("x", { type: "fontSize", size: "72px" }))))).toEqual(doc(p(t("x"))));
    });

    it("wraps inline content found at block level in a paragraph", () => {
      expect(parseRichDoc(doc(t("loose", { type: "bold" })))).toEqual(doc(p(t("loose", { type: "bold" }))));
      expect(parseRichDoc(doc(p(t("a")), { type: "hardBreak" }, t("b")))).toEqual(doc(p(t("a")), p({ type: "hardBreak" }), p(t("b"))));
    });

    it("unwraps unknown wrappers, keeping their children", () => {
      expect(parseRichDoc(doc({ type: "div", style: "x", content: [p(t("a")), { type: "section", content: [p(t("b"))] }] }))).toEqual(doc(p(t("a")), p(t("b"))));
      expect(parseRichDoc(doc(p({ type: "span", content: [t("a"), { type: "mention", content: [t("b")] }] }, { type: "image", src: "x" })))).toEqual(doc(p(t("a"), t("b"))));
      // A stray list item or cell outside its parent is unwrapped too.
      expect(parseRichDoc(doc({ type: "listItem", content: [p(t("a"))] }, { type: "tableCell", content: [p(t("b"))] }))).toEqual(doc(p(t("a")), p(t("b"))));
    });

    it("normalises heading level and alignment", () => {
      expect(parseRichDoc(doc({ type: "heading", level: 7, align: "middle", content: [t("h")] }))).toEqual(doc({ type: "heading", level: 2, content: [t("h")] }));
      expect(parseRichDoc(doc({ type: "heading", level: 4, align: "justify", content: [t("h")] }))).toEqual(doc({ type: "heading", level: 4, align: "justify", content: [t("h")] }));
      expect(parseRichDoc(doc({ type: "paragraph", align: "center", content: [t("p")] }))).toEqual(doc({ type: "paragraph", align: "center", content: [t("p")] }));
    });

    it("caps nesting depth at 12", () => {
      const nest = (n: number): unknown => (n === 0 ? p(t("deep")) : { type: "blockquote", content: [nest(n - 1)] });
      expect(JSON.stringify(parseRichDoc(doc(nest(12))))).toContain("deep");
      expect(parseRichDoc(doc(nest(13)))).toBeUndefined();
      expect(parseRichDoc(doc(p(t("top")), nest(40)))).toEqual(doc(p(t("top"))));
      const wrap = (n: number): unknown => (n === 0 ? p(t("deep")) : { type: "x", content: [wrap(n - 1)] });
      expect(parseRichDoc(doc(wrap(13)))).toBeUndefined();
      expect(parseRichDoc(doc(wrap(1000)))).toBeUndefined();
    });

    it("stops after 5000 nodes", () => {
      const many = Array.from({ length: 6000 }, (_, i) => p(t(`n${i}`)));
      const out = parseRichDoc(doc(...many))!;
      // Each paragraph and its text count one node each.
      expect(out.content).toHaveLength(2500);
      expect(out.content[0]).toEqual(p(t("n0")));
      expect(out.content[2499]).toEqual(p(t("n2499")));
    });

    it("keeps a code block's words and line breaks, never its marks", () => {
      expect(parseRichDoc(doc({ type: "codeBlock", content: [t("a", { type: "bold" }, { type: "link", href: "/x" }), { type: "hardBreak" }, t("b", { type: "color", color: "navy" })] }))).toEqual(
        doc({ type: "codeBlock", content: [t("a"), { type: "hardBreak" }, t("b")] }),
      );
    });

    it("keeps colspan and rowspan only from 2 to 20", () => {
      const span = (colspan: unknown, rowspan: unknown) => {
        const out = parseRichDoc(doc({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", colspan, rowspan, content: [p(t("c"))] }] }] })) as RichDoc;
        const row = out.content[0]!.type === "table" ? out.content[0]!.content[0] : undefined;
        const cell = row?.type === "tableRow" ? row.content[0] : undefined;
        return cell?.type === "tableHeader" ? [cell.colspan, cell.rowspan] : null;
      };
      expect(span(2, 20)).toEqual([2, 20]);
      expect(span(1, 21)).toEqual([undefined, undefined]);
      expect(span(0, -2)).toEqual([undefined, undefined]);
      expect(span(2.5, "3")).toEqual([undefined, undefined]);
      expect(span(Number.NaN, Infinity)).toEqual([undefined, undefined]);
    });

    it("drops rows and cells of the wrong type, and a table with no rows", () => {
      const out = parseRichDoc(
        doc({
          type: "table",
          content: [p(t("stray")), { type: "tableRow", content: [p(t("x")), { type: "tableCell", content: [p(t("ok"))] }] }, { type: "tableRow", content: [] }],
        }),
      );
      expect(out).toEqual(doc({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p(t("ok"))] }] }] }));
      expect(parseRichDoc(doc({ type: "table", content: [{ type: "tableRow", content: [] }] }))).toBeUndefined();
    });

    it("keeps an ordered list's start only when it is a whole number, not negative and not 1", () => {
      const start = (v: unknown) => {
        const out = parseRichDoc(doc({ type: "orderedList", start: v, content: [{ type: "listItem", content: [p(t("i"))] }] }))!;
        return out.content[0]!.type === "orderedList" ? out.content[0]!.start : "missing";
      };
      expect(start(3)).toBe(3);
      expect(start(0)).toBe(0);
      expect(start(1)).toBeUndefined();
      expect(start(-1)).toBeUndefined();
      expect(start(2.5)).toBeUndefined();
      expect(start("3")).toBeUndefined();
      expect(start(undefined)).toBeUndefined();
    });

    it("drops non-items and empty items from a list, and an empty list", () => {
      expect(parseRichDoc(doc({ type: "bulletList", content: [p(t("stray")), { type: "listItem", content: [] }, { type: "listItem", content: [p(t("ok"))] }] }))).toEqual(
        doc({ type: "bulletList", content: [{ type: "listItem", content: [p(t("ok"))] }] }),
      );
      expect(parseRichDoc(doc(p(t("a")), { type: "bulletList", content: [p(t("stray"))] }))).toEqual(doc(p(t("a"))));
    });

    it("drops empty text nodes and non-string text", () => {
      expect(parseRichDoc(doc(p(t(""), { type: "text", text: 5 }, { type: "text" }, t("ok"))))).toEqual(doc(p(t("ok"))));
    });
  });

  describe("parseRichContent", () => {
    it("keeps text as is, treats blank text as absent, and reads documents", () => {
      expect(parseRichContent("  **x**  ")).toBe("  **x**  ");
      expect(parseRichContent("   ")).toBeUndefined();
      expect(parseRichContent("")).toBeUndefined();
      expect(parseRichContent(doc(p(t("x"))))).toEqual(doc(p(t("x"))));
      expect(parseRichContent(doc(p()))).toBeUndefined();
      expect(parseRichContent(42)).toBeUndefined();
    });

    it("sanitises a document in any rich field", () => {
      const bad = doc(p(t("x", { type: "link", href: "javascript:alert(1)" })));
      const [b] = blocksOf(page([{ id: "a", kind: "text", text: bad }]));
      expect(b).toMatchObject({ kind: "text", text: doc(p(t("x"))) });
      expect(blocksOf(page([{ id: "a", kind: "heading", text: doc(p()) }]))).toEqual([]);
    });
  });

  describe("each v2 kind is dropped without its required content", () => {
    const keeps = (block: Record<string, unknown>) => blocksOf(page([{ id: "x", ...block }])).length === 1;

    it("imageText needs an image and text", () => {
      expect(keeps({ kind: "imageText", image: img, text: "T" })).toBe(true);
      expect(keeps({ kind: "imageText", text: "T" })).toBe(false);
      expect(keeps({ kind: "imageText", image: { ...img, src: "javascript:x" }, text: "T" })).toBe(false);
      expect(keeps({ kind: "imageText", image: img })).toBe(false);
      expect(keeps({ kind: "imageText", image: img, text: " " })).toBe(false);
    });

    it("gallery needs one valid image", () => {
      expect(keeps({ kind: "gallery", images: [img] })).toBe(true);
      expect(keeps({ kind: "gallery", images: [] })).toBe(false);
      expect(keeps({ kind: "gallery", images: [{ ...img, src: "//evil.example/a.png" }, "x"] })).toBe(false);
      expect(keeps({ kind: "gallery" })).toBe(false);
    });

    it("quote needs text", () => {
      expect(keeps({ kind: "quote", text: "Q" })).toBe(true);
      expect(keeps({ kind: "quote", name: "N" })).toBe(false);
    });

    it("callout needs text or a title", () => {
      expect(keeps({ kind: "callout", title: "T" })).toBe(true);
      expect(keeps({ kind: "callout", text: "T" })).toBe(true);
      expect(keeps({ kind: "callout", title: " ", text: "" })).toBe(false);
    });

    it("accordion and tabs need an item with a title", () => {
      for (const kind of ["accordion", "tabs"]) {
        expect(keeps({ kind, items: [{ title: "A", text: "x" }] })).toBe(true);
        expect(keeps({ kind, items: [{ text: "x" }, { title: " " }] })).toBe(false);
        expect(keeps({ kind, items: [] })).toBe(false);
        expect(keeps({ kind })).toBe(false);
      }
    });

    it("stats need a value", () => {
      expect(keeps({ kind: "stats", items: [{ value: "40" }] })).toBe(true);
      expect(keeps({ kind: "stats", items: [{ label: "L" }, { value: 40 }] })).toBe(false);
    });

    it("cards need a title", () => {
      expect(keeps({ kind: "cards", items: [{ title: "C" }] })).toBe(true);
      expect(keeps({ kind: "cards", items: [{ text: "x", image: img }] })).toBe(false);
    });

    it("logos need a valid image", () => {
      expect(keeps({ kind: "logos", items: [img] })).toBe(true);
      expect(keeps({ kind: "logos", items: [{ alt: "x" }] })).toBe(false);
    });

    it("embed needs a known provider and an address it allows", () => {
      expect(keeps({ kind: "embed", provider: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" })).toBe(true);
      expect(keeps({ kind: "embed", provider: "youtube", url: "https://evil.example/embed/x" })).toBe(false);
      expect(keeps({ kind: "embed", provider: "iframe", url: "https://youtu.be/dQw4w9WgXcQ" })).toBe(false);
      expect(keeps({ kind: "embed", provider: "vimeo", url: "https://youtu.be/dQw4w9WgXcQ" })).toBe(false);
      expect(keeps({ kind: "embed", provider: "youtube" })).toBe(false);
    });

    it("countdown needs a positive finite time", () => {
      expect(keeps({ kind: "countdown", until: 1_800_000_000_000 })).toBe(true);
      for (const until of [undefined, 0, -1, "2027-05-04", Number.NaN, Infinity]) expect(keeps({ kind: "countdown", until })).toBe(false);
    });

    it("table needs a document holding a table", () => {
      const table = doc({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p(t("c"))] }] }] });
      expect(keeps({ kind: "table", doc: table })).toBe(true);
      expect(keeps({ kind: "table", doc: doc(p(t("no table"))) })).toBe(false);
      expect(keeps({ kind: "table" })).toBe(false);
      expect(keeps({ kind: "table", doc: "| a | b |" })).toBe(false);
    });

    it("reusable needs a plain library id", () => {
      expect(keeps({ kind: "reusable", libraryId: "lib-cta" })).toBe(true);
      for (const libraryId of [undefined, "", " ", "../x", "a/b", "x".repeat(129)]) expect(keeps({ kind: "reusable", libraryId })).toBe(false);
    });

    it("toc needs nothing", () => {
      expect(blocksOf(page([{ id: "x", kind: "toc", title: "  " }]))).toEqual([{ id: "x", kind: "toc" }]);
    });

    it("fills defaults for the optional parts", () => {
      const [it, gal, q, c, acc, st, emb] = blocksOf(
        page([
          { id: "a", kind: "imageText", image: img, text: "T", imageSide: "top", imageWidth: "all", shape: "star", buttons: [{ label: "x", href: "javascript:x" }] },
          { id: "b", kind: "gallery", images: [img, img], layout: "slideshow", columns: 9 },
          { id: "c", kind: "quote", text: "Q", style: "huge", name: " ", photo: { src: "data:x" } },
          { id: "d", kind: "callout", title: "T", tone: "danger" },
          { id: "e", kind: "accordion", items: [{ title: "A", open: "yes" }], allowMany: 1 },
          { id: "f", kind: "stats", items: [{ value: "1" }, { value: "2" }] },
          { id: "g", kind: "embed", provider: "google-maps", url: "https://www.google.com/maps/embed?pb=!1m2", aspect: "21:9", height: 50, title: " " },
        ]),
      );
      expect(it).toEqual({ id: "a", kind: "imageText", image: img, imageSide: "left", imageWidth: "half", shape: "rounded", text: "T" });
      expect(gal).toEqual({ id: "b", kind: "gallery", layout: "grid", columns: 3, lightbox: true, images: [{ ...img, id: "img-0" }, { ...img, id: "img-1" }] });
      expect(q).toEqual({ id: "c", kind: "quote", text: "Q", style: "plain" });
      expect(c).toEqual({ id: "d", kind: "callout", tone: "info", title: "T", text: "" });
      expect(acc).toEqual({ id: "e", kind: "accordion", allowMany: false, items: [{ id: "acc-0", title: "A", text: "" }] });
      expect(st).toMatchObject({ columns: 2, items: [{ id: "stat-0", value: "1", label: "" }, { id: "stat-1", value: "2", label: "" }] });
      expect(emb).toEqual({ id: "g", kind: "embed", provider: "google-maps", url: "https://www.google.com/maps/embed?pb=!1m2", aspect: "16:9", title: "Embedded content" });
    });
  });

  describe("block and section options", () => {
    it("keeps valid block options and never the note", () => {
      const [b] = blocksOf(page([{ id: "a", kind: "text", text: "x", visibleOn: "mobile", anchor: "here", maxWidth: "small", boxed: true, textColor: "#B82105", note: "secret" }]));
      expect(b).toEqual({ id: "a", kind: "text", text: "x", visibleOn: "mobile", anchor: "here", maxWidth: "small", boxed: true, textColor: "#b82105" });
    });

    it("drops invalid block options", () => {
      const [b] = blocksOf(page([{ id: "a", kind: "text", text: "x", visibleOn: "all", anchor: "Not An Anchor", maxWidth: "huge", boxed: "yes", textColor: "red" }]));
      expect(b).toEqual({ id: "a", kind: "text", text: "x" });
    });

    it("keeps valid section options and never the note", () => {
      const s = sectionOf(
        page([{ id: "a", kind: "text", text: "x" }], {
          backgroundColor: "teal",
          backgroundImage: img,
          overlay: 0.5,
          anchor: "band",
          visibleOn: "desktop",
          layout: "two-wide-left",
          blockColumn: { a: 1 },
          note: "secret",
        }),
      );
      expect(s).toMatchObject({ backgroundColor: "teal", backgroundImage: img, overlay: 0.5, anchor: "band", visibleOn: "desktop", layout: "two-wide-left", blockColumn: { a: 1 } });
      expect(s).not.toHaveProperty("note");
    });

    it("drops invalid section options, and a single layout", () => {
      const s = sectionOf(
        page([{ id: "a", kind: "text", text: "x" }], {
          backgroundColor: "#abc",
          backgroundImage: { src: "javascript:x" },
          anchor: "-x",
          visibleOn: "tv",
          layout: "single",
        }),
      );
      for (const k of ["backgroundColor", "backgroundImage", "overlay", "anchor", "visibleOn", "layout", "blockColumn"]) expect(s).not.toHaveProperty(k);
      expect(sectionOf(page([{ id: "a", kind: "text", text: "x" }], { layout: "four" }))).not.toHaveProperty("layout");
    });

    it("clamps the overlay to 0.8 and drops 0", () => {
      const overlay = (v: unknown) => sectionOf(page([{ id: "a", kind: "text", text: "x" }], { overlay: v }))?.overlay;
      expect(overlay(0.95)).toBe(0.8);
      expect(overlay(5)).toBe(0.8);
      expect(overlay(0.8)).toBe(0.8);
      expect(overlay(0.3)).toBe(0.3);
      expect(overlay(0)).toBeUndefined();
      expect(overlay(-1)).toBeUndefined();
      expect(overlay("0.5")).toBeUndefined();
      expect(overlay(Number.NaN)).toBeUndefined();
      expect(overlay(Infinity)).toBeUndefined();
    });

    it("keeps a blockColumn entry only for a block that exists, as a whole number 0 to 2", () => {
      const s = sectionOf(
        page(
          [
            { id: "a", kind: "text", text: "x" },
            { id: "b", kind: "text", text: "x" },
            { id: "c", kind: "text", text: "x" },
            { id: "h", kind: "text", text: "x", hidden: true },
          ],
          { layout: "three", blockColumn: { a: 0, b: 2, c: 3, h: 1, ghost: 1, d: -1, e: 1.5, f: "1" } },
        ),
      );
      expect(s?.blockColumn).toEqual({ a: 0, b: 2 });
      expect(sectionOf(page([{ id: "a", kind: "text", text: "x" }], { blockColumn: { a: 7 } }))).not.toHaveProperty("blockColumn");
      expect(sectionOf(page([{ id: "a", kind: "text", text: "x" }], { blockColumn: [0] }))).not.toHaveProperty("blockColumn");
    });

    it("keeps the page's share image and noindex only when valid", () => {
      const base = page([{ id: "a", kind: "text", text: "x" }]);
      expect(parseLearnPageContent({ ...base, ogImage: img, noindex: true })).toMatchObject({ ogImage: img, noindex: true });
      const bad = parseLearnPageContent({ ...base, ogImage: { src: "javascript:x" }, noindex: "true" });
      expect(bad).not.toHaveProperty("ogImage");
      expect(bad).not.toHaveProperty("noindex");
      expect(parseLearnPageContent({ ...base, noindex: false })).not.toHaveProperty("noindex");
    });
  });

  describe("anchors", () => {
    it("keeps the first of two equal anchors, across sections and blocks", () => {
      const parsed = parseLearnPageContent({
        seoTitle: "T",
        sections: [
          { id: "s1", anchor: "top", blocks: [{ id: "a", kind: "text", text: "x", anchor: "top" }, { id: "b", kind: "text", text: "x", anchor: "dup" }] },
          { id: "s2", anchor: "dup", blocks: [{ id: "c", kind: "text", text: "x", anchor: "dup" }, { id: "d", kind: "text", text: "x", anchor: "own" }] },
          { id: "s3", anchor: "own", blocks: [{ id: "e", kind: "divider", anchor: "fresh" }] },
        ],
      })!;
      expect(parsed.sections.map((s) => s.anchor)).toEqual(["top", undefined, undefined]);
      expect(parsed.sections.flatMap((s) => s.blocks.map((b) => b.anchor))).toEqual([undefined, "dup", undefined, "own", "fresh"]);
    });

    it("does not let a hidden block's anchor take one from a shown block", () => {
      const parsed = parseLearnPageContent({
        seoTitle: "T",
        sections: [{ id: "s", blocks: [{ id: "h", kind: "text", text: "x", anchor: "a", hidden: true }, { id: "b", kind: "text", text: "x", anchor: "a" }] }],
      })!;
      expect(parsed.sections[0]!.blocks[0]).toMatchObject({ id: "b", anchor: "a" });
    });
  });
});
