'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor, useEditorState, type JSONContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/core';
import type { RichContent, RichDoc } from '@kgc/shared';
import {
  collapseToSingleParagraph,
  countWords,
  richToTiptap,
  tiptapToRich,
  toRichDoc,
  type TTNode,
} from '../../lib/rich-editor/convert';
import { keysFor } from './controls';
import { FindBar, LinkDialog, ShortcutsDialog, type RichAnchor } from './dialogs';
import { richExtensions, transformPastedHTML, type CaretInfo, type HostKey, type RichKeyHandlers } from './extensions';
import { Icon } from './icons';
import { PasteLimit } from './paste-limit';
import { Toolbar } from './toolbar';
import './rich-editor.css';

/**
 * The Learn page's text editor (T317): a word processor whose every format
 * maps onto the RichDoc contract in `learn-page.ts`, and nothing else.
 *
 * `inline` sits inside the page preview with a floating toolbar over the
 * text; `full` has a fixed toolbar and opens into a full-window Focus mode.
 * Both store the same RichDoc; a v1 Markdown string is converted on load.
 */

export interface RichEditorProps {
  /** A v1 Markdown string or a RichDoc. */
  value: RichContent;
  /** Every edit, as a RichDoc. */
  onChange: (doc: RichDoc) => void;
  variant: 'inline' | 'full';
  /** Section and block anchors offered by the link dialog. */
  anchors?: RichAnchor[];
  placeholder?: string;
  /** Shows a count against this limit; does not stop typing. */
  maxWords?: number;
  /** Accessible name of the text box. */
  ariaLabel?: string;
  /** One paragraph only (a heading): Enter makes a line break and block tools are hidden. */
  singleLine?: boolean;
  /** Escape with nothing else open. */
  onExit?: () => void;
  autoFocus?: boolean;
  className?: string;
  /**
   * A field that is one item of a list on the page: Enter, Backspace, Tab and
   * the up and down arrows go to the host first, which returns true when it
   * handled the key (T329).
   */
  onHostKey?: (key: HostKey, at: CaretInfo) => boolean;
  /** The TipTap editor once it exists (and null when it goes), for a host that adds rows to a table. */
  onEditor?: (editor: Editor | null) => void;
  /**
   * Where the inline variant's floating toolbar is mounted: outside any zoomed
   * or clipped container, inside the same stacking layer as the host's
   * dialogs (so they cover it). Defaults to the page body.
   */
  floatingRoot?: () => HTMLElement;
  /** The document is one table and nothing else, as a Table block stores it (T332). Read once, when the editor is made. */
  tableOnly?: boolean;
  /** The field's limit in characters: a paste is cut to fit and typing stops there; text already over is kept (T343). */
  maxLength?: number;
}

/** The height of a host's fixed bars at the top of the window, which the floating toolbar keeps clear of. */
const BARS_HEIGHT = 120;

/** The editor that owns a ProseMirror element, so a click on the page can put the caret where it landed. */
const editorsByDom = new WeakMap<Element, Editor>();

export function editorForElement(el: Element | null): Editor | undefined {
  const pm = el?.closest('.ProseMirror');
  return pm ? editorsByDom.get(pm) : undefined;
}

function docOf(value: RichContent, single: boolean): RichDoc {
  const d = toRichDoc(value);
  return single ? collapseToSingleParagraph(d) : d;
}

/** The text a count is taken from: blocks and line breaks become newlines. */
function textOf(editor: Editor) {
  const { doc } = editor.state;
  return doc.textBetween(0, doc.content.size, '\n', '\n');
}

/** Keeps the editor's caret on a press that lands on a bar's background, not on one of its controls. */
function keepCaretOnBackground(e: MouseEvent<HTMLDivElement>) {
  if (!(e.target as HTMLElement).closest('input, select, textarea, [contenteditable="true"]')) e.preventDefault();
}

export function RichEditor(props: RichEditorProps) {
  const { value, variant, anchors = [], placeholder, maxWords, singleLine = false } = props;
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  const [linkOpen, setLinkOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [notice, setNotice] = useState('');
  const ui = useRef({ focusMode, dialog: false });
  useEffect(() => {
    ui.current = { focusMode, dialog: linkOpen || helpOpen };
  }, [focusMode, linkOpen, helpOpen]);

  const lastEmitted = useRef(JSON.stringify(docOf(value, singleLine)));

  const handlers = useRef<() => RichKeyHandlers>(() => ({
    singleLine: !!latest.current.singleLine,
    onHostKey: (key, at) => latest.current.onHostKey?.(key, at) ?? false,
    onExit: () => {
      if (ui.current.dialog) return false;
      if (ui.current.focusMode) {
        setFocusMode(false);
        return true;
      }
      if (latest.current.onExit) {
        latest.current.onExit();
        return true;
      }
      return false;
    },
    onLink: () => setLinkOpen(true),
    onFind: () => setFindOpen(true),
    onHelp: () => setHelpOpen(true),
    onFocusMode: () => setFocusMode((v) => !v),
  }));

  const emit = (e: Editor) => {
    let doc = tiptapToRich(e.getJSON() as TTNode);
    if (latest.current.singleLine) doc = collapseToSingleParagraph(doc);
    const s = JSON.stringify(doc);
    if (s === lastEmitted.current) return;
    lastEmitted.current = s;
    latest.current.onChange(doc);
  };

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [
      ...richExtensions({ placeholder, handlers: () => handlers.current(), tableOnly: props.tableOnly }),
      PasteLimit.configure({ max: () => latest.current.maxLength }),
    ],
    content: richToTiptap(docOf(value, singleLine)) as JSONContent,
    editorProps: {
      attributes: {
        class: 'rt-content',
        role: 'textbox',
        'aria-multiline': singleLine ? 'false' : 'true',
        'aria-label': props.ariaLabel ?? placeholder ?? 'Text',
        spellcheck: 'true',
      },
      transformPastedHTML,
    },
    onUpdate: ({ editor: e }) => emit(e),
  });

  // A new value from outside (the page's undo, the settings panel): load it
  // unless it is what the editor already holds, which would move the caret.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const incoming = docOf(value, singleLine);
    const s = JSON.stringify(incoming);
    if (s === lastEmitted.current) return;
    lastEmitted.current = s;
    editor.commands.setContent(richToTiptap(incoming) as JSONContent, { emitUpdate: false });
  }, [editor, value, singleLine]);

  useEffect(() => {
    if (editor && latest.current.autoFocus) editor.commands.focus('end');
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    editorsByDom.set(dom, editor);
    latest.current.onEditor?.(editor);
    return () => {
      editorsByDom.delete(dom);
      latest.current.onEditor?.(null);
    };
  }, [editor]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!focusMode) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    editor?.commands.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, [focusMode, editor]);

  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  useEffect(() => {
    if (!editor) return;
    const measure = () => {
      const t = textOf(editor);
      const next = { words: countWords(t), chars: t.replace(/\n/g, '').length };
      setCounts((c) => (c.words === next.words && c.chars === next.chars ? c : next));
    };
    measure();
    editor.on('update', measure);
    return () => {
      editor.off('update', measure);
    };
  }, [editor]);

  const pastePlain = async () => {
    if (!editor) return;
    try {
      const text = await navigator.clipboard.readText();
      editor.commands.focus();
      editor.view.pasteText(text);
    } catch {
      setNotice(`The browser did not allow reading the clipboard. Press ${keysFor('Cmd+Shift+V')} in the text instead.`);
    }
  };

  const full = variant === 'full' || focusMode;
  const toolbarProps = editor && {
    editor,
    singleLine,
    focusMode,
    findOpen,
    onLink: () => setLinkOpen(true),
    onFind: () => setFindOpen((v) => !v),
    onHelp: () => setHelpOpen(true),
    onFocusMode: () => setFocusMode((v) => !v),
    onPastePlain: pastePlain,
  };
  const over = maxWords !== undefined && counts.words > maxWords;

  const shell = (
    <div
      className={`rt rt-${full ? 'full' : 'inline'}${focusMode ? ' rt-focus' : ''}${props.className ? ` ${props.className}` : ''}`}
      // Keys typed here belong to the text, not to the page editor around it.
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {focusMode && (
        <div className="rt-focus-bar">
          <span className="rt-focus-title">{props.ariaLabel ?? 'Focus mode'}</span>
          <button type="button" className="rt-primary" onClick={() => setFocusMode(false)}>
            Done
          </button>
        </div>
      )}
      <div className="rt-frame">
        {full && toolbarProps && <Toolbar {...toolbarProps} />}
        {findOpen && editor && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
        {variant === 'inline' && !focusMode && toolbarProps && (
          <BubbleMenu
            editor={editor}
            pluginKey="rtInline"
            // Outside any zoomed or clipped container (the Learn preview is
            // zoomed to fit), so it keeps its real size; `rt` carries the
            // toolbar's colours and type there.
            appendTo={() => latest.current.floatingRoot?.() ?? document.body}
            className="rt rt-bubble rt-bubble-floating"
            updateDelay={0}
            // In a table it sits over the whole table, not over the cell with the
            // caret, which it hid along with the cells beside it (T332).
            getReferencedVirtualElement={() => tableAround(editor)}
            // Not over the editor's own bars at the top of the window (T332): near
            // the top it goes under the words instead.
            options={{ placement: 'top-start', offset: 8, flip: { padding: { top: BARS_HEIGHT, bottom: 8, left: 8, right: 8 } }, shift: { padding: 8 } }}
            // Over selected words, as in a document editor; also in a table or
            // on a link, where the tools are the way to change them (T329).
            shouldShow={({ editor: e, view, state, element }) =>
              view.editable &&
              (element.contains(document.activeElement) ||
                (view.hasFocus() && (!state.selection.empty || e.isActive('table') || e.isActive('link'))))
            }
          >
            {/* A press on the bubble's own background keeps the caret where it
                was: it took the focus from a table cell, and the next keys went
                nowhere (T343). Its boxes and menus still take the focus. */}
            <div className="rt-bubble-body" onMouseDown={keepCaretOnBackground}>
              <LinkInfo editor={editor} onEdit={() => setLinkOpen(true)} />
              <Toolbar {...toolbarProps} compact />
            </div>
          </BubbleMenu>
        )}
        {full && editor && (
          <BubbleMenu
            editor={editor}
            pluginKey="rtLink"
            className="rt-bubble rt-link-bubble"
            options={{ placement: 'bottom-start', offset: 6, flip: true, shift: { padding: 8 } }}
            shouldShow={({ editor: e, state, view }) => view.hasFocus() && state.selection.empty && e.isActive('link')}
          >
            <LinkInfo editor={editor} onEdit={() => setLinkOpen(true)} />
          </BubbleMenu>
        )}
        <div className="rt-scroll">
          <EditorContent editor={editor} className="rt-body" />
        </div>
        {(full || maxWords !== undefined) && (
          <div className="rt-foot" aria-live="polite">
            <span className={over ? 'rt-over' : undefined}>
              {maxWords !== undefined ? `${counts.words} of ${maxWords} words` : `${counts.words} ${counts.words === 1 ? 'word' : 'words'}`}
              {over && `, ${counts.words - maxWords} over`}
            </span>
            {full && <span>{counts.chars} characters</span>}
            {full && (
              <button type="button" className="rt-text-btn" onClick={() => setHelpOpen(true)}>
                Shortcuts {keysFor('Cmd+/')}
              </button>
            )}
          </div>
        )}
        {notice && (
          <p className="rt-notice" role="status">
            {notice}
          </p>
        )}
      </div>
      {linkOpen && editor && <LinkDialog editor={editor} anchors={anchors} onClose={() => setLinkOpen(false)} />}
      {helpOpen && (
        <ShortcutsDialog
          onClose={() => {
            setHelpOpen(false);
            editor?.commands.focus();
          }}
        />
      )}
    </div>
  );

  if (focusMode && typeof document !== 'undefined') return createPortal(shell, document.body);
  return shell;
}

/** The table the caret is in, as the box the floating toolbar is placed against; null outside a table. */
function tableAround(editor: Editor) {
  if (editor.isDestroyed || !editor.isActive('table')) return null;
  const { node } = editor.view.domAtPos(editor.state.selection.from);
  const table = (node instanceof Element ? node : node.parentElement)?.closest('table');
  if (!table) return null;
  return { getBoundingClientRect: () => table.getBoundingClientRect(), getClientRects: () => [table.getBoundingClientRect()] };
}

/** The address under the caret, with Edit and Remove. */
function LinkInfo({ editor, onEdit }: { editor: Editor; onEdit: () => void }) {
  const link = useEditorState({
    editor,
    selector: ({ editor: e }) => (e.isActive('link') ? ((e.getAttributes('link').href as string | undefined) ?? '') : null),
  });
  if (link === null) return null;
  const insecure = /^http:/i.test(link);
  const shown = link.replace(/^mailto:/i, '').replace(/^tel:/i, '');
  return (
    <div className="rt-linkinfo" role="group" aria-label="Link">
      {link.startsWith('#') ? (
        <span className="rt-linkinfo-href">Section: {link.slice(1)}</span>
      ) : (
        <a className="rt-linkinfo-href" href={link} target="_blank" rel="noreferrer noopener" data-tip="Open in a new tab">
          {shown.length > 42 ? `${shown.slice(0, 42)}…` : shown}
          <Icon name="external" size={12} />
        </a>
      )}
      {insecure && <span className="rt-linkinfo-warn">Not secure</span>}
      <button type="button" className="rt-text-btn" onMouseDown={(e) => e.preventDefault()} onClick={onEdit}>
        Edit
      </button>
      <button
        type="button"
        className="rt-text-btn rt-danger"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
      >
        Remove
      </button>
    </div>
  );
}
