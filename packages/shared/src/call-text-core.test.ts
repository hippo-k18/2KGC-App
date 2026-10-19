import { describe, expect, it } from "vitest";

import {
  autolinkParts,
  callTextFromPlain,
  callTextToPlain,
  fillCallTextPlaceholders,
  parseCallText,
  sanitizeCallText,
  type CallTextDoc,
} from "./call-text-core.js";

const TOKENS = ["CLOSE DATE", "DECISION DATE"] as const;
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: unknown[]) => (marks ? { type: "text", text, marks } : { type: "text", text });

describe("sanitizeCallText: the allow-list", () => {
  it("keeps every supported node and mark", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [t("How we review")] },
        { type: "heading", attrs: { level: 3 }, content: [t("Talks")] },
        p(t("Bold", [{ type: "bold" }]), t(" and "), t("italic", [{ type: "italic" }]), { type: "hardBreak" }, t("next")),
        { type: "bulletList", content: [{ type: "listItem", content: [p(t("one"))] }] },
        { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p(t("three"))] }] },
        { type: "blockquote", content: [p(t("quoted"))] },
        p(t("site", [{ type: "link", attrs: { href: "https://example.com" } }])),
      ],
    };
    expect(sanitizeCallText(doc)).toEqual(doc);
  });

  it("drops nodes that are not on the list, with everything inside them", () => {
    const doc = sanitizeCallText({
      type: "doc",
      content: [
        { type: "image", attrs: { src: "https://x/y.png" } },
        { type: "codeBlock", content: [t("rm -rf /")] },
        { type: "script", content: [t("alert(1)")] },
        { type: "iframe", attrs: { src: "https://evil.example" } },
        { type: "table", content: [] },
        p(t("kept")),
      ],
    });
    expect(doc.content).toEqual([p(t("kept"))]);
  });

  it("keeps only bold, italic and safe links as marks, and drops attributes it does not know", () => {
    const doc = sanitizeCallText({
      type: "doc",
      content: [
        p(
          t("a", [{ type: "textStyle", attrs: { color: "red", fontFamily: "Comic Sans" } }]),
          t("b", [{ type: "underline" }, { type: "bold", attrs: { style: "x" } }]),
          t("c", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]),
          t("d", [{ type: "link", attrs: { href: "/\\evil.example" } }]),
          t("e", [{ type: "link", attrs: { href: "mailto:speakers@example.com", target: "_blank", onclick: "x" } }]),
        ),
      ],
    });
    expect(doc.content[0]).toEqual(
      p(t("a"), t("b", [{ type: "bold" }]), t("c"), t("d"), t("e", [{ type: "link", attrs: { href: "mailto:speakers@example.com" } }])),
    );
  });

  it("treats markup typed as text as text", () => {
    const doc = sanitizeCallText({ type: "doc", content: [p(t("<script>alert(1)</script>"))] });
    expect(doc.content[0]).toEqual(p(t("<script>alert(1)</script>")));
  });

  it("demotes heading levels so the page keeps its only h1", () => {
    const doc = sanitizeCallText({
      type: "doc",
      content: [1, 2, 3, 4, 6].map((level) => ({ type: "heading", attrs: { level }, content: [t("h")] })),
    });
    expect(doc.content.map((b) => (b.type === "heading" ? b.attrs.level : 0))).toEqual([2, 2, 3, 3, 3]);
  });

  it("drops empty paragraphs and trims breaks at the ends of a block", () => {
    const doc = sanitizeCallText({
      type: "doc",
      content: [{ type: "paragraph" }, p(t("   ")), p({ type: "hardBreak" }, t("x"), { type: "hardBreak" })],
    });
    expect(doc.content).toEqual([p(t("x"))]);
  });

  it("returns an empty document for anything that is not one", () => {
    for (const raw of [null, "doc", 3, [], { type: "paragraph" }, { type: "doc", content: "x" }]) {
      expect(sanitizeCallText(raw)).toEqual({ type: "doc", content: [] });
    }
  });
});

describe("parseCallText", () => {
  it("reads a stored document", () => {
    expect(parseCallText(JSON.stringify({ type: "doc", content: [p(t("Hi"))] }))).toEqual({
      type: "doc",
      content: [p(t("Hi"))],
    });
  });

  it("is null for nothing, broken JSON and a document with no text, so the plain text is used", () => {
    expect(parseCallText(undefined)).toBeNull();
    expect(parseCallText("")).toBeNull();
    expect(parseCallText("{not json")).toBeNull();
    expect(parseCallText(JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }))).toBeNull();
  });
});

describe("plain text, the old format", () => {
  const MIN = [
    "Call for Presentations. KGC 2027",
    "We welcome talks from practitioners.\nOne line under another.",
    "- Workshops: 90 minutes\n- Talks: 25 minutes",
    "Questions? Email speakers@knowledgegraph.tech.",
  ].join("\n\n");

  it("becomes the same paragraphs, line breaks and bullets the page has always shown", () => {
    expect(callTextFromPlain(MIN).content).toEqual([
      p(t("Call for Presentations. KGC 2027")),
      p(t("We welcome talks from practitioners."), { type: "hardBreak" }, t("One line under another.")),
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [p(t("Workshops: 90 minutes"))] },
          { type: "listItem", content: [p(t("Talks: 25 minutes"))] },
        ],
      },
      p(t("Questions? Email speakers@knowledgegraph.tech.")),
    ]);
  });

  it("keeps every word, and survives the sanitiser unchanged", () => {
    const doc = callTextFromPlain(MIN);
    expect(sanitizeCallText(doc)).toEqual(doc);
    expect(callTextToPlain(doc)).toBe(MIN);
  });

  it("reads Windows line breaks and never parses markers as formatting", () => {
    const doc = callTextFromPlain("**not bold** and # not a heading\r\n\r\n1. not a list");
    expect(callTextToPlain(doc)).toBe("**not bold** and # not a heading\n\n1. not a list");
    expect(doc.content.every((b) => b.type === "paragraph")).toBe(true);
  });

  it("writes numbered lists and headings back out as readable text", () => {
    const doc: CallTextDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [t("Dates")] },
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [p(t("Submit"))] },
            { type: "listItem", content: [p(t("Hear back"))] },
          ],
        },
      ],
    };
    expect(callTextToPlain(doc)).toBe("Dates\n\n1. Submit\n2. Hear back");
  });
});

describe("fillCallTextPlaceholders", () => {
  const set = { "CLOSE DATE": "Sunday 31 January 2027", "DECISION DATE": "Sunday 14 February 2027" };
  const doc: CallTextDoc = {
    type: "doc",
    content: [
      p(t("How we review. We read every week.")),
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [p(t("Not hearing from us is not a no. Every submission gets a decision by [DECISION DATE] at the latest."))],
          },
          { type: "listItem", content: [p(t("Decisions by [DECISION DATE]."))] },
        ],
      },
      p(t("Submissions close "), t("[CLOSE DATE]", [{ type: "bold" }]), t(".")),
    ],
  };

  it("fills both dates, and a filled date keeps the formatting of its placeholder", () => {
    const out = fillCallTextPlaceholders(doc, set, TOKENS);
    expect(out.content[2]).toEqual(
      p(t("Submissions close "), t("Sunday 31 January 2027", [{ type: "bold" }]), t(".")),
    );
    expect(callTextToPlain(out)).not.toMatch(/\[/);
  });

  it("leaves out the sentence, an emptied bullet and an emptied paragraph when a date is unset", () => {
    const out = fillCallTextPlaceholders(doc, {}, TOKENS);
    expect(callTextToPlain(out)).toBe("How we review. We read every week.\n\n- Not hearing from us is not a no.");
  });

  it("drops only the line of a paragraph that held the unset date", () => {
    const out = fillCallTextPlaceholders(
      { type: "doc", content: [p(t("First line."), { type: "hardBreak" }, t("Closes [CLOSE DATE]."), { type: "hardBreak" }, t("Last."))] },
      {},
      TOKENS,
    );
    expect(out.content).toEqual([p(t("First line."), { type: "hardBreak" }, t("Last."))]);
  });

  it("treats a bracketed word that is not a known placeholder as unset, as the plain-text version does", () => {
    const out = fillCallTextPlaceholders({ type: "doc", content: [p(t("Keep. Drop [VENUE]."))] }, set, TOKENS);
    expect(callTextToPlain(out)).toBe("Keep.");
  });
});

describe("autolinkParts", () => {
  it("turns a bare email into a mailto link and leaves the full stop after it", () => {
    expect(autolinkParts("Email speakers@knowledgegraph.tech.")).toEqual([
      { text: "Email " },
      { text: "speakers@knowledgegraph.tech", href: "mailto:speakers@knowledgegraph.tech" },
      { text: "." },
    ]);
  });

  it("links a web address and leaves text without one alone", () => {
    expect(autolinkParts("See https://www.knowledgegraph.tech/sponsor, then apply")).toEqual([
      { text: "See " },
      { text: "https://www.knowledgegraph.tech/sponsor", href: "https://www.knowledgegraph.tech/sponsor" },
      { text: ", then apply" },
    ]);
    expect(autolinkParts("No links here")).toEqual([{ text: "No links here" }]);
  });
});
