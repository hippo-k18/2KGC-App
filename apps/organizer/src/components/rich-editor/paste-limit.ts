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
 *
 * The field says so as a plain field does (T348): over its limit it carries
 * `data-limit-over` and the count in `data-limit-note`, and a cut paste or a
 * stopped key leaves a short note there for a few seconds (`inline.css`).
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
  const replaced = dragging ? (dragging.move ? fragmentChars(dragging.slice.content) : 0) : fragmentChars(state.selection.content().content);
  // A field already over its limit may still take as much as it loses: the
  // result is no longer than before, so a short paste over a selection goes
  // in instead of only deleting the selection (T348, gate D-S1).
  return Math.max(max - docChars(state.doc) + replaced, replaced);
}

/** The field's note while it is over its limit, the same words a plain field uses (T348). */
export function overLimitNote(chars: number, max: number): string {
  return `${chars} characters; the limit is ${max}. Shorten it to publish.`;
}

export const stoppedNote = (max: number) => `The limit is ${max} characters.`;
export const pasteCutNote = (max: number) => `Pasted text was cut to fit the limit of ${max} characters.`;

/** How long a note about a stopped key or a cut paste stays (T348). */
export const NOTE_MS = 4000;

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A short note on the field (T348): a paste that was cut, or a key that
    // added nothing, says why. It is plugin state, drawn by `attributes`, and
    // set after the current event so it never lands inside a paste.
    const flash = (note: string) => {
      setTimeout(() => {
        const v = view;
        if (!v) return;
        v.dispatch(v.state.tr.setMeta(pasteLimitKey, note).setMeta('addToHistory', false));
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (view && pasteLimitKey.getState(view.state) === note) view.dispatch(view.state.tr.setMeta(pasteLimitKey, null).setMeta('addToHistory', false));
        }, NOTE_MS);
      }, 0);
    };
    return [
      new Plugin<string | null>({
        key: pasteLimitKey,
        state: {
          init: () => null,
          apply: (tr, prev) => {
            const meta = tr.getMeta(pasteLimitKey) as string | null | undefined;
            return meta === undefined ? prev : meta;
          },
        },
        view: (v) => {
          view = v;
          return {
            destroy: () => {
              view = null;
              clearTimeout(timer);
            },
          };
        },
        props: {
          // Over the limit: the count and a red underline, as a plain field has (T348).
          attributes: (state): Record<string, string> => {
            const limit = max();
            if (limit === undefined) return {};
            const chars = docChars(state.doc);
            if (chars > limit) return { 'data-limit-note': overLimitNote(chars, limit), 'data-limit-over': '' };
            const note = pasteLimitKey.getState(state) as string | null;
            return note ? { 'data-limit-note': note } : {};
          },
          transformPasted: (slice, v) => {
            const limit = max();
            if (limit === undefined) return slice;
            const room = pasteRoom(v.state, limit, v);
            if (fragmentChars(slice.content) > room) flash(room > 0 ? pasteCutNote(limit) : stoppedNote(limit));
            return cutSlice(slice, room);
          },
          // Several characters in one go (dictation, a long autocorrect): what
          // fits is kept, as a box with a maxlength does (T348).
          handleTextInput: (v, from, to, text) => {
            const limit = max();
            if (limit === undefined || v.composing) return false;
            const replaced = v.state.doc.textBetween(from, to).length;
            const room = Math.max(limit - docChars(v.state.doc) + replaced, replaced);
            if (text.length <= room) return false;
            if (room <= 0) return false; // refused by filterTransaction below, which says so
            v.dispatch(v.state.tr.insertText(text.slice(0, room), from, to));
            flash(stoppedNote(limit));
            return true;
          },
        },
        // Typing past the limit: the step is refused, unless it is one that
        // must always go through. Anything that does not add text goes through.
        filterTransaction: (tr, state) => {
          const limit = max();
          if (limit === undefined || !tr.docChanged || exempt(tr, view)) return true;
          const after = docChars(tr.doc);
          if (after <= limit || after <= docChars(state.doc)) return true;
          flash(stoppedNote(limit));
          return false;
        },
      }),
    ];
  },
});
