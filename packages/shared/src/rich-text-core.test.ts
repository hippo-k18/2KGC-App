import { describe, expect, it } from "vitest";

import {
  isSafeHref,
  parseInline,
  parseRichText,
  richTextToPlainText,
  spansToText,
} from "./rich-text-core.js";

describe("parseRichText", () => {
  it("splits blank-line-separated prose into paragraphs and joins wrapped lines", () => {
    const blocks = parseRichText("One line\nwrapped here.\n\nSecond paragraph.");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      spans: [{ kind: "text", text: "One line wrapped here." }],
    });
    expect(spansToText((blocks[1] as { spans: never[] }).spans)).toBe("Second paragraph.");
  });

  it("demotes every heading level into h2 and h3 so the page keeps one h1", () => {
    const blocks = parseRichText("# Top\n\n## Also top\n\n### Under\n\n###### Deep");
    expect(blocks.map((b) => (b.kind === "heading" ? b.level : 0))).toEqual([2, 2, 3, 3]);
  });

  it("builds bullet and numbered lists, and starts a new block when the kind changes", () => {
    const blocks = parseRichText("- one\n- two\n\n1. first\n2. second");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: "list", ordered: false });
    expect(blocks[1]).toMatchObject({ kind: "list", ordered: true });
    expect((blocks[0] as { items: never[][] }).items.map(spansToText)).toEqual(["one", "two"]);
  });

  it("continues a wrapped list item rather than opening a paragraph inside the list", () => {
    const blocks = parseRichText("- the network is KGC-Guest\n  and the password is on your badge");
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { items: never[][] }).items.map(spansToText)).toEqual([
      "the network is KGC-Guest and the password is on your badge",
    ]);
  });

  it("ends a list when a heading follows it with no blank line", () => {
    const blocks = parseRichText("- one\n## Next");
    expect(blocks.map((b) => b.kind)).toEqual(["list", "heading"]);
  });
});

describe("parseInline", () => {
  it("reads links, strong, emphasis and code in one left-to-right pass", () => {
    expect(parseInline("see [the map](https://example.com/m) **now**, *really* `x`")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: "the map", href: "https://example.com/m" },
      { kind: "text", text: " " },
      { kind: "strong", text: "now" },
      { kind: "text", text: ", " },
      { kind: "em", text: "really" },
      { kind: "text", text: " " },
      { kind: "code", text: "x" },
    ]);
  });

  it("does not carry its cursor from one call to the next", () => {
    parseInline("a **bold** tail that ends late");
    expect(parseInline("**first**")).toEqual([{ kind: "strong", text: "first" }]);
  });

  it("keeps the words of an unsafe link and refuses the click", () => {
    expect(parseInline("[tap here](javascript:alert1)")).toEqual([
      { kind: "text", text: "tap here" },
    ]);
    expect(parseInline("[x](//evil.example)")).toEqual([{ kind: "text", text: "x" }]);
  });

  it("allows relative and mailto targets", () => {
    expect(parseInline("[agenda](/agenda)")).toEqual([
      { kind: "link", text: "agenda", href: "/agenda" },
    ]);
    expect(parseInline("[write](mailto:hello@example.com)")[0]).toMatchObject({ kind: "link" });
  });
});

describe("raw HTML", () => {
  /**
   * The point of the whole design: there is no branch that looks at `<`, so a
   * script tag is four dozen characters of text and every renderer puts it in a
   * text node. If this test ever fails, something has grown an HTML path.
   */
  it("is text, not markup", () => {
    const blocks = parseRichText('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    expect(blocks.every((b) => b.kind === "paragraph")).toBe(true);
    expect(richTextToPlainText('<script>alert(1)</script>')).toBe("<script>alert(1)</script>");
  });
});

describe("isSafeHref", () => {
  it("allows the four schemes and relative targets, and nothing else", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
    expect(isSafeHref("http://example.com")).toBe(true);
    expect(isSafeHref("mailto:a@b.c")).toBe(true);
    expect(isSafeHref("tel:+15551234")).toBe(true);
    expect(isSafeHref("/agenda")).toBe(true);
    expect(isSafeHref("#wifi")).toBe(true);
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html,<script>")).toBe(false);
    expect(isSafeHref("  ")).toBe(false);
  });

  /**
   * The WHATWG URL parser treats `\` as `/` for http and https, so a browser
   * resolves `/\evil.example` to `https://evil.example` while a plain
   * `startsWith("//")` test calls it relative. `rich-text.tsx` reads "relative"
   * as "one of our own pages" and drops `rel="noreferrer noopener"` and the
   * new tab, which is exactly what the `//` check two lines above exists to
   * stop.
   */
  it("treats a backslash as a slash, so //host cannot be spelled around", () => {
    expect(isSafeHref("//evil.example")).toBe(false);
    expect(isSafeHref("/\\evil.example")).toBe(false);
    expect(isSafeHref("\\\\evil.example")).toBe(false);
    expect(isSafeHref("\\/evil.example")).toBe(false);
    // Still a relative link of ours, and still allowed.
    expect(isSafeHref("/speakers/ada-okonkwo")).toBe(true);
  });
});

describe("richTextToPlainText", () => {
  it("flattens a page into one line and closes headings with a full stop", () => {
    expect(richTextToPlainText("## Wi-Fi\n\nJoin **KGC-Guest**.\n\n- No password")).toBe(
      "Wi-Fi. Join KGC-Guest. No password",
    );
  });
});
