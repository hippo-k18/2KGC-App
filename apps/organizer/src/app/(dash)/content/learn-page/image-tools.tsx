'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { PageImage } from '@kgc/shared';
import { resolveSrc, type UploadImage } from './editor-types';

/**
 * Pick, drop or paste an image, upload it, and set its focal point and alt
 * text. Used for the image block, people photos and column images (T310).
 *
 * Resizing happens here, before the upload, for the reason `image-field.tsx`
 * gives: a phone photo is several megabytes and a canvas costs nothing. The
 * rules differ from that field's on purpose: this one only touches a file that
 * is too big (longest edge over 2400px or over 1.5 MB), because a course page
 * image is shown large and a re-encode of a small PNG would only lose quality.
 */

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
const ACCEPTED = new Set(ACCEPT.split(','));
const MAX_BYTES = 10 * 1024 * 1024;
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;
const MAX_EDGE = 2400;
const RESIZE_TYPE = 'image/webp';
const RESIZE_QUALITY = 0.9;
const NUDGE = 0.05;

interface Prepared {
  file: File;
  width: number;
  height: number;
}

/** Down to MAX_EDGE and WebP when too big; the original otherwise. Never throws. */
async function prepare(file: File): Promise<Prepared> {
  const untouched = { file, width: 0, height: 0 };
  // A GIF loses its animation in a canvas.
  if (file.type === 'image/gif') return untouched;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return untouched;
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= MAX_EDGE && file.size <= SHRINK_ABOVE_BYTES) {
    const out = { file, width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return out;
  }
  const scale = Math.min(1, MAX_EDGE / longest);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const out = { file, width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return out;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  const original = { file, width: bitmap.width, height: bitmap.height };
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, RESIZE_TYPE, RESIZE_QUALITY),
  );
  if (!blob) return original;
  // Same pixels and no smaller: the original is the better file.
  if (scale === 1 && blob.size >= file.size) return original;
  const stem = file.name.replace(/\.[^.]+$/, '') || 'image';
  const ext = blob.type === RESIZE_TYPE ? 'webp' : 'png';
  return { file: new File([blob], `${stem}.${ext}`, { type: blob.type }), width, height };
}

function measure(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}

function round2(n: number): number {
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
}

function firstImageFile(list: DataTransferItemList | FileList | null | undefined): File | null {
  if (!list) return null;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const file = entry instanceof File ? entry : entry.kind === 'file' ? entry.getAsFile() : null;
    if (file) return file;
  }
  return null;
}

export interface ImageToolsProps {
  image: PageImage | undefined;
  onChange: (img: PageImage | undefined) => void;
  uploadImage: UploadImage;
  siteOrigin: string;
  /** A 64px thumbnail, for people photos and column images. */
  compact?: boolean;
  /** Names the image for screen readers and the drop zone ("Photo", "Image"). */
  label?: string;
}

export function ImageTools({
  image,
  onChange,
  uploadImage,
  siteOrigin,
  compact = false,
  label = 'Image',
}: ImageToolsProps) {
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // An upload takes seconds; the alt text typed meanwhile must survive it.
  const latest = useRef(image);
  useEffect(() => {
    latest.current = image;
  }, [image]);

  const img = image?.src ? image : undefined;

  async function handleFile(file: File) {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image. Choose a JPEG, PNG, WebP or GIF.');
      return;
    }
    if (!ACCEPTED.has(file.type)) {
      setError('This image type is not supported. Choose a JPEG, PNG, WebP or GIF.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That image is larger than 10 MB. Choose a smaller one.');
      return;
    }
    setBusy(true);
    try {
      const prepared = await prepare(file);
      const res = await uploadImage(prepared.file);
      if (!res.ok) {
        setError(res.error || 'The upload did not work. Try again.');
        return;
      }
      let uploaded: PageImage = { ...res.image };
      if (!uploaded.width || !uploaded.height) {
        let dims = { width: prepared.width, height: prepared.height };
        if (!dims.width || !dims.height) {
          const url = URL.createObjectURL(prepared.file);
          dims = await measure(url);
          URL.revokeObjectURL(url);
        }
        if (dims.width && dims.height) uploaded = { ...uploaded, ...dims };
      }
      // Replacing keeps the description; the old focal point belonged to the old picture.
      const old = latest.current;
      const next: PageImage = { ...uploaded };
      delete next.focusX;
      delete next.focusY;
      if (old?.alt) next.alt = old.alt;
      onChange(next);
    } catch {
      setError('The upload did not work. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function onPick() {
    const file = fileRef.current?.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (file) void handleFile(file);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const file = firstImageFile(e.dataTransfer.files);
    if (file) void handleFile(file);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  }

  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    if (busy) return;
    // Pasting into the alt text box is typing, even when the clipboard also holds a picture.
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
    const file = firstImageFile(e.clipboardData.items);
    if (!file) return;
    e.preventDefault();
    void handleFile(file);
  }

  const fx = image?.focusX ?? 0.5;
  const fy = image?.focusY ?? 0.5;
  const focusSet = image?.focusX !== undefined || image?.focusY !== undefined;

  function setFocus(x: number, y: number) {
    if (!image) return;
    onChange({ ...image, focusX: round2(x), focusY: round2(y) });
  }

  function onPreviewClick(e: MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return;
    setFocus((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }

  function onPreviewKey(e: KeyboardEvent<HTMLDivElement>) {
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-NUDGE, 0],
      ArrowRight: [NUDGE, 0],
      ArrowUp: [0, -NUDGE],
      ArrowDown: [0, NUDGE],
    };
    const step = d[e.key];
    if (!step) return;
    e.preventDefault();
    setFocus(fx + step[0], fy + step[1]);
  }

  function resetFocus() {
    if (!image) return;
    const rest = { ...image };
    delete rest.focusX;
    delete rest.focusY;
    onChange(rest);
  }

  const altId = `${uid}-alt`;
  const altMissing = !!img && !img.alt.trim();
  const valueText = `x ${Math.round(fx * 100)}%, y ${Math.round(fy * 100)}%`;

  return (
    <div
      className={`le-set-img${compact ? ' compact' : ''}${dragOver ? ' over' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onPaste={onPaste}
    >
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="le-set-visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onPick}
      />

      {img ? (
        <div className="le-set-img-main">
          <div className="le-set-img-preview-wrap">
            <div
              className="le-set-img-preview"
              role="slider"
              tabIndex={0}
              aria-label={`${label}: focal point, use arrow keys`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(fx * 100)}
              aria-valuetext={valueText}
              title="Click the most important part of the image"
              onClick={onPreviewClick}
              onKeyDown={onPreviewKey}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a Storage or site URL, sized by CSS */}
              <img src={resolveSrc(img.src, siteOrigin)} alt="" draggable={false} />
              <span
                className={`le-set-img-dot${focusSet ? '' : ' unset'}`}
                style={{ left: `${fx * 100}%`, top: `${fy * 100}%` }}
                aria-hidden="true"
              />
            </div>
            {busy && <div className="le-set-img-busy">Uploading...</div>}
          </div>
          <div className="le-set-img-side">
            {!compact && (
              <p className="le-set-hint">
                Click the most important part of the image. It stays in view when the image is cropped.
              </p>
            )}
            <div className="le-set-img-actions">
              <button
                type="button"
                className="btn btn-default btn-sm"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                Replace
              </button>
              <button
                type="button"
                className="btn btn-default btn-sm"
                disabled={busy}
                onClick={() => onChange(undefined)}
              >
                Remove
              </button>
              {focusSet && (
                <button type="button" className="le-set-link" onClick={resetFocus}>
                  Reset focal point
                </button>
              )}
            </div>
            {img.width > 0 && img.height > 0 && (
              <p className="le-set-muted">
                {img.width} × {img.height} px
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="le-set-drop" role="group" tabIndex={0} aria-label={`${label}: drop or paste an image here`}>
          {busy ? (
            <span className="le-set-img-uploading">Uploading...</span>
          ) : (
            <>
              <span className="le-set-drop-text">
                {compact ? 'Drop a photo here or' : 'Drag an image here, paste it, or'}
              </span>
              <button
                type="button"
                className="btn btn-default btn-sm"
                onClick={() => fileRef.current?.click()}
              >
                Choose image
              </button>
              {!compact && <span className="le-set-muted">JPEG, PNG, WebP or GIF, up to 10 MB</span>}
            </>
          )}
        </div>
      )}

      {error && (
        <p className="le-set-error" role="alert">
          {error}
        </p>
      )}

      {img && (
        <div className="le-set-field">
          <label className="le-set-label" htmlFor={altId}>
            Description for screen readers (alt text)
          </label>
          <input
            id={altId}
            className="whova-text-input le-set-input"
            value={img.alt}
            placeholder="For example: Three people talking at a whiteboard"
            onChange={(e) => onChange({ ...img, alt: e.target.value })}
          />
          {altMissing && (
            <p className="le-set-warn" role="status">
              Add a description so people using screen readers know what the image shows.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
