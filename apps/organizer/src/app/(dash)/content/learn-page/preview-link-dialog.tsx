'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createLearnPreviewLinkAction, revokeLearnPreviewLinkAction } from './api';
import { Modal } from './dialogs';
import './extras.css';

const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';

export function PreviewLinkDialog({
  siteOrigin,
  token,
  onToken,
  onClose,
}: {
  siteOrigin: string;
  token: string | null | undefined;
  onToken: (token: string | null) => void;
  onClose: () => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState<null | 'create' | 'revoke'>(null);
  const [confirm, setConfirm] = useState<null | 'rotate' | 'revoke'>(null);
  const [copied, setCopied] = useState<null | 'yes' | 'manual'>(null);
  const [error, setError] = useState<string | null>(null);
  const url = token ? `${siteOrigin}/learn?preview=${encodeURIComponent(token)}` : '';

  // The button that was pressed disappears when the link appears or goes, so
  // focus moves to the new first control instead of falling to the page.
  const seenToken = useRef(token);
  useEffect(() => {
    if (seenToken.current === token) return;
    seenToken.current = token;
    firstRef.current?.focus();
  }, [token]);

  // "Copied" fades back to "Copy" so a second copy also gets feedback.
  useEffect(() => {
    if (copied !== 'yes') return;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const create = async () => {
    setBusy('create');
    setError(null);
    try {
      const res = await createLearnPreviewLinkAction();
      if (res.ok) {
        onToken(res.token);
        setConfirm(null);
        setCopied(null);
      } else setError(res.error);
    } catch {
      setError(NETWORK_ERROR);
    }
    setBusy(null);
  };

  const revoke = async () => {
    setBusy('revoke');
    setError(null);
    try {
      const res = await revokeLearnPreviewLinkAction();
      if (res.ok) {
        onToken(null);
        setConfirm(null);
      } else setError(res.error);
    } catch {
      setError(NETWORK_ERROR);
    }
    setBusy(null);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('yes');
    } catch {
      // The clipboard can be blocked (an insecure origin, a browser setting).
      // Select the text so a keyboard copy works instead.
      inputRef.current?.select();
      setCopied('manual');
    }
  };

  return (
    <Modal
      title="Share the draft"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-default" onClick={onClose}>
          Done
        </button>
      }
    >
      <p>
        A preview link lets someone see the draft without signing in. Nothing on the public page changes. Anyone with the
        link can view the draft until you turn the link off.
      </p>

      {!token ? (
        <button
          type="button"
          className="whova-btn-main small"
          ref={firstRef}
          onClick={() => void create()}
          disabled={busy !== null}
          data-autofocus
        >
          {busy === 'create' ? 'Creating...' : 'Create a preview link'}
        </button>
      ) : (
        <>
          <div className="whova-form-group">
            <label className="whova-form-label" htmlFor={inputId}>
              Preview link
            </label>
            <div className="le-x-link-row">
              <input
                id={inputId}
                ref={inputRef}
                className="whova-text-input le-x-link-input"
                value={url}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
              />
              <button type="button" className="whova-btn-main small" ref={firstRef} onClick={() => void copy()} data-autofocus>
                {copied === 'yes' ? 'Copied' : 'Copy'}
              </button>
              <a className="btn btn-default btn-sm" href={url} target="_blank" rel="noreferrer">
                Open
                <span className="le-x-sr"> (opens in a new tab)</span>
              </a>
            </div>
            <p className="le-x-live" aria-live="polite">
              {copied === 'yes' ? 'Link copied.' : copied === 'manual' ? 'The link is selected. Press Cmd+C or Ctrl+C to copy it.' : ''}
            </p>
          </div>

          {confirm ? (
            <div className="le-x-confirm" role="group" aria-label={confirm === 'rotate' ? 'Make a new link' : 'Turn off the link'}>
              <span>
                {confirm === 'rotate'
                  ? 'Make a new link? The current link stops working, so anyone using it needs the new one.'
                  : 'Turn off the link? Anyone using it can no longer see the draft.'}
              </span>
              <button
                type="button"
                className={confirm === 'rotate' ? 'whova-btn-main small' : 'btn btn-danger btn-sm'}
                onClick={() => void (confirm === 'rotate' ? create() : revoke())}
                disabled={busy !== null}
                autoFocus
              >
                {busy === 'create'
                  ? 'Making...'
                  : busy === 'revoke'
                    ? 'Turning off...'
                    : confirm === 'rotate'
                      ? 'Make a new link'
                      : 'Turn off'}
              </button>
              <button type="button" className="btn btn-default btn-sm" onClick={() => setConfirm(null)} disabled={busy !== null}>
                Keep this link
              </button>
            </div>
          ) : (
            <div className="le-x-link-manage">
              <button type="button" className="btn btn-default btn-sm" onClick={() => setConfirm('rotate')}>
                Make a new link
              </button>
              <button type="button" className="btn btn-default btn-sm le-x-danger-text" onClick={() => setConfirm('revoke')}>
                Turn off the link
              </button>
            </div>
          )}
        </>
      )}

      {error && (
        <div className="whova-banner danger le-x-gap-top" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
