/**
 * The formatted text of a call for speakers: what the dashboard's editor saves
 * and what `/submit/{callId}` renders (T277).
 *
 * ── Stored as a document tree, never as HTML ────────────────────────────────
 *
 * The editor is TipTap, the same as the blog's, and like the blog the call saves
 * TipTap's JSON tree rather than HTML (`apps/web/src/lib/blog/doc.ts` explains
 * the reasoning). The website turns the tree into React elements, so there is
 * no HTML parser between the organizer's keyboard and the public page and no
 * string a browser could run.
 *
 * The browser is not trusted to have sent a tree the editor could produce.
 * `sanitizeCallText` keeps only the node types, marks and attributes listed
 * below and checks every link with `isSafeHref`. The dashboard runs it before
 * saving and the website runs it again before rendering, so a document written
 * by hand in the Firebase console is held to the same rules.
 *
 * The list is shorter than the blog's on purpose: paragraphs, two heading
 * levels, bold, italic, links, bulleted and numbered lists, and quotes. No
 * images, tables, embeds, colours or fonts. Pasting from Google Docs or Word
 * keeps what is on the list and drops everything else.
 *
 * ── Old calls are plain text, and stay that way until someone edits them ────
 *
 * `CallDoc.instructions` was plain text before this. A call without
 * `instructionsDoc` is rendered by the old plain-text path, unchanged.
 * `callTextFromPlain` turns that text into a document with the same shape
 * (paragraphs on blank lines, line breaks kept, "- " lines as a bulleted list),
 * which is what the editor opens with.
 */

import { isSafeHref } from "./rich-text-core.js";

export type CallTextMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "link"; attrs: { href: string } };

export type CallTextInline =
  | { type: "text"; text: string; marks?: CallTextMark[] }
  | { type: "hardBreak" };

export type CallTextListItem = { type: "listItem"; content: CallTextBlock[] };

export type CallTextBlock =
  | { type: "paragraph"; content?: CallTextInline[] }
  | { type: "heading"; attrs: { level: 2 | 3 }; content?: CallTextInline[] }
  | { type: "bulletList"; content: CallTextListItem[] }
  | { type: "orderedList"; attrs?: { start: number }; content: CallTextListItem[] }
  | { type: "blockquote"; content: CallTextBlock[] };

export type CallTextDoc = { type: "doc"; content: CallTextBlock[] };

/** Well past any real call text. They stop a pasted book, not a long page. */
const MAX_NODES = 5_000;
const MAX_TEXT = 60_000;
const MAX_DEPTH = 10;
/** The longest JSON string the dashboard will store or the website will parse. */
export const CALL_TEXT_MAX_JSON = 400_000;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

class Budget {
  nodes = 0;
  text = 0;
  spend(): boolean {
    this.nodes += 1;
    return this.nodes <= MAX_NODES;
  }
}

function cleanMarks(raw: unknown): CallTextMark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CallTextMark[] = [];
  const seen = new Set<string>();
  for (const m of raw) {
    if (!isObj(m) || typeof m.type !== "string" || seen.has(m.type)) continue;
    if (m.type === "bold" || m.type === "italic") {
      out.push({ type: m.type });
      seen.add(m.type);
    } else if (m.type === "link") {
      const href = isObj(m.attrs) && typeof m.attrs.href === "string" ? m.attrs.href.trim() : "";
      if (href.length > 2000 || !isSafeHref(href)) continue;
      out.push({ type: "link", attrs: { href } });
      seen.add("link");
    }
  }
  return out.length ? out : undefined;
}

function cleanInline(raw: unknown, budget: Budget): CallTextInline[] {
  if (!Array.isArray(raw)) return [];
  const out: CallTextInline[] = [];
  for (const n of raw) {
    if (!isObj(n) || !budget.spend()) continue;
    if (n.type === "hardBreak") {
      out.push({ type: "hardBreak" });
    } else if (n.type === "text" && typeof n.text === "string" && n.text.length > 0) {
      budget.text += n.text.length;
      if (budget.text > MAX_TEXT) continue;
      const marks = cleanMarks(n.marks);
      out.push(marks ? { type: "text", text: n.text, marks } : { type: "text", text: n.text });
    }
  }
  // Breaks at either end of a block are invisible in the editor and odd on the page.
  while (out[0]?.type === "hardBreak") out.shift();
  while (out[out.length - 1]?.type === "hardBreak") out.pop();
  return out;
}

const hasText = (inline: CallTextInline[]) =>
  inline.some((n) => n.type === "text" && n.text.trim() !== "");

function cleanItems(raw: unknown, depth: number, budget: Budget): CallTextListItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CallTextListItem[] = [];
  for (const item of raw) {
    if (!isObj(item) || item.type !== "listItem" || !budget.spend()) continue;
    const content = cleanBlocks(item.content, depth + 1, budget);
    if (content.length) out.push({ type: "listItem", content });
  }
  return out;
}

function cleanBlocks(raw: unknown, depth: number, budget: Budget): CallTextBlock[] {
  if (!Array.isArray(raw) || depth > MAX_DEPTH) return [];
  const out: CallTextBlock[] = [];
  for (const n of raw) {
    if (!isObj(n) || typeof n.type !== "string" || !budget.spend()) continue;
    const attrs = isObj(n.attrs) ? n.attrs : {};
    switch (n.type) {
      case "paragraph": {
        // Empty paragraphs are the blank lines people type for spacing. The
        // page sets its own spacing, so they are dropped rather than stored.
        const content = cleanInline(n.content, budget);
        if (hasText(content)) out.push({ type: "paragraph", content });
        break;
      }
      case "heading": {
        const content = cleanInline(n.content, budget);
        if (!hasText(content)) break;
        // h1 is the call's title, so the deepest an organizer reaches is h3,
        // as in `rich-text-core`: 1 and 2 become 2, anything below becomes 3.
        const level = Number(attrs.level) >= 3 ? 3 : 2;
        out.push({ type: "heading", attrs: { level }, content });
        break;
      }
      case "bulletList": {
        const content = cleanItems(n.content, depth, budget);
        if (content.length) out.push({ type: "bulletList", content });
        break;
      }
      case "orderedList": {
        const content = cleanItems(n.content, depth, budget);
        if (!content.length) break;
        const start = Number(attrs.start);
        out.push(
          Number.isInteger(start) && start > 1 && start < 10_000
            ? { type: "orderedList", attrs: { start }, content }
            : { type: "orderedList", content },
        );
        break;
      }
      case "blockquote": {
        const content = cleanBlocks(n.content, depth + 1, budget);
        if (content.length) out.push({ type: "blockquote", content });
        break;
      }
      // Anything else (images, code, tables, a `script` someone typed into the
      // console) is dropped with everything inside it.
    }
  }
  return out;
}

/** The document with everything not on the allow-list removed. Never throws. */
export function sanitizeCallText(raw: unknown): CallTextDoc {
  const content = isObj(raw) && raw.type === "doc" ? cleanBlocks(raw.content, 0, new Budget()) : [];
  return { type: "doc", content };
}

/**
 * The stored JSON string, parsed and sanitised, or null when there is no usable
 * document: absent, unreadable, too long, or empty once cleaned. Null means the
 * page falls back to the plain `instructions`.
 */
export function parseCallText(json: unknown): CallTextDoc | null {
  if (typeof json !== "string" || json === "" || json.length > CALL_TEXT_MAX_JSON) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const doc = sanitizeCallText(raw);
  return doc.content.length ? doc : null;
}

// ---------------------------------------------------------------------------
// Plain text, both ways
// ---------------------------------------------------------------------------

const BULLET_LINE = /^\s*[-•*]\s+(.*\S)\s*$/;

/**
 * Old plain-text instructions as a document, in the same shape the website has
 * always drawn them: a blank line starts a paragraph, a line break inside a
 * paragraph is kept, and a run of lines starting "- ", "• " or "* " is a
 * bulleted list. Every word is kept; nothing is parsed as formatting.
 */
export function callTextFromPlain(text: string): CallTextDoc {
  const content: CallTextBlock[] = [];
  for (const para of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    let lines: string[] = [];
    let items: string[] = [];
    const flushText = () => {
      const t = lines.join("\n").trim();
      if (t) {
        const inline: CallTextInline[] = [];
        t.split("\n").forEach((line, i) => {
          if (i > 0) inline.push({ type: "hardBreak" });
          if (line) inline.push({ type: "text", text: line });
        });
        content.push({ type: "paragraph", content: inline });
      }
      lines = [];
    };
    const flushList = () => {
      if (items.length) {
        content.push({
          type: "bulletList",
          content: items.map((item) => ({
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: item }] }],
          })),
        });
      }
      items = [];
    };
    for (const line of para.split("\n")) {
      const bullet = BULLET_LINE.exec(line);
      if (bullet) {
        flushText();
        items.push(bullet[1]);
      } else {
        flushList();
        lines.push(line);
      }
    }
    flushText();
    flushList();
  }
  return { type: "doc", content };
}

function inlineText(inline: CallTextInline[] | undefined): string {
  return (inline ?? []).map((n) => (n.type === "text" ? n.text : "\n")).join("");
}

function blockText(block: CallTextBlock): string {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return inlineText(block.content);
    case "bulletList":
    case "orderedList": {
      const start = block.type === "orderedList" ? (block.attrs?.start ?? 1) : 1;
      return block.content
        .map((item, i) => {
          const marker = block.type === "orderedList" ? `${start + i}. ` : "- ";
          return marker + item.content.map(blockText).join("\n").replace(/\n/g, "\n  ");
        })
        .join("\n");
    }
    case "blockquote":
      return block.content.map(blockText).join("\n\n");
  }
}

/**
 * The document as plain text: paragraphs on blank lines, lists as "- " lines.
 * Saved alongside the document as `instructions`, for the page's meta
 * description and for anything that reads the old field.
 */
export function callTextToPlain(doc: CallTextDoc): string {
  return doc.content.map(blockText).join("\n\n").trim();
}

// ---------------------------------------------------------------------------
// [CLOSE DATE] and [DECISION DATE]
// ---------------------------------------------------------------------------

/** One character of a line, with the marks it carries. */
type Atom = { ch: string; marks: CallTextMark[] | undefined };

const SENTENCE = /[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g;
const TOKEN = /\[([A-Z ]+)\]/g;

/**
 * One line of atoms with its placeholders filled, or null when nothing is left.
 * The same rule as `fillLine` in `scripts/src/lib/cfp-core.ts`, applied to
 * formatted text: a sentence with a placeholder whose value is not set is left
 * out, and a filled value takes the formatting of the placeholder it replaced,
 * so "**[CLOSE DATE]**" becomes the date in bold.
 */
function fillAtoms(atoms: Atom[], values: Partial<Record<string, string>>, known: readonly string[]): Atom[] | null {
  const line = atoms.map((a) => a.ch).join("");
  TOKEN.lastIndex = 0;
  if (!TOKEN.test(line)) return atoms;

  const out: Atom[] = [];
  SENTENCE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE.exec(line)) !== null) {
    if (m[0] === "") {
      SENTENCE.lastIndex += 1;
      continue;
    }
    const start = m.index;
    const end = start + m[0].length;
    const sentence = line.slice(start, end);
    const pieces: Atom[] = [];
    let missing = false;
    let cursor = 0;
    TOKEN.lastIndex = 0;
    let t: RegExpExecArray | null;
    while ((t = TOKEN.exec(sentence)) !== null) {
      const value = values[t[1]];
      if (!known.includes(t[1]) || !value) {
        missing = true;
        break;
      }
      pieces.push(...atoms.slice(start + cursor, start + t.index));
      const marks = atoms[start + t.index].marks;
      for (const ch of value) pieces.push({ ch, marks });
      cursor = t.index + t[0].length;
    }
    if (missing) continue;
    pieces.push(...atoms.slice(start + cursor, end));
    out.push(...pieces);
  }
  while (out.length && /\s/.test(out[out.length - 1].ch)) out.pop();
  return out.some((a) => a.ch.trim() !== "") ? out : null;
}

const marksKey = (marks: CallTextMark[] | undefined) => JSON.stringify(marks ?? []);

function atomsToInline(atoms: Atom[]): CallTextInline[] {
  const out: CallTextInline[] = [];
  for (const a of atoms) {
    const last = out[out.length - 1];
    if (last?.type === "text" && marksKey(last.marks) === marksKey(a.marks)) {
      last.text += a.ch;
    } else {
      out.push(a.marks ? { type: "text", text: a.ch, marks: a.marks } : { type: "text", text: a.ch });
    }
  }
  return out;
}

function fillInline(
  inline: CallTextInline[] | undefined,
  values: Partial<Record<string, string>>,
  known: readonly string[],
): CallTextInline[] {
  const lines: Atom[][] = [[]];
  for (const n of inline ?? []) {
    if (n.type === "hardBreak") lines.push([]);
    else for (const ch of n.text) lines[lines.length - 1].push({ ch, marks: n.marks });
  }
  const out: CallTextInline[] = [];
  for (const line of lines) {
    const filled = fillAtoms(line, values, known);
    if (!filled) continue;
    if (out.length) out.push({ type: "hardBreak" });
    out.push(...atomsToInline(filled));
  }
  return out;
}

function fillBlocks(
  blocks: CallTextBlock[],
  values: Partial<Record<string, string>>,
  known: readonly string[],
): CallTextBlock[] {
  const out: CallTextBlock[] = [];
  for (const b of blocks) {
    if (b.type === "paragraph" || b.type === "heading") {
      const content = fillInline(b.content, values, known);
      if (hasText(content)) out.push({ ...b, content });
    } else if (b.type === "bulletList" || b.type === "orderedList") {
      const items = b.content
        .map((item) => ({ type: "listItem" as const, content: fillBlocks(item.content, values, known) }))
        .filter((item) => item.content.length > 0);
      if (items.length) out.push({ ...b, content: items });
    } else {
      const content = fillBlocks(b.content, values, known);
      if (content.length) out.push({ type: "blockquote", content });
    }
  }
  return out;
}

/**
 * The document with its date placeholders filled in. A sentence whose date is
 * not set is dropped, and a paragraph, bullet or list left empty goes with it.
 * `known` is `PAGE_TOKENS`; a bracketed word that is not one of them is treated
 * as unset, exactly as the plain-text version does.
 */
export function fillCallTextPlaceholders(
  doc: CallTextDoc,
  values: Partial<Record<string, string>>,
  known: readonly string[],
): CallTextDoc {
  return { type: "doc", content: fillBlocks(doc.content, values, known) };
}

// ---------------------------------------------------------------------------
// Bare addresses on the page
// ---------------------------------------------------------------------------

const AUTOLINK =
  /([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})|(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/g;

/**
 * Text split so that bare email addresses and web addresses can be drawn as
 * links: an email becomes `mailto:`, a URL stays as typed. Used on text that is
 * not already inside a link.
 */
export function autolinkParts(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  let last = 0;
  AUTOLINK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AUTOLINK.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    const href = m[1] ? `mailto:${m[1]}` : m[0];
    out.push(isSafeHref(href) ? { text: m[0], href } : { text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
