import {
  expandedBlockId,
  expandReusableBlocks,
  type LearnBlock,
  type LearnPageContent,
  type LearnSection,
} from '@kgc/shared';
import { newId } from './learn-editor-core';
import { publishBlockers, publishProblems, sameContent } from './learn-page-core';

/**
 * Saved sections in the Learn editor (T325): the draft compared with the live
 * page the way Publish compares it, the publish blockers the server will
 * name, Unlink, and changing a saved section from the page.
 *
 * Pure, so `learn-library-edit-core.test.ts` can pin the T324 findings
 * (E F1 to F4, F7, C X2) without a browser.
 */

export type Library = ReadonlyMap<string, LearnSection>;
type Reusable = Extract<LearnBlock, { kind: 'reusable' }>;

export function hasReusable(content: LearnPageContent): boolean {
  return content.sections.some((s) => s.blocks.some((b) => b.kind === 'reusable'));
}

/**
 * The draft as Publish puts it live: every saved section expanded. Until the
 * library has loaded the draft comes back as it is.
 */
export function expandForCompare(content: LearnPageContent, library: Library | null | undefined): LearnPageContent {
  return library && hasReusable(content) ? expandReusableBlocks(content, library) : content;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

/**
 * The same content with every object's keys in one order. The change list
 * compares blocks as JSON, and the server's validated copy of a saved section
 * need not list its keys in the order the library row does.
 */
export function canonicalContent(content: LearnPageContent): LearnPageContent {
  return sortKeys(content) as LearnPageContent;
}

/**
 * Whether the draft differs from what visitors see. The live copy holds saved
 * sections expanded, so the draft is expanded first, as the server does in
 * `loadLearnEditor` (E F2: a linked section made every page read "Draft").
 * While the library is still loading, `fallback` (the server's answer) stands.
 */
export function draftDiffersFromLive(
  content: LearnPageContent,
  live: LearnPageContent | null,
  library: Library | null | undefined,
  fallback: boolean,
): boolean {
  if (!library && hasReusable(content)) return fallback;
  return !sameContent(expandForCompare(content, library), live);
}

// ─── Publish blockers ────────────────────────────────────────────────────────

export interface PublishBlocker {
  message: string;
  /** Where to take the person; a block inside a saved section points at its Saved section block. */
  sectionId?: string;
  blockId?: string;
}

function sectionName(s: LearnSection, i: number): string {
  return s.label.trim() || `Section ${i + 1}`;
}

/** Expanded block id to the id of the Saved section block it came from. */
function hostIds(content: LearnPageContent, library: Library): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of content.sections) {
    for (const b of s.blocks) {
      if (b.kind !== 'reusable') continue;
      for (const saved of library.get(b.libraryId)?.blocks ?? []) out.set(expandedBlockId(b.id, saved.id), b.id);
    }
  }
  return out;
}

/**
 * What stops the draft being published, the list the server refuses with
 * (`publishProblems`: the draft checked with the library, and the page with
 * its saved sections expanded), so an empty block inside a linked section
 * counts (C X2) and so does a Saved section block whose saved section was
 * deleted (E F7). Each message comes with the block or section to show where
 * one can be found, by checking the blocks one at a time.
 */
export function draftPublishBlockers(content: LearnPageContent, library: Library | null | undefined): PublishBlocker[] {
  const expanded = expandForCompare(content, library);
  const pool = library ? publishProblems(content, library, expanded) : publishBlockers(content);
  if (pool.length === 0) return [];

  const located: (PublishBlocker & { used?: boolean })[] = [];
  const probe = (s: LearnSection, i: number, blocks: LearnBlock[], lib: Library | undefined): string[] =>
    publishBlockers(
      { seoTitle: 'x', seoDescription: '', sections: [{ ...s, label: sectionName(s, i), anchor: blocks.length ? undefined : s.anchor, blocks }] },
      lib,
    );
  content.sections.forEach((s, i) => {
    for (const message of probe(s, i, [], undefined)) located.push({ message, sectionId: s.id });
    for (const b of s.blocks) {
      for (const message of probe(s, i, [b], library ?? undefined)) located.push({ message, sectionId: s.id, blockId: b.id });
    }
  });
  if (library) {
    const hosts = hostIds(content, library);
    expanded.sections.forEach((s, i) => {
      for (const b of s.blocks) {
        const host = hosts.get(b.id);
        if (!host) continue;
        for (const message of probe(s, i, [b], undefined)) located.push({ message, sectionId: s.id, blockId: host });
      }
    });
  }
  return pool.map((message) => {
    const at = located.find((l) => !l.used && l.message === message);
    if (!at) return { message };
    at.used = true;
    return { message, sectionId: at.sectionId, blockId: at.blockId };
  });
}

// ─── Linked sections ─────────────────────────────────────────────────────────

/** Anchors the page uses outside saved sections, as expansion counts them. */
function usedAnchors(content: LearnPageContent): Set<string> {
  const out = new Set<string>();
  for (const s of content.sections) {
    if (s.anchor) out.add(s.anchor);
    for (const b of s.blocks) if (b.kind !== 'reusable' && b.anchor) out.add(b.anchor);
  }
  return out;
}

interface Copies {
  blocks: LearnBlock[];
  /** Copy id to the saved section's own block id. */
  ids: Record<string, string>;
  /** Anchors left off a copy because the page already uses them. */
  anchors: Record<string, string>;
}

/**
 * The saved section's blocks as page blocks, with the ids expansion gives
 * them (`expandedBlockId`), so an unlinked copy compares equal to the live
 * page it was published as. `fromHost` passes the Saved section block's own
 * anchor, visibility and hidden flag on, as expansion draws them; a copy made
 * to change the saved section itself must not carry them back to the library.
 */
function copyBlocks(hostId: string, host: Reusable | null, saved: LearnSection, anchors: Set<string>): Copies {
  const out: Copies = { blocks: [], ids: {}, anchors: {} };
  for (const b of saved.blocks ?? []) {
    if (b.kind === 'reusable') continue;
    const copy = { ...structuredClone(b), id: expandedBlockId(hostId, b.id) } as LearnBlock;
    out.ids[copy.id] = b.id;
    if (copy.anchor) {
      if (anchors.has(copy.anchor)) {
        out.anchors[copy.id] = copy.anchor;
        delete copy.anchor;
      } else anchors.add(copy.anchor);
    }
    if (host) {
      if (host.visibleOn && host.visibleOn !== 'all' && !copy.visibleOn) copy.visibleOn = host.visibleOn;
      if (host.hidden) copy.hidden = true;
    }
    out.blocks.push(copy);
  }
  if (host?.anchor && out.blocks.length > 0 && !out.blocks[0].anchor) out.blocks[0].anchor = host.anchor;
  return out;
}

function remapColumns(saved: LearnSection, ids: Record<string, string>): Record<string, number> | undefined {
  if (!saved.blockColumn) return undefined;
  const back = new Map(Object.entries(ids).map(([copy, own]) => [own, copy]));
  const out: Record<string, number> = {};
  for (const [id, col] of Object.entries(saved.blockColumn)) {
    const copy = back.get(id);
    if (copy) out[copy] = col;
  }
  return Object.keys(out).length ? out : undefined;
}

const HOST_FIELDS = ['anchor', 'visibleOn', 'hidden', 'note'] as const;

/** The saved section's look and blocks under the host section's id, name and host-only fields. */
function wholeSection(host: LearnSection, saved: LearnSection, blocks: LearnBlock[], ids: Record<string, string>): LearnSection {
  const out: LearnSection = { ...structuredClone(saved), id: host.id, label: host.label, blocks };
  for (const k of HOST_FIELDS) delete out[k];
  delete out.blockColumn;
  for (const k of HOST_FIELDS) if (host[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = host[k];
  const cols = remapColumns(saved, ids);
  if (cols) out.blockColumn = cols;
  return out;
}

/**
 * True when the Saved section block is the only visible block of its
 * section, so the section takes the saved section whole: its background,
 * width, padding and layout come from the library, not from the section.
 */
export function takesSavedLook(section: LearnSection, blockId: string): boolean {
  const visible = section.blocks.filter((b) => !b.hidden);
  return visible.length === 1 && visible[0].id === blockId && visible[0].kind === 'reusable';
}

/** The Saved section block that gives this section its look, if one does. */
export function linkedHostBlock(section: LearnSection): Reusable | null {
  const visible = section.blocks.filter((b) => !b.hidden);
  return visible.length === 1 && visible[0].kind === 'reusable' ? visible[0] : null;
}

function findReusable(content: LearnPageContent, sectionId: string, blockId: string) {
  const si = content.sections.findIndex((s) => s.id === sectionId);
  const section = content.sections[si];
  const block = section?.blocks.find((b) => b.id === blockId);
  return block?.kind === 'reusable' ? { si, section, block } : null;
}

function withSection(content: LearnPageContent, si: number, section: LearnSection): LearnPageContent {
  return { ...content, sections: content.sections.map((s, i) => (i === si ? section : s)) };
}

/**
 * Unlink (E F3): the Saved section block becomes a copy of the saved section
 * that can be changed here, drawn exactly as the link was. Null when the
 * block or its saved section is gone.
 */
export function unlinkReusable(
  content: LearnPageContent,
  sectionId: string,
  blockId: string,
  library: Library,
): LearnPageContent | null {
  const found = findReusable(content, sectionId, blockId);
  const saved = found && library.get(found.block.libraryId);
  if (!found || !saved) return null;
  const { si, section, block } = found;
  const anchors = usedAnchors(content);
  const copies = copyBlocks(block.id, block, saved, anchors);
  if (takesSavedLook(section, block.id)) {
    // Other blocks here are hidden; they stay, after the copy.
    const rest = section.blocks.filter((b) => b.id !== block.id);
    return withSection(content, si, wholeSection(section, saved, [...copies.blocks, ...rest], copies.ids));
  }
  const column = section.blockColumn?.[block.id];
  const blockColumn: Record<string, number> = { ...(section.blockColumn ?? {}) };
  delete blockColumn[block.id];
  if (column !== undefined) for (const b of copies.blocks) blockColumn[b.id] = column;
  const next: LearnSection = {
    ...section,
    blocks: section.blocks.flatMap((b) => (b.id === block.id ? copies.blocks : [b])),
  };
  if (Object.keys(blockColumn).length) next.blockColumn = blockColumn;
  else delete next.blockColumn;
  return withSection(content, si, next);
}

// ─── Changing a saved section from the page ──────────────────────────────────

/**
 * Editor state (never stored) while a saved section is being changed (E F1).
 * The section `sectionId` holds an editable copy; Save to library writes it
 * back under `libraryId`, and either way the link is put back as `restore`
 * says.
 */
export interface SavedSectionEdit {
  libraryId: string;
  name: string;
  sectionId: string;
  ids: Record<string, string>;
  anchors: Record<string, string>;
  restore:
    /** The section was the link's whole section: put it back as it was. */
    | { kind: 'whole'; host: LearnSection }
    /** The link sat among other blocks: the copy got a section of its own, and the block goes back. */
    | { kind: 'inPlace'; hostSectionId: string; index: number; column?: number; block: LearnBlock }
    /** Opened from the library: the copy is removed. */
    | { kind: 'none' };
}

/** Starts changing the saved section a Saved section block shows. Null when there is nothing to change. */
export function startEditFromBlock(
  content: LearnPageContent,
  sectionId: string,
  blockId: string,
  library: Library,
  name: string,
): { content: LearnPageContent; edit: SavedSectionEdit } | null {
  const found = findReusable(content, sectionId, blockId);
  const saved = found && library.get(found.block.libraryId);
  if (!found || !saved) return null;
  const { si, section, block } = found;
  const copies = copyBlocks(block.id, null, saved, usedAnchors(content));
  const base = { libraryId: block.libraryId, name, ids: copies.ids, anchors: copies.anchors };
  if (takesSavedLook(section, block.id)) {
    const editing = wholeSection(section, saved, copies.blocks, copies.ids);
    return {
      content: withSection(content, si, editing),
      edit: { ...base, sectionId: section.id, restore: { kind: 'whole', host: section } },
    };
  }
  const index = section.blocks.findIndex((b) => b.id === block.id);
  const column = section.blockColumn?.[block.id];
  const host: LearnSection = { ...section, blocks: section.blocks.filter((b) => b.id !== block.id) };
  if (host.blockColumn) {
    const cols = { ...host.blockColumn };
    delete cols[block.id];
    if (Object.keys(cols).length) host.blockColumn = cols;
    else delete host.blockColumn;
  }
  const editing = ownSection(saved, name, copies);
  const sections = [...content.sections];
  sections.splice(si, 1, host, editing);
  return {
    content: { ...content, sections },
    edit: {
      ...base,
      sectionId: editing.id,
      restore: { kind: 'inPlace', hostSectionId: section.id, index, column, block },
    },
  };
}

function ownSection(saved: LearnSection, name: string, copies: Copies): LearnSection {
  const out: LearnSection = { ...structuredClone(saved), id: newId('s'), label: name, blocks: copies.blocks };
  for (const k of HOST_FIELDS) delete out[k];
  delete out.blockColumn;
  const cols = remapColumns(saved, copies.ids);
  if (cols) out.blockColumn = cols;
  return out;
}

/** Starts changing a saved section from the library list: an editable copy goes in at `index`. */
export function startEditFromLibrary(
  content: LearnPageContent,
  index: number,
  libraryId: string,
  saved: LearnSection,
  name: string,
): { content: LearnPageContent; edit: SavedSectionEdit } {
  const copies = copyBlocks(newId('b'), null, saved, usedAnchors(content));
  const editing = ownSection(saved, name, copies);
  const sections = [...content.sections];
  sections.splice(Math.max(0, Math.min(index, sections.length)), 0, editing);
  return {
    content: { ...content, sections },
    edit: { libraryId, name, sectionId: editing.id, ids: copies.ids, anchors: copies.anchors, restore: { kind: 'none' } },
  };
}

/**
 * The section to store in the library: what is on the page now, with the
 * saved section's own block ids, name and section-only fields back, and any
 * anchor that had to be left off the copy put back.
 */
export function savedSectionFromEdit(
  content: LearnPageContent,
  edit: SavedSectionEdit,
  saved: LearnSection,
): LearnSection | null {
  const cur = content.sections.find((s) => s.id === edit.sectionId);
  if (!cur) return null;
  const blocks = cur.blocks.map((b) => {
    const copy = { ...b, id: edit.ids[b.id] ?? b.id } as LearnBlock;
    if (!copy.anchor && edit.anchors[b.id]) copy.anchor = edit.anchors[b.id];
    return copy;
  });
  const out: LearnSection = { ...structuredClone(cur), id: saved.id, label: saved.label, blocks };
  for (const k of HOST_FIELDS) delete out[k];
  for (const k of HOST_FIELDS) if (saved[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = saved[k];
  delete out.blockColumn;
  if (cur.blockColumn) {
    const cols: Record<string, number> = {};
    for (const [id, col] of Object.entries(cur.blockColumn)) cols[edit.ids[id] ?? id] = col;
    if (Object.keys(cols).length) out.blockColumn = cols;
  }
  return out;
}

/** Puts the link back where the editable copy is (after Save to library, or on Cancel). */
export function finishSavedSectionEdit(content: LearnPageContent, edit: SavedSectionEdit): LearnPageContent {
  const at = content.sections.findIndex((s) => s.id === edit.sectionId);
  if (at < 0) return content;
  const cur = content.sections[at];
  const r = edit.restore;
  if (r.kind === 'whole') {
    const back: LearnSection = { ...r.host, label: cur.label };
    for (const k of HOST_FIELDS) {
      if (cur[k] !== undefined) (back as unknown as Record<string, unknown>)[k] = cur[k];
      else delete back[k];
    }
    return withSection(content, at, back);
  }
  const sections = content.sections.filter((_, i) => i !== at);
  if (r.kind === 'none') return { ...content, sections };
  const hi = sections.findIndex((s) => s.id === r.hostSectionId);
  if (hi < 0) {
    // The host section was deleted meanwhile: the link comes back in a section of its own.
    sections.splice(at, 0, {
      id: newId('s'),
      label: edit.name,
      background: 'plain',
      width: 'normal',
      paddingTop: 'none',
      paddingBottom: 'none',
      blocks: [r.block],
    });
    return { ...content, sections };
  }
  const host = sections[hi];
  const blocks = [...host.blocks];
  blocks.splice(Math.min(r.index, blocks.length), 0, r.block);
  const next: LearnSection = { ...host, blocks };
  if (r.column !== undefined) next.blockColumn = { ...(host.blockColumn ?? {}), [r.block.id]: r.column };
  sections[hi] = next;
  return { ...content, sections };
}
