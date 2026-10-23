import { Extension } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/**
 * A rich field's length limit in the editor (T343), counted the way the
 * server counts it (`richContentCharCount`: the characters of the text, not
 * line breaks or paragraph ends).
 *
 * A paste or a drop is cut to the room left, as the plain fields cut theirs:
 * the field ends up holding exactly its limit and nothing the person already
 * had is touched. Typing stops at the limit. Neither ever trims what is
 * already there: a field already over its limit (stored before this, or
 * loaded from the settings panel) keeps every word and takes deletes, undo
 * and redo as usual; it just takes no more text until it is under. During an
 * IME composition nothing is blocked, because a refused composition step
 * leaves the browser's text and the editor's apart.
 */

export const pasteLimitKey = new PluginKey('richPasteLimit');

/** Characters of text in a fragment, as the server counts them. */
export function fragmentChars(content: Fragment): number {
  let n = 0;
  content.descendants((node) => {
    if (node.isText) n += node.text?.length ?? 0;
    return true;
  });
  return n;
}

export function docChars(doc: PMNode): number {
  return fragmentChars(doc.content);
}

/**
 * `content` with at most `budget` characters of text: text past the budget is
 * cut, and everything after the cut is left out. What comes before is kept as
 * it is, marks and all.
 */
function cutFragment(content: Fragment, budget: { left: number; done: boolean }): Fragment {
  const kept: PMNode[] = [];
  content.forEach((child) => {
    if (budget.done) return;
    if (child.isText) {
      const len = child.text?.length ?? 0;
      if (len <= budget.left) {
        kept.push(child);
        budget.left -= len;
        if (budget.left === 0) budget.done = true;
      } else {
        if (budget.left > 0) kept.push(child.cut(0, budget.left));
        budget.left = 0;
        budget.done = true;
      }
      return;
    }
    if (child.isLeaf || child.content.size === 0) {
      kept.push(child);
      return;
    }
    kept.push(child.copy(cutFragment(child.content, budget)));
  });
  return Fragment.fromArray(kept);
}

/** `slice` cut to `room` characters of text; the slice itself when it fits. */
export function cutSlice(slice: Slice, room: number): Slice {
  if (room <= 0) return Slice.empty;
  if (fragmentChars(slice.content) <= room) return slice;
  const content = cutFragment(slice.content, { left: room, done: false });
  // The cut can end the slice higher up than it did (three paragraphs cut
  // inside the first), so it may not stay open as deep as before.
  const open = Slice.maxOpen(content);
  return new Slice(content, Math.min(slice.openStart, open.openStart), Math.min(slice.openEnd, open.openEnd));
}

/**
 * How many characters a paste may add: the limit, less what the field holds,
 * plus what the paste replaces (the selection) and, for a drag within the
 * field, what is moved away.
 */
export function pasteRoom(state: EditorState, max: number, view?: EditorView): number {
  const dragging = view?.dragging;
  // A drag within the field: the selection is what is dragged, and a copy (Alt) removes nothing.
  if (dragging) return max - docChars(state.doc) + (dragging.move ? fragmentChars(dragging.slice.content) : 0);
  return max - docChars(state.doc) + fragmentChars(state.selection.content().content);
}

/** True when `tr` is one the limit must never refuse: undo and redo, a load from outside, a composition. */
function exempt(tr: Transaction, view: EditorView | null): boolean {
  return (
    tr.getMeta('history$') !== undefined ||
    tr.getMeta('preventUpdate') === true ||
    tr.getMeta('composition') !== undefined ||
    tr.getMeta('uiEvent') === 'paste' ||
    tr.getMeta('uiEvent') === 'drop' ||
    view?.composing === true
  );
}

export const PasteLimit = Extension.create<{ max: () => number | undefined }>({
  name: 'richPasteLimit',

  addOptions() {
    return { max: () => undefined };
  },

  addProseMirrorPlugins() {
    const max = this.options.max;
    let view: EditorView | null = null;
    return [
      new Plugin({
        key: pasteLimitKey,
        view: (v) => {
          view = v;
          return {
            destroy: () => {
              view = null;
            },
          };
        },
        props: {
          transformPasted: (slice, v) => {
            const limit = max();
            if (limit === undefined) return slice;
            return cutSlice(slice, pasteRoom(v.state, limit, v));
          },
        },
        // Typing past the limit: the step is refused, unless it is one that
        // must always go through. Anything that does not add text goes through.
        filterTransaction: (tr, state) => {
          const limit = max();
          if (limit === undefined || !tr.docChanged || exempt(tr, view)) return true;
          const after = docChars(tr.doc);
          if (after <= limit) return true;
          return after <= docChars(state.doc);
        },
      }),
    ];
  },
});
