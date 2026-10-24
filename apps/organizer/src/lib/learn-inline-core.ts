import { isSafeHref, type LearnBlock, type LinkButton, type RichContent, type RichDoc, type RichNode } from '@kgc/shared';
import { newId, plainText } from './learn-editor-core';

/**
 * The arithmetic behind editing the Learn page where it is drawn (T329):
 * a list item that splits on Enter, folds into the one above on Tab, comes
 * back out on Shift+Tab; any repeating item added or removed in place.
 *
 * Pure and immutable like `learn-editor-core.ts`, whose undo stack keeps the
 * old arrays. Every function returns the new array and where the caret goes.
 */

export type ListItem = Extract<LearnBlock, { kind: 'list' }>['items'][number];

/** Where the caret goes after a structural edit: an item's text, or one of its sub-items. */
export type ListFocus = { itemId: string; child?: number };

export interface ListResult {
  items: ListItem[];
  focus: ListFocus;
}

export function newListItem(text = ''): ListItem {
  return { id: newId('li'), text };
}

/** Enter at the end of an item: a new empty item below it. */
export function addItemAfter(items: ListItem[], index: number): ListResult {
  const item = newListItem();
  return { items: [...items.slice(0, index + 1), item, ...items.slice(index + 1)], focus: { itemId: item.id } };
}

/**
 * Backspace in an empty item: the item goes, and the caret goes to the end of
 * the one above (its last sub-item if it has some). The last item of a list
 * stays, so the list never empties itself under the cursor.
 */
export function removeItem(items: ListItem[], index: number): ListResult | null {
  if (items.length <= 1 || index < 0 || index >= items.length) return null;
  const next = items.filter((_, i) => i !== index);
  const prev = next[Math.max(0, index - 1)];
  const kids = prev.children?.length ?? 0;
  return { items: next, focus: index > 0 && kids > 0 ? { itemId: prev.id, child: kids - 1 } : { itemId: prev.id } };
}

/** Rich text with nothing a plain line would lose: no formatting, links or lists. */
function isPlainRich(text: RichContent): boolean {
  if (typeof text === 'string') return !/[*_`[\]#<>~|]/.test(text);
  const plain = (n: RichNode): boolean => {
    if (n.type === 'text') return !('marks' in n && n.marks?.length);
    if (n.type === 'hardBreak') return true;
    if (n.type !== 'paragraph') return false;
    return ((n as { content?: RichNode[] }).content ?? []).every(plain);
  };
  return text.content.every(plain);
}

/**
 * Whether Tab may tuck this item under the one above. Sub-items are plain
 * words on the website, so an item with a bold title, a link or formatted
 * text would lose them for good on the way in and not get them back on
 * Shift+Tab (T332): such an item stays where it is.
 */
export function canIndentItem(items: ListItem[], index: number): boolean {
  const item = items[index];
  if (index <= 0 || !item) return false;
  return !item.title && !item.link && isPlainRich(item.text);
}

/**
 * Tab: the item becomes a sub-item of the one above, its own sub-items
 * following it. Only a plain item moves (`canIndentItem`).
 */
export function indentItem(items: ListItem[], index: number): ListResult | null {
  if (index <= 0 || index >= items.length || !canIndentItem(items, index)) return null;
  const item = items[index];
  const prev = items[index - 1];
  const line = [item.title, plainText(item.text), item.link?.label].filter((s) => s && s.trim()).join(' ');
  const children = [...(prev.children ?? []), line, ...(item.children ?? [])];
  const merged: ListItem = { ...prev, children };
  const next = [...items.slice(0, index - 1), merged, ...items.slice(index + 1)];
  return { items: next, focus: { itemId: prev.id, child: (prev.children?.length ?? 0) } };
}

/** Shift+Tab on a sub-item: it becomes an item after its parent, taking the sub-items below it along. */
export function outdentChild(items: ListItem[], index: number, child: number): ListResult | null {
  const parent = items[index];
  const kids = parent?.children ?? [];
  if (child < 0 || child >= kids.length) return null;
  const moved: ListItem = { ...newListItem(kids[child]) };
  const below = kids.slice(child + 1);
  if (below.length) moved.children = below;
  const kept = kids.slice(0, child);
  const updated: ListItem = { ...parent };
  if (kept.length) updated.children = kept;
  else delete updated.children;
  return { items: [...items.slice(0, index), updated, moved, ...items.slice(index + 1)], focus: { itemId: moved.id } };
}

/** Enter in a sub-item: a new empty sub-item below it. */
export function addChildAfter(items: ListItem[], index: number, child: number): ListResult {
  const parent = items[index];
  const kids = [...(parent.children ?? [])];
  kids.splice(child + 1, 0, '');
  return { items: items.map((it, i) => (i === index ? { ...it, children: kids } : it)), focus: { itemId: parent.id, child: child + 1 } };
}

/** Backspace in an empty sub-item: it goes, the caret goes to the one above or to the item's own text. */
export function removeChild(items: ListItem[], index: number, child: number): ListResult | null {
  const parent = items[index];
  const kids = parent?.children ?? [];
  if (child < 0 || child >= kids.length) return null;
  const left = kids.filter((_, i) => i !== child);
  const updated: ListItem = { ...parent };
  if (left.length) updated.children = left;
  else delete updated.children;
  return {
    items: items.map((it, i) => (i === index ? updated : it)),
    focus: child > 0 ? { itemId: parent.id, child: child - 1 } : { itemId: parent.id },
  };
}

export function setChild(items: ListItem[], index: number, child: number, text: string): ListItem[] {
  return items.map((it, i) => (i === index ? { ...it, children: (it.children ?? []).map((c, j) => (j === child ? text : c)) } : it));
}

/* ── Any repeating item (cards, people, tabs, stats...) ─────────────────── */

export function replaceAt<T>(arr: readonly T[], index: number, value: T): T[] {
  return arr.map((x, i) => (i === index ? value : x));
}

export function insertAt<T>(arr: readonly T[], index: number, value: T): T[] {
  const i = Math.max(0, Math.min(arr.length, index));
  return [...arr.slice(0, i), value, ...arr.slice(i)];
}

export function removeAt<T>(arr: readonly T[], index: number): T[] {
  return arr.filter((_, i) => i !== index);
}

/* ── Tables ────────────────────────────────────────────────────────────── */

/**
 * A Table block's document as the website draws it: its first table and
 * nothing else (T332). Words that got in beside the table before the editor
 * stopped allowing it were saved and never shown; they go, as on the page.
 * With no table at all (a Cmd+A that replaced it), `fallback` gives one back.
 */
export function tableOnlyDoc(doc: RichContent, fallback: () => RichDoc): RichDoc {
  const table = typeof doc === 'string' ? undefined : doc.content.find((n) => n.type === 'table');
  if (!table) return fallback();
  return typeof doc !== 'string' && doc.content.length === 1 ? doc : { type: 'doc', content: [table] };
}

/* ── Links ─────────────────────────────────────────────────────────────── */

/** True for a link to another website, which the page opens in a new tab on its own. */
export function isOffsite(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

export type LinkTargetResult = { href: string } | { error: string };

/**
 * What somebody pasted or typed into the small link box, as an address the
 * page may carry: `example.com` gains https, an email address becomes a
 * mailto link, `#name` and `/page` are kept.
 */
export function normalizeLinkInput(input: string): LinkTargetResult {
  const t = input.trim();
  if (!t) return { error: 'Paste a web address, or pick a part of this page.' };
  let href = t;
  if (/^[^\s@/:]+@[^\s@]+\.[^\s@]+$/.test(t)) href = `mailto:${t}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith('/') && !t.startsWith('#')) {
    if (!/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(t)) return { error: 'That does not look like a web address.' };
    href = `https://${t}`;
  }
  href = href.replace(/\s/g, '%20');
  return isSafeHref(href) ? { href } : { error: 'Links can start with https://, mailto:, tel:, / or #.' };
}

export function newButton(label = 'New button'): LinkButton {
  return { label, href: '', style: 'primary' };
}

/**
 * Cuts what was just added to a plain field so it ends at `max`, and nothing
 * else (T343). `prev` is the field before the edit, `next` after it. A field
 * that shrank or kept its length (Backspace, Delete, a move) is left alone even
 * when it is over the limit, so its words are never cut by a key that removes
 * one character. Returns null when nothing is cut, else the text and where the
 * caret goes (just after what was kept of the addition).
 */
export function capInserted(prev: string, next: string, max: number): { text: string; caret: number } | null {
  if (next.length <= max || next.length <= prev.length) return null;
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let end = 0;
  while (end < prev.length - start && end < next.length - start && prev[prev.length - 1 - end] === next[next.length - 1 - end]) end++;
  const inserted = next.slice(start, next.length - end);
  // What is left of the field around the change. A field already over its
  // limit may still take as much as the edit removed, so a replacement keeps
  // what fits instead of only deleting the selection (T348, gate D-S1/D-N4).
  const room = Math.max(0, max - start - end, prev.length - start - end);
  if (inserted.length <= room) return null;
  const add = inserted.slice(0, room);
  return { text: next.slice(0, start) + add + next.slice(next.length - end), caret: start + add.length };
}
