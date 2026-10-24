import { describe, expect, it } from "vitest";
import { isSafeHref, parseInline, type InlineSpan } from "./rich-text-core.js";

/** The regular expression `parseInline` used to be (quadratic, T324 U1), as the reference for its rules. */
function reference(text: string): InlineSpan[] {
  const INLINE = /\[([^\]\n]*)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_|`([^`\n]+)`/g;
  const spans: InlineSpan[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) spans.push({ kind: "text", text: text.slice(last, m.index) });
    last = m.index + m[0].length;
    const [, linkText, href, strong, star, underscore, code] = m;
    if (href !== undefined) {
      const label = linkText === "" ? href : linkText;
      spans.push(isSafeHref(href) ? { kind: "link", text: label, href: href.trim() } : { kind: "text", text: label });
    } else if (strong !== undefined) spans.push({ kind: "strong", text: strong });
    else if (star !== undefined) spans.push({ kind: "em", text: star });
    else if (underscore !== undefined) spans.push({ kind: "em", text: underscore });
    else if (code !== undefined) spans.push({ kind: "code", text: code });
  }
  if (last < text.length) spans.push({ kind: "text", text: text.slice(last) });
  return spans;
}

describe("parseInline is linear (T324 U1)", () => {
  it("gives the same spans as the old regular expression", () => {
    const cases = [
      "",
      "plain",
      "**bold** and *em* and _em_ and `code`",
      "[link](/agenda) [](/x) [a](javascript:alert(1)) [b](https://x.test/a b)",
      "***x***",
      "**a*b**",
      "* not em *",
      "[a]\n(/x)",
      "[a](/x\n)",
      "**\n**",
      "`a\nb`",
      "_a_b_",
      "[[x](/a)]",
      "[x](/a))",
      "x [y](/p q) z",
    ];
    // Random strings over the marker alphabet.
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const alphabet = ["[", "]", "(", ")", "*", "_", "`", "\n", " ", "a", "/", "\t", "h"];
    for (let k = 0; k < 3000; k++) {
      const len = Math.floor(rand() * 24);
      let s = "";
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rand() * alphabet.length)];
      cases.push(s);
    }
    for (const c of cases) expect(parseInline(c), JSON.stringify(c)).toEqual(reference(c));
  });

  it("parses 100,000 of any one marker in well under a second", () => {
    for (const ch of ["[", "*", "_", "(", "`", "[]", "[](", "**a", "](", "[a](b"]) {
      const text = ch.repeat(Math.ceil(1e5 / ch.length));
      const t0 = performance.now();
      parseInline(text);
      const ms = performance.now() - t0;
      expect(ms, `${JSON.stringify(ch)} took ${ms.toFixed(0)} ms`).toBeLessThan(200);
    }
  });
});

describe("isSafeHref refuses links the browser takes off-site (T324 U2, U3)", () => {
  it("refuses backslashes, missing slashes and control characters around the scheme and host", () => {
    for (const href of [
      "https:/\\evil.example",
      "https:\\\\evil.example",
      "http:\\\\evil.example",
      "https:\\/evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "//evil.example",
      "https:evil.example",
      "https:/evil.example",
      "https:///evil.example",
      "https://good.example\\@evil.example",
      "https://good .example",
      "\u0001https://evil.example",
      "\u0000https://evil.example",
      "\u001fhttps://evil.example",
      "\u007fhttps://evil.example",
      "ht\ttps://evil.example",
      "https:/\t/evil.example",
      "https://evil.example/\u0001",
      "java\tscript:alert(1)",
      "JAVASCRIPT:alert(1)",
    ]) {
      expect(isSafeHref(href), JSON.stringify(href)).toBe(false);
    }
  });

  it("still allows the usual links", () => {
    for (const href of [
      "https://example.com",
      "HTTPS://Example.com/a?b=c#d",
      "http://example.com:8080/x",
      "https://example.com/a\\b",
      "  https://example.com  ",
      "mailto:contact@knowledgegraph.tech",
      "mailto:a@b.c?subject=Hello there",
      "tel:+1 555 1234",
      "/agenda",
      "/learn#numbers",
      "#wifi",
    ]) {
      expect(isSafeHref(href), JSON.stringify(href)).toBe(true);
    }
  });
});
