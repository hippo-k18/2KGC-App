import { describe, expect, it } from "vitest";

import type { LearnBlock, LearnPageContent } from "./learn-page.js";
import { readLearnPage } from "./learn-page-share.js";
import { parseInline } from "./rich-text-core.js";
import { LEARN_PAGE_KITCHEN_SINK, LEARN_PAGE_KITCHEN_SINK_V2 } from "./learn-page-sample.js";
import {
  isLearnImageSrc,
  learnCountdownUntil,
  LEARN_COUNTDOWN_FROM,
  LEARN_COUNTDOWN_TO,
  parseLearnPageContent,
} from "./learn-page-view-core.js";

/*
 * Wrong-shaped values written straight to Firestore (T324 F1, F2, U2, U3).
 * The save validator never lets these in, but www renders whatever is
 * stored, so the parser is the last check before a 500 or an off-site fetch.
 */

const page = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({
  seoTitle: "T",
  sections: [{ id: "s", blocks, ...extra }],
});
const blocksOf = (v: unknown, o = {}): LearnBlock[] => parseLearnPageContent(v, o)?.sections[0]?.blocks ?? [];

const BUCKET = "kgc-conference-app-and-website.firebasestorage.app";
const upload = (bucket = BUCKET, path = "pageLayouts/learn/a.png") =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=t`;

/** Image sources that must never reach a visitor's browser. */
const BAD_IMAGES = [
  "https://evil.example/a.png",
  "http://evil.example/a.png",
  "//evil.example/a.png",
  "/\\evil.example/a.png",
  "https:/\\evil.example/a.png",
  "data:image/png;base64,AAAA",
  "javascript:alert(1)",
  "/api/whatever",
  "/kgc/../api/x",
  upload("someone-else.appspot.com"),
  upload(BUCKET, "speakers/a.png"),
  upload(BUCKET, "pageLayouts/learn/../../speakers/a.png"),
  upload(BUCKET).replace("&token=t", ""),
  upload(BUCKET).replace("https://", "https://user:pw@"),
  "https://storage.googleapis.com/" + BUCKET + "/pageLayouts/learn/a.png",
];

const BAD_HREFS = [
  "javascript:alert(1)",
  "https:/\\evil.example",
  "https:\\\\evil.example",
  "http:\\\\evil.example",
  "/\\evil.example",
  "\\\\evil.example",
  "//evil.example",
  "\u0001https://evil.example",
  "https:evil.example",
];

/** Every image field on the page, each set to `src`. */
function pageWithImages(src: string) {
  const img = { src, alt: "a", width: 10, height: 10 };
  return {
    seoTitle: "T",
    ogImage: img,
    sections: [
      {
        id: "s",
        backgroundImage: img,
        blocks: [
          { id: "image", kind: "image", image: img },
          { id: "people", kind: "people", people: [{ id: "p", name: "P", photo: img }] },
          { id: "columns", kind: "columns", items: [{ id: "c", title: "C", image: img }] },
          { id: "imageText", kind: "imageText", image: img, text: "x" },
          { id: "gallery", kind: "gallery", images: [{ id: "g", ...img }] },
          { id: "quote", kind: "quote", text: "q", photo: img },
          { id: "cards", kind: "cards", items: [{ id: "k", title: "K", image: img }] },
          { id: "logos", kind: "logos", items: [{ id: "l", ...img }] },
          { id: "keep", kind: "text", text: "kept" },
        ],
      },
    ],
  };
}

describe("images (T324 F2)", () => {
  it("keeps site assets and our own Learn uploads in every image field", () => {
    for (const src of ["/kgc/a.png", upload()]) {
      const read = readLearnPage(pageWithImages(src), { bucket: BUCKET, allowEmulator: false })!;
      expect(JSON.stringify(read).split(JSON.stringify(src)).length - 1, src).toBe(10);
      expect(read.sections[0]!.blocks.map((b) => b.id)).toEqual(["image", "people", "columns", "imageText", "gallery", "quote", "cards", "logos", "keep"]);
    }
  });

  it("drops an image from anywhere else, in every image field", () => {
    for (const src of BAD_IMAGES) {
      const read = readLearnPage(pageWithImages(src), { bucket: BUCKET, allowEmulator: false })!;
      expect(JSON.stringify(read), src).not.toMatch(/"src":"[^"]/);
      // Blocks that need their image go; the rest keep their words. Image and
      // text keeps its text, with the empty "no picture yet" image (T328 N3).
      expect(read.sections[0]!.blocks.map((b) => b.id), src).toEqual(["people", "columns", "imageText", "quote", "cards", "keep"]);
    }
  });

  it("accepts the Storage emulator only when told to", () => {
    const emu = `http://localhost:9199/v0/b/${BUCKET}/o/pageLayouts%2Flearn%2Fa.png?alt=media&token=t`;
    expect(isLearnImageSrc(emu, { allowEmulator: false })).toBe(false);
    expect(isLearnImageSrc(emu, { allowEmulator: true, bucket: BUCKET })).toBe(true);
    expect(isLearnImageSrc(emu)).toBe(true);
    expect(isLearnImageSrc(emu.replace("localhost", "evil.example"))).toBe(false);
  });

  it("checks the bucket only when given one", () => {
    expect(isLearnImageSrc(upload("someone-else.appspot.com"))).toBe(true);
    expect(isLearnImageSrc(upload("someone-else.appspot.com"), { bucket: BUCKET })).toBe(false);
  });

  it("refuses values that are not strings", () => {
    for (const v of [undefined, null, 1, {}, [], true]) expect(isLearnImageSrc(v)).toBe(false);
  });

  it("leaves the sample pages' images alone", () => {
    for (const sample of [LEARN_PAGE_KITCHEN_SINK, LEARN_PAGE_KITCHEN_SINK_V2] as LearnPageContent[]) {
      const srcs = JSON.stringify(sample).match(/"src":"[^"]*"/g) ?? [];
      for (const s of srcs) expect(isLearnImageSrc(JSON.parse(`{${s}}`).src), s).toBe(true);
    }
  });
});

describe("links (T324 U2, U3)", () => {
  it("drops an unsafe link from every link field", () => {
    for (const href of BAD_HREFS) {
      const link = { label: "L", href, style: "text" };
      const blocks = blocksOf(
        page([
          { id: "buttons", kind: "buttons", buttons: [link, { label: "ok", href: "/ok" }] },
          { id: "image", kind: "image", image: { src: "/kgc/a.png" }, href },
          { id: "people", kind: "people", people: [{ name: "P", linkedin: href }] },
          { id: "list", kind: "list", items: [{ title: "T", link }] },
          { id: "columns", kind: "columns", items: [{ title: "T", link }] },
          { id: "imageText", kind: "imageText", image: { src: "/kgc/a.png" }, text: "x", buttons: [link] },
          { id: "cards", kind: "cards", items: [{ title: "T", link }] },
          { id: "logos", kind: "logos", items: [{ src: "/kgc/a.png", href }] },
          {
            id: "text",
            kind: "text",
            text: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "w", marks: [{ type: "link", href }] }] }] },
          },
          { id: "md", kind: "text", text: `[w](${href})` },
        ]),
      );
      expect(blocks.map((b) => b.id), href).toEqual(["buttons", "image", "people", "list", "columns", "imageText", "cards", "logos", "text", "md"]);
      // A Markdown string is kept as typed and its links are checked when it is drawn.
      const md = blocks.pop()!;
      expect(md.kind === "text" && typeof md.text === "string" && parseInline(md.text).some((s) => s.kind === "link"), href).toBe(false);
      expect(JSON.stringify(blocks), href).not.toContain("evil");
      expect(JSON.stringify(blocks), href).not.toContain("javascript");
    }
  });
});

describe("countdown dates (T324 F1)", () => {
  it("drops a date outside the editor's range, like an unset one", () => {
    for (const until of [1e16, 8.7e15, 8.64e15, 1e300, -1e16, 0, 0.5, 1, Date.UTC(2019, 11, 31), LEARN_COUNTDOWN_TO, Number.MAX_VALUE, Infinity, -Infinity, NaN, "2027-01-01", null, {}, [], true]) {
      expect(blocksOf(page([{ id: "c", kind: "countdown", until }])), String(until)).toEqual([]);
      expect(learnCountdownUntil(until)).toBeUndefined();
    }
  });

  it("keeps a date inside it, and its ISO form never throws", () => {
    for (const until of [LEARN_COUNTDOWN_FROM, Date.UTC(2027, 4, 4, 13), LEARN_COUNTDOWN_TO - 1, Date.UTC(2027, 0, 1) + 0.4]) {
      const [b] = blocksOf(page([{ id: "c", kind: "countdown", until }]));
      expect(b?.kind).toBe("countdown");
      if (b?.kind === "countdown") expect(() => new Date(b.until).toISOString()).not.toThrow();
    }
  });
});

describe("numbers and shapes", () => {
  it("treats a width or height that is not a sensible pixel count as unset", () => {
    for (const n of [0, 0.4, -5, 1e300, Infinity, NaN, "10", null]) {
      const [b] = blocksOf(page([{ id: "i", kind: "image", image: { src: "/kgc/a.png", width: n, height: n } }]));
      expect(b?.kind === "image" && [b.image.width, b.image.height], String(n)).toEqual([1200, 800]);
    }
  });

  it("keeps column counts, overlay, embed height and list starts within their ranges", () => {
    const [s] = parseLearnPageContent(
      page(
        [
          { id: "p", kind: "people", columns: 1e9, people: [{ name: "P" }] },
          { id: "g", kind: "gallery", columns: -1, images: [{ src: "/kgc/a.png" }] },
          { id: "st", kind: "stats", columns: 2.5, items: [{ value: "1" }] },
          { id: "k", kind: "cards", columns: "4", items: [{ title: "T" }] },
          { id: "e", kind: "embed", provider: "youtube", url: "https://youtu.be/dQw4w9WgXcQ", aspect: "auto", height: 1e300 },
          {
            id: "ol",
            kind: "text",
            text: { type: "doc", content: [{ type: "orderedList", start: 1e300, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }] }] },
          },
        ],
        { overlay: 1e300, blockColumn: { p: 1e9, g: -1, st: 1, __proto__: 2 } },
      ),
    )!.sections;
    const by = Object.fromEntries(s!.blocks.map((b) => [b.id, b])) as Record<string, LearnBlock & Record<string, unknown>>;
    expect([by.p!.columns, by.g!.columns, by.st!.columns, by.k!.columns]).toEqual([3, 3, 1, 3]);
    expect(by.e!.height).toBeUndefined();
    expect(JSON.stringify(by.ol)).not.toContain("start");
    expect(s!.overlay).toBe(0.8);
    expect(s!.blockColumn).toEqual({ st: 1 });
  });

  it("drops non-string text, titles, ids and labels, and non-array lists, without throwing", () => {
    const weird: unknown[] = [undefined, null, true, 0, NaN, 1e300, "", " ", [], [[]], {}, { type: "doc" }, { type: "doc", content: 5 }, { toString: 1 }];
    for (const w of weird) {
      const blocks = blocksOf(
        page([
          { id: w, kind: "heading", text: w, level: w },
          { id: w, kind: "text", text: w, size: w },
          { id: "b", kind: "buttons", buttons: w },
          { id: "l", kind: "list", items: [{ title: w, text: w, children: w }, w] },
          { id: "a", kind: "accordion", items: [{ title: w, text: w }, w] },
          { id: "t", kind: "tabs", items: w },
          { id: "st", kind: "stats", items: [{ value: w, label: w }] },
          { id: "q", kind: "quote", text: w, name: w },
          { id: "co", kind: "callout", text: w, title: w, tone: w },
          { id: "tb", kind: "table", doc: w },
          { id: "toc", kind: "toc", title: w },
          { id: "r", kind: "reusable", libraryId: w },
          { id: "em", kind: "embed", provider: w, url: w },
          { id: "v", kind: "video", url: w },
          { id: "g", kind: "gallery", images: w },
          { id: "ok", kind: "text", text: "kept" },
        ]),
      );
      expect(blocks.at(-1)?.id).toBe("ok");
      for (const b of blocks) {
        expect(typeof b.id).toBe("string");
        for (const k of ["label", "title", "name", "caption"] as const) {
          const v = (b as unknown as Record<string, unknown>)[k];
          if (v !== undefined) expect(typeof v).toBe("string");
        }
      }
    }
  });

  it("survives a section and page of the wrong shape", () => {
    for (const w of [null, 1, "x", [], {}, { blocks: 5 }, { blocks: [null, 1, "x", []] }]) {
      expect(() => parseLearnPageContent({ seoTitle: "T", sections: [w, w] })).not.toThrow();
      expect(() => parseLearnPageContent({ seoTitle: w, sections: w, ogImage: w })).not.toThrow();
    }
  });
});
