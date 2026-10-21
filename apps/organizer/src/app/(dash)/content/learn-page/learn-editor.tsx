'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LearnPageContent } from '@kgc/shared';
import {
  contentEqual,
  contentWarnings,
  pushEdit,
  redo,
  repairSelection,
  replaceInHistory,
  startHistory,
  undo,
  type EditAction,
  type History,
  type Selection,
} from '@/lib/learn-editor-core';
import {
  loadLearnEditorAction,
  publishLearnPageAction,
  revertLearnDraftAction,
  saveLearnDraftAction,
  uploadLearnImageAction,
  type LearnEditorState,
  type LearnVersionSummary,
} from './api';
import { DEVICE_WIDTH, type Device, type UploadImage } from './editor-types';
import { DiscardDialog, HistoryDialog, PublishDialog } from './dialogs';
import { Outline } from './outline';
import { LearnPreview } from './preview';
import { SettingsPanel } from './settings-panel';
import './editor.css';

/**
 * Content › Learn page: the editor shell (T310).
 *
 * Owns everything that is not a pane: the undo stack, the autosave, the
 * conflict when two people edit at once, publishing and history. The three
 * panes (outline, preview, settings) only ever see the current content and
 * hand edits back as `EditAction`s, so every change, wherever it was made,
 * lands on one undo stack and in one autosave.
 *
 * It takes the whole window rather than the dashboard's 840px content box:
 * a page preview, an outline and a settings column do not fit beside a 200px
 * rail. The dashboard behind it is made `inert` while it is open, so the
 * keyboard cannot wander into chrome nobody can see.
 */

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';
type MobileTab = 'outline' | 'preview' | 'settings';
type Dialog = null | 'publish' | 'history' | 'discard';

/** How long typing has to pause before the draft is saved. */
const AUTOSAVE_MS = 1500;
/** Below this window width the three panes become tabs. */
const NARROW = 900;

/** Drops keys set to `undefined` ("back to default"), so they cannot survive a merge write. */
function plain(content: LearnPageContent): LearnPageContent {
  return JSON.parse(JSON.stringify(content)) as LearnPageContent;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Makes everything outside `root` inert while the editor is open, and puts it back after. */
function useInertOutside(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const changed: HTMLElement[] = [];
    let node = root.current;
    while (node && node.parentElement && node !== document.body) {
      for (const sib of Array.from(node.parentElement.children)) {
        if (sib !== node && sib instanceof HTMLElement && !sib.inert && sib.tagName !== 'SCRIPT') {
          sib.inert = true;
          changed.push(sib);
        }
      }
      node = node.parentElement;
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      for (const el of changed) el.inert = false;
      document.body.style.overflow = overflow;
    };
  }, [root]);
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NARROW - 1}px)`);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return narrow;
}

/** Scales a fixed-width page frame down to fit its pane, like a browser's zoom. */
function useFitScale(width: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const avail = entry.contentRect.width - 32;
      setScale(Math.min(1, Math.max(0.2, avail / width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return { ref, scale };
}

export function LearnEditor({
  initial,
  siteOrigin,
}: {
  initial: LearnEditorState;
  siteOrigin: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useInertOutside(rootRef);
  const narrow = useNarrow();

  const [history, setHistory] = useState<History>(() => startHistory(initial.doc.draft));
  const [selection, setSelection] = useState<Selection>({ kind: 'page' });
  const [device, setDevice] = useState<Device>('desktop');
  const [tab, setTab] = useState<MobileTab>('preview');
  const [dialog, setDialog] = useState<Dialog>(null);

  const [published, setPublished] = useState<LearnPageContent | null>(initial.doc.published);
  const [publishedAt, setPublishedAt] = useState<number | undefined>(initial.doc.publishedAt);
  const [versions, setVersions] = useState<LearnVersionSummary[]>(initial.versions);

  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [savedAt, setSavedAt] = useState<number | undefined>(initial.doc.draftUpdatedAt || undefined);
  const [error, setError] = useState<{ message: string; problems?: string[] } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // What the server holds, so autosave sends only real changes. Refs, not
  // state: the save loop reads them after awaits, when state would be stale.
  const revision = useRef(initial.doc.revision);
  const lastSaved = useRef<LearnPageContent>(initial.doc.draft);
  const inFlight = useRef(false);
  const latest = useRef(history.present);
  latest.current = history.present;

  const content = history.present;
  const warnings = useMemo(() => contentWarnings(content), [content]);
  // What visitors see now. With no document yet, the website renders the
  // built-in page, which is exactly what the editor opened with.
  const [baseline] = useState<LearnPageContent | null>(() => (initial.exists ? null : initial.doc.draft));
  const live = published ?? baseline;
  const unpublished = !contentEqual(content, live);

  useEffect(() => {
    if (narrow) setDevice((d) => (d === 'desktop' ? 'phone' : d));
  }, [narrow]);

  // ── Editing ────────────────────────────────────────────────────────────
  const edit = useCallback((action: EditAction) => {
    setHistory((h) => pushEdit(h, action, Date.now()));
  }, []);

  const select = useCallback(
    (sel: Selection) => {
      setSelection(sel);
      // On a phone the outline is a way to get to the settings.
      if (narrow && tab === 'outline' && sel.kind !== 'page') setTab('settings');
    },
    [narrow, tab],
  );

  // A removed or moved block takes the selection with it.
  useEffect(() => {
    setSelection((sel) => {
      const next = repairSelection(content, sel);
      return JSON.stringify(next) === JSON.stringify(sel) ? sel : next;
    });
  }, [content]);

  const doUndo = useCallback(() => setHistory(undo), []);
  const doRedo = useCallback(() => setHistory(redo), []);

  // ── Autosave ───────────────────────────────────────────────────────────
  const save = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return false;
    const sending = latest.current;
    if (contentEqual(sending, lastSaved.current)) {
      setSaveState('saved');
      return true;
    }
    inFlight.current = true;
    setSaveState('saving');
    try {
      const res = await saveLearnDraftAction(plain(sending), revision.current);
      if (res.ok) {
        revision.current = res.revision;
        lastSaved.current = sending;
        setSavedAt(res.savedAt);
        setError(null);
        const caughtUp = contentEqual(latest.current, sending);
        setSaveState(caughtUp ? 'saved' : 'unsaved');
        return true;
      }
      if (res.conflict) {
        setSaveState('conflict');
        return false;
      }
      setSaveState('error');
      setError({ message: res.error, problems: res.problems });
      return false;
    } catch {
      setSaveState('error');
      setError({ message: 'Could not reach the server. Your changes are still here; we will try again.' });
      return false;
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (saveState === 'conflict') return;
    if (contentEqual(content, lastSaved.current)) {
      if (saveState === 'unsaved') setSaveState('saved');
      return;
    }
    if (saveState === 'saved') setSaveState('unsaved');
    const t = setTimeout(() => void save(), saveState === 'error' ? AUTOSAVE_MS * 4 : AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [content, save, saveState]);

  const dirty = saveState !== 'saved';
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** Fresh state from the server: after a conflict, or to start over. */
  const adopt = useCallback((state: LearnEditorState, keepUndo: boolean) => {
    revision.current = state.doc.revision;
    lastSaved.current = state.doc.draft;
    setHistory((h) => (keepUndo ? replaceInHistory(h, state.doc.draft) : startHistory(state.doc.draft)));
    setPublished(state.doc.published);
    setPublishedAt(state.doc.publishedAt);
    setVersions(state.versions);
    setSavedAt(state.doc.draftUpdatedAt || undefined);
    setSaveState('saved');
    setError(null);
  }, []);

  const loadTheirs = useCallback(async () => {
    const res = await loadLearnEditorAction();
    if (res.ok) adopt(res.state, true);
    else setError({ message: res.error });
  }, [adopt]);

  const keepMine = useCallback(async () => {
    const res = await loadLearnEditorAction();
    if (!res.ok) {
      setError({ message: res.error });
      return;
    }
    revision.current = res.state.doc.revision;
    lastSaved.current = res.state.doc.draft;
    setPublished(res.state.doc.published);
    setVersions(res.state.versions);
    setSaveState('unsaved');
    void save();
  }, [save]);

  // ── Keyboard ───────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || dialog) return;
      const key = e.key.toLowerCase();
      // Inside the in-place text editor, its own undo handles the letters.
      const inRich = (e.target as HTMLElement | null)?.closest?.('.ProseMirror');
      if (key === 'z' && !inRich) {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if (key === 'y' && !inRich) {
        e.preventDefault();
        doRedo();
      } else if (key === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, doUndo, doRedo, save]);

  const uploadImage: UploadImage = useCallback(async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await uploadLearnImageAction(fd);
      return res.ok ? { ok: true, image: res.image } : { ok: false, error: res.error };
    } catch {
      return { ok: false, error: 'The upload did not finish. Check the connection and try again.' };
    }
  }, []);

  // ── Publish, discard, history ──────────────────────────────────────────
  const onPublish = useCallback(
    async (note: string): Promise<string | null> => {
      const sending = latest.current;
      const res = await publishLearnPageAction({
        baseRevision: revision.current,
        content: plain(sending),
        note: note.trim() || undefined,
      });
      if (!res.ok) {
        if (res.conflict) setSaveState('conflict');
        return res.problems?.length ? `${res.error} ${res.problems.join('; ')}` : res.error;
      }
      revision.current = res.revision;
      lastSaved.current = sending;
      setPublished(sending);
      setPublishedAt(res.publishedAt);
      setSavedAt(res.publishedAt);
      setSaveState(contentEqual(latest.current, sending) ? 'saved' : 'unsaved');
      setVersions((v) => [
        { id: res.versionId, publishedAt: res.publishedAt, publishedBy: 'You', note: note.trim() || undefined },
        ...v,
      ]);
      setFlash('Published. The live page updates within a minute.');
      return null;
    },
    [],
  );

  const onDiscard = useCallback(async (): Promise<string | null> => {
    const res = await revertLearnDraftAction();
    if (!res.ok) return res.error;
    revision.current = res.revision;
    lastSaved.current = res.draft;
    setHistory((h) => replaceInHistory(h, res.draft));
    setSaveState('saved');
    setFlash('Draft discarded. Undo brings your changes back.');
    return null;
  }, []);

  const onRestored = useCallback((draft: LearnPageContent, rev: number) => {
    revision.current = rev;
    lastSaved.current = draft;
    setHistory((h) => replaceInHistory(h, draft));
    setSaveState('saved');
    setFlash('Version restored into the draft. Publish to make it live.');
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  // ── Layout ─────────────────────────────────────────────────────────────
  const width = DEVICE_WIDTH[device];
  const { ref: stageRef, scale } = useFitScale(width);
  const pane = { content, selection, onSelect: select, onEdit: edit, warnings };

  const status =
    saveState === 'saving'
      ? 'Saving...'
      : saveState === 'unsaved'
        ? 'Unsaved changes'
        : saveState === 'error'
          ? 'Not saved'
          : saveState === 'conflict'
            ? 'Not saved'
            : savedAt
              ? `Saved ${formatTime(savedAt)}`
              : 'Saved';

  const show = (p: MobileTab) => !narrow || tab === p;

  return (
    <div className="le-root" ref={rootRef} role="region" aria-label="Learn page editor">
      <header className="le-bar">
        <div className="le-bar-left">
          <Link href="/" className="le-back" aria-label="Back to the dashboard" title="Back to the dashboard">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="le-hide-narrow">Dashboard</span>
          </Link>
          <h1 className="le-title">Learn page</h1>
          <span className={`le-status le-status-${saveState}`} role="status" aria-live="polite">
            {status}
          </span>
          {unpublished && (
            <span className="le-badge" title="The draft differs from what is on the website">
              Unpublished changes
            </span>
          )}
        </div>

        <div className="le-bar-mid">
          <div className="le-group" role="group" aria-label="Undo and redo">
            <button type="button" className="le-icon-btn" onClick={doUndo} disabled={history.past.length === 0} aria-label="Undo" title="Undo (Cmd+Z)">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4 2.5 7.5 6 11M3 7.5h6.5a4 4 0 0 1 0 8H8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button type="button" className="le-icon-btn" onClick={doRedo} disabled={history.future.length === 0} aria-label="Redo" title="Redo (Shift+Cmd+Z)">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 4l3.5 3.5L10 11M13 7.5H6.5a4 4 0 0 0 0 8H8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
          <div className="le-group le-devices" role="radiogroup" aria-label="Preview width">
            {(['desktop', 'tablet', 'phone'] as Device[]).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={device === d}
                className={`le-icon-btn${device === d ? ' is-on' : ''}`}
                onClick={() => setDevice(d)}
                aria-label={`${d[0].toUpperCase()}${d.slice(1)} width`}
                title={`${d[0].toUpperCase()}${d.slice(1)} (${DEVICE_WIDTH[d]}px)`}
              >
                <DeviceIcon device={d} />
              </button>
            ))}
          </div>
        </div>

        <div className="le-bar-right">
          <button type="button" className="btn btn-default btn-sm" onClick={() => setDialog('history')}>
            History
          </button>
          <button
            type="button"
            className="btn btn-default btn-sm le-hide-narrow"
            onClick={() => setDialog('discard')}
            disabled={!unpublished || !live}
            title={live ? 'Throw away the draft and go back to the live page' : 'Nothing is published yet'}
          >
            Discard draft
          </button>
          <a className="btn btn-default btn-sm le-hide-narrow" href={`${siteOrigin}/learn`} target="_blank" rel="noreferrer">
            View live page
          </a>
          <button type="button" className="whova-btn-main small" onClick={() => setDialog('publish')} disabled={saveState === 'conflict'}>
            Publish
          </button>
        </div>
      </header>

      {saveState === 'conflict' && (
        <div className="whova-banner danger le-banner" role="alert">
          <div>
            <strong>Someone else saved this page while you were editing.</strong> Your latest changes are not saved yet.
            <div className="le-banner-actions">
              <button type="button" className="btn btn-default btn-sm" onClick={() => void loadTheirs()}>
                Load their version
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => void keepMine()}>
                Keep mine and overwrite theirs
              </button>
            </div>
          </div>
        </div>
      )}
      {error && saveState !== 'conflict' && (
        <div className="whova-banner warning le-banner" role="alert">
          <div>
            <strong>{error.message}</strong>
            {error.problems && error.problems.length > 0 && (
              <ul className="le-problems">
                {error.problems.slice(0, 8).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {flash && (
        <div className="whova-banner success le-banner le-flash" role="status">
          {flash}
        </div>
      )}

      {narrow && (
        <div className="le-tabs" role="tablist" aria-label="Editor panes">
          {(['outline', 'preview', 'settings'] as MobileTab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`le-tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`le-pane-${t}`}
              className={tab === t ? 'is-on' : ''}
              onClick={() => setTab(t)}
            >
              {t[0].toUpperCase() + t.slice(1)}
              {t === 'outline' && warnings.length > 0 && <span className="le-dot" aria-label={`${warnings.length} warnings`} />}
            </button>
          ))}
        </div>
      )}

      <div className={`le-body${narrow ? ' is-narrow' : ''}`}>
        {show('outline') && (
          <aside className="le-pane le-pane-outline" id="le-pane-outline" aria-label="Page outline" role={narrow ? 'tabpanel' : undefined}>
            <Outline {...pane} />
          </aside>
        )}
        {show('preview') && (
          <main className="le-pane le-pane-preview" id="le-pane-preview" aria-label="Preview" role={narrow ? 'tabpanel' : undefined} ref={stageRef}>
            <div className="le-frame" style={{ width, zoom: scale, ['--le-unzoom' as string]: 1 / scale }} data-device={device}>
              <LearnPreview {...pane} siteOrigin={siteOrigin} device={device} />
            </div>
          </main>
        )}
        {show('settings') && (
          <aside className="le-pane le-pane-settings" id="le-pane-settings" aria-label="Settings" role={narrow ? 'tabpanel' : undefined}>
            <SettingsPanel {...pane} siteOrigin={siteOrigin} uploadImage={uploadImage} />
          </aside>
        )}
      </div>

      {dialog === 'publish' && (
        <PublishDialog
          before={live}
          firstPublish={!published}
          after={content}
          warnings={warnings}
          publishedAt={publishedAt}
          onPublish={onPublish}
          onClose={() => setDialog(null)}
          onShow={(sel) => {
            setDialog(null);
            select(sel);
          }}
        />
      )}
      {dialog === 'discard' && <DiscardDialog onDiscard={onDiscard} onClose={() => setDialog(null)} />}
      {dialog === 'history' && (
        <HistoryDialog
          versions={versions}
          siteOrigin={siteOrigin}
          onRestored={onRestored}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function DeviceIcon({ device }: { device: Device }) {
  if (device === 'desktop')
    return (
      <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true">
        <rect x="1.5" y="1.5" width="15" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 14.5h6M9 11.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  if (device === 'tablet')
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="1" width="11" height="14" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="8" cy="12.5" r="0.8" fill="currentColor" />
      </svg>
    );
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4.5" y="1" width="7" height="14" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="12.5" r="0.8" fill="currentColor" />
    </svg>
  );
}
