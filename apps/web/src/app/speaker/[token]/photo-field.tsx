'use client';

import { useRef, useState, type ChangeEvent } from 'react';

/**
 * The speaker's photo: a file to upload, or a link (T379).
 *
 * The file goes to the dashboard's `/api/speaker-photo`, not to this site,
 * because the dashboard holds the only credential for the storage bucket (see
 * the page's header). What comes back is a URL, which is put in the link box,
 * so the form still posts one `photoURL` either way and nothing about saving
 * or approving changes. The file input has no `name`, so the file itself never
 * travels with the form.
 *
 * Photos over 1600 pixels or 2 MB are redrawn smaller in the browser first,
 * which keeps a phone's 8 MB original from crossing the network for a picture
 * shown at 300 pixels.
 */

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 1600;
const SHRINK_OVER_BYTES = 2 * 1024 * 1024;

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done' } | { kind: 'error'; message: string };

async function shrink(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const edge = Math.max(bitmap.width, bitmap.height);
  if (edge <= MAX_EDGE && file.size <= SHRINK_OVER_BYTES) return file;
  const scale = Math.min(1, MAX_EDGE / edge);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.fillStyle = '#fff'; // A transparent PNG as a JPEG would otherwise turn black.
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  return blob && blob.size < file.size ? blob : file;
}

const looksLikeLink = (v: string) => /^https?:\/\/\S+$/i.test(v.trim());

export function PhotoField({
  token,
  uploadUrl,
  initialUrl,
  contactEmail,
}: {
  token: string;
  uploadUrl: string;
  initialUrl: string;
  contactEmail: string;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [broken, setBroken] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!TYPES.includes(file.type)) {
      setStatus({ kind: 'error', message: 'That file is not a JPEG, PNG or WebP image.' });
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus({ kind: 'error', message: 'That image is over 10 MB. Pick a smaller one.' });
      return;
    }
    setStatus({ kind: 'busy' });
    try {
      const blob = await shrink(file);
      const body = new FormData();
      body.set('token', token);
      body.set('file', blob, blob === file ? file.name : 'photo.jpg');
      const res = await fetch(uploadUrl, { method: 'POST', body });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        setStatus({ kind: 'error', message: json.error ?? 'That photo did not upload. Try again.' });
        return;
      }
      setBroken(false);
      setUrl(json.url);
      setStatus({ kind: 'done' });
    } catch {
      setStatus({ kind: 'error', message: 'That photo did not upload. Check your connection and try again.' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const preview = looksLikeLink(url) && !broken;

  return (
    <div className="field">
      <label htmlFor="photoFile">Photo</label>
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element -- any host the speaker links to, at its own size
        <img
          src={url}
          alt="Your photo"
          width={120}
          height={120}
          style={{ display: 'block', objectFit: 'cover', borderRadius: 8, marginBottom: 10, background: '#f1f1f1' }}
          onError={() => setBroken(true)}
        />
      )}
      <input
        ref={fileRef}
        id="photoFile"
        type="file"
        accept={TYPES.join(',')}
        onChange={onFile}
        disabled={status.kind === 'busy'}
      />
      <p className="hint" role="status" aria-live="polite">
        {status.kind === 'busy'
          ? 'Uploading…'
          : status.kind === 'done'
            ? 'Uploaded. Press Send to the organizers to keep it.'
            : 'A headshot, square if you have one. JPEG, PNG or WebP, up to 10 MB.'}
      </p>
      {status.kind === 'error' && (
        <p className="hint" role="alert" style={{ color: '#991b1b' }}>
          {status.message}
        </p>
      )}
      <label htmlFor="photoURL" style={{ marginTop: 12 }}>
        Or a link to your photo
      </label>
      <input
        id="photoURL"
        name="photoURL"
        type="url"
        maxLength={500}
        placeholder="https://"
        value={url}
        onChange={(e) => {
          setBroken(false);
          setUrl(e.target.value);
        }}
      />
      <p className="hint">
        If neither works, email the photo to{' '}
        <a href={`mailto:${contactEmail}?subject=Speaker photo`}>{contactEmail}</a> and we will add it.
      </p>
    </div>
  );
}
