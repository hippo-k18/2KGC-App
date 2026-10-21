'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import type { LearnPageContent, PageImage } from '@kgc/shared';
import {
  MEDIA_SORTS,
  UPLOAD_ACCEPT,
  addTag,
  allTags,
  checkUploads,
  formatBytes,
  queryMedia,
  removeTag,
  runPool,
  type MediaSort,
} from '@/lib/learn-media-core';
import { imageUsage } from '@/lib/learn-tools-core';
import {
  deleteLearnMediaAction,
  listLearnMediaAction,
  recordLearnMediaAction,
  updateLearnMediaAction,
  type MediaRow,
} from './api';
import { Modal } from './dialogs';
import { useEditorServices } from './editor-context';
import { resolveSrc } from './editor-types';
import { measureImageUrl, prepareImageFile } from './image-tools';
import './media.css';

/**
 * The Learn page's media library (T318): every uploaded image in one grid, to
 * search, tag, rename, describe, edit and delete, and to choose from when a
 * field wants an image. Opened by the shell for both jobs, so `mode` decides
 * only the title and whether there is a "Use this image" button.
 *
 * Uploads run three at a time. A server action reports no progress, so each
 * file shows a moving bar until it is done or has failed.
 */

const PARALLEL_UPLOADS = 3;

type UploadStatus = 'waiting' | 'uploading' | 'done' | 'failed';
interface UploadEntry {
  key: number;
  name: string;
  status: UploadStatus;
  error?: string;
}

export interface MediaLibraryProps {
  mode: 'manage' | 'pick';
  /** Pick mode: called with the chosen image (its default alt text included). */
  onPick?: (image: PageImage) => void;
  onClose: () => void;
  /** The draft, for "Where it is used". */
  content: LearnPageContent;
  /** The live page, or null before the first publish. */
  published: LearnPageContent | null;
  /** Overrides the pick mode title ("Choose a photo"). */
  title?: string;
}

const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

function editedName(fileName: string): string {
  const m = /^(.*?)(\.[^.]+)?$/.exec(fileName);
  return `${m?.[1] || 'image'} (edited)${m?.[2] ?? ''}`;
}

export function MediaLibrary({ mode, onPick, onClose, content, published, title }: MediaLibraryProps) {
  const services = useEditorServices();
  const siteOrigin = services?.siteOrigin ?? '';
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const detailsHeadRef = useRef<HTMLHeadingElement>(null);
  const uploadKey = useRef(0);

  const [rows, setRows] = useState<MediaRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<MediaSort>('newest');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // On a narrow screen the details replace the grid; this says which is showing.
  const [showDetails, setShowDetails] = useState(false);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  // Focal point edits keep the same file, which the library row cannot store;
  // held here so "Use this image" hands over the edited version.
  const [edits, setEdits] = useState<Record<string, PageImage>>({});

  useEffect(() => {
    let alive = true;
    listLearnMediaAction()
      .then((res) => {
        if (!alive) return;
        if (res.ok) {
          setRows(res.items);
          setLoadError(null);
        } else setLoadError(res.error || 'The images could not be loaded.');
      })
      .catch(() => alive && setLoadError('The images could not be loaded. Check your connection and try again.'));
    return () => {
      alive = false;
    };
  }, [reload]);

  const tags = useMemo(() => allTags(rows ?? []), [rows]);
  const visible = useMemo(() => queryMedia(rows ?? [], { query, tag, sort }), [rows, query, tag, sort]);
  const selected = rows?.find((r) => r.id === selectedId) ?? null;
  const focusTarget = visible.find((r) => r.id === activeId) ?? visible.find((r) => r.id === selectedId) ?? visible[0];

  function imageOf(row: MediaRow): PageImage {
    return edits[row.id] ?? row.image;
  }

  function pick(row: MediaRow) {
    onPick?.(imageOf(row));
  }

  function select(row: MediaRow, open = false) {
    setSelectedId(row.id);
    setActiveId(row.id);
    if (open) {
      setShowDetails(true);
      // After the panel renders, so a screen reader lands on its heading.
      requestAnimationFrame(() => detailsHeadRef.current?.focus());
    }
  }

  function backToGrid() {
    setShowDetails(false);
    const id = selectedId;
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id ?? '')}"]`)?.focus();
    });
  }

  function upsert(item: MediaRow) {
    setRows((cur) => (cur ? (cur.some((r) => r.id === item.id) ? cur.map((r) => (r.id === item.id ? item : r)) : [item, ...cur]) : [item]));
  }

  function removeRow(id: string) {
    setRows((cur) => cur?.filter((r) => r.id !== id) ?? cur);
    setSelectedId(null);
    setShowDetails(false);
  }

  // ─── Keyboard in the grid ──────────────────────────────────────────────────

  function columns(): number {
    const tiles = gridRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    if (!tiles || tiles.length === 0) return 1;
    const top = tiles[0].offsetTop;
    let n = 0;
    while (n < tiles.length && tiles[n].offsetTop === top) n++;
    return Math.max(1, n);
  }

  function onGridKey(e: KeyboardEvent<HTMLDivElement>) {
    if (visible.length === 0) return;
    const i = Math.max(0, visible.findIndex((r) => r.id === focusTarget?.id));
    const cols = columns();
    const moves: Record<string, number> = {
      ArrowLeft: i - 1,
      ArrowRight: i + 1,
      ArrowUp: i - cols,
      ArrowDown: i + cols,
      Home: 0,
      End: visible.length - 1,
    };
    if (e.key in moves) {
      e.preventDefault();
      const j = Math.min(visible.length - 1, Math.max(0, moves[e.key]));
      const row = visible[j];
      setActiveId(row.id);
      gridRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(row.id)}"]`)?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const row = visible[i];
      if (mode === 'pick' && e.key === 'Enter') pick(row);
      else select(row, true);
    }
  }

  // ─── Uploads ───────────────────────────────────────────────────────────────

  function setUpload(key: number, patch: Partial<UploadEntry>) {
    setUploads((cur) => cur.map((u) => (u.key === key ? { ...u, ...patch } : u)));
  }

  async function uploadOne(file: File, key: number): Promise<MediaRow | null> {
    if (!services) return null;
    setUpload(key, { status: 'uploading' });
    try {
      const prepared = await prepareImageFile(file);
      const res = await services.uploadImage(prepared.file);
      if (!res.ok) {
        setUpload(key, { status: 'failed', error: res.error || 'The upload did not work.' });
        return null;
      }
      let image: PageImage = { ...res.image };
      if (!image.width || !image.height) {
        let dims = { width: prepared.width, height: prepared.height };
        if (!dims.width || !dims.height) {
          const url = URL.createObjectURL(prepared.file);
          dims = await measureImageUrl(url);
          URL.revokeObjectURL(url);
        }
        if (dims.width && dims.height) image = { ...image, ...dims };
      }
      const rec = await recordLearnMediaAction(image, file.name, prepared.file.size);
      if (!rec.ok) {
        setUpload(key, { status: 'failed', error: rec.error || 'The image uploaded but could not be added to the library.' });
        return null;
      }
      upsert(rec.item);
      setUpload(key, { status: 'done' });
      return rec.item;
    } catch {
      setUpload(key, { status: 'failed', error: 'The upload did not work. Check your connection and try again.' });
      return null;
    }
  }

  async function handleFiles(list: FileList | File[] | null | undefined) {
    const files = Array.from(list ?? []);
    if (files.length === 0 || !services) return;
    const { accepted, rejected } = checkUploads(files);
    const failed: UploadEntry[] = rejected.map(({ file, reason }) => ({
      key: ++uploadKey.current,
      name: file.name,
      status: 'failed',
      error: reason,
    }));
    const queued = accepted.map((file) => ({ file, key: ++uploadKey.current }));
    setUploads((cur) => [
      ...cur,
      ...failed,
      ...queued.map(({ file, key }) => ({ key, name: file.name, status: 'waiting' as const })),
    ]);
    const first: { row: MediaRow | null } = { row: null };
    await runPool(queued, PARALLEL_UPLOADS, async ({ file, key }) => {
      const row = await uploadOne(file, key);
      if (row && !first.row) first.row = row;
    });
    // Show what just arrived when nothing else was being looked at.
    const shown = first.row;
    if (shown) setSelectedId((cur) => cur ?? shown.id);
  }

  function onFileInput(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    void handleFiles(files);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    void handleFiles(e.dataTransfer.files);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (!services || !Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  }

  const uploading = uploads.some((u) => u.status === 'waiting' || u.status === 'uploading');
  const finished = uploads.some((u) => u.status === 'done' || u.status === 'failed');

  // ─── Render ────────────────────────────────────────────────────────────────

  const heading = mode === 'pick' ? title || 'Choose an image' : 'Media library';
  const searchId = `${uid}-search`;
  const sortId = `${uid}-sort`;

  let body;
  if (loadError) {
    body = (
      <div className="le-media-state" role="alert">
        <p>{loadError}</p>
        <button
          type="button"
          className="btn btn-default btn-sm"
          onClick={() => {
            setLoadError(null);
            setReload((n) => n + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  } else if (!rows) {
    body = (
      <div className="le-media-state" role="status">
        <p>Loading images...</p>
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <div className="le-media-state">
        <p>No images yet. Upload some to use them anywhere on the page.</p>
      </div>
    );
  } else if (visible.length === 0) {
    body = (
      <div className="le-media-state" role="status">
        <p>No images match{query.trim() ? ` "${query.trim()}"` : ''}{tag ? ` with the tag ${tag}` : ''}.</p>
        <button
          type="button"
          className="btn btn-default btn-sm"
          onClick={() => {
            setQuery('');
            setTag(null);
          }}
        >
          Show all images
        </button>
      </div>
    );
  } else {
    body = (
      <div
        ref={gridRef}
        className="le-media-grid"
        role="listbox"
        aria-label={mode === 'pick' ? 'Images. Press Enter to use the selected one.' : 'Images. Press Enter to see details.'}
        onKeyDown={onGridKey}
      >
        {visible.map((r) => {
          const img = imageOf(r);
          return (
            <div
              key={r.id}
              data-id={r.id}
              role="option"
              aria-selected={r.id === selectedId}
              tabIndex={r.id === focusTarget?.id ? 0 : -1}
              className={`le-media-tile${r.id === selectedId ? ' is-selected' : ''}`}
              onFocus={() => setActiveId(r.id)}
              onClick={() => select(r, true)}
              onDoubleClick={() => mode === 'pick' && pick(r)}
            >
              <span className="le-media-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element -- a Storage or site URL, sized by CSS */}
                <img
                  src={resolveSrc(img.src, siteOrigin)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  style={{ objectPosition: `${(img.focusX ?? 0.5) * 100}% ${(img.focusY ?? 0.5) * 100}%` }}
                />
              </span>
              <span className="le-media-tile-name">{r.fileName}</span>
              <span className="le-media-tile-meta">
                {img.width > 0 && img.height > 0 ? `${img.width} × ${img.height}` : formatBytes(r.bytes)}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Modal
      title={heading}
      onClose={onClose}
      wide
      footer={
        mode === 'pick' ? (
          <>
            <button type="button" className="btn btn-default" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="whova-btn-main small"
              disabled={!selected}
              onClick={() => selected && pick(selected)}
            >
              Use this image
            </button>
          </>
        ) : (
          <button type="button" className="whova-btn-main small" onClick={onClose}>
            Done
          </button>
        )
      }
    >
      <div
        className={`le-media${dragOver ? ' is-over' : ''}${showDetails && selected ? ' show-details' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={onDrop}
      >
        <div className="le-media-main">
          <div className="le-media-toolbar">
            <label className="le-media-visually-hidden" htmlFor={searchId}>
              Search images
            </label>
            <input
              id={searchId}
              type="search"
              className="whova-text-input le-media-search"
              placeholder="Search by name, description or tag"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-autofocus
            />
            <label className="le-media-sort">
              <span>Sort</span>
              <select id={sortId} value={sort} onChange={(e) => setSort(e.target.value as MediaSort)}>
                {MEDIA_SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {services && (
              <button type="button" className="whova-btn-main small" onClick={() => fileRef.current?.click()}>
                Upload images
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              multiple
              className="le-media-visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={onFileInput}
            />
          </div>

          {tags.length > 0 && (
            <div className="le-media-tags" role="group" aria-label="Show only images with this tag">
              <button type="button" className="le-media-chip" aria-pressed={tag === null} onClick={() => setTag(null)}>
                All <span className="le-media-count">{rows?.length ?? 0}</span>
              </button>
              {tags.map((t) => (
                <button
                  key={t.tag}
                  type="button"
                  className="le-media-chip"
                  aria-pressed={tag === t.tag}
                  onClick={() => setTag(tag === t.tag ? null : t.tag)}
                >
                  {t.tag} <span className="le-media-count">{t.count}</span>
                </button>
              ))}
            </div>
          )}

          {services && (
            <p className="le-media-drop">
              {dragOver ? 'Drop the images to upload them.' : 'Drag images here to upload several at once. JPEG, PNG, WebP or GIF, up to 10 MB each.'}
            </p>
          )}

          {uploads.length > 0 && (
            <div className="le-media-uploads">
              <ul aria-label="Uploads">
                {uploads.map((u) => (
                  <li key={u.key} className={`le-media-upload is-${u.status}`}>
                    <span className="le-media-upload-name">{u.name}</span>
                    {u.status === 'waiting' && <span className="le-media-upload-state">Waiting</span>}
                    {u.status === 'uploading' && (
                      <span className="le-media-bar" role="progressbar" aria-label={`Uploading ${u.name}`}>
                        <span />
                      </span>
                    )}
                    {u.status === 'done' && <span className="le-media-upload-state">Done</span>}
                    {u.status === 'failed' && <span className="le-media-upload-error">{u.error || 'Failed'}</span>}
                  </li>
                ))}
              </ul>
              <p className="le-media-visually-hidden" role="status">
                {uploading
                  ? 'Uploading images.'
                  : `${uploads.filter((u) => u.status === 'done').length} uploaded, ${uploads.filter((u) => u.status === 'failed').length} failed.`}
              </p>
              {!uploading && finished && (
                <button type="button" className="le-media-link" onClick={() => setUploads([])}>
                  Clear this list
                </button>
              )}
            </div>
          )}

          {body}
        </div>

        <aside className="le-media-side" aria-label="Image details">
          {selected ? (
            <MediaDetails
              key={selected.id}
              row={selected}
              image={imageOf(selected)}
              mode={mode}
              siteOrigin={siteOrigin}
              content={content}
              published={published}
              headRef={detailsHeadRef}
              onBack={backToGrid}
              onSaved={upsert}
              onDeleted={removeRow}
              onAdded={(item) => {
                upsert(item);
                setSelectedId(item.id);
              }}
              onFocalEdit={(img) => setEdits((cur) => ({ ...cur, [selected.id]: img }))}
            />
          ) : (
            <p className="le-media-side-empty">Select an image to see its details.</p>
          )}
        </aside>
      </div>
    </Modal>
  );
}

// ─── Details panel ───────────────────────────────────────────────────────────

interface DetailsProps {
  row: MediaRow;
  image: PageImage;
  mode: 'manage' | 'pick';
  siteOrigin: string;
  content: LearnPageContent;
  published: LearnPageContent | null;
  headRef: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  onSaved: (row: MediaRow) => void;
  onDeleted: (id: string) => void;
  onAdded: (row: MediaRow) => void;
  onFocalEdit: (image: PageImage) => void;
}

function MediaDetails({
  row,
  image,
  mode,
  siteOrigin,
  content,
  published,
  headRef,
  onBack,
  onSaved,
  onDeleted,
  onAdded,
  onFocalEdit,
}: DetailsProps) {
  const services = useEditorServices();
  const uid = useId();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(row.fileName);
  const [tagDraft, setTagDraft] = useState('');
  const [alt, setAlt] = useState(row.image.alt);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<string[] | null>(null);

  const usedIn = useMemo(
    () => [...imageUsage(content, row.image.src, 'Draft: '), ...imageUsage(published, row.image.src, 'Live: ')],
    [content, published, row.image.src],
  );

  async function patch(p: { fileName?: string; tags?: string[]; alt?: string }, done: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await updateLearnMediaAction(row.id, p);
      if (!res.ok) {
        setError(res.error || 'The change could not be saved.');
        return false;
      }
      onSaved(res.item);
      setNote(done);
      return true;
    } catch {
      setError('The change could not be saved. Check your connection and try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveName() {
    const next = name.trim();
    if (!next || next === row.fileName) {
      setName(row.fileName);
      setRenaming(false);
      return;
    }
    if (await patch({ fileName: next }, 'Name saved.')) setRenaming(false);
  }

  function onNameKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void saveName();
    } else if (e.key === 'Escape') {
      // Stops the dialog closing too.
      e.preventDefault();
      setName(row.fileName);
      setRenaming(false);
    }
  }

  async function addTagNow() {
    const next = addTag(row.tags, tagDraft);
    if (next.length === (row.tags ?? []).length) {
      setTagDraft('');
      return;
    }
    if (await patch({ tags: next }, 'Tag added.')) setTagDraft('');
  }

  async function saveAlt() {
    if (alt === row.image.alt) return;
    await patch({ alt }, 'Description saved.');
  }

  async function edit() {
    if (!services) return;
    setError(null);
    setNote(null);
    const result = await services.editImage(image);
    if (!result) return;
    if (result.src === row.image.src) {
      onFocalEdit(result);
      setNote(
        mode === 'pick'
          ? 'The new focal point is used when you choose this image.'
          : 'A focal point is kept where the image is used, so set it when you choose the image for a block.',
      );
      return;
    }
    setBusy(true);
    try {
      // The size of the new file is not reported back, so it is recorded as unknown.
      const rec = await recordLearnMediaAction(result, editedName(row.fileName), 0);
      if (!rec.ok) {
        setError(rec.error || 'The edited image was saved but could not be added to the library.');
        return;
      }
      onAdded(rec.item);
    } catch {
      setError('The edited image could not be added to the library. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await deleteLearnMediaAction(row.id, usedIn);
      if (res.ok) {
        onDeleted(row.id);
        return;
      }
      if (res.usedIn?.length) setRefusal(res.usedIn);
      else setError(res.error || 'The image could not be deleted.');
      setConfirming(false);
    } catch {
      setError('The image could not be deleted. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function askDelete() {
    setError(null);
    if (usedIn.length > 0) {
      setRefusal(usedIn);
      setConfirming(false);
    } else {
      setRefusal(null);
      setConfirming(true);
    }
  }

  const nameId = `${uid}-name`;
  const altId = `${uid}-alt`;
  const tagId = `${uid}-tag`;

  return (
    <div className="le-media-details">
      <button type="button" className="le-media-link le-media-back" onClick={onBack}>
        Back to all images
      </button>
      <h3 ref={headRef} tabIndex={-1} className="le-media-details-title">
        {row.fileName}
      </h3>
      <div className="le-media-preview">
        {/* eslint-disable-next-line @next/next/no-img-element -- a Storage or site URL, sized by CSS */}
        <img src={resolveSrc(image.src, siteOrigin)} alt={image.alt} />
      </div>

      <dl className="le-media-facts">
        <dt>Size</dt>
        <dd>{row.bytes > 0 ? formatBytes(row.bytes) : 'Not known'}</dd>
        <dt>Dimensions</dt>
        <dd>{image.width > 0 && image.height > 0 ? `${image.width} × ${image.height} px` : 'Not known'}</dd>
        <dt>Uploaded</dt>
        <dd>{row.uploadedAt ? dateFormat.format(row.uploadedAt) : 'Not known'}</dd>
      </dl>

      <div className="le-media-field">
        <label className="le-media-label" htmlFor={nameId}>
          File name
        </label>
        {renaming ? (
          <div className="le-media-inline">
            <input
              id={nameId}
              className="whova-text-input le-media-input"
              value={name}
              maxLength={120}
              disabled={busy}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={onNameKey}
            />
            <button type="button" className="btn btn-default btn-sm" disabled={busy} onClick={() => void saveName()}>
              Save
            </button>
            <button
              type="button"
              className="le-media-link"
              onClick={() => {
                setName(row.fileName);
                setRenaming(false);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="le-media-inline">
            <span id={nameId} className="le-media-name">
              {row.fileName}
            </span>
            <button type="button" className="le-media-link" onClick={() => setRenaming(true)}>
              Rename
            </button>
          </div>
        )}
      </div>

      <div className="le-media-field">
        <label className="le-media-label" htmlFor={tagId}>
          Tags
        </label>
        <p className="le-media-hint">Tags group images so you can find them faster.</p>
        {(row.tags ?? []).length > 0 && (
          <ul className="le-media-tag-list" aria-label="Tags on this image">
            {(row.tags ?? []).map((t) => (
              <li key={t} className="le-media-tag">
                {t}
                <button
                  type="button"
                  className="le-media-tag-x"
                  aria-label={`Remove tag ${t}`}
                  disabled={busy}
                  onClick={() => void patch({ tags: removeTag(row.tags, t) }, 'Tag removed.')}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="le-media-inline">
          <input
            id={tagId}
            className="whova-text-input le-media-input"
            value={tagDraft}
            maxLength={30}
            placeholder="For example: team"
            disabled={busy}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addTagNow();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-default btn-sm"
            disabled={busy || !tagDraft.trim()}
            onClick={() => void addTagNow()}
          >
            Add tag
          </button>
        </div>
      </div>

      <div className="le-media-field">
        <label className="le-media-label" htmlFor={altId}>
          Default description (alt text)
        </label>
        <p className="le-media-hint">
          Filled in when you choose this image. You can still change it for each place the image is used.
        </p>
        <textarea
          id={altId}
          className="whova-text-input le-media-input"
          rows={2}
          value={alt}
          maxLength={300}
          placeholder="For example: Three people talking at a whiteboard"
          onChange={(e) => setAlt(e.target.value)}
          onBlur={() => void saveAlt()}
        />
      </div>

      <div className="le-media-field">
        <h4 className="le-media-label">Where it is used</h4>
        {usedIn.length === 0 ? (
          <p className="le-media-hint">Not used on the draft or the live page.</p>
        ) : (
          <ul className="le-media-used">
            {usedIn.map((u, i) => (
              <li key={`${u}-${i}`}>{u}</li>
            ))}
          </ul>
        )}
      </div>

      <p className="le-media-status" role="status">
        {note}
      </p>
      {error && (
        <p className="le-media-error" role="alert">
          {error}
        </p>
      )}

      <div className="le-media-actions">
        {services && (
          <button type="button" className="btn btn-default btn-sm" disabled={busy} onClick={() => void edit()}>
            Edit image
          </button>
        )}
        {!confirming && (
          <button type="button" className="btn btn-default btn-sm le-media-danger" disabled={busy} onClick={askDelete}>
            Delete
          </button>
        )}
      </div>

      {confirming && (
        <div className="le-media-confirm" role="group" aria-label="Confirm delete">
          <p>Delete this image from the library? This cannot be undone.</p>
          <div className="le-media-inline">
            <button
              type="button"
              className="btn btn-default btn-sm le-media-danger"
              disabled={busy}
              onClick={() => void confirmDelete()}
              autoFocus
            >
              {busy ? 'Deleting...' : 'Delete image'}
            </button>
            <button type="button" className="le-media-link" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}

      {refusal && (
        <div className="le-media-confirm" role="alert">
          <p>This image is still used, so it cannot be deleted. Remove it from these places first:</p>
          <ul className="le-media-used">
            {refusal.map((u, i) => (
              <li key={`${u}-${i}`}>{u}</li>
            ))}
          </ul>
          <button type="button" className="le-media-link" onClick={() => setRefusal(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
