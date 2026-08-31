'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_MAX_EDGE,
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_UPLOAD_BYTES,
} from '@/lib/upload-limits';

/**
 * Pick an image, see it, and submit it inside the form's own FormData.
 *
 * ── Why it stays a real `<input type="file">` ───────────────────────────────
 *
 * The obvious build is a hidden input plus a JavaScript submit handler that
 * POSTs the bytes somewhere. That would break the thing every other editor in
 * this dashboard relies on: a Server Action bound with `useActionState`, which
 * needs the file to arrive in the same FormData as the rest of the fields, in
 * the same round trip, so that "save the exhibitor" is one transaction and not
 * "upload, then hope the save works".
 *
 * So the input is real and named, and the resizing swaps the *contents* of its
 * `files` list via `DataTransfer` before anything is submitted. The form does
 * not know it happened; the server receives a `File` exactly as if the user had
 * picked a small one.
 *
 * ── Why it resizes in the browser ───────────────────────────────────────────
 *
 * Two independent reasons, and either alone would be enough.
 *
 * A Server Action body is capped at 1 MB in Next 15, and raising that cap
 * raises it for every action in the app — including the ones that take a CSV.
 * A 4 MB photograph from somebody's phone is a 413 with no useful message.
 *
 * And the alternative places to resize both cost something real: the Firebase
 * "Resize Images" extension is a thirteenth Cloud Function with its own image
 * in Artifact Registry, which is the one thing in this project that bills at
 * idle; `sharp` in the Next server is a native binary and about 30 MB of
 * dependency. A `<canvas>` is already in the browser, costs nothing, and hands
 * back the preview as a by-product. See `lib/uploads.ts` for the full argument.
 *
 * Two files are deliberately left alone. A GIF loses its animation the moment
 * it goes through a canvas, and an image that is already small and already
 * within the size limit gains nothing from being re-encoded — re-encoding a
 * crisp PNG logo to lossy WebP to save 4 KB is a downgrade, not an
 * optimisation.
 */

export interface ImageFieldProps {
  /** The FormData key the file arrives under. */
  name: string;
  label: string;
  /** What is on the record today, if anything. */
  currentUrl?: string;
  help?: ReactNode;
  /** Longest edge, in pixels, after resizing. */
  maxEdge?: number;
  /** Side of the square preview box. */
  previewSize?: number;
}

/** WebP keeps transparency and is roughly half the size of the JPEG. */
const RESIZE_TYPE = 'image/webp';
const RESIZE_QUALITY = 0.9;

/** Below this, an image already in range is submitted untouched. */
const LEAVE_ALONE_BELOW_BYTES = 200 * 1024;

function kb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Down to `maxEdge` on the longest side, or the original file if that would
 * gain nothing or cannot be done here.
 *
 * Never throws: a browser that cannot decode the image is a browser that should
 * still be able to submit it and let the server have the final say.
 */
async function shrink(file: File, maxEdge: number): Promise<File> {
  if (file.type === 'image/gif') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, maxEdge / longest);
  if (scale === 1 && file.size <= LEAVE_ALONE_BELOW_BYTES) {
    bitmap.close();
    return file;
  }

  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, RESIZE_TYPE, RESIZE_QUALITY),
  );
  // A browser without WebP encoding hands back a PNG or null; in the null case
  // the original is still the honest thing to send.
  if (!blob || blob.size >= file.size) return file;

  const stem = file.name.replace(/\.[^.]+$/, '') || 'image';
  const extension = blob.type === RESIZE_TYPE ? 'webp' : 'png';
  return new File([blob], `${stem}.${extension}`, { type: blob.type });
}

export function ImageField({
  name,
  label,
  currentUrl,
  help,
  maxEdge = DEFAULT_MAX_EDGE,
  previewSize = 96,
}: ImageFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | undefined>(currentUrl);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(false);

  // Object URLs are a leak until revoked, and this component can mint one per
  // file the organizer tries before settling on the right logo.
  const objectUrl = useRef<string | undefined>(undefined);
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  const show = useCallback((url: string | undefined) => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = undefined;
    setPreview(url);
  }, []);

  const onPick = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const picked = event.target.files?.[0];
      setError(undefined);
      setNote(undefined);
      if (!picked) {
        show(currentUrl);
        return;
      }

      setBusy(true);
      try {
        const processed = await shrink(picked, maxEdge);

        if (processed.size > MAX_UPLOAD_BYTES) {
          if (inputRef.current) inputRef.current.value = '';
          show(currentUrl);
          setError(
            `That image is still ${kb(processed.size)} after resizing, and the limit is ` +
              `${kb(MAX_UPLOAD_BYTES)}. Try a PNG or JPEG rather than a screenshot of one.`,
          );
          return;
        }

        // Replace the input's own file list, so the form submits the small one.
        if (processed !== picked && inputRef.current) {
          const transfer = new DataTransfer();
          transfer.items.add(processed);
          inputRef.current.files = transfer.files;
        }

        const url = URL.createObjectURL(processed);
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = url;
        setPreview(url);
        setRemoved(false);
        setNote(
          processed === picked
            ? `${picked.name} · ${kb(picked.size)}`
            : `${picked.name} · ${kb(picked.size)} → ${kb(processed.size)}, resized to fit ${maxEdge}px`,
        );
      } finally {
        setBusy(false);
      }
    },
    [currentUrl, maxEdge, show],
  );

  const onRemove = useCallback(() => {
    if (inputRef.current) inputRef.current.value = '';
    show(undefined);
    setNote(undefined);
    setError(undefined);
    setRemoved(true);
  }, [show]);

  const onUndoRemove = useCallback(() => {
    show(currentUrl);
    setRemoved(false);
  }, [currentUrl, show]);

  return (
    <div className="whova-form-row">
      <label className="whova-form-label" htmlFor={inputId}>
        {label}
      </label>

      <div style={{ alignItems: 'flex-start', display: 'flex', gap: 12 }}>
        <div
          style={{
            alignItems: 'center',
            background: 'var(--surface-alt)',
            border: '1px solid var(--hairline)',
            borderRadius: 4,
            display: 'flex',
            flex: '0 0 auto',
            height: previewSize,
            justifyContent: 'center',
            overflow: 'hidden',
            width: previewSize,
          }}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt=""
              style={{ display: 'block', maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
            />
          ) : (
            <span className="muted" style={{ fontSize: 22 }} aria-hidden="true">
              ▤
            </span>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          {/*
            Visually hidden rather than `display: none`: a hidden input is
            skipped by some browsers' keyboard focus order, and the label is the
            control everybody actually clicks.
          */}
          <input
            ref={inputRef}
            id={inputId}
            name={name}
            type="file"
            accept={IMAGE_ACCEPT_ATTRIBUTE}
            onChange={onPick}
            style={{ height: 1, opacity: 0, position: 'absolute', width: 1 }}
          />

          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <label htmlFor={inputId} className="whova-btn-main secondary small">
              {preview ? 'Replace image' : 'Choose image'}
            </label>
            {preview && !busy && (
              <button type="button" className="linkish" onClick={onRemove}>
                Remove
              </button>
            )}
            {busy && (
              <span className="muted" style={{ fontSize: 12 }}>
                Resizing…
              </span>
            )}
          </div>

          {removed && currentUrl && (
            <p className="whova-form-description">
              The current image will be deleted when you save.{' '}
              <button type="button" className="linkish" onClick={onUndoRemove}>
                Keep it
              </button>
            </p>
          )}
          {note && <p className="whova-form-description">{note}</p>}
          {error && (
            <p className="whova-form-error-message" role="alert">
              {error}
            </p>
          )}
          {help && !error && <p className="whova-form-description">{help}</p>}
        </div>
      </div>

      {/*
        Removal has to be a field of its own: an empty file input and "leave it
        alone" are the same absence in FormData, so without this a save that
        touched no other field would silently keep the old logo forever.
      */}
      <input type="hidden" name={`${name}Removed`} value={removed ? '1' : ''} />
    </div>
  );
}
