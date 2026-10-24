import { describe, expect, it } from "vitest";

import { LEARN_PAGE_DEFAULT, type RichDoc, type RichNode } from "./learn-page.js";
import {
  RICH_DOC_LIMITS,
  emptyRichDoc,
  isColorValue,
  isRichContentEmpty,
  isRichDoc,
  isSafeRichHref,
  markdownToRichDoc,
  normalizeRichContent,
  richContentCharCount,
  richContentToPlainText,
  richContentWordCount,
  richDocHeadings,
  sanitizeRichDoc,
  slugifyAnchor,
  validateRichDoc,
} from "./rich-doc-core.js";

const doc = (...content: RichNode[]): RichDoc => ({ type: "doc", content });
const p = (...content: RichNode[]): RichNode => ({ type: "paragraph", content });
const t = (text: string, marks?: NonNullable<Extract<RichNode, { type: "text" }>["marks"]>): RichNode =>
  marks ? { type: "text", text, marks } : { type: "text", text };

/** Every node and mark in the contract, once. */
const KITCHEN_SINK: RichDoc = doc(
  { type: "heading", level: 1, align: "center", content: [t("Title")] },
  { type: "heading", level: 4, content: [t("Small")] },
  {
    type: "paragraph",
    align: "justify",
    content: [
      t("b", [{ type: "bold" }]),
      t("i", [{ type: "italic" }]),
      t("u", [{ type: "underline" }]),
      t("s", [{ type: "strike" }]),
      t("c", [{ type: "code" }]),
      t("sup", [{ type: "superscript" }]),
      t("sub", [{ type: "subscript" }]),
      { type: "hardBreak" },
      t("link", [{ type: "link", href: "https://example.com", newTab: true }]),
      t("anchor", [{ type: "link", href: "#team" }]),
      t("mail", [{ type: "link", href: "mailto:contact@knowledgegraph.tech" }]),
      t("tel", [{ type: "link", href: "tel:+15551234567" }]),
      t("page", [{ type: "link", href: "/tickets" }]),
      t("red", [{ type: "color", color: "#cc0000" }, { type: "highlight", color: "light-blue" }, { type: "fontSize", size: "x-large" }]),
    ],
  },
  { type: "bulletList", content: [{ type: "listItem", content: [p(t("one")), { type: "orderedList", start: 3, content: [{ type: "listItem", content: [p(t("nested"))] }] }] }] },
  { type: "blockquote", content: [p(t("quoted"))] },
  { type: "codeBlock", content: [t("const x = 1;")] },
  { type: "horizontalRule" },
  {
    type: "table",
    content: [
      { type: "tableRow", content: [{ type: "tableHeader", content: [p(t("H1"))] }, { type: "tableHeader", colspan: 2, content: [p(t("H2"))] }] },
      { type: "tableRow", content: [{ type: "tableCell", rowspan: 2, content: [p(t("a"))] }, { type: "tableCell", content: [p(t("b"))] }, { type: "tableCell", content: [p(t("c"))] }] },
    ],
  },
);

describe("validateRichDoc", () => {
  it("accepts every node and mark in the contract and returns an equal copy", () => {
    const r = validateRichDoc(KITCHEN_SINK);
    expect(r).toEqual({ ok: true, doc: KITCHEN_SINK });
    if (r.ok) expect(r.doc).not.toBe(KITCHEN_SINK);
  });

  it("drops unknown keys without complaint but never copies them", () => {
    const r = validateRichDoc({ type: "doc", extra: 1, content: [{ type: "paragraph", attrs: { style: "x" }, onclick: "y", content: [{ type: "text", text: "hi", html: "<b>" }] }] });
    expect(r).toEqual({ ok: true, doc: doc(p(t("hi"))) });
  });

  it.each([
    ["an unknown node", doc({ type: "image", src: "x" } as unknown as RichNode)],
    ["an html node", doc({ type: "html", html: "<script>" } as unknown as RichNode)],
    ["an unknown mark", doc(p(t("x", [{ type: "script" } as never])))],
    ["a javascript: link", doc(p(t("x", [{ type: "link", href: "javascript:alert(1)" }])))],
    ["a data: link", doc(p(t("x", [{ type: "link", href: "data:text/html,hi" }])))],
    ["a scheme-relative link", doc(p(t("x", [{ type: "link", href: "//evil.example" }])))],
    ["a backslash link", doc(p(t("x", [{ type: "link", href: "/\\evil.example" }])))],
    ["a link with a newline", doc(p(t("x", [{ type: "link", href: "https://a.b/\nx" }])))],
    ["an anchor with spaces", doc(p(t("x", [{ type: "link", href: "#Not An Anchor" }])))],
    ["a colour that is not hex", doc(p(t("x", [{ type: "color", color: "red" as never }])))],
    ["a short hex colour", doc(p(t("x", [{ type: "color", color: "#fff" }])))],
    ["a css injection colour", doc(p(t("x", [{ type: "highlight", color: "#000000;background:url(x)" as never }])))],
    ["a bad font size", doc(p(t("x", [{ type: "fontSize", size: "huge" as never }])))],
    ["heading level 5", doc({ type: "heading", level: 5 as never, content: [t("x")] })],
    ["a bad alignment", doc({ type: "paragraph", align: "middle" as never, content: [t("x")] })],
    ["a list item outside a list", doc({ type: "listItem", content: [p(t("x"))] })],
    ["a paragraph inside a paragraph", doc({ type: "paragraph", content: [p(t("x"))] })],
    ["a table nested in a table cell", doc({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "table", content: [] }] }] }] })],
    ["a bold mark inside a code block", doc({ type: "codeBlock", content: [{ type: "hardBreak" }] })],
    ["a huge colspan", doc({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", colspan: 99, content: [p(t("x"))] }] }] })],
    ["a negative list start", doc({ type: "orderedList", start: -1, content: [{ type: "listItem", content: [p(t("x"))] }] })],
    ["text that is not a string", doc(p({ type: "text", text: 5 } as never))],
    ["a doc that is not a doc", { type: "paragraph", content: [] }],
    ["a string", "hello"],
    ["an empty list", doc({ type: "bulletList", content: [] })],
  ])("refuses %s", (_name, input) => {
    const r = validateRichDoc(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.length).toBeGreaterThan(0);
  });

  it("caps the depth", () => {
    let node: RichNode = p(t("deep"));
    for (let i = 0; i < 12; i++) node = { type: "blockquote", content: [{ type: "bulletList", content: [{ type: "listItem", content: [node] }] }] };
    // Quotes may not nest directly, but list items in quotes can; the cap is what refuses this.
    const r = validateRichDoc(doc(node));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(" ")).toMatch(/nested more than|cannot hold/);
  });

  it("caps the depth even for shapes that are otherwise allowed", () => {
    let node: RichNode = p(t("deep"));
    for (let i = 0; i < 6; i++) node = { type: "bulletList", content: [{ type: "listItem", content: [node] }] };
    expect(validateRichDoc(doc(node)).ok).toBe(false);
    let ok: RichNode = p(t("fine"));
    for (let i = 0; i < 4; i++) ok = { type: "bulletList", content: [{ type: "listItem", content: [ok] }] };
    expect(validateRichDoc(doc(ok)).ok).toBe(true);
  });

  it("caps the number of nodes and the characters", () => {
    const many = doc(...Array.from({ length: RICH_DOC_LIMITS.nodes + 5 }, () => ({ type: "horizontalRule" }) as RichNode));
    expect(validateRichDoc(many).ok).toBe(false);
    const long = doc(p(t("x".repeat(101))));
    const r = validateRichDoc(long, { maxChars: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toEqual(["Text is longer than 100 characters."]);
    expect(validateRichDoc(long, { maxChars: 101 }).ok).toBe(true);
  });

  it("caps table rows and columns", () => {
    const cell = { type: "tableCell", content: [p(t("x"))] } as RichNode;
    const wide = doc({ type: "table", content: [{ type: "tableRow", content: Array(RICH_DOC_LIMITS.tableColumns + 1).fill(cell) }] });
    expect(validateRichDoc(wide).ok).toBe(false);
    const tall = doc({ type: "table", content: Array(RICH_DOC_LIMITS.tableRows + 1).fill({ type: "tableRow", content: [cell] }) });
    expect(validateRichDoc(tall).ok).toBe(false);
  });

  it("in inline mode allows only paragraphs of text and breaks", () => {
    expect(validateRichDoc(doc(p(t("a"), { type: "hardBreak" }, t("b", [{ type: "bold" }]))), { inline: true }).ok).toBe(true);
    expect(validateRichDoc(doc({ type: "heading", level: 2, content: [t("x")] }), { inline: true }).ok).toBe(false);
    expect(validateRichDoc(doc({ type: "bulletList", content: [{ type: "listItem", content: [p(t("x"))] }] }), { inline: true }).ok).toBe(false);
  });

  it("normalises: hex lower-cased, default alignment and start dropped, duplicate marks kept once, empty text dropped", () => {
    const r = validateRichDoc(
      doc(
        { type: "paragraph", align: "left", content: [t(""), t("x", [{ type: "bold" }, { type: "bold" }, { type: "color", color: "#AABBCC" }])] },
        { type: "orderedList", start: 1, content: [{ type: "listItem", content: [] }] },
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", colspan: 1, rowspan: 1, content: [] }] }] },
      ),
    );
    expect(r).toEqual({
      ok: true,
      doc: doc(
        p(t("x", [{ type: "bold" }, { type: "color", color: "#aabbcc" }])),
        { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph" }] }] }] },
      ),
    });
  });

  it("keeps code block text but strips its marks", () => {
    const r = validateRichDoc(doc({ type: "codeBlock", content: [t("x", [{ type: "bold" }])] }));
    expect(r).toEqual({ ok: true, doc: doc({ type: "codeBlock", content: [t("x")] }) });
  });
});

describe("sanitizeRichDoc", () => {
  it("keeps what it can: an unsafe link keeps its words, an unknown node goes", () => {
    const out = sanitizeRichDoc(
      doc(p(t("click", [{ type: "link", href: "javascript:alert(1)" }, { type: "bold" }])), { type: "iframe" } as never, p(t("after"))),
    );
    expect(out).toEqual(doc(p(t("click", [{ type: "bold" }])), p(t("after"))));
  });

  it("never throws, whatever it is given", () => {
    for (const v of [null, undefined, 5, "x", [], {}, { type: "doc" }, { type: "doc", content: "x" }, { type: "doc", content: [null, 1, "a"] }]) {
      expect(() => sanitizeRichDoc(v)).not.toThrow();
    }
    expect(sanitizeRichDoc({ type: "doc" })).toEqual(emptyRichDoc());
  });

  it("keeps over-long text (the editor shows the count; the server refuses)", () => {
    expect(richContentCharCount(sanitizeRichDoc(doc(p(t("x".repeat(50)))), { maxChars: 10 }))).toBe(50);
  });
});

describe("isSafeRichHref and isColorValue", () => {
  it.each(["https://knowledgegraph.tech", "http://example.com", "mailto:a@b.c", "tel:+1555", "/learn", "#team", "#mc-1"])("accepts %s", (h) =>
    expect(isSafeRichHref(h)).toBe(true),
  );
  it.each(["", "  ", "javascript:x", "vbscript:x", "data:x", "//x.y", "\\\\x", "#", "#Team", "#a b", "#-a", 5, null])("refuses %s", (h) =>
    expect(isSafeRichHref(h)).toBe(false),
  );
  it("knows the brand colours and #rrggbb only", () => {
    expect(["navy", "blue", "light-blue", "teal", "orange", "grey", "dark", "white", "#00aaFF"].every(isColorValue)).toBe(true);
    expect(["red", "#fff", "#gggggg", "rgb(0,0,0)", "", 1].some(isColorValue)).toBe(false);
  });
});

describe("markdownToRichDoc", () => {
  it("reads the same inline markers as rich-text-core", () => {
    expect(markdownToRichDoc("a **b** *c* _d_ `e` [f](https://x.y) [g](javascript:x)")).toEqual(
      doc(
        p(
          t("a "),
          t("b", [{ type: "bold" }]),
          t(" "),
          t("c", [{ type: "italic" }]),
          t(" "),
          t("d", [{ type: "italic" }]),
          t(" "),
          t("e", [{ type: "code" }]),
          t(" "),
          t("f", [{ type: "link", href: "https://x.y" }]),
          t(" "),
          t("g"),
        ),
      ),
    );
  });

  it("turns a single newline into a line break and a blank line into a new paragraph, as v1 drew it", () => {
    expect(markdownToRichDoc("Find the program\nthat is right for you\n\nNext")).toEqual(
      doc(p(t("Find the program"), { type: "hardBreak" }, t("that is right for you")), p(t("Next"))),
    );
  });

  it("reads headings (capped at level 4) and lists, with a numbered list keeping its start", () => {
    expect(markdownToRichDoc("# One\n##### Five\n- a\n- b\n\n3. c\n4. d")).toEqual(
      doc(
        { type: "heading", level: 1, content: [t("One")] },
        { type: "heading", level: 4, content: [t("Five")] },
        { type: "bulletList", content: [{ type: "listItem", content: [p(t("a"))] }, { type: "listItem", content: [p(t("b"))] }] },
        { type: "orderedList", start: 3, content: [{ type: "listItem", content: [p(t("c"))] }, { type: "listItem", content: [p(t("d"))] }] },
      ),
    );
  });

  it("in inline mode leaves heading and list markers as text", () => {
    expect(markdownToRichDoc("# not a heading\n- not a list", { inline: true })).toEqual(
      doc(p(t("# not a heading"), { type: "hardBreak" }, t("- not a list"))),
    );
  });

  it("never parses HTML", () => {
    expect(markdownToRichDoc("<script>alert(1)</script>")).toEqual(doc(p(t("<script>alert(1)</script>"))));
  });

  it("handles CRLF and an empty string", () => {
    expect(markdownToRichDoc("a\r\nb")).toEqual(doc(p(t("a"), { type: "hardBreak" }, t("b"))));
    expect(markdownToRichDoc("")).toEqual(emptyRichDoc());
  });

  it("produces docs the strict validator accepts, for every text in the default page", () => {
    const texts: string[] = [];
    JSON.stringify(LEARN_PAGE_DEFAULT, (k, v) => {
      if ((k === "text" || k === "bio") && typeof v === "string") texts.push(v);
      return v;
    });
    expect(texts.length).toBeGreaterThan(10);
    for (const s of texts) expect(validateRichDoc(markdownToRichDoc(s)).ok).toBe(true);
  });
});

describe("normalizeRichContent", () => {
  it("parses a string, sanitizes a doc, and empties anything else", () => {
    expect(normalizeRichContent("**x**")).toEqual(doc(p(t("x", [{ type: "bold" }]))));
    expect(normalizeRichContent(doc(p(t("x")), { type: "nope" } as never))).toEqual(doc(p(t("x"))));
    expect(normalizeRichContent(42)).toEqual(emptyRichDoc());
    expect(isRichDoc(normalizeRichContent(null))).toBe(true);
  });
});

describe("plain text, counts and headings", () => {
  it("reads a doc back one block per line, table cells by tab", () => {
    expect(richContentToPlainText(KITCHEN_SINK)).toBe(
      ["Title", "Small", "biuscsupsub", "linkanchormailtelpagered", "one", "nested", "quoted", "const x = 1;", "H1\tH2", "a\tb\tc"].join("\n"),
    );
  });

  it("collapses to one line on request, and reads Markdown the same way", () => {
    expect(richContentToPlainText("Meet the **KGC|Learn**\nContinuing Education Team", { oneLine: true })).toBe(
      "Meet the KGC|Learn Continuing Education Team",
    );
    expect(richContentToPlainText(null)).toBe("");
  });

  it("counts words that hold a letter or digit", () => {
    expect(richContentWordCount("Hello, world - it's 2027!")).toBe(4);
    expect(richContentWordCount(doc(p(t("one")), p(t("two three"))))).toBe(3);
    expect(richContentWordCount(emptyRichDoc())).toBe(0);
    expect(richContentWordCount("Café señor")).toBe(2);
  });

  it("counts characters of text only", () => {
    expect(richContentCharCount("**ab** c")).toBe(4);
    expect(richContentCharCount(doc(p(t("ab"), { type: "hardBreak" }, t("c"))))).toBe(3);
  });

  it("knows an empty doc from one with something to show", () => {
    expect(isRichContentEmpty("  ")).toBe(true);
    expect(isRichContentEmpty(doc({ type: "paragraph" }, { type: "paragraph" }))).toBe(true);
    expect(isRichContentEmpty(doc({ type: "horizontalRule" }))).toBe(false);
    expect(isRichContentEmpty(doc(p(t("x"))))).toBe(false);
    expect(isRichContentEmpty(undefined)).toBe(true);
  });

  it("lists headings for a table of contents, and slugs anchors", () => {
    expect(richDocHeadings(KITCHEN_SINK)).toEqual([
      { level: 1, text: "Title" },
      { level: 4, text: "Small" },
    ]);
    expect(richDocHeadings("## A\ntext\n### B")).toEqual([
      { level: 2, text: "A" },
      { level: 3, text: "B" },
    ]);
    expect(slugifyAnchor("Meet the KGC | Learn Team!")).toBe("meet-the-kgc-learn-team");
    expect(slugifyAnchor("François Scharffe")).toBe("francois-scharffe");
    expect(slugifyAnchor("---")).toBe("");
    expect(isSafeRichHref(`#${slugifyAnchor("Builder MC-1 Bricks")}`)).toBe(true);
  });
});

describe("isSafeRichHref shares isSafeHref's rules (T324 U2, U3)", () => {
  it("refuses backslash and control-character disguises", () => {
    for (const href of ["https:/\\evil.example", "https:\\\\evil.example", "http:\\\\evil.example", "/\\evil.example", "\\\\evil.example", "//evil.example", "\u0001https://evil.example", "https:evil.example"]) {
      expect(isSafeRichHref(href), JSON.stringify(href)).toBe(false);
      const doc = sanitizeRichDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", href }] }] }] });
      expect(JSON.stringify(doc)).not.toContain("evil");
    }
    expect(isSafeRichHref("https://example.com/a")).toBe(true);
  });

  it("drops inline handlers, styles and unknown attributes when it reads a stored doc", () => {
    const doc = sanitizeRichDoc({
      type: "doc",
      attrs: { onload: "alert(1)" },
      content: [
        {
          type: "paragraph",
          style: "background:url(javascript:alert(1))",
          attrs: { onclick: "alert(1)", class: "x" },
          onclick: "alert(1)",
          content: [
            {
              type: "text",
              text: "hi",
              style: "color:red",
              onmouseover: "alert(1)",
              marks: [
                { type: "link", href: "/a", onclick: "alert(1)", target: "_top", rel: "opener", style: "x" },
                { type: "color", color: "red;background:url(x)" },
                { type: "bold", attrs: { style: "x" } },
              ],
            },
          ],
        },
        { type: "html", html: "<img src=x onerror=alert(1)>" },
        { type: "image", attrs: { src: "https://evil.example/a.png" } },
      ],
    });
    expect(doc).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi", marks: [{ type: "link", href: "/a" }, { type: "bold" }] }] }],
    });
  });
});
