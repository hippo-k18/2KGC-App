'use client';

import { Extension } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import Youtube from '@tiptap/extension-youtube';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { slugify, type Cover, type PostFields } from '@/lib/blog/types';
import {
  deletePostAction,
  discardDraftAction,
  publishAction,
  requestChangesAction,
  saveDraftAction,
  submitAction,
  unpublishAction,
  withdrawAction,
  type Result,
} from '../actions';
import { uploadImage } from '../image-upload';

export interface EditorPermissions {
  editor: boolean;
  canEdit: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canRequestChanges: boolean;
  canUnpublish: boolean;
  canDiscard: boolean;
  canDelete: boolean;
  canChangeSlug: boolean;
}

export interface EditorProps {
  id: string;
  base: string;
  /** "blog.knowledgegraph.tech/" or "knowledgegraph.tech/blog/", shown before the slug. */
  slugPrefix: string;
  draft: PostFields;
  /** Archive HTML to load when the body has never been saved as a document. */
  legacyHtml: string | null;
  isLive: boolean;
  liveSlug: string | null;
  everPublished: boolean;
  status: { label: string; className: string };
  reviewNote?: string;
  reviewNoteBy?: string;
  isArchive: boolean;
  categorySuggestions: string[];
  can: EditorPermissions;
}

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

/** `class="center"` on paragraphs and headings, as the archive marks centred lines. */
const Align = Extension.create({
  name: 'align',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (el: HTMLElement) =>
              el.classList.contains('center') || el.style.textAlign === 'center' ? 'center' : null,
            renderHTML: (attrs: { textAlign?: string | null }) =>
              attrs.textAlign === 'center' ? { class: 'center' } : {},
          },
        },
      },
    ];
  },
});

/** An image that can be centred and can be a link, as the archive's are. */
const LinkedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      href: {
        default: null,
        parseHTML: (el: HTMLElement) => el.closest('a')?.getAttribute('href') ?? null,
        renderHTML: (attrs: { href?: string | null }) => (attrs.href ? { 'data-href': attrs.href } : {}),
      },
      center: {
        default: false,
        parseHTML: (el: HTMLElement) => el.classList.contains('center'),
        renderHTML: (attrs: { center?: boolean }) => (attrs.center ? { class: 'center' } : {}),
      },
    };
  },
});

/** Archive iframes sit in `div.embed`; the YouTube extension parses `div[data-youtube-video]`. */
function prepareArchiveHtml(html: string): string {
  return html.replace(/<div class="embed">\s*<iframe/g, '<div data-youtube-video><iframe');
}

export function PostEditor(props: EditorProps) {
  const { id, base, can } = props;
  const router = useRouter();

  const [title, setTitle] = useState(props.draft.title);
  const [slug, setSlug] = useState(props.draft.slug);
  const [slugAuto, setSlugAuto] = useState(
    !props.everPublished && (!props.draft.slug || props.draft.slug === slugify(props.draft.title)),
  );
  const [excerpt, setExcerpt] = useState(props.draft.excerpt);
  const [date, setDate] = useState(props.draft.date);
  const [authorName, setAuthorName] = useState(props.draft.authorName);
  const [categories, setCategories] = useState(props.draft.categories);
  const [tags, setTags] = useState(props.draft.tags);
  const [cover, setCover] = useState<Cover | null>(props.draft.cover);

  const [save, setSave] = useState<SaveState>('saved');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // A save turns a published post with nothing pending into one with edits.
  const [editedSinceLoad, setEditedSinceLoad] = useState(false);
  useEffect(() => setEditedSinceLoad(false), [props.status.label]);
  const status =
    editedSinceLoad && props.status.className === 'st-status-live'
      ? { label: 'Published, with unpublished edits', className: 'st-status-pending' }
      : props.status;

  // Bumped by every change; the autosave compares it with what it last sent.
  const version = useRef(0);
  const sent = useRef(0);
  const docDirty = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    editable: can.canEdit,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          HTMLAttributes: { rel: null, target: null },
        },
      }),
      Align,
      LinkedImage.configure({ inline: false, allowBase64: false }),
      Youtube.configure({ nocookie: true, controls: true, width: 640, height: 360 }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: 'Write your post' }),
    ],
    content:
      props.legacyHtml !== null
        ? prepareArchiveHtml(props.legacyHtml)
        : props.draft.body.kind === 'doc'
          ? props.draft.body.doc
          : '',
    editorProps: { attributes: { class: 'post-body', 'aria-label': 'Post body' } },
    onUpdate: () => {
      docDirty.current = true;
      touch();
    },
  });

  const touch = useCallback(() => {
    version.current += 1;
    setSave('unsaved');
  }, []);

  const showToast = (text: string, error = false) => {
    setToast({ text, error });
    setTimeout(() => setToast(null), error ? 6000 : 3000);
  };

  // Everything the save sends, read at the moment it runs.
  const state = useRef({ title, slug, slugAuto, excerpt, date, authorName, categories, tags, cover });
  state.current = { title, slug, slugAuto, excerpt, date, authorName, categories, tags, cover };

  const doSave = useCallback(async (): Promise<boolean> => {
    if (!can.canEdit) return true;
    if (inFlight.current) await inFlight.current;
    if (sent.current === version.current) return true;
    const run = (async () => {
      const at = version.current;
      const s = state.current;
      setSave('saving');
      const res = await saveDraftAction(id, {
        title: s.title,
        slug: s.slugAuto ? '' : s.slug,
        excerpt: s.excerpt,
        date: s.date,
        authorName: s.authorName,
        categories: s.categories,
        tags: s.tags,
        cover: s.cover,
        // Through JSON on purpose. ProseMirror builds every `attrs` object with a
        // null prototype, and React's action serialiser drops those without a
        // word: links arrived with no href, images with no src, headings with
        // no level. A plain copy survives the trip.
        ...(docDirty.current && editor ? { doc: JSON.parse(JSON.stringify(editor.getJSON())) } : {}),
      });
      if (!res.ok) {
        setSave('error');
        showToast(res.error, true);
        return false;
      }
      sent.current = at;
      setEditedSinceLoad(true);
      if (s.slugAuto) setSlug(res.slug);
      setSavedAt(res.savedAt);
      setSave(version.current === at ? 'saved' : 'unsaved');
      return true;
    })();
    inFlight.current = run;
    const ok = await run;
    inFlight.current = null;
    return ok;
  }, [can.canEdit, editor, id]);

  // Autosave a second and a half after the last change.
  useEffect(() => {
    if (save !== 'unsaved') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void doSave(), 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [save, doSave, title, slug, excerpt, date, authorName, categories, tags, cover]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (sent.current !== version.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  useEffect(() => {
    // `false`: toggling editability must not count as an edit and trigger a save.
    editor?.setEditable(can.canEdit, false);
  }, [editor, can.canEdit]);

  const set =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      touch();
    };

  async function act(fn: () => Promise<Result<object>>, done: string, after?: (r: Result<object>) => void) {
    setBusy(true);
    const saved = await doSave();
    if (!saved) {
      setBusy(false);
      return;
    }
    const res = await fn();
    setBusy(false);
    if (!res.ok) return showToast(res.error, true);
    showToast(done);
    setEditedSinceLoad(false);
    after?.(res);
    router.refresh();
  }

  const [dialog, setDialog] = useState<null | 'changes' | 'unpublish' | 'delete' | 'discard'>(null);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const saveLabel =
    save === 'saving'
      ? 'Saving…'
      : save === 'unsaved'
        ? 'Unsaved changes'
        : save === 'error'
          ? 'Not saved'
          : savedAt
            ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
            : '';

  const readOnlyReason = !can.canEdit
    ? 'This post is waiting for an editor. Withdraw it if you need to change something.'
    : null;

  return (
    <>
      <div className="ed-top">
        <div className="ed-top-inner">
          <Link href={`${base}/write`} className="ed-back">
            ← Posts
          </Link>
          <span className="ed-state">
            <span className={`st-status ${status.className}`}>{status.label}</span>
            {saveLabel}
          </span>
          <div className="ed-actions">
            <a className="st-btn st-btn-quiet" href={`${base}/write/${id}/preview`} target="_blank" rel="noreferrer">
              Preview
            </a>
            {props.isLive && props.liveSlug && (
              <a className="st-btn st-btn-quiet" href={`${base}/${props.liveSlug}`} target="_blank" rel="noreferrer">
                View live
              </a>
            )}
            {can.canWithdraw && (
              <button className="st-btn" disabled={busy} onClick={() => act(() => withdrawAction(id), 'Moved back to your drafts')}>
                Withdraw
              </button>
            )}
            {can.canRequestChanges && (
              <button className="st-btn" disabled={busy} onClick={() => setDialog('changes')}>
                Request changes
              </button>
            )}
            {can.canSubmit && (
              <button
                className="st-btn st-btn-primary"
                disabled={busy}
                onClick={() => act(() => submitAction(id), 'Sent to the editors for review')}
              >
                Submit for review
              </button>
            )}
            {can.editor && (
              <button
                className="st-btn st-btn-primary"
                disabled={busy}
                onClick={() => act(() => publishAction(id), props.isLive ? 'Update published' : 'Published')}
              >
                {props.isLive ? 'Update post' : 'Publish'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="ed-grid">
        <div>
          {props.reviewNote !== undefined && (
            <div className="ed-note">
              <p>
                <strong>{props.reviewNoteBy ?? 'An editor'} asked for changes.</strong> Make them, then submit
                again.
              </p>
              {props.reviewNote && <p className="ed-note-body">{props.reviewNote}</p>}
            </div>
          )}
          {readOnlyReason && (
            <div className="ed-note is-info">
              <p>{readOnlyReason}</p>
            </div>
          )}
          {props.isLive && can.canEdit && !can.editor && (
            <div className="ed-note is-info">
              <p>This post is live. Your changes go to an editor before readers see them.</p>
            </div>
          )}

          <article className="ed-paper">
            <p className="ed-cats">{categories.join(' | ')}</p>
            <textarea
              ref={titleRef}
              className="ed-title"
              value={title}
              rows={1}
              placeholder="Title"
              aria-label="Title"
              readOnly={!can.canEdit}
              onChange={(e) => set(setTitle)(e.target.value.replace(/\n/g, ' '))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  editor?.commands.focus('start');
                }
              }}
            />
            <p className="ed-byline">By {authorName || '…'}</p>
            {cover && (
              <figure className="ed-cover">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cover.src} alt="" width={cover.width} height={cover.height} />
              </figure>
            )}
            {editor && can.canEdit && <Toolbar editor={editor} onError={(m) => showToast(m, true)} />}
            <div className="ed-body">
              <EditorContent editor={editor} />
            </div>
          </article>
        </div>

        <aside className="ed-side">
          <div className="st-panel">
            <h2>Post settings</h2>
            <label className="st-field">
              <span>Web address</span>
              <div className="ed-slug">
                <span>/</span>
                <input
                  value={slugAuto ? slugify(title) : slug}
                  placeholder="post-address"
                  disabled={!can.canEdit || !can.canChangeSlug}
                  onChange={(e) => {
                    setSlugAuto(false);
                    set(setSlug)(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
                  }}
                  aria-label="Web address"
                />
              </div>
              <small>
                {props.slugPrefix}
                {slugAuto ? slugify(title) : slug}
              </small>
              {props.everPublished && can.canChangeSlug && (
                <small>Changing it after publishing is safe: the old address redirects here.</small>
              )}
            </label>

            <label className="st-field">
              <span>Summary</span>
              <textarea
                className="st-textarea"
                value={excerpt}
                maxLength={400}
                disabled={!can.canEdit}
                placeholder="Shown on the blog's front page and in link previews. Leave empty to use the first paragraph."
                onChange={(e) => set(setExcerpt)(e.target.value)}
              />
            </label>

            {(can.canEdit || cover) && (
            <div className="st-field">
              <span className="st-label">Cover image</span>
              <CoverPicker cover={cover} disabled={!can.canEdit} onChange={set(setCover)} onError={(m) => showToast(m, true)} />
            </div>
            )}

            {(can.canEdit || categories.length > 0) && (
            <ChipField
              label="Categories"
              values={categories}
              suggestions={props.categorySuggestions}
              disabled={!can.canEdit}
              onChange={set(setCategories)}
              listId="blog-categories"
            />
            )}
            {(can.canEdit || tags.length > 0) && (
              <ChipField label="Tags" values={tags} disabled={!can.canEdit} onChange={set(setTags)} />
            )}

            {can.editor && (
              <>
                <label className="st-field">
                  <span>Byline</span>
                  <input className="st-input" value={authorName} onChange={(e) => set(setAuthorName)(e.target.value)} />
                </label>
                <label className="st-field">
                  <span>Date</span>
                  <input className="st-input" type="date" value={date} onChange={(e) => set(setDate)(e.target.value)} />
                  <small>Empty means the day it is published.</small>
                </label>
              </>
            )}

            {(can.canUnpublish || can.canDiscard || can.canDelete) && (
              <div className="ed-danger">
                {can.canDiscard && (
                  <button className="st-btn st-btn-quiet" onClick={() => setDialog('discard')}>
                    Discard unpublished edits
                  </button>
                )}
                {can.canUnpublish && (
                  <button className="st-btn st-btn-quiet st-btn-danger" onClick={() => setDialog('unpublish')}>
                    Unpublish
                  </button>
                )}
                {can.canDelete && !props.isArchive && (
                  <button className="st-btn st-btn-quiet st-btn-danger" onClick={() => setDialog('delete')}>
                    Delete post
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {dialog === 'changes' && (
        <NoteDialog
          onCancel={() => setDialog(null)}
          onSend={(note) => {
            setDialog(null);
            void act(() => requestChangesAction(id, note), 'Sent back to the writer');
          }}
        />
      )}
      {dialog === 'unpublish' && (
        <ConfirmDialog
          title="Unpublish this post?"
          body="It comes off the blog straight away. The text stays here as a draft, and you can publish it again."
          confirm="Unpublish"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            void act(() => unpublishAction(id), 'Unpublished');
          }}
        />
      )}
      {dialog === 'discard' && (
        <ConfirmDialog
          title="Discard these edits?"
          body="The draft goes back to the published version. The edits cannot be recovered."
          confirm="Discard edits"
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            setDialog(null);
            const res = await discardDraftAction(id);
            if (!res.ok) return showToast(res.error, true);
            version.current = sent.current;
            window.location.reload();
          }}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title="Delete this post?"
          body="It is removed for good, with its history."
          confirm="Delete post"
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            setDialog(null);
            version.current = sent.current;
            const res = await deletePostAction(id);
            if (!res.ok) return showToast(res.error, true);
            window.location.assign(res.go);
          }}
        />
      )}
      {toast && (
        <div className={`st-toast${toast.error ? ' is-error' : ''}`} role="status">
          {toast.text}
        </div>
      )}
    </>
  );
}

// ── Formatting bar ──────────────────────────────────────────────────────────

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
  center: <path d="M4 6h16M7 12h10M5 18h14" />,
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 17 5-4.5 3.5 3 3-2.5 4.5 4" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor" />
    </>
  ),
  rule: <path d="M4 12h16" />,
  undo: <path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12" transform="translate(0 -3)" />,
  redo: <path d="m15 7 5 5-5 5M20 12H10a6 6 0 0 0 0 12" transform="translate(0 -3)" />,
};

function Icon({ d }: { d: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d}
    </svg>
  );
}

function Toolbar({ editor, onError }: { editor: Editor; onError: (m: string) => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive('heading', { level: 2 })
        ? 'h2'
        : e.isActive('heading', { level: 3 })
          ? 'h3'
          : e.isActive('heading', { level: 4 })
            ? 'h4'
            : 'p',
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      link: e.isActive('link'),
      linkHref: (e.getAttributes('link').href as string | undefined) ?? '',
      linkButton: /\bbutton\b/.test((e.getAttributes('link').class as string | undefined) ?? ''),
      bullets: e.isActive('bulletList'),
      numbers: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      center: e.isActive('image')
        ? e.getAttributes('image').center === true
        : e.getAttributes('paragraph').textAlign === 'center' || e.getAttributes('heading').textAlign === 'center',
      imageHref: (e.getAttributes('image').href as string | undefined) ?? '',
      image: e.isActive('image'),
      imageAlt: (e.getAttributes('image').alt as string | undefined) ?? '',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const [panel, setPanel] = useState<null | 'link' | 'video'>(null);
  const [value, setValue] = useState('');
  const [asButton, setAsButton] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const c = () => editor.chain().focus();

  const setBlock = (v: string) => {
    if (v === 'p') c().setParagraph().run();
    else c().setHeading({ level: Number(v[1]) as 2 | 3 | 4 }).run();
  };

  const toggleCenter = () => {
    if (s.image) return void c().updateAttributes('image', { center: !s.center }).run();
    const type = editor.isActive('heading') ? 'heading' : 'paragraph';
    c().updateAttributes(type, { textAlign: s.center ? null : 'center' }).run();
  };

  const openLink = () => {
    setValue(s.linkHref);
    setAsButton(s.linkButton);
    setPanel(panel === 'link' ? null : 'link');
  };

  const applyLink = () => {
    const href = value.trim();
    if (!href) {
      c().extendMarkRange('link').unsetLink().run();
    } else {
      const withProto = /^(https?:|mailto:|tel:|\/|#)/.test(href) ? href : `https://${href}`;
      c().extendMarkRange('link').setLink({ href: withProto, class: asButton ? 'button' : null } as never).run();
    }
    setPanel(null);
  };

  const applyVideo = () => {
    const ok = editor.chain().focus().setYoutubeVideo({ src: value.trim() }).run();
    if (!ok) return onError('That is not a YouTube link.');
    setPanel(null);
    setValue('');
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const img = await uploadImage(file);
      c().setImage({ src: img.src, alt: '', width: img.width, height: img.height } as never).run();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'The upload failed.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const btn = (label: string, pressed: boolean, onClick: () => void, content: React.ReactNode, disabled = false) => (
    <button type="button" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {content}
    </button>
  );

  return (
    <div className="ed-tools" role="toolbar" aria-label="Formatting">
      <select value={s.block} onChange={(e) => setBlock(e.target.value)} aria-label="Text style">
        <option value="p">Paragraph</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
        <option value="h4">Small heading</option>
      </select>
      <span className="sep" />
      {btn('Bold', s.bold, () => c().toggleBold().run(), <strong>B</strong>)}
      {btn('Italic', s.italic, () => c().toggleItalic().run(), <em style={{ fontFamily: 'Georgia, serif' }}>I</em>)}
      {btn('Underline', s.underline, () => c().toggleUnderline().run(), <u>U</u>)}
      {btn('Link', s.link || panel === 'link', openLink, <Icon d={I.link} />)}
      <span className="sep" />
      {btn('Bulleted list', s.bullets, () => c().toggleBulletList().run(), <Icon d={I.bullets} />)}
      {btn('Numbered list', s.numbers, () => c().toggleOrderedList().run(), <Icon d={I.numbers} />)}
      {btn('Quote', s.quote, () => c().toggleBlockquote().run(), <Icon d={I.quote} />)}
      {btn('Centre', s.center, toggleCenter, <Icon d={I.center} />)}
      <span className="sep" />
      {btn(uploading ? 'Uploading image' : 'Image', false, () => fileRef.current?.click(), uploading ? '…' : <Icon d={I.image} />, uploading)}
      {btn('YouTube video', panel === 'video', () => {
        setValue('');
        setPanel(panel === 'video' ? null : 'video');
      }, <Icon d={I.video} />)}
      {btn('Divider', false, () => c().setHorizontalRule().run(), <Icon d={I.rule} />)}
      <span className="sep" />
      {btn('Undo', false, () => c().undo().run(), <Icon d={I.undo} />, !s.canUndo)}
      {btn('Redo', false, () => c().redo().run(), <Icon d={I.redo} />, !s.canRedo)}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pickImage(e.target.files?.[0])} />

      {panel === 'link' && (
        <form className="ed-inline" onSubmit={(e) => (e.preventDefault(), applyLink())}>
          <input className="st-input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Paste a link" aria-label="Link address" />
          <label>
            <input type="checkbox" checked={asButton} onChange={(e) => setAsButton(e.target.checked)} /> Button
          </label>
          <button className="st-btn st-btn-primary">Apply</button>
          {s.link && (
            <button type="button" className="st-btn st-btn-quiet" onClick={() => (c().extendMarkRange('link').unsetLink().run(), setPanel(null))}>
              Remove
            </button>
          )}
        </form>
      )}
      {panel === 'video' && (
        <form className="ed-inline" onSubmit={(e) => (e.preventDefault(), applyVideo())}>
          <input className="st-input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Paste a YouTube link" aria-label="YouTube link" />
          <button className="st-btn st-btn-primary">Insert</button>
        </form>
      )}
      {s.image && !panel && (
        <div className="ed-inline">
          <label htmlFor="ed-alt">Describe the image</label>
          <input
            id="ed-alt"
            className="st-input"
            value={s.imageAlt}
            placeholder="For readers using a screen reader"
            onChange={(e) => editor.chain().updateAttributes('image', { alt: e.target.value }).run()}
          />
          <label htmlFor="ed-img-link">Link</label>
          <input
            id="ed-img-link"
            className="st-input"
            style={{ maxWidth: 220 }}
            value={s.imageHref}
            placeholder="Optional"
            onChange={(e) => editor.chain().updateAttributes('image', { href: e.target.value.trim() || null }).run()}
          />
        </div>
      )}
    </div>
  );
}

// ── Settings fields ─────────────────────────────────────────────────────────

function CoverPicker({
  cover,
  disabled,
  onChange,
  onError,
}: {
  cover: Cover | null;
  disabled: boolean;
  onChange: (c: Cover | null) => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await uploadImage(file));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'The upload failed.');
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };
  return (
    <div className="ed-cover-pick">
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover.src} alt="" />
      )}
      {!disabled && (
        <div className="ed-cover-actions">
          <button type="button" className="st-btn" disabled={busy} onClick={() => ref.current?.click()}>
            {busy ? 'Uploading…' : cover ? 'Replace' : 'Upload'}
          </button>
          {cover && (
            <button type="button" className="st-btn st-btn-quiet" onClick={() => onChange(null)}>
              Remove
            </button>
          )}
        </div>
      )}
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}

function ChipField({
  label,
  values,
  suggestions,
  disabled,
  onChange,
  listId,
}: {
  label: string;
  values: string[];
  suggestions?: string[];
  disabled: boolean;
  onChange: (v: string[]) => void;
  listId?: string;
}) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const v = raw.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="st-field">
      <span className="st-label">{label}</span>
      {values.length > 0 && (
        <div className="ed-chips">
          {values.map((v) => (
            <span key={v} className="ed-chip">
              {v}
              {!disabled && (
                <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && (
        <>
          <input
            className="st-input"
            value={draft}
            list={listId}
            placeholder={`Add ${label.toLowerCase()}, then Enter`}
            aria-label={`Add ${label.toLowerCase()}`}
            onChange={(e) => {
              const v = e.target.value;
              if (v.endsWith(',')) add(v);
              else setDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(draft);
              } else if (e.key === 'Backspace' && !draft && values.length) {
                onChange(values.slice(0, -1));
              }
            }}
            onBlur={() => draft && add(draft)}
          />
          {listId && suggestions && (
            <datalist id={listId}>
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
        </>
      )}
    </div>
  );
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return ref;
}

function ConfirmDialog(props: { title: string; body: string; confirm: string; onCancel: () => void; onConfirm: () => void }) {
  const ref = useModal();
  return (
    <dialog ref={ref} className="st-dialog" onCancel={props.onCancel}>
      <h2>{props.title}</h2>
      <p>{props.body}</p>
      <div className="st-dialog-actions">
        <button className="st-btn st-btn-quiet" onClick={props.onCancel}>
          Cancel
        </button>
        <button className="st-btn st-btn-primary" onClick={props.onConfirm} autoFocus>
          {props.confirm}
        </button>
      </div>
    </dialog>
  );
}

function NoteDialog({ onCancel, onSend }: { onCancel: () => void; onSend: (note: string) => void }) {
  const ref = useModal();
  const [note, setNote] = useState('');
  return (
    <dialog ref={ref} className="st-dialog" onCancel={onCancel}>
      <h2>Request changes</h2>
      <p>The writer gets this note by email and sees it above their draft.</p>
      <textarea
        className="st-textarea"
        style={{ minHeight: 140 }}
        value={note}
        autoFocus
        onChange={(e) => setNote(e.target.value)}
        placeholder="What should change?"
      />
      <div className="st-dialog-actions">
        <button className="st-btn st-btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button className="st-btn st-btn-primary" onClick={() => onSend(note)}>
          Send back
        </button>
      </div>
    </dialog>
  );
}
