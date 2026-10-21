'use client';

import { EditorContent, Extension, useEditor, useEditorState, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isSafeHref } from '@kgc/shared';
import { docToMarkdown, markdownToDoc, type InlineDoc, type InlineNode } from '@/lib/learn-editor-core';

/**
 * In-place editing for a heading or text block of the Learn page preview.
 *
 * The schema is the contract's Markdown subset and nothing more: paragraphs,
 * line breaks, bold, italic and links. Whatever is pasted is cut down to that
 * by ProseMirror, so the stored text can always be read back by
 * `rich-text-core`. A heading has no paragraphs: Enter inserts a line break,
 * and a pasted second paragraph is folded into the first on save.
 */

type Level = 1 | 2 | 3;

export interface RichInlineEditorProps {
  text: string;
  /** A heading: one paragraph, line breaks only. */
  single: boolean;
  ariaLabel: string;
  onChange: (markdown: string) => void;
  /** Escape. */
  onExit: () => void;
  /** Whether to put the caret in the editor once it exists (false when selected from the outline). */
  shouldFocus: () => boolean;
  level?: Level;
  onLevel?: (level: Level) => void;
  /** Shown for the moment before the editor exists, so the block does not blink empty. */
  fallback?: ReactNode;
}

function serialize(editor: Editor, single: boolean): string {
  const doc = editor.getJSON() as unknown as InlineDoc;
  if (!single || doc.content.length <= 1) return docToMarkdown(doc);
  const merged: InlineNode[] = [];
  doc.content.forEach((p, i) => {
    if (i > 0) merged.push({ type: 'hardBreak' });
    merged.push(...(p.content ?? []));
  });
  return docToMarkdown({ type: 'doc', content: [{ type: 'paragraph', content: merged }] });
}

const PreviewKeys = Extension.create<{ single: boolean; onExit: () => void }>({
  name: 'learnPreviewKeys',
  addOptions() {
    return { single: false, onExit: () => {} };
  },
  addKeyboardShortcuts() {
    return {
      Escape: () => {
        this.options.onExit();
        return true;
      },
      Enter: () => (this.options.single ? this.editor.commands.setHardBreak() : false),
    };
  },
});

/** A typed address to a link target, or null when it is not one the page may carry. */
function normalizeHref(value: string): string | null {
  const t = value.trim();
  if (!t) return null;
  let target = t;
  if (!/^(https?:|mailto:|tel:)/i.test(t)) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) target = `mailto:${t}`;
    else if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(t)) target = `https://${t}`;
    else return null;
  }
  // Markdown stores the target as `(href)`, which a space or a `)` would end early.
  target = target.replace(/\s/g, '%20').replace(/\)/g, '%29');
  return /^(https?:|mailto:|tel:)/i.test(target) && isSafeHref(target) ? target : null;
}

export function RichInlineEditor(props: RichInlineEditorProps) {
  const { text, single, ariaLabel } = props;
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        strike: false,
        underline: false,
        horizontalRule: false,
        dropcursor: false,
        gapcursor: false,
        trailingNode: false,
        link: {
          openOnClick: false,
          autolink: false,
          linkOnPaste: false,
          protocols: ['mailto', 'tel'],
          HTMLAttributes: { rel: null, target: null },
        },
      }),
      PreviewKeys.configure({ single, onExit: () => latest.current.onExit() }),
    ],
    content: markdownToDoc(text) as unknown as JSONContent,
    editorProps: {
      attributes: {
        class: 'lp-pm',
        role: 'textbox',
        'aria-multiline': single ? 'false' : 'true',
        'aria-label': ariaLabel,
      },
    },
    onUpdate: ({ editor: e }) => latest.current.onChange(serialize(e, single)),
  });

  // Undo, redo or a settings-panel edit changed the text: load it, unless it is
  // what the editor already holds (which would move the caret for nothing).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (serialize(editor, single) !== text) {
      editor.commands.setContent(markdownToDoc(text) as unknown as JSONContent, { emitUpdate: false });
    }
  }, [editor, text, single]);

  useEffect(() => {
    if (editor && latest.current.shouldFocus()) editor.commands.focus('end');
  }, [editor]);

  return (
    <>
      {editor && <Toolbar editor={editor} single={single} level={props.level} onLevel={props.onLevel} />}
      {editor ? <EditorContent editor={editor} /> : props.fallback}
    </>
  );
}

function Toolbar({
  editor,
  single,
  level,
  onLevel,
}: {
  editor: Editor;
  single: boolean;
  level?: Level;
  onLevel?: (level: Level) => void;
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      link: e.isActive('link'),
      linkHref: (e.getAttributes('link').href as string | undefined) ?? '',
    }),
  });
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const c = () => editor.chain().focus();

  const openLink = () => {
    setHref(s.linkHref);
    setError('');
    setLinking((v) => !v);
    setTimeout(() => input.current?.focus(), 0);
  };

  const applyLink = () => {
    if (!href.trim()) {
      c().extendMarkRange('link').unsetLink().run();
      setLinking(false);
      return;
    }
    const target = normalizeHref(href);
    if (!target) {
      setError('Use a web address, an email address or a tel: number.');
      return;
    }
    c().extendMarkRange('link').setLink({ href: target }).run();
    setLinking(false);
  };

  const btn = (label: string, shortcut: string, pressed: boolean, onClick: () => void, content: ReactNode) => (
    <button
      type="button"
      className="lp-tb-btn"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={pressed}
      // Keeps the selection in the text while the button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {content}
    </button>
  );

  return (
    <div
      className="lp-toolbar"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="lp-toolbar-row" role="toolbar" aria-label="Text formatting">
        {single && onLevel && (
          <select
            className="lp-tb-select"
            aria-label="Heading level"
            value={level ?? 2}
            onChange={(e) => onLevel(Number(e.target.value) as Level)}
          >
            <option value={1}>H1</option>
            <option value={2}>H2</option>
            <option value={3}>H3</option>
          </select>
        )}
        {btn('Bold', 'Cmd+B', s.bold, () => c().toggleBold().run(), <strong>B</strong>)}
        {btn('Italic', 'Cmd+I', s.italic, () => c().toggleItalic().run(), <em className="lp-tb-italic">I</em>)}
        {btn(
          'Link',
          '',
          s.link || linking,
          openLink,
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
          </svg>,
        )}
        {btn(
          'Line break',
          'Shift+Enter',
          false,
          () => c().setHardBreak().run(),
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 5v7a3 3 0 0 1-3 3H6M10 11l-4 4 4 4" />
          </svg>,
        )}
      </div>
      {linking && (
        <div className="lp-link-pop">
          <input
            ref={input}
            className="lp-link-input"
            value={href}
            onChange={(e) => {
              setHref(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setLinking(false);
                editor.commands.focus();
              }
            }}
            placeholder="Web or email address"
            aria-label="Link address"
            aria-invalid={error ? true : undefined}
          />
          <button type="button" className="lp-link-apply" onClick={applyLink}>
            Apply
          </button>
          {s.link && (
            <button
              type="button"
              className="lp-link-remove"
              onClick={() => {
                c().extendMarkRange('link').unsetLink().run();
                setLinking(false);
              }}
            >
              Remove
            </button>
          )}
          {error && (
            <p className="lp-link-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
