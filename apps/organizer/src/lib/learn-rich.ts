import {
  isRichDoc as sharedIsRichDoc,
  markdownToRichDoc as sharedMarkdownToRichDoc,
  richContentToPlainText,
  richContentWordCount,
} from '@kgc/shared';
import type { RichContent, RichDoc, RichMark, RichNode } from '@kgc/shared';

/**
 * The Learn editor's view of `RichContent` (T318): plain text for outline rows
 * and checks, and a walk over every text run so find and replace can reach
 * inside a `RichDoc` as easily as inside a v1 Markdown string.
 *
 * Plain text, word count and Markdown to RichDoc come from T315's
 * `rich-doc-core` in `@kgc/shared`, so the editor, the server and the website
 * agree. `mapRichText`, `richTextRuns`, `richLinks` and `richColors` are the
 * editor's own walks for find and replace and the checks.
 */

export const isRichDoc = sharedIsRichDoc;

const BLOCK_NODES = new Set([
  'paragraph',
  'heading',
  'listItem',
  'blockquote',
  'codeBlock',
  'tableCell',
  'tableHeader',
]);

/** v1 Markdown subset to plain words: links keep their text, markers go. */
export function markdownToPlain(md: string): string {
  return md
    .replace(/\[([^\]\n]*)\]\([^)\s]+\)/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1');
}

function nodeText(n: RichNode, out: string[]): void {
  if (n.type === 'text') {
    out.push(n.text);
    return;
  }
  if (n.type === 'hardBreak') {
    out.push('\n');
    return;
  }
  if ('content' in n && n.content) for (const c of n.content) nodeText(c, out);
  if (BLOCK_NODES.has(n.type)) out.push('\n');
}

/** Rich content as plain text, paragraphs on their own lines. */
export function richToPlainText(c: RichContent | undefined | null): string {
  return richContentToPlainText(c);
}

/** One line, for an outline row. */
export function richOneLine(c: RichContent | undefined | null): string {
  return richToPlainText(c).replace(/\s+/g, ' ').trim();
}

export function richWordCount(c: RichContent | undefined | null): number {
  return richContentWordCount(c);
}

/** v1 Markdown as a RichDoc, by the server's rules. */
export function markdownToRichDoc(md: string): RichDoc {
  return sharedMarkdownToRichDoc(md);
}

export function toRichDoc(c: RichContent): RichDoc {
  return typeof c === 'string' ? markdownToRichDoc(c) : c;
}

// ─── Walking text, for find and replace ─────────────────────────────────────

/**
 * Every text run in `c`, in reading order. For a Markdown string that is the
 * string itself; for a RichDoc, each `text` node. Find works run by run, so a
 * match never straddles a bold boundary, which is what a word processor does too.
 */
export function richTextRuns(c: RichContent): string[] {
  if (typeof c === 'string') return [c];
  const out: string[] = [];
  const walk = (nodes: RichNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === 'text') out.push(n.text);
      else if ('content' in n) walk(n.content);
    }
  };
  walk(c.content);
  return out;
}

/**
 * `c` with `fn` applied to every text run, returning the same object when no
 * run changed, so an edit that finds nothing does not land on the undo stack.
 */
export function mapRichText(c: RichContent, fn: (text: string) => string): RichContent {
  if (typeof c === 'string') {
    const next = fn(c);
    return next === c ? c : next;
  }
  let changed = false;
  const walk = (nodes: RichNode[]): RichNode[] =>
    nodes.map((n) => {
      if (n.type === 'text') {
        const text = fn(n.text);
        if (text === n.text) return n;
        changed = true;
        return { ...n, text };
      }
      if ('content' in n && n.content) {
        const content = walk(n.content);
        return content.some((x, i) => x !== n.content?.[i]) ? ({ ...n, content } as RichNode) : n;
      }
      return n;
    });
  const content = walk(c.content ?? []);
  return changed ? { ...c, content } : c;
}

/** Every link target inside rich content, with its visible text. */
export function richLinks(c: RichContent | undefined): { href: string; text: string }[] {
  if (!c) return [];
  if (typeof c === 'string') {
    const out: { href: string; text: string }[] = [];
    const re = /\[([^\]\n]*)\]\(([^)\s]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(c)) !== null) out.push({ text: m[1], href: m[2] });
    return out;
  }
  const out: { href: string; text: string }[] = [];
  const walk = (nodes: RichNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === 'text') {
        const link = n.marks?.find((m): m is Extract<RichMark, { type: 'link' }> => m.type === 'link');
        if (link) {
          const prev = out[out.length - 1];
          // Adjacent runs of one link (bold part, plain part) are one link.
          if (prev && prev.href === link.href && prev.text.length < 2000) prev.text += n.text;
          else out.push({ href: link.href, text: n.text });
        }
      } else if ('content' in n) walk(n.content);
    }
  };
  walk(c.content);
  return out;
}

/** Headings inside rich content, for the heading-order check and the table of contents. */
export function richHeadings(c: RichContent | undefined): { level: number; text: string }[] {
  if (!c || typeof c === 'string') return [];
  const out: { level: number; text: string }[] = [];
  const walk = (nodes: RichNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === 'heading') {
        const parts: string[] = [];
        nodeText(n, parts);
        out.push({ level: n.level, text: parts.join('').trim() });
      } else if ('content' in n) walk(n.content);
    }
  };
  walk(c.content);
  return out;
}

/** Colours set on text inside rich content, for the contrast check. */
export function richColors(c: RichContent | undefined): string[] {
  if (!c || typeof c === 'string') return [];
  const out = new Set<string>();
  const walk = (nodes: RichNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === 'text') {
        for (const m of n.marks ?? []) if (m.type === 'color') out.add(m.color);
      } else if ('content' in n) walk(n.content);
    }
  };
  walk(c.content);
  return [...out];
}
