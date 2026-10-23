import { expandReusableBlocks, type LearnPageContent, type LearnSection } from '@kgc/shared';

/**
 * A page drawn read only, in Compare and History (T324 E F11): its linked
 * (Saved section) blocks filled in from the library as it is now, the way
 * Publish fills them in. Without this a linked section showed only a
 * placeholder that said where the content comes from and showed none of it.
 */
export interface ReadOnlyView {
  content: LearnPageContent;
  /** Linked sections that are not hidden. */
  linked: number;
  /** Linked sections whose saved section is no longer in the library, so they are left out. */
  missing: number;
  /** The library has not loaded yet, so linked sections still show as placeholders. */
  waiting: boolean;
}

export const VERSION_LIBRARY_NOTE = 'Saved sections show as they are in the library now.';

function linkedBlocks(content: LearnPageContent) {
  return content.sections.flatMap((s) => s.blocks.filter((b) => b.kind === 'reusable' && !b.hidden));
}

export function expandForView(
  content: LearnPageContent,
  library: ReadonlyMap<string, LearnSection> | null | undefined,
): ReadOnlyView {
  const linked = linkedBlocks(content);
  if (linked.length === 0) return { content, linked: 0, missing: 0, waiting: false };
  if (!library) return { content, linked: linked.length, missing: 0, waiting: true };
  const missing = linked.filter((b) => b.kind === 'reusable' && !library.has(b.libraryId)).length;
  // Expansion drops a hidden linked block and one whose saved section is gone,
  // as Publish does.
  return { content: expandReusableBlocks(content, library), linked: linked.length, missing, waiting: false };
}

/**
 * The small note above a read-only page, or null when there is nothing to say.
 * A version is drawn with today's library, not the one it was published with,
 * so it says so.
 */
export function readOnlyViewNote(view: ReadOnlyView, what: 'version' | 'draft'): string | null {
  if (view.missing === 0) return what === 'version' && view.linked > 0 && !view.waiting ? VERSION_LIBRARY_NOTE : null;
  const n = view.missing === 1 ? 'A saved section' : `${view.missing} saved sections`;
  const verb = view.missing === 1 ? 'was' : 'were';
  return `${n} in this ${what} ${verb} deleted from the library, so ${view.missing === 1 ? 'it is' : 'they are'} not shown here.`;
}
