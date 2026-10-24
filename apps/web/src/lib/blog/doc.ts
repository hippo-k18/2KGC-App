/**
 * A blog post body, as the editor saves it and the page renders it.
 *
 * The editor is TipTap, which saves a JSON tree of nodes and marks. That JSON,
 * not HTML, is what is stored, and the public page turns it into React elements
 * (`render.tsx`). So there is no HTML parser between a writer's keyboard and a
 * reader's browser, which is the rule `components/rich-text.tsx` sets for the
 * organizer's pages and the reason it holds up: nothing a writer types can
 * become markup, because nothing downstream reads markup.
 *
 * The browser is not trusted to have produced a tree the editor could produce.
 * `sanitizeDoc` runs on every save, keeps only the node types, marks and
 * attributes listed below, and checks every URL. It runs again before render,
 * so a document written by some older version of this file is held to the
 * current rules.
 *
 * No `server-only`: the editor imports the types and the tests import all of it.
 */

export type Mark =
  | { type: 'bold' | 'italic' | 'underline' | 'strike' | 'code' }
  | { type: 'link'; attrs: { href: string; button?: boolean } };

export type Align = 'center' | null;

export type Node =
  | { type: 'doc'; content: Node[] }
  | { type: 'paragraph'; attrs?: { textAlign?: Align }; content?: Node[] }
  | { type: 'heading'; attrs: { level: 2 | 3 | 4; textAlign?: Align }; content?: Node[] }
  | { type: 'text'; text: string; marks?: Mark[] }
  | { type: 'hardBreak' }
  | { type: 'bulletList'; content: Node[] }
  | { type: 'orderedList'; attrs?: { start?: number }; content: Node[] }
  | { type: 'listItem'; content: Node[] }
  | { type: 'blockquote'; content: Node[] }
  | { type: 'codeBlock'; content?: Node[] }
  | { type: 'horizontalRule' }
  | {
      type: 'image';
      attrs: { src: string; alt?: string; width?: number; height?: number; href?: string; center?: boolean };
    }
  | { type: 'youtube'; attrs: { src: string } }
  | { type: 'table'; content: Node[] }
  | { type: 'tableRow'; content: Node[] }
  | { type: 'tableHeader' | 'tableCell'; attrs?: { colspan?: number; rowspan?: number }; content: Node[] };

export type Doc = { type: 'doc'; content: Node[] };

export const EMPTY_DOC: Doc = { type: 'doc', content: [{ type: 'paragraph' }] };

/** Past these a post is not a post. They stop a pasted novel, not a long read. */
const MAX_NODES = 25_000;
const MAX_TEXT = 400_000;
const MAX_DEPTH = 16;

// ── URLs ────────────────────────────────────────────────────────────────────

/**
 * A link target a reader may be sent to: the web, mail, a phone number, or a
 * path on this site. `javascript:` and `data:` fail here, as does anything the
 * URL parser cannot read.
 */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const href = raw.trim();
  if (!href || href.length > 2000) return null;
  if (href.startsWith('#')) return href;
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  try {
    const url = new URL(href);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** An image may come from this site or any https host. */
export function safeImageSrc(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const src = raw.trim();
  if (!src || src.length > 2000) return null;
  if (src.startsWith('/') && !src.startsWith('//')) return src;
  try {
    const url = new URL(src);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The YouTube video id in any of the URL shapes people paste, or null.
 * Stored and rendered as a youtube-nocookie embed whatever was pasted, so no
 * embed on the blog sets YouTube's tracking cookies before somebody presses play.
 */
export function youtubeId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')) id = parts[1] ?? null;
  }
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
}

export const youtubeEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${id}`;

// ── The sanitiser ───────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

const align = (attrs: unknown): Align =>
  isObj(attrs) && attrs.textAlign === 'center' ? 'center' : null;

const smallInt = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

function cleanMarks(raw: unknown): Mark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Mark[] = [];
  const seen = new Set<string>();
  for (const m of raw) {
    if (!isObj(m) || typeof m.type !== 'string' || seen.has(m.type)) continue;
    if (['bold', 'italic', 'underline', 'strike', 'code'].includes(m.type)) {
      out.push({ type: m.type as 'bold' });
      seen.add(m.type);
    } else if (m.type === 'link') {
      const attrs = isObj(m.attrs) ? m.attrs : {};
      const href = safeHref(attrs.href);
      if (!href) continue;
      const button =
        attrs.button === true || (typeof attrs.class === 'string' && /\bbutton\b/.test(attrs.class));
      out.push({ type: 'link', attrs: button ? { href, button: true } : { href } });
      seen.add('link');
    }
  }
  return out.length ? out : undefined;
}

class Budget {
  nodes = 0;
  text = 0;
  spend(n = 1) {
    this.nodes += n;
    return this.nodes <= MAX_NODES;
  }
}

/** Children of a block, with anything unknown or unsafe dropped. */
function children(raw: unknown, depth: number, budget: Budget): Node[] {
  if (!Array.isArray(raw) || depth > MAX_DEPTH) return [];
  const out: Node[] = [];
  for (const child of raw) {
    const node = cleanNode(child, depth + 1, budget);
    if (node) out.push(node);
  }
  return out;
}

/** Inline content: text and line breaks only. */
function inline(raw: unknown, depth: number, budget: Budget): Node[] {
  return children(raw, depth, budget).filter((n) => n.type === 'text' || n.type === 'hardBreak');
}

/** Block content: never a bare text node, which ProseMirror would reject. */
function blocks(raw: unknown, depth: number, budget: Budget): Node[] {
  return children(raw, depth, budget).filter((n) => n.type !== 'text' && n.type !== 'hardBreak');
}

function cleanNode(raw: unknown, depth: number, budget: Budget): Node | null {
  if (!isObj(raw) || typeof raw.type !== 'string' || !budget.spend()) return null;
  const attrs = isObj(raw.attrs) ? raw.attrs : {};

  switch (raw.type) {
    case 'text': {
      if (typeof raw.text !== 'string' || raw.text.length === 0) return null;
      budget.text += raw.text.length;
      if (budget.text > MAX_TEXT) return null;
      const marks = cleanMarks(raw.marks);
      return marks ? { type: 'text', text: raw.text, marks } : { type: 'text', text: raw.text };
    }
    case 'hardBreak':
      return { type: 'hardBreak' };
    case 'horizontalRule':
      return { type: 'horizontalRule' };
    case 'paragraph': {
      const content = inline(raw.content, depth, budget);
      const a = align(attrs);
      return {
        type: 'paragraph',
        ...(a ? { attrs: { textAlign: a } } : {}),
        ...(content.length ? { content } : {}),
      };
    }
    case 'heading': {
      // The title is the page's h1, so the body starts at h2.
      const level = Math.min(4, Math.max(2, smallInt(attrs.level, 1, 6) ?? 2)) as 2 | 3 | 4;
      const content = inline(raw.content, depth, budget);
      const a = align(attrs);
      return {
        type: 'heading',
        attrs: a ? { level, textAlign: a } : { level },
        ...(content.length ? { content } : {}),
      };
    }
    case 'codeBlock': {
      const content = inline(raw.content, depth, budget)
        .filter((n): n is Extract<Node, { type: 'text' }> => n.type === 'text')
        .map((n) => ({ type: 'text' as const, text: n.text }));
      return { type: 'codeBlock', ...(content.length ? { content } : {}) };
    }
    case 'bulletList':
    case 'orderedList': {
      const items = blocks(raw.content, depth, budget).filter((n) => n.type === 'listItem');
      if (!items.length) return null;
      if (raw.type === 'bulletList') return { type: 'bulletList', content: items };
      const start = smallInt(attrs.start, 0, 100_000);
      return {
        type: 'orderedList',
        ...(start !== undefined && start !== 1 ? { attrs: { start } } : {}),
        content: items,
      };
    }
    case 'listItem':
    case 'blockquote': {
      const content = blocks(raw.content, depth, budget);
      if (!content.length) content.push({ type: 'paragraph' });
      return { type: raw.type, content };
    }
    case 'image': {
      const src = safeImageSrc(attrs.src);
      if (!src) return null;
      const alt = typeof attrs.alt === 'string' ? attrs.alt.slice(0, 500) : undefined;
      const width = smallInt(attrs.width, 1, 10_000);
      const height = smallInt(attrs.height, 1, 10_000);
      // An image can be a link, as the archive's sponsor logos are.
      const href = attrs.href ? safeHref(attrs.href) : null;
      return {
        type: 'image',
        attrs: {
          src,
          ...(alt ? { alt } : {}),
          ...(width && height ? { width, height } : {}),
          ...(href ? { href } : {}),
          ...(attrs.center === true ? { center: true } : {}),
        },
      };
    }
    case 'youtube': {
      const id = youtubeId(attrs.src);
      return id ? { type: 'youtube', attrs: { src: youtubeEmbed(id) } } : null;
    }
    case 'table': {
      const rows = blocks(raw.content, depth, budget).filter((n) => n.type === 'tableRow');
      return rows.length ? { type: 'table', content: rows } : null;
    }
    case 'tableRow': {
      const cells = blocks(raw.content, depth, budget).filter(
        (n) => n.type === 'tableCell' || n.type === 'tableHeader',
      );
      return cells.length ? { type: 'tableRow', content: cells } : null;
    }
    case 'tableCell':
    case 'tableHeader': {
      const content = blocks(raw.content, depth, budget);
      if (!content.length) content.push({ type: 'paragraph' });
      const colspan = smallInt(attrs.colspan, 2, 50);
      const rowspan = smallInt(attrs.rowspan, 2, 500);
      const spans = { ...(colspan ? { colspan } : {}), ...(rowspan ? { rowspan } : {}) };
      return { type: raw.type, ...(colspan || rowspan ? { attrs: spans } : {}), content };
    }
    default:
      return null;
  }
}

/**
 * The document with everything outside the schema removed. Never throws: input
 * that is not a document at all comes back as an empty one.
 */
export function sanitizeDoc(raw: unknown): Doc {
  if (!isObj(raw) || raw.type !== 'doc') return EMPTY_DOC;
  const content = blocks(raw.content, 0, new Budget());
  return { type: 'doc', content: content.length ? content : EMPTY_DOC.content };
}

// ── Reading it ──────────────────────────────────────────────────────────────

/** The words of the post, blocks separated by blank lines. */
export function docText(doc: Doc): string {
  const out: string[] = [];
  const walk = (node: Node, into: string[]) => {
    if (node.type === 'text') into.push(node.text);
    else if (node.type === 'hardBreak') into.push('\n');
    else if ('content' in node && node.content) {
      const parts: string[] = [];
      node.content.forEach((child) => walk(child, parts));
      const joined = parts.join('');
      if (node.type === 'doc' || node.type === 'bulletList' || node.type === 'orderedList') {
        into.push(joined);
      } else into.push(joined + '\n\n');
    }
  };
  walk(doc, out);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

export function wordCount(doc: Doc): number {
  const text = docText(doc);
  return text ? text.split(/\s+/).length : 0;
}

/** The first paragraph's text, cut at a word near `max` characters. */
export function autoExcerpt(doc: Doc, max = 280): string {
  const first = doc.content.find(
    (n) => n.type === 'paragraph' && n.content?.some((c) => c.type === 'text' && c.text.trim()),
  );
  const text = first ? docText({ type: 'doc', content: [first] }).replace(/\s+/g, ' ') : '';
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:.\s]+$/, '')}…`;
}

export function isEmptyDoc(doc: Doc): boolean {
  return !doc.content.some((n) => n.type === 'image' || n.type === 'youtube' || docText({ type: 'doc', content: [n] }));
}
