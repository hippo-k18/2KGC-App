import { defaultEmbedTitle, isSafeHref, learnEmbedLinkProblem, learnEmbedSrc } from '@kgc/shared';
import type {
  Columns,
  LearnBlock,
  LearnPageContent,
  LearnSection,
  PageImage,
  RichContent,
} from '@kgc/shared';
import { richOneLine, richToPlainText } from './learn-rich';
import { isUnfinishedHref } from './learn-page-core';

/**
 * The Learn page editor's pure half: every edit, the undo stack and the
 * "what changed" summary the Publish dialog shows (T310).
 *
 * Kept apart from the React components for the reason `conflicts-core.ts`
 * is: this is where the arithmetic lives, and a component cannot be tested
 * under Vitest without a browser. Every function returns a new object and
 * never mutates its input, because the undo stack keeps the old ones.
 */

export type BlockKind = LearnBlock['kind'];
export type BlockOf<K extends BlockKind> = Extract<LearnBlock, { kind: K }>;

/** What the settings panel is showing. */
export type Selection =
  | { kind: 'page' }
  | { kind: 'section'; sectionId: string }
  | { kind: 'block'; sectionId: string; blockId: string };

/** Distributes over the union, so a patch for a heading cannot carry `people`. */
type DistributivePartial<T> = T extends unknown ? Partial<Omit<T, 'id' | 'kind'>> : never;
export type BlockPatch = DistributivePartial<LearnBlock>;
export type SectionPatch = Partial<Omit<LearnSection, 'id' | 'blocks'>>;

export type PagePatch = Partial<Pick<LearnPageContent, 'seoTitle' | 'seoDescription' | 'ogImage' | 'noindex'>>;

export type EditAction =
  | { type: 'setPage'; patch: PagePatch }
  | { type: 'updateSection'; sectionId: string; patch: SectionPatch }
  | { type: 'addSection'; index: number; section: LearnSection }
  | { type: 'duplicateSection'; sectionId: string }
  | { type: 'removeSection'; sectionId: string }
  | { type: 'moveSection'; sectionId: string; toIndex: number }
  | { type: 'updateBlock'; sectionId: string; blockId: string; patch: BlockPatch }
  | { type: 'insertBlock'; sectionId: string; index: number; block: LearnBlock }
  | { type: 'duplicateBlock'; sectionId: string; blockId: string }
  | { type: 'removeBlock'; sectionId: string; blockId: string }
  | {
      type: 'moveBlock';
      sectionId: string;
      blockId: string;
      toSectionId: string;
      toIndex: number;
      /** In a multi-column section, the column it lands in (v2). */
      toColumn?: number;
    }
  | { type: 'replace'; content: LearnPageContent }
  /* v2 (T318) */
  /** Paste or insert a template's blocks; ids must already be fresh. */
  | { type: 'insertBlocks'; sectionId: string; index: number; blocks: LearnBlock[]; column?: number }
  | { type: 'removeBlocks'; blockIds: string[] }
  | { type: 'setBlocksHidden'; blockIds: string[]; hidden: boolean }
  /** Moves several blocks, in page order, to one place. */
  | { type: 'moveBlocks'; blockIds: string[]; toSectionId: string; toIndex: number; toColumn?: number }
  | { type: 'setBlockColumn'; sectionId: string; blockId: string; column: number };

/** Matches the server's id rule: `^[A-Za-z0-9_-]{1,64}$`. */
export function newId(prefix = 'b'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}${rand}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function moveWithin<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(clamp(to, 0, next.length), 0, item);
  return next;
}

/** Every nested id gets a fresh one, so a duplicate never shares an id the server checks for uniqueness. */
export function cloneBlockWithNewIds(block: LearnBlock): LearnBlock {
  const copy = structuredClone(block);
  copy.id = newId('b');
  // An anchor is a link target and must stay unique on the page.
  delete copy.anchor;
  switch (copy.kind) {
    case 'people':
      copy.people = copy.people.map((p) => ({ ...p, id: newId('p') }));
      break;
    case 'list':
      copy.items = copy.items.map((i) => ({ ...i, id: newId('i') }));
      break;
    case 'columns':
    case 'accordion':
    case 'tabs':
    case 'stats':
    case 'cards':
    case 'logos':
      // Each case narrows `copy` on its own; the item shapes differ.
      (copy as { items: { id: string }[] }).items = copy.items.map((i: { id: string }) => ({ ...i, id: newId('i') }));
      break;
    case 'gallery':
      copy.images = copy.images.map((i) => ({ ...i, id: newId('g') }));
      break;
  }
  return copy;
}

/** A section copy with fresh ids everywhere, its column map following its blocks. */
export function cloneSectionWithNewIds(section: LearnSection, label = `${section.label} copy`): LearnSection {
  const copy = structuredClone(section);
  const blocks = section.blocks.map(cloneBlockWithNewIds);
  const out: LearnSection = { ...copy, id: newId('s'), label, blocks };
  delete out.anchor;
  if (section.blockColumn) {
    const map: Record<string, number> = {};
    section.blocks.forEach((b, i) => {
      const col = section.blockColumn?.[b.id];
      if (col !== undefined) map[blocks[i].id] = col;
    });
    out.blockColumn = map;
  }
  return out;
}

/** How many columns a section layout has. */
export function layoutColumns(layout: LearnSection['layout']): number {
  if (layout === 'three') return 3;
  if (layout === 'two-equal' || layout === 'two-wide-left' || layout === 'two-wide-right') return 2;
  return 1;
}

/** The column a block sits in, clamped to the layout (a block with no entry is in the first). */
export function blockColumnOf(section: LearnSection, blockId: string): number {
  const n = layoutColumns(section.layout);
  const c = section.blockColumn?.[blockId] ?? 0;
  return Math.max(0, Math.min(n - 1, c));
}

/** `section` without column entries for blocks it no longer holds. */
function pruneColumns(section: LearnSection): LearnSection {
  if (!section.blockColumn) return section;
  const ids = new Set(section.blocks.map((b) => b.id));
  const keys = Object.keys(section.blockColumn);
  if (keys.every((k) => ids.has(k))) return section;
  const map: Record<string, number> = {};
  for (const k of keys) if (ids.has(k)) map[k] = section.blockColumn[k];
  return { ...section, blockColumn: map };
}

function withColumn(section: LearnSection, blockId: string, column: number | undefined): LearnSection {
  if (column === undefined) return section;
  const n = layoutColumns(section.layout);
  const col = Math.max(0, Math.min(n - 1, column));
  if ((section.blockColumn?.[blockId] ?? 0) === col && section.blockColumn?.[blockId] !== undefined) return section;
  return { ...section, blockColumn: { ...(section.blockColumn ?? {}), [blockId]: col } };
}

function blockLocation(content: LearnPageContent, blockId: string): { section: LearnSection; index: number } | null {
  for (const section of content.sections) {
    const index = section.blocks.findIndex((b) => b.id === blockId);
    if (index >= 0) return { section, index };
  }
  return null;
}

function mapSection(
  content: LearnPageContent,
  sectionId: string,
  fn: (s: LearnSection) => LearnSection,
): LearnPageContent {
  let changed = false;
  const sections = content.sections.map((s) => {
    if (s.id !== sectionId) return s;
    const next = fn(s);
    if (next !== s) changed = true;
    return next;
  });
  return changed ? { ...content, sections } : content;
}

/** True when applying `patch` to `obj` would change something. */
function patchChanges(obj: object, patch: object): boolean {
  const rec = obj as Record<string, unknown>;
  return Object.entries(patch).some(([k, v]) =>
    typeof v === 'object' && v !== null ? JSON.stringify(rec[k]) !== JSON.stringify(v) : rec[k] !== v,
  );
}

/** One edit, applied. An action naming something that is not there returns the content unchanged. */
export function applyEdit(content: LearnPageContent, action: EditAction): LearnPageContent {
  switch (action.type) {
    case 'replace':
      return action.content;
    case 'setPage':
      return patchChanges(content, action.patch) ? { ...content, ...action.patch } : content;
    case 'updateSection':
      return mapSection(content, action.sectionId, (s) =>
        patchChanges(s, action.patch) ? { ...s, ...action.patch } : s,
      );
    case 'addSection': {
      const sections = content.sections.slice();
      sections.splice(clamp(action.index, 0, sections.length), 0, action.section);
      return { ...content, sections };
    }
    case 'duplicateSection': {
      const i = content.sections.findIndex((s) => s.id === action.sectionId);
      if (i < 0) return content;
      const sections = content.sections.slice();
      sections.splice(i + 1, 0, cloneSectionWithNewIds(content.sections[i]));
      return { ...content, sections };
    }
    case 'removeSection':
      if (!content.sections.some((s) => s.id === action.sectionId)) return content;
      return { ...content, sections: content.sections.filter((s) => s.id !== action.sectionId) };
    case 'moveSection': {
      const i = content.sections.findIndex((s) => s.id === action.sectionId);
      if (i < 0) return content;
      return { ...content, sections: moveWithin(content.sections, i, action.toIndex) };
    }
    case 'updateBlock':
      return mapSection(content, action.sectionId, (s) => {
        const target = s.blocks.find((b) => b.id === action.blockId);
        if (!target || !patchChanges(target, action.patch)) return s;
        return {
          ...s,
          blocks: s.blocks.map((b) => (b === target ? ({ ...b, ...action.patch } as LearnBlock) : b)),
        };
      });
    case 'insertBlock':
      return mapSection(content, action.sectionId, (s) => {
        const blocks = s.blocks.slice();
        blocks.splice(clamp(action.index, 0, blocks.length), 0, action.block);
        return { ...s, blocks };
      });
    case 'duplicateBlock':
      return mapSection(content, action.sectionId, (s) => {
        const i = s.blocks.findIndex((b) => b.id === action.blockId);
        if (i < 0) return s;
        const blocks = s.blocks.slice();
        const copy = cloneBlockWithNewIds(s.blocks[i]);
        blocks.splice(i + 1, 0, copy);
        const col = s.blockColumn?.[action.blockId];
        return withColumn({ ...s, blocks }, copy.id, col);
      });
    case 'removeBlock':
      return mapSection(content, action.sectionId, (s) =>
        s.blocks.some((b) => b.id === action.blockId)
          ? pruneColumns({ ...s, blocks: s.blocks.filter((b) => b.id !== action.blockId) })
          : s,
      );
    case 'insertBlocks': {
      if (action.blocks.length === 0) return content;
      return mapSection(content, action.sectionId, (s) => {
        const blocks = s.blocks.slice();
        blocks.splice(clamp(action.index, 0, blocks.length), 0, ...action.blocks);
        let next: LearnSection = { ...s, blocks };
        for (const b of action.blocks) next = withColumn(next, b.id, action.column);
        return next;
      });
    }
    case 'removeBlocks': {
      const ids = new Set(action.blockIds);
      let changed = false;
      const sections = content.sections.map((s) => {
        if (!s.blocks.some((b) => ids.has(b.id))) return s;
        changed = true;
        return pruneColumns({ ...s, blocks: s.blocks.filter((b) => !ids.has(b.id)) });
      });
      return changed ? { ...content, sections } : content;
    }
    case 'setBlocksHidden': {
      const ids = new Set(action.blockIds);
      let changed = false;
      const sections = content.sections.map((s) => {
        let touched = false;
        const blocks = s.blocks.map((b) => {
          if (!ids.has(b.id) || !!b.hidden === action.hidden) return b;
          touched = true;
          const next = { ...b } as LearnBlock;
          if (action.hidden) next.hidden = true;
          else delete next.hidden;
          return next;
        });
        if (!touched) return s;
        changed = true;
        return { ...s, blocks };
      });
      return changed ? { ...content, sections } : content;
    }
    case 'moveBlocks': {
      const target = content.sections.find((s) => s.id === action.toSectionId);
      if (!target) return content;
      const ids = new Set(action.blockIds);
      // Page order, not click order, so a moved group reads the way it did.
      const moving: LearnBlock[] = [];
      for (const s of content.sections) for (const b of s.blocks) if (ids.has(b.id)) moving.push(b);
      if (moving.length === 0) return content;
      // The landing index counts only blocks that stay in the target section.
      const before = target.blocks.slice(0, clamp(action.toIndex, 0, target.blocks.length)).filter((b) => !ids.has(b.id)).length;
      const stripped = content.sections.map((s) =>
        s.blocks.some((b) => ids.has(b.id)) ? pruneColumns({ ...s, blocks: s.blocks.filter((b) => !ids.has(b.id)) }) : s,
      );
      const sections = stripped.map((s) => {
        if (s.id !== target.id) return s;
        const blocks = s.blocks.slice();
        blocks.splice(before, 0, ...moving);
        let next: LearnSection = { ...s, blocks };
        for (const b of moving) next = withColumn(next, b.id, action.toColumn);
        return next;
      });
      return { ...content, sections };
    }
    case 'setBlockColumn':
      return mapSection(content, action.sectionId, (s) =>
        s.blocks.some((b) => b.id === action.blockId) ? withColumn(s, action.blockId, action.column) : s,
      );
    case 'moveBlock': {
      const from = content.sections.find((s) => s.id === action.sectionId);
      const block = from?.blocks.find((b) => b.id === action.blockId);
      if (!from || !block) return content;
      if (!content.sections.some((s) => s.id === action.toSectionId)) return content;
      if (action.sectionId === action.toSectionId) {
        const i = from.blocks.indexOf(block);
        return mapSection(content, from.id, (s) =>
          withColumn({ ...s, blocks: moveWithin(s.blocks, i, action.toIndex) }, block.id, action.toColumn),
        );
      }
      const removed = mapSection(content, from.id, (s) =>
        pruneColumns({ ...s, blocks: s.blocks.filter((b) => b.id !== block.id) }),
      );
      return mapSection(removed, action.toSectionId, (s) => {
        const blocks = s.blocks.slice();
        blocks.splice(clamp(action.toIndex, 0, blocks.length), 0, block);
        return withColumn({ ...s, blocks }, block.id, action.toColumn);
      });
    }
  }
}

/** Where a selection should go after an edit removed what it pointed at. */
export function repairSelection(content: LearnPageContent, sel: Selection): Selection {
  if (sel.kind === 'page') return sel;
  const section = content.sections.find((s) => s.id === sel.sectionId);
  if (!section) {
    // A block moved to another section keeps its id: follow it.
    if (sel.kind === 'block') {
      const owner = content.sections.find((s) => s.blocks.some((b) => b.id === sel.blockId));
      if (owner) return { kind: 'block', sectionId: owner.id, blockId: sel.blockId };
    }
    return { kind: 'page' };
  }
  if (sel.kind === 'block' && !section.blocks.some((b) => b.id === sel.blockId)) {
    const owner = content.sections.find((s) => s.blocks.some((b) => b.id === sel.blockId));
    if (owner) return { kind: 'block', sectionId: owner.id, blockId: sel.blockId };
    return { kind: 'section', sectionId: section.id };
  }
  return sel;
}

export { blockLocation };

export function findBlock(
  content: LearnPageContent,
  sectionId: string,
  blockId: string,
): LearnBlock | undefined {
  return content.sections.find((s) => s.id === sectionId)?.blocks.find((b) => b.id === blockId);
}

// ─── Undo and redo ────────────────────────────────────────────────────────────

export interface History {
  past: LearnPageContent[];
  present: LearnPageContent;
  future: LearnPageContent[];
  /** Typing into one field is one undo step, not one per letter. */
  lastKey?: string;
  lastAt?: number;
}

export const HISTORY_LIMIT = 100;
/** Edits with the same key closer together than this merge into one undo step. */
export const COALESCE_MS = 1200;

export function startHistory(content: LearnPageContent): History {
  return { past: [], present: content, future: [] };
}

/**
 * The key that decides whether two edits are "the same typing". Only text-like
 * edits to one field of one thing coalesce; a click on a toggle never does.
 */
export function coalesceKey(action: EditAction): string | undefined {
  const fields = (patch: object) => Object.keys(patch).sort().join(',');
  switch (action.type) {
    case 'setPage':
      return `page:${fields(action.patch)}`;
    case 'updateSection':
      return ['label', 'note', 'anchor'].some((k) => k in action.patch)
        ? `section:${action.sectionId}:${fields(action.patch)}`
        : undefined;
    case 'updateBlock': {
      const textual = [
        'text', 'caption', 'url', 'buttons', 'people', 'items', 'image', 'images', 'title', 'name', 'role',
        'label', 'doneText', 'doc', 'note', 'anchor', 'height', 'photo',
      ];
      return Object.keys(action.patch).some((k) => textual.includes(k))
        ? `block:${action.blockId}:${fields(action.patch)}`
        : undefined;
    }
    default:
      return undefined;
  }
}

export function pushEdit(h: History, action: EditAction, now: number): History {
  const next = applyEdit(h.present, action);
  if (next === h.present) return h;
  const key = coalesceKey(action);
  if (key && key === h.lastKey && h.lastAt !== undefined && now - h.lastAt < COALESCE_MS) {
    return { ...h, present: next, future: [], lastAt: now };
  }
  const past = [...h.past, h.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}

export function undo(h: History): History {
  if (h.past.length === 0) return h;
  const past = h.past.slice(0, -1);
  return { past, present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (h.future.length === 0) return h;
  const [next, ...future] = h.future;
  return { past: [...h.past, h.present], present: next, future };
}

/** A content swap the user did not type (a restore, a reload) that should still be undoable. */
export function replaceInHistory(h: History, content: LearnPageContent): History {
  return pushEdit({ ...h, lastKey: undefined }, { type: 'replace', content }, Date.now());
}

// ─── Labels ───────────────────────────────────────────────────────────────────

export type BlockCategory = 'Text' | 'Media' | 'Layout' | 'People' | 'Interactive' | 'Embed';
export const BLOCK_CATEGORIES: BlockCategory[] = ['Text', 'Media', 'Layout', 'People', 'Interactive', 'Embed'];

export const BLOCK_KINDS: { kind: BlockKind; label: string; hint: string; category: BlockCategory; keywords?: string }[] = [
  { kind: 'heading', label: 'Heading', hint: 'A title for a part of the page', category: 'Text', keywords: 'title h1 h2 h3' },
  { kind: 'text', label: 'Text', hint: 'Paragraphs with bold, italic and links', category: 'Text', keywords: 'paragraph body copy' },
  { kind: 'list', label: 'List', hint: 'Bulleted or numbered items', category: 'Text', keywords: 'bullets numbered' },
  { kind: 'quote', label: 'Quote', hint: 'A testimonial or a pull quote', category: 'Text', keywords: 'testimonial review' },
  { kind: 'callout', label: 'Note box', hint: 'A coloured box for a note or warning', category: 'Text', keywords: 'callout note alert notice info' },
  { kind: 'table', label: 'Table', hint: 'Rows and columns of text', category: 'Text', keywords: 'grid schedule prices' },
  { kind: 'toc', label: 'Contents list', hint: 'Links to the headings on this page', category: 'Text', keywords: 'table of contents toc menu' },
  { kind: 'image', label: 'Image', hint: 'A photo or graphic', category: 'Media', keywords: 'photo picture' },
  { kind: 'imageText', label: 'Image and text', hint: 'A picture beside a paragraph', category: 'Media', keywords: 'media side' },
  { kind: 'gallery', label: 'Gallery', hint: 'A grid or slideshow of photos', category: 'Media', keywords: 'photos carousel slideshow' },
  { kind: 'video', label: 'Video', hint: 'YouTube or Vimeo', category: 'Media', keywords: 'youtube vimeo film' },
  { kind: 'logos', label: 'Logos', hint: 'A row of partner or sponsor logos', category: 'Media', keywords: 'sponsors partners brands' },
  { kind: 'columns', label: 'Columns', hint: 'Two to four side by side', category: 'Layout', keywords: 'grid side by side' },
  { kind: 'cards', label: 'Cards', hint: 'Boxes with a picture, title and link', category: 'Layout', keywords: 'courses tiles' },
  { kind: 'stats', label: 'Numbers', hint: 'Big figures with a label', category: 'Layout', keywords: 'stats statistics figures counters' },
  { kind: 'buttons', label: 'Buttons', hint: 'One or more link buttons', category: 'Layout', keywords: 'cta call to action link' },
  { kind: 'divider', label: 'Divider', hint: 'A thin line', category: 'Layout', keywords: 'line rule separator' },
  { kind: 'spacer', label: 'Empty space', hint: 'A gap between blocks', category: 'Layout', keywords: 'spacer gap space' },
  { kind: 'reusable', label: 'Saved section', hint: 'A section from your library, kept in sync', category: 'Layout', keywords: 'library reusable shared' },
  { kind: 'people', label: 'People', hint: 'Cards with photo, name and role', category: 'People', keywords: 'team staff speakers' },
  { kind: 'accordion', label: 'Questions', hint: 'Answers that open on a click', category: 'Interactive', keywords: 'faq accordion collapse' },
  { kind: 'tabs', label: 'Tabs', hint: 'Panels you switch between', category: 'Interactive', keywords: 'tabbed panels' },
  { kind: 'countdown', label: 'Countdown', hint: 'Days and hours to a date', category: 'Interactive', keywords: 'timer deadline date' },
  { kind: 'embed', label: 'Map, form or video', hint: 'From Google Maps, Google Forms, Calendly and other sites', category: 'Embed', keywords: 'embed iframe google maps form calendly typeform loom spotify slides docs' },
];

/** Picker search: label, hint, category and keywords, every word must match. */
export function searchBlockKinds(query: string): typeof BLOCK_KINDS {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return BLOCK_KINDS;
  return BLOCK_KINDS.filter((k) => {
    const hay = `${k.label} ${k.hint} ${k.category} ${k.keywords ?? ''} ${k.kind}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function kindLabel(kind: BlockKind): string {
  return BLOCK_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

/** Rich text as one plain line, for an outline row. */
export function plainText(c: RichContent): string {
  return richOneLine(c);
}

function short(s: string, n = 40): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

/** "Heading: Meet the KGC | Learn Team", for the outline and the change list. */
export function blockSummary(block: LearnBlock): string {
  const label = kindLabel(block.kind);
  let detail = '';
  switch (block.kind) {
    case 'heading':
    case 'text':
      detail = plainText(block.text);
      break;
    case 'image':
      detail = block.image.alt || block.caption || '';
      break;
    case 'buttons':
      detail = block.buttons.map((b) => b.label).join(', ');
      break;
    case 'people':
      detail = `${block.people.length} ${block.people.length === 1 ? 'person' : 'people'}`;
      break;
    case 'list':
      detail = `${block.items.length} ${block.items.length === 1 ? 'item' : 'items'}`;
      break;
    case 'columns':
      detail = `${block.items.length} across ${block.columns}`;
      break;
    case 'video':
      detail = block.caption || block.url;
      break;
    case 'imageText':
      detail = plainText(block.text) || block.image.alt;
      break;
    case 'gallery':
      detail = `${block.images.length} ${block.images.length === 1 ? 'photo' : 'photos'}`;
      break;
    case 'quote':
      detail = plainText(block.text) || block.name || '';
      break;
    case 'callout':
      detail = block.title || plainText(block.text);
      break;
    case 'accordion':
    case 'tabs':
      detail = block.items.map((i) => i.title).filter(Boolean).join(', ');
      break;
    case 'stats':
      detail = block.items.map((i) => i.value).filter(Boolean).join(', ');
      break;
    case 'cards':
      detail = block.items.map((i) => i.title).filter(Boolean).join(', ');
      break;
    case 'logos':
      detail = `${block.items.length} ${block.items.length === 1 ? 'logo' : 'logos'}`;
      break;
    case 'embed':
      detail = block.title || block.url;
      break;
    case 'countdown':
      detail = block.label || (block.until ? new Date(block.until).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
      break;
    case 'table':
      detail = block.caption || '';
      break;
    case 'toc':
      detail = block.title || '';
      break;
    case 'reusable':
      detail = '';
      break;
  }
  return detail ? `${label}: ${short(detail)}` : label;
}

// ─── New blocks ───────────────────────────────────────────────────────────────

/**
 * An image not chosen yet. The server stores it in the draft, so autosave keeps
 * going while an Image block is unfinished, and refuses to publish it.
 */
export const EMPTY_IMAGE: PageImage = { src: '', alt: '', width: 0, height: 0 };

export function createBlock(kind: BlockKind): LearnBlock {
  const id = newId('b');
  switch (kind) {
    case 'heading':
      return { id, kind, text: 'New heading', level: 2, align: 'center' };
    case 'text':
      return { id, kind, text: 'Write something here.' };
    case 'image':
      return { id, kind, image: { ...EMPTY_IMAGE }, width: 'medium', shape: 'original', align: 'center' };
    case 'buttons':
      return {
        id,
        kind,
        align: 'center',
        buttons: [{ label: 'Learn more', href: 'mailto:contact@knowledgegraph.tech', style: 'primary' }],
      };
    case 'people':
      return {
        id,
        kind,
        style: 'cards',
        columns: 3,
        people: [{ id: newId('p'), name: 'Name', role: 'Role' }],
      };
    case 'list':
      return {
        id,
        kind,
        ordered: false,
        items: [
          { id: newId('i'), text: 'First item' },
          { id: newId('i'), text: 'Second item' },
        ],
      };
    case 'columns':
      return {
        id,
        kind,
        columns: 2,
        items: [
          { id: newId('c'), title: 'First', text: 'Some text.' },
          { id: newId('c'), title: 'Second', text: 'Some text.' },
        ],
      };
    case 'video':
      return { id, kind, url: '', align: 'center' };
    case 'divider':
      return { id, kind };
    case 'spacer':
      return { id, kind, size: 'medium' };
    case 'imageText':
      return {
        id,
        kind,
        image: { ...EMPTY_IMAGE },
        imageSide: 'left',
        imageWidth: 'half',
        shape: 'rounded',
        text: '## A short title\n\nA sentence or two about the picture.',
      };
    case 'gallery':
      return { id, kind, layout: 'grid', columns: 3, images: [], lightbox: true };
    case 'quote':
      return { id, kind, text: 'What someone said about the course.', name: 'Name', role: 'Role', style: 'card' };
    case 'callout':
      return { id, kind, tone: 'info', title: 'Good to know', text: 'A short note for readers.' };
    case 'accordion':
      return {
        id,
        kind,
        allowMany: false,
        items: [
          { id: newId('i'), title: 'A question people ask', text: 'The answer.' },
          { id: newId('i'), title: 'Another question', text: 'The answer.' },
        ],
      };
    case 'tabs':
      return {
        id,
        kind,
        items: [
          { id: newId('i'), title: 'First tab', text: 'What this tab says.' },
          { id: newId('i'), title: 'Second tab', text: 'What this tab says.' },
        ],
      };
    case 'stats':
      return {
        id,
        kind,
        columns: 3,
        align: 'center',
        items: [
          { id: newId('i'), value: '500+', label: 'Learners' },
          { id: newId('i'), value: '4', label: 'Programmes' },
          { id: newId('i'), value: '2023', label: 'Founded' },
        ],
      };
    case 'cards':
      return {
        id,
        kind,
        columns: 3,
        items: [
          { id: newId('i'), title: 'First card', text: 'A line about it.' },
          { id: newId('i'), title: 'Second card', text: 'A line about it.' },
          { id: newId('i'), title: 'Third card', text: 'A line about it.' },
        ],
      };
    case 'logos':
      return { id, kind, grayscale: false, items: [], align: 'center' };
    case 'embed':
      return { id, kind, provider: 'google-maps', url: '', aspect: '16:9', title: defaultEmbedTitle('google-maps') };
    case 'countdown':
      return { id, kind, until: 0, label: 'Starts in', doneText: 'It has started.', align: 'center' };
    case 'table':
      return {
        id,
        kind,
        striped: true,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'table',
              content: [
                {
                  type: 'tableRow',
                  content: [
                    { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Heading' }] }] },
                    { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Heading' }] }] },
                  ],
                },
                {
                  type: 'tableRow',
                  content: [
                    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell' }] }] },
                    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell' }] }] },
                  ],
                },
              ],
            },
          ],
        },
      };
    case 'toc':
      return { id, kind, title: 'On this page' };
    case 'reusable':
      return { id, kind, libraryId: '' };
  }
}

export function createSection(label = 'New section'): LearnSection {
  return {
    id: newId('s'),
    label,
    background: 'plain',
    width: 'normal',
    paddingTop: 'large',
    paddingBottom: 'large',
    blocks: [createBlock('heading'), createBlock('text')],
  };
}

type ColumnItem = BlockOf<'columns'>['items'][number];

function isEmptyColumn(it: ColumnItem): boolean {
  return !it.title?.trim() && !richOneLine(it.text) && !it.image?.src && !it.link;
}

/**
 * Picking a number under Columns (T324 D10). The block gets empty columns up
 * to that many, so picking 3 shows a third column at once. Picking fewer
 * removes only empty columns from the end: one with anything in it stays and
 * wraps onto the next row, as www draws it, so nothing typed is lost.
 */
export function columnCountPatch(block: BlockOf<'columns'>, columns: Columns): { columns: Columns; items: ColumnItem[] } {
  const items = block.items.slice();
  while (items.length < columns) items.push({ id: newId('c'), title: '', text: '' });
  while (items.length > columns && isEmptyColumn(items[items.length - 1])) items.pop();
  return { columns, items };
}

/**
 * Names for a list of sections to pick from, such as the bulk "Move to" list
 * (T324 D16). Two sections with the same name get their place on the page
 * added, "Hero (section 1)" and "Hero (section 4)", so they can be told apart.
 */
export function sectionPickLabels(sections: readonly Pick<LearnSection, 'label'>[]): string[] {
  const names = sections.map((s) => s.label.trim() || 'Untitled section');
  const count = new Map<string, number>();
  for (const n of names) count.set(n, (count.get(n) ?? 0) + 1);
  return names.map((n, i) => (count.get(n)! > 1 ? `${n} (section ${i + 1})` : n));
}

// ─── Starter text ─────────────────────────────────────────────────────────────

/**
 * The words a reader would see in `b`, one entry per field or paragraph, for
 * the starter text check. A stat is its figure and label together, so a
 * course lead who changes "500+" is not told off for keeping "Learners".
 * Fields whose starter is a fine final value are left out: an Embed's
 * screen-reader title (www uses "Map" and the like when it is empty, T326
 * item 6), a contents list's "On this page" and a countdown's labels.
 */
function readerLines(b: LearnBlock): string[] {
  const out: string[] = [];
  const add = (...xs: (string | undefined)[]) => {
    for (const x of xs) if (x) out.push(x);
  };
  // Table cells come out tab-separated, so a cell counts as a line too.
  const rich = (c: RichContent | undefined) => add(...richToPlainText(c).split(/[\n\t]/));
  switch (b.kind) {
    case 'heading':
    case 'text':
      rich(b.text);
      break;
    case 'image':
    case 'video':
      add(b.caption);
      break;
    case 'buttons':
      add(...b.buttons.map((x) => x.label));
      break;
    case 'people':
      for (const p of b.people) {
        add(p.name, p.role);
        rich(p.bio);
      }
      break;
    case 'list':
      for (const it of b.items) {
        add(it.title, it.link?.label, ...(it.children ?? []));
        rich(it.text);
      }
      break;
    case 'columns':
      for (const it of b.items) {
        add(it.title, it.link?.label);
        rich(it.text);
      }
      break;
    case 'imageText':
      rich(b.text);
      add(...(b.buttons ?? []).map((x) => x.label));
      break;
    case 'gallery':
      add(...b.images.map((i) => i.caption));
      break;
    case 'quote':
      rich(b.text);
      add(b.name, b.role);
      break;
    case 'callout':
      add(b.title);
      rich(b.text);
      break;
    case 'accordion':
    case 'tabs':
      for (const it of b.items) {
        add(it.title);
        rich(it.text);
      }
      break;
    case 'stats':
      add(...b.items.map((i) => `${i.value.trim()} ${i.label.trim()}`.trim()));
      break;
    case 'cards':
      for (const it of b.items) {
        add(it.title, it.badge, it.link?.label);
        rich(it.text);
      }
      break;
    case 'table':
      rich(b.doc);
      add(b.caption);
      break;
    default:
      break;
  }
  return out.map((x) => x.trim()).filter(Boolean);
}

/**
 * The text a new block of each kind starts with (`createBlock`), worked out
 * from `createBlock` itself so the check can never fall behind it. Left in by
 * mistake it publishes as real copy (T326 N3), so the Publish dialog and the
 * page checks both warn about it.
 */
export const STARTER_TEXT: Readonly<Record<BlockKind, ReadonlySet<string>>> = Object.fromEntries(
  BLOCK_KINDS.map(({ kind }) => [kind, new Set(readerLines(createBlock(kind)))]),
) as unknown as Record<BlockKind, ReadonlySet<string>>;

/** The lines of `b` that are still exactly a new block's starter text, after trimming. Each line once. */
export function starterLines(b: LearnBlock): string[] {
  const starter = STARTER_TEXT[b.kind];
  if (!starter?.size) return [];
  return [...new Set(readerLines(b).filter((l) => starter.has(l)))];
}

/** '"Second card"' or '"Second card" and 2 more', for a warning. */
export function starterList(lines: string[]): string {
  const first = `"${short(lines[0], 50)}"`;
  return lines.length > 1 ? `${first} and ${lines.length - 1} more` : first;
}

// ─── Problems the editor warns about before the server does ──────────────────

export interface Warning {
  sectionId: string;
  blockId?: string;
  message: string;
}

/** Things worth fixing before publish. Not a validator: the server has the last word. */
export function contentWarnings(content: LearnPageContent): Warning[] {
  const out: Warning[] = [];
  content.sections.forEach((s, i) => {
    const name = s.label.trim() || `Section ${i + 1}`;
    for (const b of s.blocks) {
      if (b.kind === 'image') {
        // Publish refuses these (`publishBlockers`); the wording matches.
        if (!b.image.src)
          out.push({ sectionId: s.id, blockId: b.id, message: `The Image block in "${name}" has no image yet` });
        else if (!b.image.alt.trim())
          out.push({ sectionId: s.id, blockId: b.id, message: 'Image needs a description' });
      }
      if (b.kind === 'people') {
        for (const p of b.people) {
          if (p.photo?.src && !p.photo.alt.trim())
            out.push({ sectionId: s.id, blockId: b.id, message: `Photo of ${p.name || 'a person'} needs a description` });
        }
      }
      if (b.kind === 'columns') {
        for (const item of b.items) {
          if (item.image?.src && !item.image.alt.trim())
            out.push({ sectionId: s.id, blockId: b.id, message: 'A column image needs a description' });
        }
      }
      if (b.kind === 'video' && !b.url.trim())
        out.push({ sectionId: s.id, blockId: b.id, message: `The Video block in "${name}" has no video link yet` });
      else if (b.kind === 'video' && !videoEmbedUrl(b.url))
        out.push({ sectionId: s.id, blockId: b.id, message: 'Video link must be YouTube or Vimeo' });
      const warn = (message: string) => out.push({ sectionId: s.id, blockId: b.id, message });
      switch (b.kind) {
        case 'imageText':
          // www shows the text and buttons on their own, so this is a note, not a problem.
          if (!b.image.src) warn('No picture yet; the text shows on its own');
          else if (!b.image.alt.trim()) warn('Image needs a description');
          break;
        case 'gallery':
          if (b.images.length === 0) warn('Gallery has no photos yet');
          if (b.images.some((i) => !i.alt.trim())) warn('Some gallery photos need a description');
          break;
        case 'logos':
          if (b.items.length === 0) warn('No logos yet');
          if (b.items.some((i) => !i.alt.trim())) warn('Each logo needs the company name as its description');
          break;
        case 'cards':
          if (b.items.some((i) => i.image?.src && !i.image.alt.trim())) warn('A card image needs a description');
          break;
        case 'quote':
          if (b.photo?.src && !b.photo.alt.trim()) warn('The quote photo needs a description');
          break;
        case 'embed': {
          const status = embedStatus(b.provider, b.url);
          if (status.state === 'empty') warn('The map, form or video has no link yet');
          else if (status.state === 'bad') warn(status.message);
          // An empty title is fine: www uses the service's name ("Map", "Video").
          break;
        }
        case 'countdown':
          if (!b.until) warn('Countdown has no date yet');
          break;
        case 'reusable':
          if (!b.libraryId) warn('Choose a saved section to show here');
          break;
      }
      if (hasUnfinishedLink(b)) warn('A link is not finished yet');
      if (!s.hidden && !b.hidden) {
        const starter = starterLines(b);
        if (starter.length)
          warn(`The ${kindLabel(b.kind)} block in "${name}" still has starter text: ${starterList(starter)}`);
      }
    }
  });
  return out;
}

// ─── Values the preview puts into markup ─────────────────────────────────────

/*
 * The preview draws whatever content it is handed: the draft (validated on
 * load and on every save) but also a version from the history list. Nothing
 * stored goes into an `href`, a `style` or a `className` without passing
 * through one of these first, so a hand-written document cannot inject CSS
 * (a `url()` in a custom property fetches from anywhere) or a script link.
 */

/** A link the preview may render, or `undefined` for none. */
export function previewHref(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' && isSafeHref(v) ? v : undefined;
}

/** One of `allowed`, or `fallback`. For every enum that becomes a class name. */
export function previewPick<T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;
}

const COLUMN_COUNTS = [1, 2, 3, 4] as const;

/** A column count for `--lp-cols`: 1 to 4, else 1. */
export function previewColumns(v: unknown): Columns {
  return previewPick<Columns>(v, COLUMN_COUNTS, 1);
}

/** A focal point fraction, clamped to 0..1; 0.5 for anything that is not a number. */
export function previewFraction(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
}

/** An image dimension in pixels, or 0 for unknown. */
export function previewPixels(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 20_000 ? v : 0;
}

export type EmbedProvider = BlockOf<'embed'>['provider'];

/** What the editor tells a course lead about each embed, and the hosts it accepts. */
export const EMBED_PROVIDERS: Record<EmbedProvider, { label: string; hint: string; hosts: string[] }> = {
  youtube: { label: 'YouTube', hint: 'https://www.youtube.com/watch?v=...', hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] },
  vimeo: { label: 'Vimeo', hint: 'https://vimeo.com/123456789', hosts: ['vimeo.com', 'player.vimeo.com'] },
  'google-maps': {
    label: 'Google Maps',
    hint: 'Find the place in Google Maps, then copy the address from the browser\'s address bar',
    hosts: ['google.com', 'maps.google.com', 'maps.app.goo.gl'],
  },
  'google-forms': { label: 'Google Forms', hint: 'https://docs.google.com/forms/d/e/.../viewform', hosts: ['docs.google.com', 'forms.gle'] },
  'google-docs': { label: 'Google Docs', hint: 'File > Share > Publish to web, then copy the link', hosts: ['docs.google.com'] },
  'google-slides': { label: 'Google Slides', hint: 'File > Share > Publish to web, then copy the link', hosts: ['docs.google.com'] },
  calendly: { label: 'Calendly', hint: 'https://calendly.com/your-name/30min', hosts: ['calendly.com'] },
  typeform: { label: 'Typeform', hint: 'https://yourname.typeform.com/to/abc123', hosts: ['typeform.com'] },
  loom: { label: 'Loom', hint: 'https://www.loom.com/share/...', hosts: ['loom.com'] },
  spotify: { label: 'Spotify', hint: 'https://open.spotify.com/episode/...', hosts: ['open.spotify.com'] },
};

/** Which provider a pasted link belongs to, so the editor can pick it for the person. */
export function embedProviderFromUrl(url: string): EmbedProvider | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'docs.google.com') {
    if (u.pathname.startsWith('/forms/')) return 'google-forms';
    if (u.pathname.startsWith('/presentation/')) return 'google-slides';
    if (u.pathname.startsWith('/document/')) return 'google-docs';
  }
  if (host === 'forms.gle') return 'google-forms';
  if ((host === 'google.com' || host === 'maps.google.com') && u.pathname.startsWith('/maps')) return 'google-maps';
  if (host === 'maps.app.goo.gl' || (host === 'goo.gl' && u.pathname.startsWith('/maps'))) return 'google-maps';
  for (const [p, info] of Object.entries(EMBED_PROVIDERS) as [EmbedProvider, (typeof EMBED_PROVIDERS)[EmbedProvider]][]) {
    if (p.startsWith('google-')) continue;
    if (info.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return p;
  }
  return null;
}

/**
 * The iframe address for a pasted link, or null when the website could not
 * show it. The same allowlist www renders with (`learnEmbedSrc`), so the
 * preview and the status line never say a link works when the page would
 * draw nothing (T324 D2: a Google Maps place link was "found" and then
 * refused).
 */
export function embedSrc(provider: EmbedProvider, url: string): string | null {
  return learnEmbedSrc(provider, url);
}

export interface EmbedStatus {
  state: 'empty' | 'ok' | 'bad';
  /** The status line under the link field, in plain words. */
  message: string;
}

/**
 * What the Embed settings say under the link: nothing pasted yet, a link that
 * will show on the page, or why it will not (`learnEmbedLinkProblem`, the
 * same words publish uses). A link that will not show still saves.
 */
export function embedStatus(provider: EmbedProvider, url: string): EmbedStatus {
  const label = EMBED_PROVIDERS[provider]?.label ?? 'embed';
  if (!url.trim()) return { state: 'empty', message: `Paste a ${label} link` };
  if (embedSrc(provider, url)) {
    return { state: 'ok', message: provider === 'google-maps' ? 'This map will show on the page.' : `This ${label} link will show on the page.` };
  }
  return { state: 'bad', message: learnEmbedLinkProblem(provider, url) ?? `That is not a ${label} link this page can show.` };
}

/**
 * The patch for a pasted or typed embed link: the link, the service it
 * belongs to when that is a different one, and a title that follows the
 * service while it is still the default one (a YouTube link in a new Embed
 * is announced as "Video", not "Map"). A title somebody wrote is kept.
 */
export function embedLinkPatch(
  block: { provider: EmbedProvider; title: string },
  url: string,
): { url: string; provider?: EmbedProvider; title?: string } {
  const p = embedProviderFromUrl(url);
  if (!p || p === block.provider) return { url };
  return { url, ...embedProviderPatch(block, p) };
}

/** Switching service by hand: the provider, and the title when it was the old service's default or empty. */
export function embedProviderPatch(
  block: { provider: EmbedProvider; title: string },
  provider: EmbedProvider,
): { provider: EmbedProvider; title?: string } {
  const t = block.title.trim();
  return t === '' || t === defaultEmbedTitle(block.provider) ? { provider, title: defaultEmbedTitle(provider) } : { provider };
}

/** Does the block hold a link with no address yet or one still being typed? Publish refuses it. */
export function hasUnfinishedLink(b: LearnBlock): boolean {
  const bad = (h: string | undefined) => h !== undefined && isUnfinishedHref(h);
  switch (b.kind) {
    case 'buttons':
      return b.buttons.some((x) => bad(x.href));
    case 'imageText':
      return (b.buttons ?? []).some((x) => bad(x.href));
    case 'image':
      return bad(b.href);
    case 'people':
      return b.people.some((p) => bad(p.linkedin));
    case 'list':
    case 'columns':
    case 'cards':
      return (b.items as { link?: { href: string } }[]).some((i) => bad(i.link?.href));
    case 'logos':
      return b.items.some((i) => bad(i.href));
    default:
      return false;
  }
}

/** YouTube or Vimeo page URL to its embed URL, or null for anything else. */
export function videoEmbedUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return /^[\w-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id =
      u.searchParams.get('v') ?? u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/)?.[1] ?? '';
    return /^[\w-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = u.pathname.match(/(\d{5,12})/)?.[1];
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }
  return null;
}

// ─── What changed, for the Publish dialog ────────────────────────────────────

export interface ChangeSummary {
  sectionsAdded: string[];
  sectionsRemoved: string[];
  sectionsEdited: string[];
  sectionsMoved: string[];
  blocksAdded: string[];
  blocksRemoved: string[];
  blocksEdited: string[];
  blocksMoved: string[];
  pageEdited: boolean;
  total: number;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Before against after, by id. A block that changed section counts as moved,
 * not as removed and added, because that is what the person did.
 */
export function summarizeChanges(
  before: LearnPageContent | null,
  after: LearnPageContent,
): ChangeSummary {
  const out: ChangeSummary = {
    sectionsAdded: [],
    sectionsRemoved: [],
    sectionsEdited: [],
    sectionsMoved: [],
    blocksAdded: [],
    blocksRemoved: [],
    blocksEdited: [],
    blocksMoved: [],
    pageEdited: false,
    total: 0,
  };
  const prev: LearnPageContent = before ?? { seoTitle: '', seoDescription: '', sections: [] };
  out.pageEdited =
    prev.seoTitle !== after.seoTitle ||
    prev.seoDescription !== after.seoDescription ||
    !same(prev.ogImage ?? null, after.ogImage ?? null) ||
    !!prev.noindex !== !!after.noindex;

  const prevSections = new Map(prev.sections.map((s, i) => [s.id, { s, i }]));
  const nextSections = new Map(after.sections.map((s, i) => [s.id, { s, i }]));
  const prevBlocks = new Map<string, { b: LearnBlock; sectionId: string; i: number }>();
  const nextBlocks = new Map<string, { b: LearnBlock; sectionId: string; i: number }>();
  for (const s of prev.sections) s.blocks.forEach((b, i) => prevBlocks.set(b.id, { b, sectionId: s.id, i }));
  for (const s of after.sections) s.blocks.forEach((b, i) => nextBlocks.set(b.id, { b, sectionId: s.id, i }));

  // Order changes are judged on the ids both sides share, so adding a section
  // at the top does not mark every other one as moved.
  const sharedPrev = prev.sections.filter((s) => nextSections.has(s.id)).map((s) => s.id);
  const sharedNext = after.sections.filter((s) => prevSections.has(s.id)).map((s) => s.id);

  for (const s of after.sections) {
    const old = prevSections.get(s.id);
    if (!old) {
      out.sectionsAdded.push(s.label);
      continue;
    }
    if (!same({ ...s, blocks: [] }, { ...old.s, blocks: [] })) out.sectionsEdited.push(s.label);
    if (sharedPrev.indexOf(s.id) !== sharedNext.indexOf(s.id)) out.sectionsMoved.push(s.label);
  }
  for (const s of prev.sections) if (!nextSections.has(s.id)) out.sectionsRemoved.push(s.label);

  const sectionLabel = (id: string) =>
    nextSections.get(id)?.s.label ?? prevSections.get(id)?.s.label ?? '';

  for (const s of after.sections) {
    const sharedBefore = (prevSections.get(s.id)?.s.blocks ?? [])
      .filter((b) => nextBlocks.get(b.id)?.sectionId === s.id)
      .map((b) => b.id);
    const sharedAfter = s.blocks.filter((b) => prevBlocks.get(b.id)?.sectionId === s.id).map((b) => b.id);
    for (const b of s.blocks) {
      const where = `${blockSummary(b)} (${s.label})`;
      const old = prevBlocks.get(b.id);
      if (!old) {
        out.blocksAdded.push(where);
        continue;
      }
      if (!same(old.b, b)) out.blocksEdited.push(where);
      if (old.sectionId !== s.id || sharedBefore.indexOf(b.id) !== sharedAfter.indexOf(b.id))
        out.blocksMoved.push(where);
    }
  }
  for (const [id, { b, sectionId }] of prevBlocks)
    if (!nextBlocks.has(id)) out.blocksRemoved.push(`${blockSummary(b)} (${sectionLabel(sectionId)})`);

  out.total =
    out.sectionsAdded.length +
    out.sectionsRemoved.length +
    out.sectionsEdited.length +
    out.sectionsMoved.length +
    out.blocksAdded.length +
    out.blocksRemoved.length +
    out.blocksEdited.length +
    out.blocksMoved.length +
    (out.pageEdited ? 1 : 0);
  return out;
}

export function contentEqual(a: LearnPageContent | null, b: LearnPageContent | null): boolean {
  return same(a, b);
}

// ─── Rich text in the inline editor ──────────────────────────────────────────

/**
 * The inline editor (TipTap) works on a document tree; the contract stores the
 * small Markdown subset `rich-text-core` reads. These two convert between them
 * for exactly what the toolbar offers: paragraphs (a blank line between),
 * line breaks (a single newline), bold, italic and links.
 */
export interface InlineMark {
  type: 'bold' | 'italic' | 'link';
  attrs?: { href?: string };
}
export interface InlineNode {
  type: 'text' | 'hardBreak';
  text?: string;
  marks?: InlineMark[];
}
export interface ParagraphNode {
  type: 'paragraph';
  content?: InlineNode[];
}
export interface InlineDoc {
  type: 'doc';
  content: ParagraphNode[];
}

const INLINE_MD =
  /\[([^\]\n]*)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_/g;

function lineToNodes(line: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let last = 0;
  INLINE_MD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_MD.exec(line)) !== null) {
    if (m.index > last) nodes.push({ type: 'text', text: line.slice(last, m.index) });
    last = m.index + m[0].length;
    const [, linkText, href, strong, star, underscore] = m;
    if (href !== undefined) {
      // A bold or italic link is stored as `**[text](href)**`, which the
      // regex sees as bold text containing brackets. Handled below.
      nodes.push({ type: 'text', text: linkText || href, marks: [{ type: 'link', attrs: { href } }] });
    } else {
      const text = strong ?? star ?? underscore ?? '';
      const mark: InlineMark = { type: strong !== undefined ? 'bold' : 'italic' };
      // One level of nesting: a link inside bold or italic.
      const inner = /^\[([^\]\n]*)\]\(([^)\s]+)\)$/.exec(text);
      if (inner)
        nodes.push({
          type: 'text',
          text: inner[1] || inner[2],
          marks: [mark, { type: 'link', attrs: { href: inner[2] } }],
        });
      else nodes.push({ type: 'text', text, marks: [mark] });
    }
  }
  if (last < line.length) nodes.push({ type: 'text', text: line.slice(last) });
  return nodes.filter((n) => n.text !== '');
}

export function markdownToDoc(md: string): InlineDoc {
  const paras = md.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  return {
    type: 'doc',
    content: paras.map((p) => {
      const content: InlineNode[] = [];
      p.split('\n').forEach((line, i) => {
        if (i > 0) content.push({ type: 'hardBreak' });
        content.push(...lineToNodes(line));
      });
      return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
    }),
  };
}

function nodeToMarkdown(n: InlineNode): string {
  if (n.type === 'hardBreak') return '\n';
  let text = n.text ?? '';
  if (!text) return '';
  const marks = n.marks ?? [];
  const link = marks.find((m) => m.type === 'link');
  // Markdown markers wrap the words, not the spaces around them, or `** bold**`
  // stops parsing as bold.
  const lead = text.match(/^\s*/)?.[0] ?? '';
  const trail = text.slice(lead.length).match(/\s*$/)?.[0] ?? '';
  let core = text.slice(lead.length, text.length - trail.length);
  if (!core) return text;
  if (link?.attrs?.href) core = `[${core}](${link.attrs.href})`;
  if (marks.some((m) => m.type === 'italic')) core = `*${core}*`;
  if (marks.some((m) => m.type === 'bold')) core = `**${core}**`;
  text = `${lead}${core}${trail}`;
  return text;
}

export function docToMarkdown(doc: InlineDoc): string {
  return doc.content
    .map((p) => (p.content ?? []).map(nodeToMarkdown).join(''))
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
