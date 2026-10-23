'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { LearnPageContent, LearnSection } from '@kgc/shared';
import { summarizeChanges, type Selection, type Warning } from '@/lib/learn-editor-core';
import type { PublishBlocker } from '@/lib/learn-library-edit-core';
import { fitZoom } from '@/lib/learn-shell-core';
import { loadLearnVersionAction, restoreLearnVersionAction, type LearnVersionSummary } from './api';
import { ReadOnlyPreview } from './read-only-preview';

/**
 * Open modals, newest last. Only the top one answers Escape and Tab, so the
 * image editor opened over the media library closes alone (T318).
 */
const modalStack: object[] = [];

/** A modal: focus moves in, Tab stays in, Escape closes, focus goes back after. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // A ref, so a parent passing a new arrow each render does not re-run the
  // effect and pull focus back to the first field while someone types.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const me = {};
    modalStack.push(me);
    const back = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const focusables = () =>
      Array.from(
        box?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    (box?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== me) return;
      if (e.key === 'Escape') {
        // A nested popover (a menu, a picker) closes first.
        if (e.defaultPrevented) return;
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab') {
        const list = focusables();
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(me), 1);
      back?.focus?.();
    };
  }, []);

  return (
    <div className="le-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div
        className={`le-modal${wide ? ' is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
      >
        <div className="le-modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="le-icon-btn" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="le-modal-body">{children}</div>
        {footer && <div className="le-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

function ChangeGroup({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="le-change-group">
      <h3>
        {title} <span className="le-count">{items.length}</span>
      </h3>
      <ul>
        {items.slice(0, 12).map((t, i) => (
          <li key={`${t}-${i}`}>{t}</li>
        ))}
        {items.length > 12 && <li className="le-muted">and {items.length - 12} more</li>}
      </ul>
    </div>
  );
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function PublishDialog({
  before,
  firstPublish,
  after,
  blockers,
  warnings,
  publishedAt,
  onPublish,
  onClose,
  onShow,
}: {
  before: LearnPageContent | null;
  firstPublish: boolean;
  /** The draft with its saved sections expanded, as Publish puts it live. */
  after: LearnPageContent;
  /** What the server refuses to publish (`draftPublishBlockers`), worked out on the expanded draft. */
  blockers: PublishBlocker[];
  warnings: Warning[];
  publishedAt?: number;
  onPublish: (note: string) => Promise<string | null>;
  onClose: () => void;
  onShow: (sel: Selection) => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const s = summarizeChanges(before, after);

  const go = async () => {
    setBusy(true);
    setError(null);
    const err = await onPublish(note);
    setBusy(false);
    if (err) setError(err);
    else setDone(true);
  };

  if (done)
    return (
      <Modal
        title="Published"
        onClose={onClose}
        footer={
          <button type="button" className="whova-btn-main small" onClick={onClose} data-autofocus>
            Done
          </button>
        }
      >
        <p>The new page is live. Visitors see it within a minute.</p>
      </Modal>
    );

  return (
    <Modal
      title="Publish the Learn page"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-default" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="whova-btn-main small"
            onClick={() => void go()}
            disabled={busy || blockers.length > 0 || (s.total === 0 && before !== null)}
          >
            {busy ? 'Publishing...' : 'Publish now'}
          </button>
        </>
      }
    >
      <p className="le-muted">
        {firstPublish
          ? 'This is the first publish from here. Changes are compared with the built-in page the website shows now.'
          : publishedAt
            ? `Changes since the last publish on ${formatDate(publishedAt)}.`
            : 'Changes compared with the live page.'}
      </p>

      {s.total === 0 && before !== null ? (
        <p>
          {firstPublish
            ? 'The draft is the same as the page the website shows now.'
            : 'Nothing has changed since the last publish.'}
        </p>
      ) : (
        <div className="le-changes" aria-label="What changed">
          {s.pageEdited && <ChangeGroup title="Page title or description" items={['Edited']} />}
          <ChangeGroup title="Sections added" items={s.sectionsAdded} />
          <ChangeGroup title="Sections removed" items={s.sectionsRemoved} />
          <ChangeGroup title="Sections changed" items={s.sectionsEdited} />
          <ChangeGroup title="Sections moved" items={s.sectionsMoved} />
          <ChangeGroup title="Blocks added" items={s.blocksAdded} />
          <ChangeGroup title="Blocks removed" items={s.blocksRemoved} />
          <ChangeGroup title="Blocks changed" items={s.blocksEdited} />
          <ChangeGroup title="Blocks moved" items={s.blocksMoved} />
        </div>
      )}

      {blockers.length > 0 && (
        <div className="whova-banner danger" role="alert">
          <div>
            <strong>Finish these blocks to publish</strong>
            <ul className="le-problems">
              {blockers.map((b, i) => (
                <li key={i}>
                  {b.sectionId ? (
                    <button
                      type="button"
                      className="linkish"
                      onClick={() =>
                        onShow(
                          b.blockId
                            ? { kind: 'block', sectionId: b.sectionId!, blockId: b.blockId }
                            : { kind: 'section', sectionId: b.sectionId! },
                        )
                      }
                    >
                      {b.message}
                    </button>
                  ) : (
                    b.message
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="whova-banner warning" role="note">
          <div>
            <strong>Worth fixing first</strong>
            <ul className="le-problems">
              {warnings.slice(0, 6).map((w, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() =>
                      onShow(
                        w.blockId
                          ? { kind: 'block', sectionId: w.sectionId, blockId: w.blockId }
                          : { kind: 'section', sectionId: w.sectionId },
                      )
                    }
                  >
                    {w.message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="whova-form-group">
        <label className="whova-form-label" htmlFor="le-publish-note">
          Note for the history (optional)
        </label>
        <input
          id="le-publish-note"
          className="whova-text-input"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          placeholder="For example: added the spring cohort dates"
          data-autofocus
        />
      </div>
      {error && (
        <div className="whova-banner danger" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}

export function DiscardDialog({
  onDiscard,
  onClose,
}: {
  onDiscard: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title="Discard the draft?"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-default" onClick={onClose} disabled={busy} data-autofocus>
            Keep editing
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const err = await onDiscard();
              setBusy(false);
              if (err) setError(err);
              else onClose();
            }}
          >
            {busy ? 'Discarding...' : 'Discard draft'}
          </button>
        </>
      }
    >
      <p>The draft goes back to what is on the website now. Everything changed since the last publish is thrown away.</p>
      <p className="le-muted">Changed your mind straight after? Undo brings it back while this window is open.</p>
      {error && (
        <div className="whova-banner danger" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}

/**
 * Leaving the editor when the latest words could not be saved (T332, E F2):
 * a conflict, a refused save or no connection. Staying is the default.
 */
export function LeaveDialog({
  conflict,
  onLeave,
  onClose,
}: {
  /** Someone else saved meanwhile, which is why the words are not saved. */
  conflict: boolean;
  onLeave: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Leave without saving?"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-default" onClick={onClose} data-autofocus>
            Stay
          </button>
          <button type="button" className="btn btn-danger" onClick={onLeave}>
            Leave anyway
          </button>
        </>
      }
    >
      <p>Your latest changes are not saved. If you leave now, they are lost.</p>
      <p className="le-muted">
        {conflict
          ? 'Someone else saved this page while you were editing. Stay, then choose which version to keep.'
          : 'Stay and fix what the message at the top names, or try again in a moment.'}
      </p>
    </Modal>
  );
}

/** The version preview is a desktop page drawn at this zoom, or smaller to fit its box (E F14). */
const HISTORY_PAGE = 1280;
const HISTORY_ZOOM = 0.42;

function useBoxZoom(pageWidth: number, max: number) {
  const [el, ref] = useState<HTMLElement | null>(null);
  const [zoom, setZoom] = useState(max);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setZoom(fitZoom(entry.contentRect.width, pageWidth, max)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, pageWidth, max]);
  return { ref, zoom };
}

export function HistoryDialog({
  versions,
  siteOrigin,
  library = null,
  hasUnpublished = false,
  onRestored,
  onClose,
}: {
  versions: LearnVersionSummary[];
  siteOrigin: string;
  /** Saved sections, to draw the version's linked sections (null while loading). */
  library?: ReadonlyMap<string, LearnSection> | null;
  /** The draft has changes that are not live; restoring replaces them, so it asks first. */
  hasUnpublished?: boolean;
  onRestored: (draft: LearnPageContent, revision: number) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(versions[0]?.id ?? null);
  const [content, setContent] = useState<LearnPageContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const frame = useBoxZoom(HISTORY_PAGE, HISTORY_ZOOM);

  useEffect(() => {
    if (!picked) return;
    let live = true;
    setLoading(true);
    setError(null);
    loadLearnVersionAction(picked)
      .then((res) => {
        if (!live) return;
        if (res.ok) setContent(res.content);
        else {
          setContent(null);
          setError(res.error);
        }
      })
      .catch(() => live && setError('Could not load that version.'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [picked]);

  const restore = async () => {
    if (!picked) return;
    if (hasUnpublished && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy(true);
    setError(null);
    const res = await restoreLearnVersionAction(picked);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onRestored(res.draft, res.revision);
    onClose();
  };

  return (
    <Modal
      title="Version history"
      onClose={onClose}
      wide
      footer={
        confirming ? (
          <div className="le-history-confirm" role="alert">
            <span>Restore this version? Your unpublished changes will be replaced. You can undo this.</span>
            <span className="le-history-confirm-actions">
              <button type="button" className="btn btn-default" onClick={() => setConfirming(false)} autoFocus>
                Cancel
              </button>
              <button type="button" className="whova-btn-main small" onClick={() => void restore()}>
                Restore
              </button>
            </span>
          </div>
        ) : (
          <>
            <button type="button" className="btn btn-default" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="whova-btn-main small"
              onClick={() => void restore()}
              disabled={!picked || busy || loading || !content}
            >
              {busy ? 'Restoring...' : 'Restore this version'}
            </button>
          </>
        )
      }
    >
      {versions.length === 0 ? (
        <p>Nothing has been published from here yet. Each publish adds a version you can go back to.</p>
      ) : (
        <div className="le-history">
          <ul className="le-history-list" role="listbox" aria-label="Published versions">
            {versions.map((v, i) => (
              <li
                key={v.id}
                role="option"
                aria-selected={picked === v.id}
                tabIndex={0}
                className={picked === v.id ? 'is-on' : ''}
                onClick={() => {
                  setPicked(v.id);
                  setConfirming(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setPicked(v.id);
                  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const next = versions[i + (e.key === 'ArrowDown' ? 1 : -1)];
                    if (next) {
                      setPicked(next.id);
                      (e.currentTarget.parentElement?.children[i + (e.key === 'ArrowDown' ? 1 : -1)] as HTMLElement | undefined)?.focus();
                    }
                  }
                }}
              >
                <span className="le-history-when">
                  {formatDate(v.publishedAt)}
                  {i === 0 && <span className="le-live-tag">Live</span>}
                </span>
                <span className="le-history-who">{v.publishedBy}</span>
                {v.note && <span className="le-history-note">{v.note}</span>}
              </li>
            ))}
          </ul>
          <div className="le-history-preview" aria-live="polite" aria-busy={loading} ref={frame.ref}>
            {error && (
              <div className="whova-banner danger" role="alert">
                {error}
              </div>
            )}
            {loading && <p className="le-muted">Loading...</p>}
            {content && !loading && (
              <ReadOnlyPreview
                content={content}
                library={library}
                what="version"
                siteOrigin={siteOrigin}
                device="desktop"
                width={HISTORY_PAGE}
                zoom={frame.zoom}
                frameClassName="le-history-frame"
              />
            )}
          </div>
        </div>
      )}
      <p className="le-muted le-history-help">Restoring puts the old version in the draft. The website does not change until you publish.</p>
    </Modal>
  );
}
