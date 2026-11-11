'use client';

import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useRef, useState, type ReactNode } from 'react';
import type { CallTextDoc } from '@kgc/shared';

/**
 * The call's text, with formatting (T277).
 *
 * TipTap, configured like the blog editor on the website but with a shorter
 * list: two heading levels, bold, italic, links, bulleted and numbered lists,
 * and quotes. The editor's schema is the paste filter. Pasting from Google Docs
 * or Word keeps what the schema knows and drops the rest (fonts, colours,
 * sizes, underline, images), because ProseMirror only builds nodes it has a
 * rule for. `call-text-core.ts` checks the result again on the server.
 *
 * ── Untouched text is not sent ──────────────────────────────────────────────
 *
 * The hidden `instructionsDoc` input exists only after the first edit. Saving
 * the form for a date or a checkbox therefore leaves the stored text exactly as
 * it was, which matters on Min's call: its text is plain and hers, and it should
 * only become a formatted document when somebody formats it.
 */

/** Word marks list paragraphs with `mso-list` rather than `<li>`. */
function wordListsToHtmlLists(doc: Document) {
  const paragraphs = Array.from(doc.querySelectorAll('p')).filter((p) =>
    /mso-list:\s*l\d/i.test(p.getAttribute('style') ?? ''),
  );
  let list: HTMLElement | null = null;
  let previous: Element | null = null;
  for (const p of paragraphs) {
    const marker = p.querySelector('[style*="mso-list:Ignore"], [style*="mso-list: Ignore"]');
    const ordered = /^\s*(\d+|[a-z]|[ivx]+)[.)]/i.test(marker?.textContent ?? '');
    marker?.remove();
    if (!list || previous !== p.previousElementSibling || (list.tagName === 'OL') !== ordered) {
      list = doc.createElement(ordered ? 'ol' : 'ul');
      p.before(list);
    }
    const li = doc.createElement('li');
    li.innerHTML = p.innerHTML;
    list.append(li);
    p.remove();
    // The next list paragraph follows the list, now that this one is inside it.
    previous = list;
  }
}

/**
 * Pasted HTML, before ProseMirror reads it: h1 becomes a heading (the page's
 * h1 is the call title), h4 to h6 the smaller heading, and Word's lists real
 * lists. Everything else is left to the schema.
 */
function cleanPastedHtml(html: string): string {
  const out = html.replace(/<(\/?)h1\b/gi, '<$1h2').replace(/<(\/?)h[4-6]\b/gi, '<$1h3');
  if (!/mso-list/i.test(out) || typeof DOMParser === 'undefined') return out;
  const doc = new DOMParser().parseFromString(out, 'text/html');
  wordListsToHtmlLists(doc);
  return doc.body.innerHTML;
}

export function InstructionsEditor({
  initial,
  label = 'Instructions',
  hint,
}: {
  initial: CallTextDoc;
  label?: string;
  hint?: ReactNode;
}) {
  const [json, setJson] = useState<string | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          protocols: ['mailto', 'tel'],
          HTMLAttributes: { rel: null, target: null },
        },
      }),
    ],
    content: initial,
    editorProps: {
      attributes: {
        class: 'call-text-editor-body',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
      },
      transformPastedHTML: cleanPastedHtml,
    },
    // Through JSON on purpose, as the blog editor does: ProseMirror builds attrs
    // with a null prototype, and a plain copy is what survives the form post.
    onUpdate: ({ editor: e }) => setJson(JSON.stringify(e.getJSON())),
  });

  return (
    <div className="whova-form-group">
      <div className="whova-form-label">
        <span id="instructions-label">{label}</span>
      </div>
      <div className="call-text-editor" aria-labelledby="instructions-label">
        {editor ? <Toolbar editor={editor} /> : <div className="call-text-toolbar" aria-hidden="true" />}
        <EditorContent editor={editor} />
      </div>
      {json !== null && <input type="hidden" name="instructionsDoc" value={json} />}
      {hint ? <p className="whova-form-description">{hint}</p> : null}
    </div>
  );
}

const I = {
  link: <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />,
  bullets: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" />
    </>
  ),
  numbers: (
    <>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="M4 5h1.5v4M3.8 9h3M3.7 14.2c.4-.6 2.6-.9 2.6.6 0 1-2.8 2.2-2.8 3.2h3" strokeWidth="1.4" />
    </>
  ),
  quote: <path d="M7 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6" />,
  undo: <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />,
  redo: <path d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />,
};

function Icon({ d }: { d: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d}
    </svg>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : 'p',
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      link: e.isActive('link'),
      linkHref: (e.getAttributes('link').href as string | undefined) ?? '',
      bullets: e.isActive('bulletList'),
      numbers: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState('');
  const hrefInput = useRef<HTMLInputElement>(null);

  const c = () => editor.chain().focus();

  const setBlock = (v: string) => {
    if (v === 'p') c().setParagraph().run();
    else c().setHeading({ level: v === 'h2' ? 2 : 3 }).run();
  };

  const openLink = () => {
    setHref(s.linkHref);
    setLinking((v) => !v);
    setTimeout(() => hrefInput.current?.focus(), 0);
  };

  const applyLink = () => {
    const value = href.trim();
    if (!value) {
      c().extendMarkRange('link').unsetLink().run();
    } else {
      const target = /^(https?:|mailto:|tel:|\/|#)/i.test(value)
        ? value
        : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
          ? `mailto:${value}`
          : `https://${value}`;
      c().extendMarkRange('link').setLink({ href: target }).run();
    }
    setLinking(false);
  };

  const btn = (label: string, pressed: boolean, onClick: () => void, content: ReactNode, disabled = false) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      // Keeps the selection in the text while the button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {content}
    </button>
  );

  return (
    <>
      <div className="call-text-toolbar" role="toolbar" aria-label="Formatting">
        <select value={s.block} onChange={(e) => setBlock(e.target.value)} aria-label="Text style">
          <option value="p">Paragraph</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
        </select>
        <span className="sep" />
        {btn('Bold', s.bold, () => c().toggleBold().run(), <strong>B</strong>)}
        {btn('Italic', s.italic, () => c().toggleItalic().run(), <em style={{ fontFamily: 'Georgia, serif' }}>I</em>)}
        {btn('Link', s.link || linking, openLink, <Icon d={I.link} />)}
        <span className="sep" />
        {btn('Bulleted list', s.bullets, () => c().toggleBulletList().run(), <Icon d={I.bullets} />)}
        {btn('Numbered list', s.numbers, () => c().toggleOrderedList().run(), <Icon d={I.numbers} />)}
        {btn('Quote', s.quote, () => c().toggleBlockquote().run(), <Icon d={I.quote} />)}
        <span className="sep" />
        {btn('Undo', false, () => c().undo().run(), <Icon d={I.undo} />, !s.canUndo)}
        {btn('Redo', false, () => c().redo().run(), <Icon d={I.redo} />, !s.canRedo)}
      </div>
      {linking && (
        <div className="call-text-link">
          <input
            ref={hrefInput}
            className="whova-text-input"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              // Enter would submit the whole call form.
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              } else if (e.key === 'Escape') {
                setLinking(false);
              }
            }}
            placeholder="A web address or an email address"
            aria-label="Link address"
          />
          <button type="button" className="whova-btn-main small primary" onClick={applyLink}>
            Apply
          </button>
          {s.link && (
            <button
              type="button"
              className="whova-btn-main small secondary"
              onClick={() => {
                c().extendMarkRange('link').unsetLink().run();
                setLinking(false);
              }}
            >
              Remove link
            </button>
          )}
        </div>
      )}
    </>
  );
}
