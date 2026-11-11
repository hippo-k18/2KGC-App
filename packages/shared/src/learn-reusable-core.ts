/**
 * Saved sections (T315): how a `reusable` block becomes real blocks.
 *
 * The library (`pageLayouts/learn/library/{id}`) holds whole sections. A
 * `reusable` block in the draft points at one by id. The website never sees a
 * `reusable` block: publishing expands every one into the blocks it stands for,
 * so the published copy (and each kept version) is self-contained, and editing
 * or deleting a saved section never changes www until somebody presses Publish.
 * The dashboard preview runs the same function on the draft.
 *
 * ── The two ways a reusable block expands ───────────────────────────────────
 *
 * 1. **A section whose only visible block is a reusable block takes the saved
 *    section whole**: its background, width, padding, layout and columns, and
 *    its blocks. The host keeps its own id, label, anchor, visibleOn, hidden and
 *    note, so in-page links and the editor's outline still point at it. This is
 *    "drop a saved section into the page".
 * 2. **Anywhere else, the reusable block is replaced in place by the saved
 *    section's blocks**, in the same column of the host section, and the host
 *    keeps its own look. This is "drop a saved group of blocks into a section".
 *
 * Rules that apply to both:
 * - A hidden reusable block expands to nothing; hidden blocks inside the saved
 *   section stay hidden.
 * - A reusable block naming a saved section that does not exist expands to
 *   nothing (the server refuses to save such a draft, so this only covers a
 *   race with a delete).
 * - A saved section may not hold reusable blocks itself (the server refuses to
 *   save one), and any found anyway are dropped, so expansion never recurses.
 * - Expanded block ids are `{reusableBlockId}--{savedBlockId}`, so the same
 *   saved section can be used twice on one page and every id stays unique.
 * - An anchor inside a saved section is kept only the first time it appears on
 *   the page, so two copies never produce two targets with the same name. The
 *   reusable block's own anchor and visibleOn pass to the first expanded block
 *   (anchor) and every expanded block that has none (visibleOn).
 */

import type { LearnBlock, LearnPageContent, LearnSection } from "./learn-page.js";

export type LearnLibrarySections = ReadonlyMap<string, LearnSection> | Readonly<Record<string, LearnSection>>;

function lookup(library: LearnLibrarySections, id: string): LearnSection | undefined {
  if (library instanceof Map) return library.get(id);
  const rec = library as Readonly<Record<string, LearnSection>>;
  return Object.prototype.hasOwnProperty.call(rec, id) ? rec[id] : undefined;
}

/** A short stable hash, so a long expanded id still fits the 64-character id format. */
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function expandedBlockId(hostId: string, savedId: string): string {
  const id = `${hostId}--${savedId}`;
  if (id.length <= 64) return id;
  return `${hostId.slice(0, 24)}--${savedId.slice(0, 24)}-${shortHash(id)}`;
}

/** Ids of the saved sections a page points at, each once, in order of first use. */
export function reusableLibraryIds(content: LearnPageContent | null | undefined): string[] {
  const out: string[] = [];
  for (const s of content?.sections ?? []) {
    for (const b of s.blocks ?? []) {
      if (b.kind === "reusable" && !out.includes(b.libraryId)) out.push(b.libraryId);
    }
  }
  return out;
}

/** Where a page points at one saved section, for "used in" and for refusing a delete. */
export function reusableUses(content: LearnPageContent | null | undefined, libraryId: string): string[] {
  const out: string[] = [];
  (content?.sections ?? []).forEach((s, si) => {
    (s.blocks ?? []).forEach((b, bi) => {
      if (b.kind === "reusable" && b.libraryId === libraryId) {
        out.push(`section ${si + 1}${s.label ? ` "${s.label}"` : ""}, block ${bi + 1}`);
      }
    });
  });
  return out;
}

/** The saved section's blocks, renamed for this use, with anchors that are still free. */
function blocksFor(host: LearnBlock & { kind: "reusable" }, saved: LearnSection, anchors: Set<string>): LearnBlock[] {
  const out: LearnBlock[] = [];
  for (const b of saved.blocks ?? []) {
    if (b.kind === "reusable") continue;
    const copy = { ...structuredClone(b), id: expandedBlockId(host.id, b.id) } as LearnBlock;
    if (copy.anchor) {
      if (anchors.has(copy.anchor)) delete copy.anchor;
      else anchors.add(copy.anchor);
    }
    if (host.visibleOn && host.visibleOn !== "all" && !copy.visibleOn) copy.visibleOn = host.visibleOn;
    out.push(copy);
  }
  if (host.anchor && out.length > 0 && !out[0].anchor) out[0].anchor = host.anchor;
  return out;
}

function remapColumns(saved: LearnSection, hostId: string): Record<string, number> | undefined {
  if (!saved.blockColumn) return undefined;
  const out: Record<string, number> = {};
  for (const [id, col] of Object.entries(saved.blockColumn)) out[expandedBlockId(hostId, id)] = col;
  return Object.keys(out).length ? out : undefined;
}

/**
 * The page with every reusable block expanded from `library`. Pure: the input
 * is not changed. A page with no reusable blocks comes back equal to itself.
 */
export function expandReusableBlocks(content: LearnPageContent, library: LearnLibrarySections): LearnPageContent {
  // Anchors the page already uses, so a saved section's anchors never collide with them.
  const anchors = new Set<string>();
  for (const s of content.sections) {
    if (s.anchor) anchors.add(s.anchor);
    for (const b of s.blocks) if (b.kind !== "reusable" && b.anchor) anchors.add(b.anchor);
  }

  const sections = content.sections.map((section): LearnSection => {
    if (!section.blocks.some((b) => b.kind === "reusable")) return section;

    const visible = section.blocks.filter((b) => !b.hidden);
    const only = visible.length === 1 && visible[0].kind === "reusable" ? visible[0] : null;
    if (only) {
      const saved = lookup(library, only.libraryId);
      if (saved) {
        const whole: LearnSection = {
          ...structuredClone(saved),
          id: section.id,
          label: section.label,
          blocks: blocksFor(only, saved, anchors),
        };
        // Saved section anchors are handled per block above; the section's own come from the host.
        delete whole.anchor;
        delete whole.visibleOn;
        delete whole.hidden;
        delete whole.note;
        delete whole.blockColumn;
        if (section.anchor) whole.anchor = section.anchor;
        if (section.visibleOn) whole.visibleOn = section.visibleOn;
        if (section.hidden) whole.hidden = true;
        if (section.note) whole.note = section.note;
        const cols = remapColumns(saved, only.id);
        if (cols) whole.blockColumn = cols;
        return whole;
      }
    }

    const blocks: LearnBlock[] = [];
    const blockColumn: Record<string, number> = { ...(section.blockColumn ?? {}) };
    for (const b of section.blocks) {
      if (b.kind !== "reusable") {
        blocks.push(b);
        continue;
      }
      const column = blockColumn[b.id];
      delete blockColumn[b.id];
      if (b.hidden) continue;
      const saved = lookup(library, b.libraryId);
      if (!saved) continue;
      for (const inserted of blocksFor(b, saved, anchors)) {
        blocks.push(inserted);
        if (column !== undefined) blockColumn[inserted.id] = column;
      }
    }
    const out: LearnSection = { ...section, blocks };
    if (Object.keys(blockColumn).length) out.blockColumn = blockColumn;
    else delete out.blockColumn;
    return out;
  });

  return { ...content, sections };
}
