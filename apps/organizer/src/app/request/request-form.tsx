'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  CHANGE_REQUEST_API_PATH,
  DESCRIPTION_MAX,
  HONEYPOT_FIELD,
  MAX_SCREENSHOTS,
  SCREENSHOT_ACCEPT,
  SCREENSHOT_MAX_BYTES,
  type FieldName,
} from '@/lib/change-requests-core';

type Errors = Partial<Record<FieldName, string>>;

const MB = 1024 * 1024;

function size(bytes: number): string {
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The form, and the page that replaces it once a request is saved. The same
 * pattern as the speaker profile's sent view (T405): the form goes away, a
 * heading takes focus, and one button starts a new request.
 */
export function RequestForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [length, setLength] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (sentTo) heading.current?.focus();
  }, [sentTo]);

  function pick(list: FileList | null) {
    const next = [...files, ...Array.from(list ?? [])].slice(0, MAX_SCREENSHOTS + 1);
    setFiles(next.slice(0, MAX_SCREENSHOTS));
    if (fileInput.current) fileInput.current.value = '';
    const tooBig = next.find((f) => f.size > SCREENSHOT_MAX_BYTES);
    setErrors((e) => ({
      ...e,
      screenshots:
        next.length > MAX_SCREENSHOTS
          ? `Attach up to ${MAX_SCREENSHOTS} screenshots.`
          : tooBig
            ? `${tooBig.name} is ${size(tooBig.size)}. Each screenshot can be up to ${SCREENSHOT_MAX_BYTES / MB} MB.`
            : undefined,
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (files.some((f) => f.size > SCREENSHOT_MAX_BYTES)) {
      setErrors((e) => ({ ...e, screenshots: `Each screenshot can be up to ${SCREENSHOT_MAX_BYTES / MB} MB.` }));
      return;
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    data.delete('screenshots');
    for (const f of files) data.append('screenshots', f);
    const email = String(data.get('email') ?? '').trim();

    setPending(true);
    setBanner(null);
    try {
      const res = await fetch(CHANGE_REQUEST_API_PATH, { method: 'POST', body: data });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; fields?: Errors };
      if (res.ok && body.ok) {
        setErrors({});
        setSentTo(email);
        return;
      }
      setErrors(body.fields ?? {});
      setBanner(body.error ?? 'Your request could not be sent. Try again.');
    } catch {
      setBanner('Your request could not be sent. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  function startOver() {
    setSentTo(null);
    setFiles([]);
    setLength(0);
    setErrors({});
    setBanner(null);
  }

  if (sentTo) {
    return (
      <div className="request-sent">
        <div className="request-tick" aria-hidden="true">
          ✓
        </div>
        <h1 ref={heading} tabIndex={-1} className="whova-header__feature request-title">
          Thanks, we have your request
        </h1>
        <p className="body-2" role="status">
          We will email <strong>{sentTo}</strong> when the change is built, and again when it is live.
          You can close this page.
        </p>
        <button type="button" className="whova-btn-main" onClick={startOver}>
          Send another request
        </button>
      </div>
    );
  }

  const fieldClass = (name: FieldName) => `whova-text-input${errors[name] ? ' error' : ''}`;

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="whova-header__feature request-title">Request a change</h1>
      <p className="body-2 request-lede">
        Tell us what to change on the Knowledge Graph Conference website. No account needed.
      </p>

      {banner ? (
        <p className="whova-form-error-message request-banner" role="alert">
          {banner}
        </p>
      ) : null}

      <div className="whova-form-group">
        <div className="whova-form-label">
          <label htmlFor="email">Your email</label>
          <span className="whova-form-label-suffix">*</span>
        </div>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
          className={fieldClass('email')}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'email-error' : undefined}
        />
        {errors.email ? (
          <p id="email-error" className="whova-form-error-message">
            {errors.email}
          </p>
        ) : null}
      </div>

      <div className="whova-form-group">
        <div className="whova-form-label">
          <label htmlFor="description">What should change?</label>
          <span className="whova-form-label-suffix">*</span>
        </div>
        <textarea
          id="description"
          name="description"
          rows={6}
          maxLength={DESCRIPTION_MAX}
          required
          className={`${fieldClass('description')} request-textarea`}
          onChange={(e) => setLength(e.target.value.length)}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby="description-count"
        />
        <div id="description-count" className="request-count">
          {length.toLocaleString('en-US')} / {DESCRIPTION_MAX.toLocaleString('en-US')}
        </div>
        {errors.description ? <p className="whova-form-error-message">{errors.description}</p> : null}
      </div>

      <div className="whova-form-group">
        <div className="whova-form-label">
          <label htmlFor="pageUrl">Link to the page</label>
        </div>
        <input
          id="pageUrl"
          name="pageUrl"
          type="url"
          inputMode="url"
          placeholder="https://www.knowledgegraph.tech/…"
          maxLength={2000}
          className={fieldClass('pageUrl')}
          aria-invalid={errors.pageUrl ? true : undefined}
        />
        {errors.pageUrl ? <p className="whova-form-error-message">{errors.pageUrl}</p> : null}
      </div>

      <div className="whova-form-group">
        <div className="whova-form-label">
          <label htmlFor="screenshots">Screenshots</label>
        </div>
        <div id="screenshots-hint" className="whova-checkbox-description request-hint">
          Up to {MAX_SCREENSHOTS}, PNG, JPEG or WebP, {SCREENSHOT_MAX_BYTES / MB} MB each.
        </div>
        {files.length ? (
          <ul className="request-files">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span className="request-file-name">{f.name}</span>
                <span className="request-file-size">{size(f.size)}</span>
                <button
                  type="button"
                  className="whova-btn-link"
                  onClick={() => {
                    const next = files.filter((_, j) => j !== i);
                    setFiles(next);
                    setErrors((e) => ({ ...e, screenshots: next.some((x) => x.size > SCREENSHOT_MAX_BYTES) ? e.screenshots : undefined }));
                  }}
                  aria-label={`Remove ${f.name}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {files.length < MAX_SCREENSHOTS ? (
          <input
            ref={fileInput}
            id="screenshots"
            name="screenshots"
            type="file"
            accept={SCREENSHOT_ACCEPT}
            multiple
            className="request-file-input"
            aria-describedby="screenshots-hint"
            onChange={(e) => pick(e.target.files)}
          />
        ) : null}
        {/*
          The native control is visually hidden, not removed: it keeps its
          focus, its keyboard and its screen-reader name, and this label is
          the part a person sees. Its "No file chosen" text never shows beside
          a list that says otherwise (gate T429).
        */}
        {files.length < MAX_SCREENSHOTS ? (
          <label htmlFor="screenshots" className="whova-btn-main secondary request-file-button">
            {files.length ? 'Add another screenshot' : 'Choose screenshots'}
          </label>
        ) : null}
        {errors.screenshots ? <p className="whova-form-error-message">{errors.screenshots}</p> : null}
      </div>

      {/* The honeypot. Off screen, out of the tab order, ignored by password managers. */}
      <div className="request-trap" aria-hidden="true">
        <label htmlFor={HONEYPOT_FIELD}>Leave this empty</label>
        <input id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <button type="submit" className="whova-btn-main primary request-submit" disabled={pending}>
        {pending ? 'Sending...' : 'Send request'}
      </button>
    </form>
  );
}
