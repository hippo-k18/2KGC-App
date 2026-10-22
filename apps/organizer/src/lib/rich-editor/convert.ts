import type { ColorValue, RichContent, RichDoc, RichMark, RichNode, TextAlign, TextSize } from '@kgc/shared';
import { markdownToDoc } from '../learn-editor-core';

/**
 * RichDoc (the stored contract, `learn-page.ts`) to TipTap JSON and back (T317).
 *
 * The two are close but not the same: TipTap keeps alignment in `textAlign`,
 * a new-tab link in `target`, and table cells always carry `colspan: 1`. Both
 * directions are a whitelist. Anything TipTap holds that the contract does not
 * name (an unknown node, a mark from a paste, a `language` on a code block) is
 * dropped here, so a RichDoc that leaves the editor is always one the server
 * would accept.
 *
 * "Lossless" means: for any RichDoc `d`, `tiptapToRich(richToTiptap(d))` equals
 * `normalizeRichDoc(d)`, and a normalised doc is its own fixed point. The
 * normal form only removes things that render the same either way (a `start`
 * of 1, a `colspan` of 1, empty text, marks in a different order, two adjacent
 * runs with the same marks), and puts inline content that sits directly in a
 * list item, quote or cell into a paragraph, which is what ProseMirror does.
 *
 * No TipTap import here, so it runs under Vitest without a browser.
 */

export interface TTMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TTNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TTNode[];
  marks?: TTMark[];
  text?: string;
}

const ALIGNS: TextAlign[] = ['left', 'center', 'right', 'justify'];
const SIZES: TextSize[] = ['small', 'normal', 'large', 'x-large'];
export const NAMED_COLORS = ['navy', 'blue', 'light-blue', 'teal', 'orange', 'grey', 'dark', 'white'] as const;

export function isColorValue(v: unknown): v is ColorValue {
  return typeof v === 'string' && ((NAMED_COLORS as readonly string[]).includes(v) || /^#[0-9a-f]{6}$/i.test(v));
}

/** Canonical mark order, so two runs with the same marks compare equal. */
const MARK_ORDER: RichMark['type'][] = [
  'link',
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'superscript',
  'subscript',
  'color',
  'highlight',
  'fontSize',
];

const SIMPLE_MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'superscript', 'subscript']);

/* ── Markdown (v1) ─────────────────────────────────────────────────────── */

/**
 * A v1 Markdown string as a RichDoc: paragraphs, line breaks, bold, italic
 * and links, exactly what the v1 editor wrote.
 *
 * Stand-in until T315's `rich-doc-core` lands; swap the body for its
 * `markdownToRichDoc` then, keeping this name.
 */
export function markdownToRich(md: string): RichDoc {
  const inline = markdownToDoc(md);
  return normalizeRichDoc({
    type: 'doc',
    content: inline.content.map((p) => ({
      type: 'paragraph',
      content: (p.content ?? []).map((n): RichNode => {
        if (n.type === 'hardBreak') return { type: 'hardBreak' };
        const marks: RichMark[] = (n.marks ?? []).flatMap((m): RichMark[] => {
          if (m.type === 'link') return m.attrs?.href ? [{ type: 'link', href: m.attrs.href }] : [];
          return [{ type: m.type }];
        });
        return marks.length ? { type: 'text', text: n.text ?? '', marks } : { type: 'text', text: n.text ?? '' };
      }),
    })),
  });
}

export function toRichDoc(value: RichContent | null | undefined): RichDoc {
  if (value == null) return emptyDoc();
  if (typeof value === 'string') return markdownToRich(value);
  return normalizeRichDoc(value);
}

export const emptyDoc = (): RichDoc => ({ type: 'doc', content: [{ type: 'paragraph' }] });

/* ── Normal form ───────────────────────────────────────────────────────── */

function sortMarks(marks: RichMark[]): RichMark[] {
  // One mark of each type: the last one wins, as in ProseMirror.
  const byType = new Map<string, RichMark>();
  for (const m of marks) byType.set(m.type, m);
  return [...byType.values()].sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
}

function sameMarks(a: RichMark[] | undefined, b: RichMark[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

const INLINE_TYPES = new Set(['text', 'hardBreak']);

function normInline(nodes: RichNode[] | undefined, code = false): RichNode[] {
  const out: RichNode[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      out.push({ type: 'hardBreak' });
      continue;
    }
    if (n.type !== 'text' || !n.text) continue;
    const marks = code ? [] : sortMarks(n.marks ?? []);
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text' && sameMarks(prev.marks, marks)) {
      prev.text += n.text;
      continue;
    }
    out.push(marks.length ? { type: 'text', text: n.text, marks } : { type: 'text', text: n.text });
  }
  return out;
}

/** Block children for a node whose content must be blocks: loose inline runs become paragraphs. */
function normBlocks(nodes: RichNode[] | undefined): RichNode[] {
  const out: RichNode[] = [];
  let run: RichNode[] = [];
  const flush = () => {
    if (run.length) out.push(withContent({ type: 'paragraph' }, normInline(run)));
    run = [];
  };
  for (const n of nodes ?? []) {
    if (INLINE_TYPES.has(n.type)) run.push(n);
    else {
      flush();
      const b = normBlock(n);
      if (b) out.push(b);
    }
  }
  flush();
  return out.length ? out : [{ type: 'paragraph' }];
}

function withContent<T extends RichNode>(node: T, content: RichNode[]): T {
  return content.length ? ({ ...node, content } as T) : node;
}

function alignOf(a: unknown): { align?: TextAlign } {
  return ALIGNS.includes(a as TextAlign) ? { align: a as TextAlign } : {};
}

function span(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isInteger(n) && n > 1 ? n : undefined;
}

function normBlock(n: RichNode): RichNode | null {
  switch (n.type) {
    case 'paragraph':
      return withContent({ type: 'paragraph', ...alignOf(n.align) }, normInline(n.content));
    case 'heading': {
      const level = ([1, 2, 3, 4] as const).includes(n.level) ? n.level : 2;
      return withContent({ type: 'heading', level, ...alignOf(n.align) }, normInline(n.content));
    }
    case 'bulletList':
      return { type: 'bulletList', content: normItems(n.content) };
    case 'orderedList': {
      const start = typeof n.start === 'number' && Number.isInteger(n.start) && n.start !== 1 ? n.start : undefined;
      return { type: 'orderedList', ...(start !== undefined ? { start } : {}), content: normItems(n.content) };
    }
    case 'listItem':
      return { type: 'listItem', content: listItemBlocks(n.content) };
    case 'blockquote':
      return { type: 'blockquote', content: normBlocks(n.content) };
    case 'codeBlock':
      return withContent({ type: 'codeBlock' }, normInline(n.content?.filter((c) => c.type === 'text'), true));
    case 'horizontalRule':
      return { type: 'horizontalRule' };
    case 'table': {
      const rows = (n.content ?? []).filter((r) => r.type === 'tableRow').map(normBlock).filter(Boolean) as RichNode[];
      return rows.length ? { type: 'table', content: rows } : null;
    }
    case 'tableRow': {
      const cells = (n.content ?? [])
        .filter((c) => c.type === 'tableCell' || c.type === 'tableHeader')
        .map(normBlock)
        .filter(Boolean) as RichNode[];
      return cells.length ? { type: 'tableRow', content: cells } : null;
    }
    case 'tableCell':
    case 'tableHeader': {
      const colspan = span(n.colspan);
      const rowspan = span(n.rowspan);
      return {
        type: n.type,
        ...(colspan ? { colspan } : {}),
        ...(rowspan ? { rowspan } : {}),
        content: normBlocks(n.content),
      };
    }
    default:
      return null;
  }
}

function normItems(nodes: RichNode[] | undefined): RichNode[] {
  const items = (nodes ?? []).filter((n) => n.type === 'listItem').map(normBlock).filter(Boolean) as RichNode[];
  return items.length ? items : [{ type: 'listItem', content: [{ type: 'paragraph' }] }];
}

/** A list item must open with a paragraph (ProseMirror's `paragraph block*`). */
function listItemBlocks(nodes: RichNode[] | undefined): RichNode[] {
  const blocks = normBlocks(nodes);
  return blocks[0].type === 'paragraph' ? blocks : [{ type: 'paragraph' }, ...blocks];
}

export function normalizeRichDoc(doc: RichDoc): RichDoc {
  return { type: 'doc', content: normBlocks(doc?.content) };
}

/* ── RichDoc → TipTap ──────────────────────────────────────────────────── */

function markToTT(m: RichMark): TTMark | null {
  if (SIMPLE_MARKS.has(m.type)) return { type: m.type };
  switch (m.type) {
    case 'link':
      return { type: 'link', attrs: { href: m.href, target: m.newTab ? '_blank' : null } };
    case 'color':
      return isColorValue(m.color) ? { type: 'textColor', attrs: { color: m.color } } : null;
    case 'highlight':
      return isColorValue(m.color) ? { type: 'highlight', attrs: { color: m.color } } : null;
    case 'fontSize':
      return SIZES.includes(m.size) ? { type: 'fontSize', attrs: { size: m.size } } : null;
    default:
      return null;
  }
}

function nodeToTT(n: RichNode): TTNode {
  const kids = (c: RichNode[] | undefined) => (c && c.length ? { content: c.map(nodeToTT) } : {});
  switch (n.type) {
    case 'text': {
      const marks = (n.marks ?? []).map(markToTT).filter(Boolean) as TTMark[];
      return marks.length ? { type: 'text', text: n.text, marks } : { type: 'text', text: n.text };
    }
    case 'paragraph':
      return { type: 'paragraph', attrs: { textAlign: n.align ?? null }, ...kids(n.content) };
    case 'heading':
      return { type: 'heading', attrs: { level: n.level, textAlign: n.align ?? null }, ...kids(n.content) };
    case 'orderedList':
      return { type: 'orderedList', attrs: { start: n.start ?? 1 }, ...kids(n.content) };
    case 'tableCell':
    case 'tableHeader':
      return {
        type: n.type,
        attrs: { colspan: n.colspan ?? 1, rowspan: n.rowspan ?? 1, colwidth: null },
        ...kids(n.content),
      };
    case 'hardBreak':
    case 'horizontalRule':
      return { type: n.type };
    default:
      return { type: n.type, ...kids(n.content) };
  }
}

export function richToTiptap(value: RichContent | null | undefined): TTNode {
  const doc = toRichDoc(value);
  return { type: 'doc', content: doc.content.map(nodeToTT) };
}

/* ── TipTap → RichDoc ──────────────────────────────────────────────────── */

function markFromTT(m: TTMark): RichMark | null {
  const a = m.attrs ?? {};
  if (SIMPLE_MARKS.has(m.type)) return { type: m.type } as RichMark;
  switch (m.type) {
    case 'link': {
      const href = typeof a.href === 'string' ? a.href : '';
      if (!href) return null;
      return a.target === '_blank' ? { type: 'link', href, newTab: true } : { type: 'link', href };
    }
    case 'textColor':
      return isColorValue(a.color) ? { type: 'color', color: a.color } : null;
    case 'highlight':
      return isColorValue(a.color) ? { type: 'highlight', color: a.color } : null;
    case 'fontSize':
      return SIZES.includes(a.size as TextSize) ? { type: 'fontSize', size: a.size as TextSize } : null;
    default:
      return null;
  }
}

/** Unknown wrapper nodes are unwrapped (their children kept), unknown leaves dropped. */
function nodeFromTT(n: TTNode): RichNode[] {
  const a = n.attrs ?? {};
  const kids = () => (n.content ?? []).flatMap(nodeFromTT);
  switch (n.type) {
    case 'text': {
      if (!n.text) return [];
      const marks = (n.marks ?? []).map(markFromTT).filter(Boolean) as RichMark[];
      return [marks.length ? { type: 'text', text: n.text, marks } : { type: 'text', text: n.text }];
    }
    case 'hardBreak':
      return [{ type: 'hardBreak' }];
    case 'horizontalRule':
      return [{ type: 'horizontalRule' }];
    case 'paragraph':
      return [{ type: 'paragraph', ...alignOf(a.textAlign), content: kids() }];
    case 'heading':
      return [{ type: 'heading', level: Number(a.level) as 1 | 2 | 3 | 4, ...alignOf(a.textAlign), content: kids() }];
    case 'orderedList':
      return [{ type: 'orderedList', start: typeof a.start === 'number' ? a.start : 1, content: kids() }];
    case 'tableCell':
    case 'tableHeader':
      return [{ type: n.type, colspan: Number(a.colspan) || 1, rowspan: Number(a.rowspan) || 1, content: kids() }];
    case 'bulletList':
    case 'listItem':
    case 'blockquote':
    case 'codeBlock':
    case 'table':
    case 'tableRow':
      return [{ type: n.type, content: kids() } as RichNode];
    default:
      return kids();
  }
}

export function tiptapToRich(json: TTNode): RichDoc {
  return normalizeRichDoc({ type: 'doc', content: (json.content ?? []).flatMap(nodeFromTT) });
}

/**
 * One paragraph holding everything, blocks joined by line breaks: what a
 * heading field stores, whatever was pasted into it.
 */
export function collapseToSingleParagraph(doc: RichDoc): RichDoc {
  const inline: RichNode[] = [];
  let align: TextAlign | undefined;
  let first = true;
  const walk = (nodes: RichNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'codeBlock') {
        if (first && n.type !== 'codeBlock') align = n.align;
        if (!first) inline.push({ type: 'hardBreak' });
        first = false;
        inline.push(...(n.content ?? []));
      } else if ('content' in n) walk(n.content);
    }
  };
  walk(normalizeRichDoc(doc).content);
  // Trailing breaks come from empty blocks and render as blank lines.
  while (inline.length && inline[inline.length - 1].type === 'hardBreak') inline.pop();
  return normalizeRichDoc({ type: 'doc', content: [{ type: 'paragraph', ...(align ? { align } : {}), content: inline }] });
}

/* ── Text ──────────────────────────────────────────────────────────────── */

/** Plain text of a doc, blocks separated by newlines (for counting, not display). */
export function richPlainText(doc: RichDoc): string {
  const parts: string[] = [];
  const walk = (nodes: RichNode[] | undefined, sep: string) => {
    for (const n of nodes ?? []) {
      if (n.type === 'text') parts.push(n.text);
      else if (n.type === 'hardBreak') parts.push('\n');
      else if ('content' in n) {
        walk(n.content, '\n');
        parts.push(sep);
      }
    }
  };
  walk(doc.content, '\n');
  return parts.join('').replace(/\n{2,}/g, '\n').trim();
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}
