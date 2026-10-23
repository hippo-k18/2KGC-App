import { Extension, Mark, mergeAttributes, type AnyExtension, type Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Blockquote from '@tiptap/extension-blockquote';
import { ListItem } from '@tiptap/extension-list';
import { TableCell, TableHeader, TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { ColorValue, TextSize } from '@kgc/shared';
import { isColorValue } from '../../lib/rich-editor/convert';
import { colorHex } from '../../lib/rich-editor/tools';
import { cleanPastedHtml } from '../../lib/rich-editor/paste';

/**
 * The editor's schema: exactly the nodes and marks of the RichDoc contract
 * (`learn-page.ts`), under the names `lib/rich-editor/convert.ts` maps.
 * Anything a paste brings that is not here is dropped by ProseMirror.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: ColorValue) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
    highlight: {
      setHighlight: (color: ColorValue) => ReturnType;
      unsetHighlight: () => ReturnType;
    };
    fontSize: {
      setFontSize: (size: TextSize) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

const SIZES: TextSize[] = ['small', 'normal', 'large', 'x-large'];

/**
 * A mark with one value attribute, stored in `data-rt-*` so a copy inside the
 * editor keeps it and a paste from elsewhere (which never has the attribute)
 * does not bring its own colours in.
 */
function valueMark<V extends string>(name: string, attr: string, tag: string, valid: (v: unknown) => v is V, style: (v: V) => string) {
  return Mark.create({
    name,
    excludes: name,
    addAttributes() {
      return {
        [attr]: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute(`data-rt-${name}`),
          renderHTML: (a: Record<string, unknown>) => {
            const v = a[attr];
            return valid(v) ? { [`data-rt-${name}`]: v, style: style(v) } : {};
          },
        },
      };
    },
    parseHTML() {
      return [{ tag: `${tag}[data-rt-${name}]`, getAttrs: (el) => (valid((el as HTMLElement).getAttribute(`data-rt-${name}`)) ? null : false) }];
    },
    renderHTML({ HTMLAttributes }) {
      return [tag, mergeAttributes(HTMLAttributes), 0];
    },
  });
}

const isSize = (v: unknown): v is TextSize => SIZES.includes(v as TextSize);

export const TextColor = valueMark('textColor', 'color', 'span', isColorValue, (c) => `color: ${colorHex(c)}`).extend({
  addCommands() {
    return {
      setTextColor: (color: ColorValue) => ({ commands }) => commands.setMark(this.name, { color }),
      unsetTextColor: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});

export const Highlight = valueMark('highlight', 'color', 'mark', isColorValue, (c) => `background-color: ${colorHex(c)}; color: inherit`).extend({
  addCommands() {
    return {
      setHighlight: (color: ColorValue) => ({ commands }) => commands.setMark(this.name, { color }),
      unsetHighlight: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});

export const FontSize = valueMark('fontSize', 'size', 'span', isSize, (s) => `font-size: var(--rt-size-${s})`).extend({
  addCommands() {
    return {
      setFontSize: (size: TextSize) => ({ commands }) =>
        size === 'normal' ? commands.unsetMark(this.name) : commands.setMark(this.name, { size }),
      unsetFontSize: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});

/* ── Find and replace highlighting ─────────────────────────────────────── */

export const findKey = new PluginKey<DecorationSet>('richFind');

export interface FindMeta {
  ranges: { from: number; to: number }[];
  current: number;
}

const FindHighlight = Extension.create({
  name: 'richFind',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: findKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(findKey) as FindMeta | undefined;
            if (meta) {
              return DecorationSet.create(
                tr.doc,
                meta.ranges.map((r, i) => Decoration.inline(r.from, r.to, { class: i === meta.current ? 'rt-find-hit rt-find-current' : 'rt-find-hit' })),
              );
            }
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state) => findKey.getState(state),
        },
      }),
    ];
  },
});

/* ── Keys ──────────────────────────────────────────────────────────────── */

/** Keys a host may take over, for a field that is one item of a list on the page (T329). */
export type HostKey = 'Enter' | 'Backspace' | 'Tab' | 'ShiftTab' | 'ArrowUp' | 'ArrowDown';

export interface CaretInfo {
  /** The field holds no text at all. */
  empty: boolean;
  /** The caret, with nothing selected, is before the first character. */
  atStart: boolean;
  atEnd: boolean;
}

export interface RichKeyHandlers {
  singleLine: boolean;
  /** True when the host handled the key, and the editor should not. */
  onHostKey?: (key: HostKey, at: CaretInfo) => boolean;
  onExit: () => boolean;
  onLink: () => void;
  onFind: () => void;
  onHelp: () => void;
  onFocusMode: () => void;
}

/** Removes every mark and turns the selected blocks back into plain paragraphs. */
export function clearFormatting(editor: Editor) {
  return editor.chain().focus().unsetAllMarks().clearNodes().unsetTextAlign().run();
}

const RichKeys = Extension.create<{ handlers: () => RichKeyHandlers }>({
  name: 'richKeys',
  // Ahead of the list and table keymaps, so a host's Tab and Enter come first.
  priority: 1000,
  addOptions() {
    return {
      handlers: () => ({ singleLine: false, onExit: () => false, onLink: () => {}, onFind: () => {}, onHelp: () => {}, onFocusMode: () => {} }),
    };
  },
  addKeyboardShortcuts() {
    const h = () => this.options.handlers();
    const host = (key: HostKey) => {
      const fn = h().onHostKey;
      if (!fn) return false;
      const { state } = this.editor;
      const { selection, doc } = state;
      const empty = doc.textContent.length === 0 && !doc.firstChild?.childCount;
      const atStart = selection.empty && selection.from <= 1 + (doc.firstChild?.isTextblock ? 0 : 1);
      const atEnd = selection.empty && selection.to >= doc.content.size - 1;
      return fn(key, { empty, atStart, atEnd });
    };
    return {
      Tab: () => host('Tab'),
      'Shift-Tab': () => host('ShiftTab'),
      Backspace: () => host('Backspace'),
      ArrowUp: () => host('ArrowUp'),
      ArrowDown: () => host('ArrowDown'),
      // In a table, the first Cmd+A selects the cell's words, as a spreadsheet
      // does; the next selects everything. Typing over a whole-document
      // selection would replace the table with one line (T329).
      'Mod-a': () => {
        const { selection, doc } = this.editor.state;
        const $from = selection.$from;
        for (let d = $from.depth; d > 0; d--) {
          const name = $from.node(d).type.name;
          if (name !== 'tableCell' && name !== 'tableHeader') continue;
          const from = $from.start(d);
          const to = $from.end(d);
          const whole = selection.from <= from + 1 && selection.to >= to - 1;
          if (whole || doc.textBetween(from, to).length === 0) return false;
          return this.editor.commands.setTextSelection({ from: from + 1, to: to - 1 });
        }
        return false;
      },
      'Mod-k': () => (h().onLink(), true),
      'Mod-f': () => (h().onFind(), true),
      'Mod-/': () => (h().onHelp(), true),
      'Mod-Shift-f': () => (h().onFocusMode(), true),
      'Mod-\\': () => clearFormatting(this.editor),
      Escape: () => h().onExit(),
      Enter: () => host('Enter') || (h().singleLine ? this.editor.commands.setHardBreak() : false),
    };
  },
});

export interface ExtensionOptions {
  placeholder?: string;
  handlers: () => RichKeyHandlers;
}

export function richExtensions({ placeholder, handlers }: ExtensionOptions): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      blockquote: false,
      listItem: false,
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: ['mailto', 'tel'],
        HTMLAttributes: { rel: null, target: null, class: null },
      },
    }),
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
    Subscript,
    Superscript,
    // Containers hold only what the contract lets them hold (`rich-doc-core.ts`
    // in @kgc/shared). TipTap's defaults are `block+`, so a table could be put
    // in a quote or a list item, and the server then refused the whole save.
    // With these, ProseMirror places a table after the quote instead.
    Blockquote.extend({ content: '(paragraph | heading | bulletList | orderedList | codeBlock | horizontalRule)+' }),
    ListItem.extend({ content: 'paragraph (paragraph | heading | bulletList | orderedList | blockquote | codeBlock)*' }),
    TableKit.configure({ table: { resizable: false }, tableCell: false, tableHeader: false }),
    TableCell.extend({ content: '(paragraph | heading | bulletList | orderedList | blockquote | codeBlock)+' }),
    TableHeader.extend({ content: '(paragraph | heading | bulletList | orderedList | blockquote | codeBlock)+' }),
    TextColor,
    Highlight,
    FontSize,
    FindHighlight,
    Placeholder.configure({ placeholder: placeholder ?? '' }),
    RichKeys.configure({ handlers }),
  ];
}

/** ProseMirror's paste hook: structure in, styles out (`lib/rich-editor/paste.ts`). */
export const transformPastedHTML = (html: string) => cleanPastedHtml(html);
