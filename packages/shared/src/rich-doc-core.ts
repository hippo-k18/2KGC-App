/**
 * Pure helpers for the Learn page's rich text (T315): check a `RichDoc`
 * against the contract, turn a v1 Markdown string into one, and read one back
 * as plain text. The server validator, the editor and both renderers use these
 * so that "what a RichDoc may contain" is written down exactly once.
 *
 * ── A whitelist, rebuilt key by key ─────────────────────────────────────────
 *
 * A RichDoc arrives from a browser as JSON and is rendered on www. So nothing
 * in it is trusted: every node type, mark type and attribute is checked against
 * the lists below, and the output is a fresh object built from the checked
 * values, never the input with bad parts removed. Unknown keys are dropped.
 * There is no HTML anywhere on this path, and there must never be: renderers
 * map each node to a component and put text in text nodes.
 *
 * Two entry points, same rules:
 * - `validateRichDoc` is strict and says what is wrong (the server uses it on
 *   save, so a crafted request is refused, not quietly altered).
 * - `sanitizeRichDoc` is lenient and drops what it cannot keep (the editor uses
 *   it on paste, the renderers on read).
 *
 * ── v1 Markdown strings ─────────────────────────────────────────────────────
 *
 * `markdownToRichDoc` reads the same inline markers as `rich-text-core`
 * (`**bold**`, `*italic*`, `_italic_`, `` `code` ``, `[text](href)`), plus
 * `#` headings and `-` / `1.` lists. Inside a paragraph a single newline is a
 * line break, because that is how the v1 Learn page drew "Find the program\nthat
 * is right for you"; a blank line starts a new paragraph.
 */

import { isSafeHref, parseInline } from "./rich-text-core.js";
import type { ColorValue, RichContent, RichDoc, RichMark, RichNode, TextAlign, TextSize } from "./learn-page.js";

export const RICH_DOC_LIMITS = {
  /** Nesting depth below the doc (three levels of list inside a quote fits easily). */
  depth: 10,
  /** Nodes of any kind, text runs included. */
  nodes: 5_000,
  /** Characters of text, the default when the caller gives no `maxChars`. */
  chars: 20_000,
  href: 2_000,
  marksPerText: 11,
  listItems: 200,
  tableRows: 100,
  tableColumns: 20,
  span: 20,
  orderedStart: 100_000,
} as const;

export const RICH_COLOR_NAMES = ["navy", "blue", "light-blue", "teal", "orange", "grey", "dark", "white"] as const;
const TEXT_ALIGNS: readonly TextAlign[] = ["left", "center", "right", "justify"];
const FONT_SIZES: readonly TextSize[] = ["small", "normal", "large", "x-large"];
const HEADING_LEVELS = [1, 2, 3, 4] as const;

/** Marks that carry nothing but their type. */
const PLAIN_MARKS = ["bold", "italic", "underline", "strike", "code", "superscript", "subscript"] as const;

/** Block nodes allowed at the top of a doc, inside a quote, list item or table cell. */
const BLOCKS = ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock", "horizontalRule", "table"];
const IN_LIST_ITEM = ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock"];
const IN_QUOTE = ["paragraph", "heading", "bulletList", "orderedList", "codeBlock", "horizontalRule"];
const IN_CELL = ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock"];
/** In an inline-only field (a title, a heading block) the doc holds paragraphs of text. */
const INLINE_ONLY = ["paragraph"];

/** A brand colour by name or a `#rrggbb` hex. */
export function isColorValue(v: unknown): v is ColorValue {
  if (typeof v !== "string") return false;
  return (RICH_COLOR_NAMES as readonly string[]).includes(v) || /^#[0-9a-fA-F]{6}$/.test(v);
}

/** Lower-cases a hex colour so two spellings of the same colour compare equal. */
export function normalizeColor(v: ColorValue): ColorValue {
  return v.startsWith("#") ? (v.toLowerCase() as ColorValue) : v;
}

/**
 * May a link in rich text point here? `isSafeHref` (https, http, mailto, tel,
 * `/path`, `#anchor`), with no whitespace or control characters, and an
 * in-page anchor must be a real anchor name (lower-case letters, digits, dashes).
 */
export function isSafeRichHref(href: unknown): href is string {
  if (typeof href !== "string") return false;
  const s = href.trim();
  if (s === "" || s.length > RICH_DOC_LIMITS.href) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(s)) return false;
  if (s.startsWith("#")) return /^#[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
  return isSafeHref(s);
}

/** Is this value a doc at all (shape only, not checked)? Tells the two halves of `RichContent` apart. */
export function isRichDoc(v: unknown): v is RichDoc {
  return isObj(v) && v.type === "doc";
}

export function emptyRichDoc(): RichDoc {
  return { type: "doc", content: [] };
}

export interface RichDocOptions {
  /** Most characters of text allowed. Defaults to `RICH_DOC_LIMITS.chars`. */
  maxChars?: number;
  /** Paragraphs of text only (headings, titles): no lists, quotes, tables or rules. */
  inline?: boolean;
}

export type RichDocValidation = { ok: true; doc: RichDoc } | { ok: false; problems: string[] };

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Walks a doc once, building the clean copy and noting each problem. */
class Walker {
  problems: string[] = [];
  nodes = 0;
  chars = 0;
  constructor(
    readonly strict: boolean,
    readonly maxChars: number,
  ) {}

  problem(what: string) {
    if (this.problems.length < 20) this.problems.push(what);
  }

  /** Children of a container, keeping only node types listed in `allowed`. */
  children(v: unknown, allowed: readonly string[], depth: number, where: string, max = Infinity): RichNode[] {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      this.problem(`${where} content must be a list.`);
      return [];
    }
    if (v.length > max) this.problem(`${where} has ${v.length} entries; the limit is ${max}.`);
    const out: RichNode[] = [];
    for (const child of v.slice(0, max)) {
      const node = this.node(child, allowed, depth, where);
      if (node) out.push(node);
    }
    return out;
  }

  node(v: unknown, allowed: readonly string[], depth: number, where: string): RichNode | null {
    if (depth > RICH_DOC_LIMITS.depth) {
      this.problem(`Text is nested more than ${RICH_DOC_LIMITS.depth} levels deep.`);
      return null;
    }
    if (++this.nodes > RICH_DOC_LIMITS.nodes) {
      if (this.nodes === RICH_DOC_LIMITS.nodes + 1) this.problem(`Text has more than ${RICH_DOC_LIMITS.nodes} parts.`);
      return null;
    }
    if (!isObj(v) || typeof v.type !== "string") {
      this.problem(`${where} has a malformed part.`);
      return null;
    }
    const type = v.type;
    if (!allowed.includes(type)) {
      this.problem(`${where} cannot hold "${type.slice(0, 40)}".`);
      return null;
    }
    const d = depth + 1;
    switch (type) {
      case "text":
        return this.text(v, where);
      case "hardBreak":
        return { type: "hardBreak" };
      case "horizontalRule":
        return { type: "horizontalRule" };
      case "paragraph": {
        const out: RichNode & { type: "paragraph" } = { type: "paragraph" };
        const align = this.align(v.align, where);
        if (align) out.align = align;
        const content = this.children(v.content, ["text", "hardBreak"], d, "A paragraph");
        if (content.length) out.content = content;
        return out;
      }
      case "heading": {
        let level = v.level as 1 | 2 | 3 | 4;
        if (!(HEADING_LEVELS as readonly unknown[]).includes(level)) {
          this.problem(`${where} has a heading level that is not 1 to 4.`);
          level = 2;
        }
        const out: RichNode & { type: "heading" } = { type: "heading", level };
        const align = this.align(v.align, where);
        if (align) out.align = align;
        const content = this.children(v.content, ["text", "hardBreak"], d, "A heading");
        if (content.length) out.content = content;
        return out;
      }
      case "bulletList":
      case "orderedList": {
        const content = this.children(v.content, ["listItem"], d, "A list", RICH_DOC_LIMITS.listItems);
        if (content.length === 0) return this.empty(where, "list");
        if (type === "bulletList") return { type, content };
        const out: RichNode & { type: "orderedList" } = { type, content };
        if (v.start !== undefined && v.start !== null && v.start !== 1) {
          if (typeof v.start === "number" && Number.isInteger(v.start) && v.start >= 0 && v.start <= RICH_DOC_LIMITS.orderedStart) {
            out.start = v.start;
          } else {
            this.problem(`${where} has a numbered list that starts at an odd number.`);
          }
        }
        return out;
      }
      case "listItem": {
        const content = this.children(v.content, IN_LIST_ITEM, d, "A list item");
        return { type, content: content.length ? content : [{ type: "paragraph" }] };
      }
      case "blockquote": {
        const content = this.children(v.content, IN_QUOTE, d, "A quote");
        if (content.length === 0) return this.empty(where, "quote");
        return { type, content };
      }
      case "codeBlock": {
        const content = this.children(v.content, ["text"], d, "A code block").map((t) =>
          t.type === "text" ? { type: "text" as const, text: t.text } : t,
        );
        return content.length ? { type, content } : { type };
      }
      case "table": {
        const rows = this.children(v.content, ["tableRow"], d, "A table", RICH_DOC_LIMITS.tableRows);
        if (rows.length === 0) return this.empty(where, "table");
        return { type, content: rows };
      }
      case "tableRow": {
        const cells = this.children(v.content, ["tableHeader", "tableCell"], d, "A table row", RICH_DOC_LIMITS.tableColumns);
        if (cells.length === 0) return this.empty(where, "table row");
        return { type, content: cells };
      }
      case "tableHeader":
      case "tableCell": {
        const content = this.children(v.content, IN_CELL, d, "A table cell");
        const out: RichNode & { type: "tableHeader" | "tableCell" } = {
          type,
          content: content.length ? content : [{ type: "paragraph" }],
        };
        const colspan = this.span(v.colspan, where);
        const rowspan = this.span(v.rowspan, where);
        if (colspan) out.colspan = colspan;
        if (rowspan) out.rowspan = rowspan;
        return out;
      }
      default:
        this.problem(`${where} cannot hold "${type.slice(0, 40)}".`);
        return null;
    }
  }

  /** An empty list, quote or table is dropped; strict mode says so. */
  empty(where: string, what: string): null {
    this.problem(`${where} has an empty ${what}.`);
    return null;
  }

  text(v: Obj, where: string): RichNode | null {
    if (typeof v.text !== "string") {
      this.problem(`${where} has text that is not text.`);
      return null;
    }
    // ProseMirror cannot hold an empty text node; one is dropped, not an error.
    if (v.text === "") return null;
    this.chars += v.text.length;
    if (this.chars > this.maxChars && this.chars - v.text.length <= this.maxChars) {
      this.problem(`Text is longer than ${this.maxChars} characters.`);
    }
    const out: RichNode & { type: "text" } = { type: "text", text: v.text };
    const marks = this.marks(v.marks, where);
    if (marks.length) out.marks = marks;
    return out;
  }

  marks(v: unknown, where: string): RichMark[] {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      this.problem(`${where} has formatting that is not a list.`);
      return [];
    }
    const out: RichMark[] = [];
    const seen = new Set<string>();
    for (const m of v.slice(0, RICH_DOC_LIMITS.marksPerText)) {
      const mark = this.mark(m, where);
      if (!mark) continue;
      // One of each kind: two links on the same run would be ambiguous.
      if (seen.has(mark.type)) continue;
      seen.add(mark.type);
      out.push(mark);
    }
    if (v.length > RICH_DOC_LIMITS.marksPerText) this.problem(`${where} has too much formatting on one run of text.`);
    return out;
  }

  mark(m: unknown, where: string): RichMark | null {
    if (!isObj(m) || typeof m.type !== "string") {
      this.problem(`${where} has malformed formatting.`);
      return null;
    }
    const type = m.type;
    if ((PLAIN_MARKS as readonly string[]).includes(type)) return { type } as RichMark;
    switch (type) {
      case "link": {
        if (!isSafeRichHref(m.href)) {
          this.problem(`${where} has a link "${String(m.href).slice(0, 80)}" the site cannot open.`);
          return null;
        }
        const out: RichMark & { type: "link" } = { type, href: m.href.trim() };
        if (m.newTab === true) out.newTab = true;
        return out;
      }
      case "color":
      case "highlight":
        if (!isColorValue(m.color)) {
          this.problem(`${where} has a colour that is not a brand colour or #rrggbb.`);
          return null;
        }
        return { type, color: normalizeColor(m.color) };
      case "fontSize":
        if (!(FONT_SIZES as readonly unknown[]).includes(m.size)) {
          this.problem(`${where} has a text size that is not small, normal, large or x-large.`);
          return null;
        }
        return { type, size: m.size as TextSize };
      default:
        this.problem(`${where} has unknown formatting "${type.slice(0, 40)}".`);
        return null;
    }
  }

  align(v: unknown, where: string): TextAlign | undefined {
    if (v === undefined || v === null || v === "left") return undefined;
    if ((TEXT_ALIGNS as readonly unknown[]).includes(v)) return v as TextAlign;
    this.problem(`${where} has an alignment that is not left, center, right or justify.`);
    return undefined;
  }

  span(v: unknown, where: string): number | undefined {
    if (v === undefined || v === null || v === 1) return undefined;
    if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= RICH_DOC_LIMITS.span) return v;
    this.problem(`${where} has a table cell that spans an odd number of cells.`);
    return undefined;
  }
}

function walk(input: unknown, strict: boolean, opts: RichDocOptions): { doc: RichDoc; problems: string[] } {
  const w = new Walker(strict, opts.maxChars ?? RICH_DOC_LIMITS.chars);
  if (!isRichDoc(input)) {
    w.problem("Text is malformed.");
    return { doc: emptyRichDoc(), problems: w.problems };
  }
  const content = w.children(input.content, opts.inline ? INLINE_ONLY : BLOCKS, 0, "The text");
  return { doc: { type: "doc", content }, problems: w.problems };
}

/**
 * Check `input` strictly and rebuild it from the whitelist. Any node, mark or
 * attribute value outside the contract, an unsafe link, a bad colour or a cap
 * exceeded is a problem; unknown keys are dropped silently.
 */
export function validateRichDoc(input: unknown, opts: RichDocOptions = {}): RichDocValidation {
  const { doc, problems } = walk(input, true, opts);
  return problems.length ? { ok: false, problems } : { ok: true, doc };
}

/**
 * Keep whatever of `input` is allowed and drop the rest; never throws. A link
 * with an unsafe target keeps its words and loses the link. Text past the
 * character cap is kept (the editor shows the count; the server refuses it).
 */
export function sanitizeRichDoc(input: unknown, opts: RichDocOptions = {}): RichDoc {
  return walk(input, false, opts).doc;
}

/** Either half of `RichContent` as a clean doc: a string is parsed, a doc sanitized, anything else is empty. */
export function normalizeRichContent(content: unknown, opts: RichDocOptions = {}): RichDoc {
  if (typeof content === "string") return markdownToRichDoc(content, opts);
  if (isRichDoc(content)) return sanitizeRichDoc(content, opts);
  return emptyRichDoc();
}

// ---------------------------------------------------------------------------
// Markdown to RichDoc
// ---------------------------------------------------------------------------

const MD_HEADING = /^(#{1,6})\s+(.*)$/;
const MD_BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const MD_NUMBERED = /^\s{0,3}(\d+)[.)]\s+(.*)$/;

/** One line of Markdown as text runs, using `rich-text-core`'s inline parser. */
function inlineNodes(line: string): RichNode[] {
  const out: RichNode[] = [];
  for (const s of parseInline(line)) {
    if (s.text === "") continue;
    switch (s.kind) {
      case "strong":
        out.push({ type: "text", text: s.text, marks: [{ type: "bold" }] });
        break;
      case "em":
        out.push({ type: "text", text: s.text, marks: [{ type: "italic" }] });
        break;
      case "code":
        out.push({ type: "text", text: s.text, marks: [{ type: "code" }] });
        break;
      case "link":
        out.push(
          isSafeRichHref(s.href)
            ? { type: "text", text: s.text, marks: [{ type: "link", href: s.href }] }
            : { type: "text", text: s.text },
        );
        break;
      default:
        out.push({ type: "text", text: s.text });
    }
  }
  return out;
}

/** Lines joined by hard breaks. */
function linesToInline(lines: string[]): RichNode[] {
  const out: RichNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push({ type: "hardBreak" });
    out.push(...inlineNodes(line));
  });
  return out;
}

/**
 * A v1 Markdown string as a RichDoc. With `inline`, headings and lists are not
 * recognised (their markers stay as text), matching how the v1 page drew a
 * heading block's text.
 */
export function markdownToRichDoc(markdown: string, opts: RichDocOptions = {}): RichDoc {
  const content: RichNode[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; start: number; items: string[][] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const inline = linesToInline(paragraph);
    content.push(inline.length ? { type: "paragraph", content: inline } : { type: "paragraph" });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items: RichNode[] = list.items.map((lines) => {
      const inline = linesToInline(lines);
      return { type: "listItem", content: [inline.length ? { type: "paragraph", content: inline } : { type: "paragraph" }] };
    });
    if (list.ordered) {
      content.push(list.start === 1 ? { type: "orderedList", content: items } : { type: "orderedList", start: list.start, content: items });
    } else {
      content.push({ type: "bulletList", content: items });
    }
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    if (!opts.inline) {
      const heading = MD_HEADING.exec(line);
      if (heading) {
        flushParagraph();
        flushList();
        const level = Math.min(heading[1].length, 4) as 1 | 2 | 3 | 4;
        const inline = inlineNodes(heading[2].trim());
        content.push(inline.length ? { type: "heading", level, content: inline } : { type: "heading", level });
        continue;
      }
      const bullet = MD_BULLET.exec(line);
      const numbered = bullet ? null : MD_NUMBERED.exec(line);
      if (bullet || numbered) {
        flushParagraph();
        const ordered = numbered !== null;
        if (!list || list.ordered !== ordered) {
          flushList();
          const start = numbered ? Math.min(Number(numbered[1]), RICH_DOC_LIMITS.orderedStart) : 1;
          list = { ordered, start, items: [] };
        }
        list.items.push([(bullet ? bullet[1] : numbered![2]).trim()]);
        continue;
      }
      // A plain line right after a bullet continues that bullet on a new line.
      if (list && list.items.length > 0) {
        list.items[list.items.length - 1].push(line.trim());
        continue;
      }
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return { type: "doc", content };
}

// ---------------------------------------------------------------------------
// Reading a doc back
// ---------------------------------------------------------------------------

const BLOCKISH = new Set(["paragraph", "heading", "codeBlock", "listItem", "blockquote", "tableRow", "horizontalRule"]);

function collect(nodes: readonly RichNode[] | undefined, out: string[]) {
  for (const n of nodes ?? []) {
    switch (n.type) {
      case "text":
        out.push(n.text);
        break;
      case "hardBreak":
        out.push("\n");
        break;
      case "tableHeader":
      case "tableCell": {
        // A cell's own paragraphs share its line, so a row stays one line.
        const cell: string[] = [];
        collect(n.content, cell);
        out.push(cell.join("").replace(/\s+/g, " ").trim(), "\t");
        break;
      }
      default:
        if ("content" in n) collect(n.content, out);
    }
    if (BLOCKISH.has(n.type)) out.push("\n");
  }
}

/**
 * The words of a doc or Markdown string, one block per line (table cells
 * separated by tabs). With `oneLine`, all whitespace collapses to single
 * spaces, for a search description or an aria label.
 */
export function richContentToPlainText(content: RichContent | null | undefined, opts: { oneLine?: boolean } = {}): string {
  if (content === null || content === undefined) return "";
  const doc = typeof content === "string" ? markdownToRichDoc(content) : content;
  if (!isRichDoc(doc)) return "";
  const out: string[] = [];
  collect(doc.content, out);
  const text = out.join("");
  if (opts.oneLine) return text.replace(/\s+/g, " ").trim();
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, "").replace(/\t+/g, "\t"))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Words as a reader counts them: runs separated by spaces that hold a letter or a digit. */
export function richContentWordCount(content: RichContent | null | undefined): number {
  const text = richContentToPlainText(content, { oneLine: true });
  if (text === "") return 0;
  return text.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Characters of text (what the server caps), not counting markers or breaks. */
export function richContentCharCount(content: RichContent | null | undefined): number {
  if (content === null || content === undefined) return 0;
  const doc = typeof content === "string" ? markdownToRichDoc(content) : content;
  let n = 0;
  const visit = (nodes: readonly RichNode[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === "text") n += node.text.length;
      else if ("content" in node) visit(node.content);
    }
  };
  if (isRichDoc(doc)) visit(doc.content);
  return n;
}

/** True when there are no words to show (an empty doc, only blank paragraphs, or blank Markdown). */
export function isRichContentEmpty(content: RichContent | null | undefined): boolean {
  if (content === null || content === undefined) return true;
  if (typeof content === "string") return content.trim() === "";
  if (!isRichDoc(content)) return true;
  if (richContentToPlainText(content).trim() !== "") return false;
  // A rule or a table with empty cells is still something on the page.
  const hasShape = (nodes: readonly RichNode[] | undefined): boolean =>
    (nodes ?? []).some((n) => n.type === "horizontalRule" || n.type === "table" || ("content" in n && hasShape(n.content)));
  return !hasShape(content.content);
}

/** An anchor name from heading text: lower case, letters and digits, dashes between words. */
export function slugifyAnchor(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

/** Headings inside a doc, in order, for a table of contents. */
export function richDocHeadings(content: RichContent | null | undefined): { level: 1 | 2 | 3 | 4; text: string }[] {
  if (content === null || content === undefined) return [];
  const doc = typeof content === "string" ? markdownToRichDoc(content) : content;
  const out: { level: 1 | 2 | 3 | 4; text: string }[] = [];
  const visit = (nodes: readonly RichNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === "heading") {
        const text = richContentToPlainText({ type: "doc", content: [{ type: "paragraph", content: n.content }] }, { oneLine: true });
        if (text) out.push({ level: n.level, text });
      } else if ("content" in n) visit(n.content);
    }
  };
  if (isRichDoc(doc)) visit(doc.content);
  return out;
}
