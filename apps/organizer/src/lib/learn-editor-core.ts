import type {
  LearnBlock,
  LearnPageContent,
  LearnSection,
  PageImage,
} from '@kgc/shared';

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

export type EditAction =
  | { type: 'setPage'; patch: Partial<Pick<LearnPageContent, 'seoTitle' | 'seoDescription'>> }
  | { type: 'updateSection'; sectionId: string; patch: SectionPatch }
  | { type: 'addSection'; index: number; section: LearnSection }
  | { type: 'duplicateSection'; sectionId: string }
  | { type: 'removeSection'; sectionId: string }
  | { type: 'moveSection'; sectionId: string; toIndex: number }
  | { type: 'updateBlock'; sectionId: string; blockId: string; patch: BlockPatch }
  | { type: 'insertBlock'; sectionId: string; index: number; block: LearnBlock }
  | { type: 'duplicateBlock'; sectionId: string; blockId: string }
  | { type: 'removeBlock'; sectionId: string; blockId: string }
  | { type: 'moveBlock'; sectionId: string; blockId: string; toSectionId: string; toIndex: number }
  | { type: 'replace'; content: LearnPageContent };

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
  if (copy.kind === 'people') copy.people = copy.people.map((p) => ({ ...p, id: newId('p') }));
  if (copy.kind === 'list') copy.items = copy.items.map((i) => ({ ...i, id: newId('i') }));
  if (copy.kind === 'columns') copy.items = copy.items.map((i) => ({ ...i, id: newId('c') }));
  return copy;
}

export function cloneSectionWithNewIds(section: LearnSection): LearnSection {
  return {
    ...structuredClone(section),
    id: newId('s'),
    label: `${section.label} copy`,
    blocks: section.blocks.map(cloneBlockWithNewIds),
  };
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
        blocks.splice(i + 1, 0, cloneBlockWithNewIds(s.blocks[i]));
        return { ...s, blocks };
      });
    case 'removeBlock':
      return mapSection(content, action.sectionId, (s) =>
        s.blocks.some((b) => b.id === action.blockId)
          ? { ...s, blocks: s.blocks.filter((b) => b.id !== action.blockId) }
          : s,
      );
    case 'moveBlock': {
      const from = content.sections.find((s) => s.id === action.sectionId);
      const block = from?.blocks.find((b) => b.id === action.blockId);
      if (!from || !block) return content;
      if (!content.sections.some((s) => s.id === action.toSectionId)) return content;
      if (action.sectionId === action.toSectionId) {
        const i = from.blocks.indexOf(block);
        return mapSection(content, from.id, (s) => ({
          ...s,
          blocks: moveWithin(s.blocks, i, action.toIndex),
        }));
      }
      const removed = mapSection(content, from.id, (s) => ({
        ...s,
        blocks: s.blocks.filter((b) => b.id !== block.id),
      }));
      return mapSection(removed, action.toSectionId, (s) => {
        const blocks = s.blocks.slice();
        blocks.splice(clamp(action.toIndex, 0, blocks.length), 0, block);
        return { ...s, blocks };
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
      return 'label' in action.patch ? `section:${action.sectionId}:${fields(action.patch)}` : undefined;
    case 'updateBlock': {
      const textual = ['text', 'caption', 'url', 'buttons', 'people', 'items', 'image'];
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

export const BLOCK_KINDS: { kind: BlockKind; label: string; hint: string }[] = [
  { kind: 'heading', label: 'Heading', hint: 'A title for a part of the page' },
  { kind: 'text', label: 'Text', hint: 'Paragraphs with bold, italic and links' },
  { kind: 'image', label: 'Image', hint: 'A photo or graphic' },
  { kind: 'buttons', label: 'Buttons', hint: 'One or more link buttons' },
  { kind: 'people', label: 'People', hint: 'Cards with photo, name and role' },
  { kind: 'list', label: 'List', hint: 'Bulleted or numbered items' },
  { kind: 'columns', label: 'Columns', hint: 'Two to four side by side' },
  { kind: 'video', label: 'Video', hint: 'YouTube or Vimeo' },
  { kind: 'divider', label: 'Divider', hint: 'A thin line' },
  { kind: 'spacer', label: 'Spacer', hint: 'Empty space' },
];

export function kindLabel(kind: BlockKind): string {
  return BLOCK_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

/** Rich text as one plain line, for an outline row. */
export function plainText(md: string): string {
  return md
    .replace(/\[([^\]\n]*)\]\([^)\s]+\)/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
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
  }
  return detail ? `${label}: ${short(detail)}` : label;
}

// ─── New blocks ───────────────────────────────────────────────────────────────

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

// ─── Problems the editor warns about before the server does ──────────────────

export interface Warning {
  sectionId: string;
  blockId?: string;
  message: string;
}

/** Things worth fixing before publish. Not a validator: the server has the last word. */
export function contentWarnings(content: LearnPageContent): Warning[] {
  const out: Warning[] = [];
  for (const s of content.sections) {
    for (const b of s.blocks) {
      if (b.kind === 'image') {
        if (!b.image.src) out.push({ sectionId: s.id, blockId: b.id, message: 'Image has no picture yet' });
        else if (!b.image.alt.trim())
          out.push({ sectionId: s.id, blockId: b.id, message: 'Image needs a description (alt text)' });
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
      if (b.kind === 'video' && b.url && !videoEmbedUrl(b.url))
        out.push({ sectionId: s.id, blockId: b.id, message: 'Video link must be YouTube or Vimeo' });
    }
  }
  return out;
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
  const prev = before ?? { seoTitle: '', seoDescription: '', sections: [] };
  out.pageEdited = prev.seoTitle !== after.seoTitle || prev.seoDescription !== after.seoDescription;

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
