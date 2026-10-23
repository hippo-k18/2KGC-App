'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LearnBlock, LearnPageContent, LearnSection, PageImage } from '@kgc/shared';
import {
  contentEqual,
  contentWarnings,
  createBlock,
  findBlock,
  pushEdit,
  redo,
  repairSelection,
  sectionPickLabels,
  startHistory,
  undo,
  type EditAction,
  type History,
  type Selection,
} from '@/lib/learn-editor-core';
import { autosaveStep, historyAfterServerReplace } from '@/lib/learn-autosave-core';
import {
  canonicalContent,
  draftDiffersFromLive,
  draftPublishBlockers,
  expandForCompare,
  finishSavedSectionEdit,
  isSavedSectionCopy,
  savedSectionEditOf,
  savedSectionFromEdit,
  startEditFromBlock,
  startEditFromLibrary,
  unlinkReusable,
  type SavedSectionEdit,
} from '@/lib/learn-library-edit-core';
import { historyAfterRestore, scheduleCheckDelay } from '@/lib/learn-shell-core';
import {
  recoveryKey,
  recoveryStep,
  recoveryTimeLabel,
  recoveryToOffer,
  revisionForRestore,
  type RecoveryCopy,
} from '@/lib/learn-recovery-core';
import {
  blockRange,
  blocksInPageOrder,
  pageAnchors,
  parseClip,
  serializeClip,
  statusChips,
  type Clip,
  type SaveState,
  type Where,
} from '@/lib/learn-tools-core';
import {
  cancelLearnScheduleAction,
  listLearnLibraryAction,
  loadLearnEditorAction,
  publishLearnPageAction,
  revertLearnDraftAction,
  saveLearnDraftAction,
  saveLearnLibraryItemAction,
  uploadLearnImageAction,
  type LearnEditorState,
  type LearnVersionSummary,
} from './api';
import { AccountMenu } from '../../account-menu';
import { CheckerPanel, type CheckerTab } from './checker-panel';
import { CompareDialog } from './compare-dialog';
import { DiscardDialog, HistoryDialog, LeaveDialog, PublishDialog } from './dialogs';
import { EditorServicesContext, type EditorServices } from './editor-context';
import { DEVICE_WIDTH, type Device, type UploadImage } from './editor-types';
import { FindReplacePanel } from './find-replace';
import { HelpPanel } from './help-panel';
import { ImageEditor } from './image-editor';
import { MediaLibrary } from './media-library';
import { Outline } from './outline';
import { LearnPreview, type BlockClickFn } from './preview';
import { PreviewLinkDialog } from './preview-link-dialog';
import {
  clearRecovery,
  clearRecoveryIfSaved,
  onGuardEntry,
  pushGuardEntry,
  readRecovery,
  writeRecovery,
} from './recovery-store';
import { ScheduleDialog, ScheduleFailedBanner, ScheduledBanner, formatScheduled } from './schedule-dialog';
import { SettingsPanel } from './settings-panel';
import { ShortcutsDialog, isMacPlatform, shortcutText } from './shortcuts-dialog';
import { AddSectionDialog, SaveToLibraryDialog } from './templates-dialog';
import { FirstRunTour, useFirstRunTour } from './tour';
import './editor.css';

/**
 * Content › Learn page: the editor shell (T310, extended for v2 in T318).
 *
 * Owns everything that is not a pane: the undo stack, the autosave, the
 * conflict when two people edit at once, publishing and history, and since v2
 * the page tools (find and replace, the checks, the media library, templates,
 * compare, schedule, preview links), the clipboard, several-at-once selection
 * and the keyboard. The panes only ever see the current content and hand
 * edits back as `EditAction`s, so every change, wherever it was made, lands on
 * one undo stack and in one autosave.
 *
 * It takes the whole window rather than the dashboard's 840px content box:
 * a page preview, an outline and a settings column do not fit beside a 200px
 * rail. The dashboard behind it is made `inert` while it is open, so the
 * keyboard cannot wander into chrome nobody can see.
 */

type MobileTab = 'outline' | 'preview' | 'settings';
type Dialog =
  | null
  | 'publish'
  | 'history'
  | 'discard'
  | 'shortcuts'
  | 'compare'
  | 'schedule'
  | 'preview-link'
  | 'media'
  | { type: 'add-section'; index: number }
  | { type: 'save-library'; sectionId: string }
  | { type: 'leave'; go: () => void; stay?: () => void };
/** A tool that takes the settings column while it is open. */
type SideTool = null | 'find' | { type: 'check'; tab: CheckerTab };

/** Below this window width the three panes become tabs. */
const NARROW = 900;
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2] as const;
/** Where a copy is kept too, for when the browser refuses the system clipboard. */
const CLIP_KEY = 'kgc-learn-clipboard';

/** Drops keys set to `undefined` ("back to default"), so they cannot survive a merge write. */
function plain(content: LearnPageContent): LearnPageContent {
  return JSON.parse(JSON.stringify(content)) as LearnPageContent;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** True when a key press belongs to a text field, so the editor's own shortcuts stay out of its way. */
function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.closest?.('.ProseMirror')) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(type);
  }
  return el.isContentEditable;
}

function readStoredClip(): Clip | null {
  try {
    return parseClip(window.localStorage.getItem(CLIP_KEY) ?? '');
  } catch {
    return null;
  }
}

function storeClip(text: string) {
  try {
    window.localStorage.setItem(CLIP_KEY, text);
  } catch {
    // Private windows refuse storage; the system clipboard still has it.
  }
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
  // A callback ref, not a ref object: on a phone the preview pane unmounts
  // when another tab is shown, and the pane that comes back is a new element
  // that an effect keyed on `width` would never observe. The old one reports
  // a width of 0 on its way out, which used to leave the preview at 20%.
  const [el, ref] = useState<HTMLElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const avail = entry.contentRect.width - 32;
      if (avail <= 0) return;
      setScale(Math.min(1, Math.max(0.2, avail / width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, width]);
  return { ref, scale };
}


export function LearnEditor({
  initial,
  siteOrigin,
  openedAt,
  userEmail = '',
}: {
  initial: LearnEditorState;
  siteOrigin: string;
  /** The server's clock when the page was rendered, for the preview's countdown. */
  openedAt?: number;
  /** Who is signed in: the recovery copy in this browser is theirs alone (T343). */
  userEmail?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useInertOutside(rootRef);
  const narrow = useNarrow();
  const mac = useMemo(() => (typeof navigator === 'undefined' ? true : isMacPlatform()), []);
  const keys = useCallback((combo: string) => shortcutText(combo, mac), [mac]);
  const tour = useFirstRunTour();

  const [history, setHistory] = useState<History>(() => startHistory(initial.doc.draft));
  const [selection, setSelection] = useState<Selection>({ kind: 'page' });
  const [multi, setMulti] = useState<Set<string>>(() => new Set());
  const [device, setDevice] = useState<Device>('desktop');
  const [zoom, setZoom] = useState(1);
  const [tab, setTab] = useState<MobileTab>('preview');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [side, setSide] = useState<SideTool>(null);
  const [help, setHelp] = useState(false);
  const [menu, setMenu] = useState(false);

  const [published, setPublished] = useState<LearnPageContent | null>(initial.doc.published);
  const [publishedAt, setPublishedAt] = useState<number | undefined>(initial.doc.publishedAt);
  const [versions, setVersions] = useState<LearnVersionSummary[]>(initial.versions);
  const [scheduledAt, setScheduledAt] = useState<number | undefined>(initial.doc.scheduledPublishAt);
  const [previewToken, setPreviewToken] = useState<string | undefined>(initial.doc.previewToken);
  // The draft was saved again after the schedule was set (the scheduled
  // publish takes the draft as it is at that time, so the banner says so).
  const [changedSinceSchedule, setChangedSinceSchedule] = useState(
    initial.doc.scheduledRevision !== undefined && initial.doc.scheduledRevision !== initial.doc.revision,
  );
  // The last scheduled publish came due and could not run. Dismissing only hides
  // it here; the next schedule or publish clears it on the server.
  const [scheduleFailure, setScheduleFailure] = useState(initial.doc.scheduleFailure);

  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [savedAt, setSavedAt] = useState<number | undefined>(initial.doc.draftUpdatedAt || undefined);
  const [error, setError] = useState<{ message: string; problems?: string[] } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // Bumped whenever the draft is replaced from the server. The panes are keyed
  // on it, so the in-place text editors start again too: their own undo would
  // otherwise bring the replaced text back.
  const [epoch, setEpoch] = useState(0);

  // A form asked for an image; the promise it holds resolves when the library closes.
  const [picking, setPicking] = useState<{ title?: string; resolve: (v: PageImage | null) => void } | null>(null);
  const [editingImage, setEditingImage] = useState<{ image: PageImage; resolve: (v: PageImage | null) => void } | null>(null);

  // Saved sections by id, so the preview draws a linked section as Publish
  // will expand it. Loaded once, then again whenever the library may have
  // changed from here (a section saved to it, the add-section dialog closed).
  // Null until the first answer: the preview shows placeholders meanwhile,
  // and keeps the last good copy if a refresh fails.
  const [library, setLibrary] = useState<ReadonlyMap<string, LearnSection> | null>(null);
  const [libraryNames, setLibraryNames] = useState<ReadonlyMap<string, string>>(() => new Map());
  const refreshLibrary = useCallback(async () => {
    try {
      const res = await listLearnLibraryAction();
      if (res.ok) {
        setLibrary(new Map(res.items.map((item) => [item.id, item.section])));
        setLibraryNames(new Map(res.items.map((item) => [item.id, item.name])));
      }
    } catch {
      // Offline or a server hiccup: the placeholders stay until the next refresh.
    }
  }, []);
  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);
  const libraryRef = useRef(library);
  libraryRef.current = library;

  // What the server holds, so autosave sends only real changes. Refs, not
  // state: the save loop reads them after awaits, when state would be stale.
  const revision = useRef(initial.doc.revision);
  const lastSaved = useRef<LearnPageContent>(initial.doc.draft);
  const inFlight = useRef(false);
  /** The content of the last save the server refused, so a fix is retried at once. */
  const refused = useRef<LearnPageContent | null>(null);
  /** Counts drafts replaced from the server; a save answered after one is stale. */
  const generation = useRef(0);
  const latest = useRef(history.present);
  latest.current = history.present;
  const saveStateRef = useRef<SaveState>('saved');

  // ── The recovery copy in this browser (T343, N5) ───────────────────────
  const rkey = useMemo(() => recoveryKey(userEmail), [userEmail]);
  /** A copy from an earlier visit being offered; undefined until storage was read. */
  const offerRef = useRef<RecoveryCopy | null | undefined>(undefined);
  const [offer, setOffer] = useState<RecoveryCopy | null>(null);
  /** Whether the words on screen that the server lacks are in the copy. */
  const recoveryKept = useRef(false);
  const revisionAtOpen = useRef(initial.doc.revision);

  const content = history.present;
  const warnings = useMemo(() => contentWarnings(content), [content]);
  // What visitors see now. With no document yet, the website renders the
  // built-in page, which is exactly what the editor opened with.
  const [baseline] = useState<LearnPageContent | null>(() => (initial.exists ? null : initial.doc.draft));
  const live = published ?? baseline;
  // The live copy holds saved sections expanded, so the draft is expanded the
  // same way before the two are compared (T325, E F2). Until the library has
  // loaded, the server's answer stands for the draft it was given.
  const expandedDraft = useMemo(() => canonicalContent(expandForCompare(content, library)), [content, library]);
  const unpublished = draftDiffersFromLive(
    content,
    live,
    library,
    content === initial.doc.draft ? initial.hasUnpublishedChanges : true,
  );
  // What the server refuses to publish, worked out on the expanded draft (C X2).
  const blockers = useMemo(() => draftPublishBlockers(content, library), [content, library]);

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

  // A removed or moved block takes the selection with it, and leaves the several-selected set.
  useEffect(() => {
    setSelection((sel) => {
      const next = repairSelection(content, sel);
      return JSON.stringify(next) === JSON.stringify(sel) ? sel : next;
    });
    setMulti((m) => {
      if (m.size === 0) return m;
      const ids = new Set(content.sections.flatMap((s) => s.blocks.map((b) => b.id)));
      const kept = [...m].filter((id) => ids.has(id));
      return kept.length === m.size ? m : new Set(kept);
    });
  }, [content]);

  const doUndo = useCallback(() => setHistory(undo), []);
  const doRedo = useCallback(() => setHistory(redo), []);

  /** Shift and Cmd clicks in the preview, the same rules as the outline. */
  const onBlockClick = useCallback<BlockClickFn>(
    (_sectionId, blockId, mods) => {
      const from = selection.kind === 'block' ? selection.blockId : [...multi].pop();
      if (mods.shift && from) {
        setMulti(new Set([...multi, ...blockRange(content, from, blockId)]));
        return true;
      }
      if (mods.meta) {
        const next = new Set(multi);
        if (next.size === 0 && selection.kind === 'block') next.add(selection.blockId);
        if (next.has(blockId)) next.delete(blockId);
        else next.add(blockId);
        setMulti(next);
        return true;
      }
      return false;
    },
    [content, multi, selection],
  );

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
    const gen = generation.current;
    try {
      const res = await saveLearnDraftAction(plain(sending), revision.current);
      // The draft was replaced while this was on its way. If it was saved,
      // the server already has a newer revision than the one we now hold, and
      // the next save will say so as a conflict.
      if (gen !== generation.current) return false;
      if (res.ok) {
        // Also after the editor has closed (the save sent on the way out).
        clearRecoveryIfSaved(rkey, sending);
        refused.current = null;
        revision.current = res.revision;
        lastSaved.current = sending;
        setSavedAt(res.savedAt);
        setChangedSinceSchedule(true);
        setError(null);
        const caughtUp = contentEqual(latest.current, sending);
        setSaveState(caughtUp ? 'saved' : 'unsaved');
        return true;
      }
      if (res.conflict) {
        setSaveState('conflict');
        return false;
      }
      refused.current = sending;
      setSaveState('error');
      setError({ message: res.error, problems: res.problems });
      return false;
    } catch {
      if (gen !== generation.current) return false;
      refused.current = null;
      setSaveState('error');
      setError({ message: 'Could not reach the server. Your changes are still here; we will try again.' });
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [rkey]);

  useEffect(() => {
    const step = autosaveStep({ content, lastSaved: lastSaved.current, state: saveState, refused: refused.current });
    if (step.kind === 'clean') {
      // Back to what the server holds, for example by removing the block a
      // refused save was about: nothing to send, and nothing wrong any more.
      refused.current = null;
      setError(null);
      setSaveState('saved');
      return;
    }
    if (step.kind === 'idle') return;
    if (saveState === 'saved') setSaveState('unsaved');
    const t = setTimeout(() => void save(), step.delay);
    return () => clearTimeout(t);
  }, [content, save, saveState]);

  saveStateRef.current = saveState;
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

  /*
   * Browser Back cannot be held, and with a conflict or a refused save the
   * words cannot be sent on the way out. So whenever the screen holds words
   * the server lacks, this browser keeps a copy, and the next open offers it.
   * Written shortly after each change, and at once on the way out.
   */
  const keepCopyNow = useCallback(() => {
    if (offerRef.current === undefined) return;
    const step = recoveryStep({ content: latest.current, lastSaved: lastSaved.current, offerPending: !!offerRef.current });
    if (step === 'write') recoveryKept.current = writeRecovery(rkey, latest.current, revision.current);
    else if (step === 'clear') {
      clearRecovery(rkey);
      recoveryKept.current = false;
    }
  }, [rkey]);

  // Read once on open, before anything writes.
  useEffect(() => {
    const copy = recoveryToOffer(readRecovery(rkey), initial.doc.draft);
    if (!copy) clearRecovery(rkey);
    offerRef.current = copy;
    setOffer(copy);
    // Only the draft the editor opened with counts here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rkey]);

  useEffect(() => {
    const t = setTimeout(keepCopyNow, 300);
    return () => clearTimeout(t);
  }, [content, saveState, keepCopyNow]);

  useEffect(() => {
    window.addEventListener('pagehide', keepCopyNow);
    return () => window.removeEventListener('pagehide', keepCopyNow);
  }, [keepCopyNow]);

  /**
   * The draft was replaced from the server (their version, a discard, a
   * restore). Undo and redo start again from it: an undo that stepped back
   * past it would bring back content that is not on the server any more and
   * autosave it over whatever replaced it, at the new revision, with no
   * conflict to warn anybody.
   */
  const replaceDraft = useCallback((draft: LearnPageContent, rev: number) => {
    revision.current = rev;
    lastSaved.current = draft;
    refused.current = null;
    generation.current += 1;
    setHistory(historyAfterServerReplace(draft));
    setEpoch((n) => n + 1);
    setSaveState('saved');
    setError(null);
    // A discard or restore is a new draft revision too.
    setChangedSinceSchedule(true);
  }, []);

  /** Fresh state from the server: after a conflict, or to start over. */
  const adopt = useCallback((state: LearnEditorState) => {
    replaceDraft(state.doc.draft, state.doc.revision);
    setPublished(state.doc.published);
    setPublishedAt(state.doc.publishedAt);
    setVersions(state.versions);
    setScheduledAt(state.doc.scheduledPublishAt);
    setPreviewToken(state.doc.previewToken);
    setChangedSinceSchedule(state.doc.scheduledRevision !== undefined && state.doc.scheduledRevision !== state.doc.revision);
    setScheduleFailure(state.doc.scheduleFailure);
    setSavedAt(state.doc.draftUpdatedAt || undefined);
  }, [replaceDraft]);

  // "Load their version" asks first when it would throw away unsaved words (T332, E F8).
  const [confirmTheirs, setConfirmTheirs] = useState(false);
  useEffect(() => {
    if (saveState !== 'conflict') setConfirmTheirs(false);
  }, [saveState]);
  // The question takes focus on Cancel, so Enter keeps the words (T342 N-G); its answer gives it back.
  const cancelTheirsRef = useRef<HTMLButtonElement>(null);
  const loadTheirsRef = useRef<HTMLButtonElement>(null);
  const askedTheirs = useRef(false);
  useEffect(() => {
    if (confirmTheirs) {
      askedTheirs.current = true;
      cancelTheirsRef.current?.focus();
    } else if (askedTheirs.current) {
      askedTheirs.current = false;
      loadTheirsRef.current?.focus();
    }
  }, [confirmTheirs]);

  const loadTheirs = useCallback(async (asked = false) => {
    if (!asked && !contentEqual(latest.current, lastSaved.current)) {
      setConfirmTheirs(true);
      return;
    }
    setConfirmTheirs(false);
    const res = await loadLearnEditorAction();
    if (res.ok) adopt(res.state);
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

  /** The offered copy goes back in as an ordinary unsaved edit; a newer save on the server then asks as a conflict. */
  const restoreCopy = useCallback(() => {
    const copy = offerRef.current;
    if (!copy) return;
    offerRef.current = null;
    setOffer(null);
    revision.current = revisionForRestore(copy, revisionAtOpen.current, revision.current);
    edit({ type: 'replace', content: copy.doc });
    setEpoch((n) => n + 1);
  }, [edit]);

  const throwCopyAway = useCallback(() => {
    offerRef.current = null;
    setOffer(null);
    clearRecovery(rkey);
    keepCopyNow();
  }, [keepCopyNow, rkey]);

  // ── Leaving through the editor's own links (T332, E F2) ─────────────────
  /**
   * Sends what autosave is still waiting to send, after any save on its way.
   * False when the words cannot be saved: a conflict, a refused save, no
   * connection.
   */
  const flushForLeave = useCallback(async (): Promise<boolean> => {
    for (let i = 0; inFlight.current && i < 100; i++) await new Promise((r) => setTimeout(r, 100));
    if (inFlight.current) return false;
    if (contentEqual(latest.current, lastSaved.current)) return true;
    if (saveStateRef.current === 'conflict') return false;
    return save();
  }, [save]);

  /*
   * beforeunload covers a reload or a closed tab only. "< Dashboard", other
   * in-app links and Sign out (a server-action form) are client-side, so they
   * are caught here, before Next or React see them: the pending save goes
   * first, then the navigation, and if the words cannot be saved the editor
   * asks. Back in the browser cannot be held, so leaving any way at all still
   * sends the pending save.
   *
   * Browser Back (T343, N5): while the words cannot be saved, a guard history
   * entry for the same address sits on top, so Back lands in the editor still
   * here. Then it is handled like a link: save and go on back, or ask. Stay
   * puts the guard back. Next replaces history.state on every server action,
   * so the guard is told apart by the Navigation API's entry key where there
   * is one, and otherwise by counting.
   */
  const passing = useRef(false);
  const leaving = useRef(false);
  const onGuard = useRef(false);
  const editorPath = useRef('');
  const [guardTick, setGuardTick] = useState(0);
  const atRisk = saveState === 'conflict' || saveState === 'error';
  useEffect(() => {
    editorPath.current = window.location.pathname + window.location.search;
    onGuard.current = onGuardEntry() ?? false;
  }, []);
  useEffect(() => {
    if (!atRisk || onGuard.current) return;
    pushGuardEntry();
    onGuard.current = true;
  }, [atRisk, guardTick]);

  useEffect(() => {
    const pass = (go: () => void) => {
      passing.current = true;
      try {
        go();
      } finally {
        passing.current = false;
      }
    };
    const leave = (go: () => void, stay?: () => void) => {
      if (leaving.current) return;
      leaving.current = true;
      void flushForLeave()
        .catch(() => false)
        .then((ok) => {
          leaving.current = false;
          // A task later: with nothing to send this runs inside the first
          // submit's own dispatch, where a browser ignores a new submit.
          if (ok) setTimeout(() => pass(go), 0);
          else {
            keepCopyNow();
            setDialog({ type: 'leave', go: () => pass(go), stay });
          }
        });
    };
    const onPop = () => {
      if (window.location.pathname + window.location.search !== editorPath.current) {
        // Leaving with no guard to stop it: the copy keeps the words.
        onGuard.current = false;
        keepCopyNow();
        return;
      }
      const was = onGuard.current;
      onGuard.current = onGuardEntry() ?? !was;
      if (!was || onGuard.current) return;
      // Back took the guard entry and the editor is still here.
      leave(
        () => window.history.back(),
        () => {
          onGuard.current = false;
          setGuardTick((n) => n + 1);
        },
      );
    };
    const onClick = (e: MouseEvent) => {
      if (passing.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement) || !rootRef.current?.contains(a)) return;
      // Links in the page preview never navigate; new tabs and downloads leave nothing behind.
      if (a.closest('.lp-root') || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      e.preventDefault();
      e.stopPropagation();
      leave(() => a.click());
    };
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target;
      if (passing.current || !(form instanceof HTMLFormElement) || !rootRef.current?.contains(form)) return;
      // Only the account menu's Sign out forms leave the page; the editor's own forms are not real submits.
      if (!form.closest('.acct')) return;
      e.preventDefault();
      e.stopPropagation();
      const submitter = e.submitter instanceof HTMLElement ? e.submitter : null;
      leave(() => form.requestSubmit(submitter));
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
      window.removeEventListener('popstate', onPop);
    };
  }, [flushForLeave, keepCopyNow]);

  // Leaving by Back, or anything else that unmounts the editor: keep a copy and send what is pending.
  useEffect(
    () => () => {
      keepCopyNow();
      void flushForLeave();
    },
    [flushForLeave, keepCopyNow],
  );

  // ── Selection helpers for bulk and keyboard actions ─────────────────────
  const selectedBlocks = useCallback((): LearnBlock[] => {
    if (multi.size > 0) return blocksInPageOrder(content, multi);
    if (selection.kind === 'block') {
      const b = findBlock(content, selection.sectionId, selection.blockId);
      return b ? [b] : [];
    }
    return [];
  }, [content, multi, selection]);

  const selectedSection = useCallback((): LearnSection | undefined => {
    if (selection.kind !== 'section' || multi.size > 0) return undefined;
    return content.sections.find((s) => s.id === selection.sectionId);
  }, [content, multi, selection]);

  // ── Clipboard ──────────────────────────────────────────────────────────
  const clipText = useCallback((): { text: string; what: string } | null => {
    const blocks = selectedBlocks();
    if (blocks.length) {
      return { text: serializeClip({ kind: 'blocks', blocks }), what: blocks.length === 1 ? 'Block' : `${blocks.length} blocks` };
    }
    const section = selectedSection();
    if (section) return { text: serializeClip({ kind: 'sections', sections: [section] }), what: 'Section' };
    return null;
  }, [selectedBlocks, selectedSection]);

  const removeSelected = useCallback(
    (verb: string) => {
      const blocks = selectedBlocks();
      if (blocks.length) {
        edit({ type: 'removeBlocks', blockIds: blocks.map((b) => b.id) });
        setMulti(new Set());
        setFlash(`${blocks.length === 1 ? 'Block' : `${blocks.length} blocks`} ${verb}. Undo brings ${blocks.length === 1 ? 'it' : 'them'} back.`);
        return;
      }
      const section = selectedSection();
      if (section) {
        edit({ type: 'removeSection', sectionId: section.id });
        select({ kind: 'page' });
        setFlash(`Section ${verb}. Undo brings it back.`);
      }
    },
    [edit, select, selectedBlocks, selectedSection],
  );

  const paste = useCallback(
    (clip: Clip | null) => {
      if (!clip) {
        setFlash('Nothing to paste. Copy a block or section first.');
        return;
      }
      if (clip.kind === 'sections') {
        const at =
          selection.kind === 'page'
            ? content.sections.length
            : content.sections.findIndex((s) => s.id === selection.sectionId) + 1;
        clip.sections.forEach((s, i) => edit({ type: 'addSection', index: at + i, section: s }));
        select({ kind: 'section', sectionId: clip.sections[0].id });
        setFlash(clip.sections.length === 1 ? 'Section pasted.' : `${clip.sections.length} sections pasted.`);
        return;
      }
      // Blocks land after the selected block, at the end of the selected section, or in the last section.
      let sectionId: string | undefined;
      let index = 0;
      let column: number | undefined;
      if (selection.kind === 'block') {
        const s = content.sections.find((x) => x.id === selection.sectionId);
        sectionId = s?.id;
        index = (s?.blocks.findIndex((b) => b.id === selection.blockId) ?? -1) + 1;
        column = s?.blockColumn?.[selection.blockId];
      } else if (selection.kind === 'section') {
        sectionId = selection.sectionId;
        index = content.sections.find((s) => s.id === sectionId)?.blocks.length ?? 0;
      } else {
        const last = content.sections[content.sections.length - 1];
        sectionId = last?.id;
        index = last?.blocks.length ?? 0;
      }
      if (!sectionId) {
        setFlash('Add a section first, then paste into it.');
        return;
      }
      edit({ type: 'insertBlocks', sectionId, index, blocks: clip.blocks, column });
      if (clip.blocks.length === 1) select({ kind: 'block', sectionId, blockId: clip.blocks[0].id });
      else setMulti(new Set(clip.blocks.map((b) => b.id)));
      setFlash(clip.blocks.length === 1 ? 'Block pasted.' : `${clip.blocks.length} blocks pasted.`);
    },
    [content, edit, select, selection],
  );

  // The system clipboard events need no permission prompt and work across browser tabs.
  useEffect(() => {
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      if (dialog || typingIn(e.target) || window.getSelection()?.toString()) return;
      const c = clipText();
      if (!c) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', c.text);
      storeClip(c.text);
      if (cut) removeSelected('cut');
      else setFlash(`${c.what} copied. Paste it here or in another tab.`);
    };
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    const onPaste = (e: ClipboardEvent) => {
      if (dialog || typingIn(e.target)) return;
      const clip = parseClip(e.clipboardData?.getData('text/plain') ?? '') ?? readStoredClip();
      if (!clip) return;
      e.preventDefault();
      paste(clip);
    };
    document.addEventListener('copy', copy);
    document.addEventListener('cut', cut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', copy);
      document.removeEventListener('cut', cut);
      document.removeEventListener('paste', onPaste);
    };
  }, [clipText, dialog, paste, removeSelected]);

  /** The toolbar's Copy and Paste, for people who do not use the keyboard. */
  const copyByButton = useCallback(async () => {
    const c = clipText();
    if (!c) return;
    storeClip(c.text);
    try {
      await navigator.clipboard.writeText(c.text);
    } catch {
      // Stored locally above; paste in this browser still works.
    }
    setFlash(`${c.what} copied. Paste it here or in another tab.`);
  }, [clipText]);

  const pasteByButton = useCallback(async () => {
    let clip: Clip | null = null;
    try {
      clip = parseClip(await navigator.clipboard.readText());
    } catch {
      // The browser said no; fall back to the copy kept in this browser.
    }
    paste(clip ?? readStoredClip());
  }, [paste]);

  const hideSelected = useCallback(() => {
    const blocks = selectedBlocks();
    if (blocks.length) {
      const hidden = !blocks.every((b) => b.hidden);
      edit({ type: 'setBlocksHidden', blockIds: blocks.map((b) => b.id), hidden });
      return;
    }
    const s = selectedSection();
    if (s) edit({ type: 'updateSection', sectionId: s.id, patch: { hidden: s.hidden ? undefined : true } });
  }, [edit, selectedBlocks, selectedSection]);

  const duplicateSelected = useCallback(() => {
    if (selection.kind === 'block' && multi.size === 0)
      edit({ type: 'duplicateBlock', sectionId: selection.sectionId, blockId: selection.blockId });
    else if (selection.kind === 'section' && multi.size === 0) edit({ type: 'duplicateSection', sectionId: selection.sectionId });
    else if (multi.size > 0) {
      const blocks = blocksInPageOrder(content, multi);
      const clip = parseClip(serializeClip({ kind: 'blocks', blocks }));
      if (clip?.kind === 'blocks') {
        const lastId = blocks[blocks.length - 1].id;
        const s = content.sections.find((x) => x.blocks.some((b) => b.id === lastId));
        if (s) edit({ type: 'insertBlocks', sectionId: s.id, index: s.blocks.findIndex((b) => b.id === lastId) + 1, blocks: clip.blocks });
      }
    }
  }, [content, edit, multi, selection]);

  // ── Jumping to a place named by a tool ─────────────────────────────────
  const jump = useCallback(
    (where: Where) => {
      setMulti(new Set());
      if (where.blockId && where.sectionId) setSelection({ kind: 'block', sectionId: where.sectionId, blockId: where.blockId });
      else if (where.sectionId) setSelection({ kind: 'section', sectionId: where.sectionId });
      else setSelection({ kind: 'page' });
      if (narrow) setTab('preview');
    },
    [narrow],
  );

  // ── Keyboard ───────────────────────────────────────────────────────────
  const zoomBy = useCallback((dir: -1 | 0 | 1) => {
    setZoom((z) => {
      if (dir === 0) return 1;
      const i = ZOOMS.findIndex((x) => x >= z - 0.001);
      return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 3 : i) + dir))];
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const typing = typingIn(e.target);
      // Inside the in-place text editor, its own undo handles the letters.
      const inRich = (e.target as HTMLElement | null)?.closest?.('.ProseMirror');

      if (mod && key === 'z' && !inRich && !typing) {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if (mod && key === 'y' && !inRich && !typing) {
        e.preventDefault();
        doRedo();
      } else if (mod && key === 's') {
        e.preventDefault();
        void save();
      } else if (mod && !e.shiftKey && key === 'f') {
        e.preventDefault();
        setSide('find');
        if (narrow) setTab('settings');
      } else if (mod && e.shiftKey && key === 'k') {
        e.preventDefault();
        setSide({ type: 'check', tab: 'accessibility' });
        if (narrow) setTab('settings');
      } else if (mod && e.shiftKey && key === 'm') {
        e.preventDefault();
        setDialog('media');
      } else if (mod && e.shiftKey && key === 'h') {
        e.preventDefault();
        hideSelected();
      } else if (mod && e.shiftKey && ['1', '2', '3', '!', '@', '#'].includes(e.key)) {
        e.preventDefault();
        const i = ['1', '!'].includes(e.key) ? 0 : ['2', '@'].includes(e.key) ? 1 : 2;
        setDevice((['desktop', 'tablet', 'phone'] as Device[])[i]);
      } else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomBy(1);
      } else if (mod && e.key === '-') {
        e.preventDefault();
        zoomBy(-1);
      } else if (mod && e.key === '0') {
        e.preventDefault();
        zoomBy(0);
      } else if (mod && (e.key === '/' || e.key === '?')) {
        e.preventDefault();
        setDialog('shortcuts');
      } else if (typing) {
        return;
      } else if (!mod && e.key === '?') {
        e.preventDefault();
        setDialog('shortcuts');
      } else if (mod && key === 'd') {
        e.preventDefault();
        duplicateSelected();
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (multi.size === 0 && selection.kind === 'page') return;
        e.preventDefault();
        removeSelected('deleted');
      } else if (e.key === 'Escape') {
        if (menu) setMenu(false);
        else if (multi.size > 0) setMulti(new Set());
        else if (side) setSide(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, doUndo, doRedo, duplicateSelected, hideSelected, menu, multi, narrow, removeSelected, save, selection, side, zoomBy]);

  const uploadImage: UploadImage = useCallback(async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await uploadLearnImageAction(fd);
      return res.ok ? { ok: true, image: res.image, mediaId: res.mediaId } : { ok: false, error: res.error };
    } catch {
      return { ok: false, error: 'The upload did not finish. Check the connection and try again.' };
    }
  }, []);

  // ── Publish, discard, history ──────────────────────────────────────────
  const onPublish = useCallback(async (note: string): Promise<string | null> => {
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
    // The live copy holds saved sections expanded, as the server stored it.
    setPublished(canonicalContent(expandForCompare(sending, libraryRef.current)));
    setPublishedAt(res.publishedAt);
    setSavedAt(res.publishedAt);
    setSaveState(contentEqual(latest.current, sending) ? 'saved' : 'unsaved');
    setVersions((v) => [
      { id: res.versionId, publishedAt: res.publishedAt, publishedBy: 'You', note: note.trim() || undefined },
      ...v,
    ]);
    // Publishing by hand replaces a pending schedule, and settles a failed one
    // (the server clears both in the publish).
    setScheduledAt(undefined);
    setScheduleFailure(undefined);
    setFlash('Published. The live page updates within a minute.');
    return null;
  }, []);

  const onDiscard = useCallback(async (): Promise<string | null> => {
    const res = await revertLearnDraftAction();
    if (!res.ok) return res.error;
    replaceDraft(res.draft, res.revision);
    setFlash('Draft discarded. The editor now shows the live page.');
    return null;
  }, [replaceDraft]);

  /**
   * A restored version is one undo step (T325, E F5): the draft it replaced
   * goes onto the undo stack, so Undo brings unpublished work back and
   * autosave stores it again. A discard or "Load their version" still starts
   * the history afresh (`replaceDraft`).
   */
  const onRestored = useCallback((draft: LearnPageContent, rev: number) => {
    revision.current = rev;
    lastSaved.current = draft;
    refused.current = null;
    generation.current += 1;
    setHistory((h) => historyAfterRestore(h, draft));
    setEpoch((n) => n + 1);
    setSaveState('saved');
    setError(null);
    setChangedSinceSchedule(true);
    setFlash('Version restored into the draft. Publish to make it live. Undo brings your draft back.');
  }, []);

  // ── A scheduled publish that came due while the editor was open (E F8) ──
  /**
   * The publish state from the server: what is live, the versions and the
   * schedule. The draft is left alone; if the server's draft moved on, the
   * next save says so as a conflict, as usual.
   */
  const refreshStatus = useCallback(async () => {
    try {
      const res = await loadLearnEditorAction();
      if (!res.ok) return;
      const d = res.state.doc;
      const due = scheduledRef.current;
      if (due && !d.scheduledPublishAt && d.publishedAt && d.publishedAt >= due) setFlash('The scheduled publish is live.');
      setPublished(d.published);
      setPublishedAt(d.publishedAt);
      setVersions(res.state.versions);
      setScheduledAt(d.scheduledPublishAt);
      setScheduleFailure(d.scheduleFailure);
      setChangedSinceSchedule(d.scheduledRevision !== undefined && d.scheduledRevision !== d.revision);
    } catch {
      // Offline: the next try or the next focus asks again.
    }
  }, []);

  const scheduledRef = useRef(scheduledAt);
  scheduledRef.current = scheduledAt;
  const [scheduleTries, setScheduleTries] = useState(0);
  const [scheduleWake, setScheduleWake] = useState(0);
  useEffect(() => setScheduleTries(0), [scheduledAt]);
  useEffect(() => {
    if (!scheduledAt) return;
    const delay = scheduleCheckDelay(scheduledAt, Date.now(), scheduleTries);
    if (delay === null) return;
    const t = setTimeout(() => {
      if (Date.now() < scheduledAt) setScheduleWake((n) => n + 1);
      else void refreshStatus().then(() => setScheduleTries((n) => n + 1));
    }, delay);
    return () => clearTimeout(t);
  }, [scheduledAt, scheduleTries, scheduleWake, refreshStatus]);
  useEffect(() => {
    if (!scheduledAt) return;
    const onFocus = () => {
      if (Date.now() >= scheduledAt) void refreshStatus();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [scheduledAt, refreshStatus]);
  // ── Saved sections: Unlink and change them from the page (E F1, F3) ────
  // Stored on the copy's section (T328), so a reload keeps the edit going and
  // Undo past the start, or deleting the copy, ends it without saving.
  const savedEdit = useMemo(() => savedSectionEditOf(content), [content]);
  const [savedEditBusy, setSavedEditBusy] = useState(false);
  const [savedEditError, setSavedEditError] = useState<string | null>(null);

  const unlinkBlock = useCallback(
    (sectionId: string, blockId: string) => {
      if (!library) return;
      const next = unlinkReusable(latest.current, sectionId, blockId, library);
      if (!next) {
        setFlash('That saved section is not in the library any more, so there is nothing to unlink.');
        return;
      }
      edit({ type: 'replace', content: next });
      setSelection({ kind: 'section', sectionId });
      setFlash('Unlinked. This is now a copy you can change here; the saved section is not changed. Undo links it again.');
    },
    [edit, library],
  );

  const beginSavedEdit = useCallback(
    (started: { content: LearnPageContent; edit: SavedSectionEdit } | null) => {
      if (!started) {
        setFlash('That saved section is not in the library any more.');
        return;
      }
      edit({ type: 'replace', content: started.content });
      setSavedEditError(null);
      setSelection({ kind: 'section', sectionId: started.edit.sectionId });
    },
    [edit],
  );

  const editSavedSection = useCallback(
    (sectionId: string, blockId: string) => {
      if (!library || savedEdit) return;
      const block = findBlock(latest.current, sectionId, blockId);
      const id = block?.kind === 'reusable' ? block.libraryId : '';
      beginSavedEdit(startEditFromBlock(latest.current, sectionId, blockId, library, libraryNames.get(id) ?? 'Saved section'));
    },
    [beginSavedEdit, library, libraryNames, savedEdit],
  );

  const finishSavedEdit = useCallback(
    async (keep: boolean) => {
      if (!savedEdit) return;
      if (keep) {
        if (!library) {
          setSavedEditError('The saved sections are still loading. Try again in a moment.');
          return;
        }
        const saved = library.get(savedEdit.libraryId);
        const section = saved && savedSectionFromEdit(latest.current, savedEdit, saved);
        if (!section) {
          setSavedEditError('This saved section is not in the library any more. Cancel, then save the section to the library again.');
          return;
        }
        setSavedEditBusy(true);
        setSavedEditError(null);
        try {
          const res = await saveLearnLibraryItemAction({ name: savedEdit.name, section, replaceId: savedEdit.libraryId });
          if (!res.ok) {
            setSavedEditError(res.error);
            return;
          }
          // Drawn from the new copy at once; the refresh below confirms it.
          setLibrary((lib) => new Map(lib ?? []).set(savedEdit.libraryId, section));
        } catch {
          setSavedEditError('Could not reach the server. Your changes are still here; try again.');
          return;
        } finally {
          setSavedEditBusy(false);
        }
      }
      edit({ type: 'replace', content: finishSavedSectionEdit(latest.current, savedEdit) });
      setSelection({ kind: 'page' });
      setSavedEditError(null);
      setFlash(
        keep
          ? `Saved "${savedEdit.name}" to the library. Every page that links it shows the change; publish to put it on the website.`
          : 'No change made to the saved section.',
      );
      if (keep) void refreshLibrary();
    },
    [edit, library, refreshLibrary, savedEdit],
  );

  const cancelSchedule = useCallback(async () => {
    const res = await cancelLearnScheduleAction();
    if (res.ok) {
      setScheduledAt(undefined);
      setFlash('Schedule cancelled. Nothing goes live until you publish.');
    } else setError({ message: res.error });
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  // ── Services for forms deep in the panes ───────────────────────────────
  const anchors = useMemo(() => pageAnchors(content).map((a) => ({ anchor: a.anchor, label: a.label })), [content]);
  const services = useMemo<EditorServices>(
    () => ({
      siteOrigin,
      uploadImage,
      anchors,
      content,
      pickImage: (opts) => new Promise<PageImage | null>((resolve) => setPicking({ resolve, title: opts?.title })),
      editImage: (image) => new Promise<PageImage | null>((resolve) => setEditingImage({ image, resolve })),
      library,
      libraryNames,
      unlinkBlock,
      editSavedSection: savedEdit ? undefined : editSavedSection,
      editingSavedSection: savedEdit ? { libraryId: savedEdit.libraryId, sectionId: savedEdit.sectionId } : null,
    }),
    [anchors, content, editSavedSection, library, libraryNames, savedEdit, siteOrigin, unlinkBlock, uploadImage],
  );

  // ── Adding sections ────────────────────────────────────────────────────
  const insertSection = useCallback(
    (section: LearnSection, index: number) => {
      edit({ type: 'addSection', index, section });
      select({ kind: 'section', sectionId: section.id });
    },
    [edit, select],
  );

  // ── Layout ─────────────────────────────────────────────────────────────
  const width = DEVICE_WIDTH[device];
  const { ref: stageRef, scale } = useFitScale(width);
  const frameZoom = scale * zoom;
  const pane = { content, selection, onSelect: select, onEdit: edit, warnings };
  const [saveChip, liveChip] = statusChips(
    { saveState, unpublished, live: !!published || !!baseline, scheduledAt },
    formatScheduled,
  );
  const saveDetail = saveState === 'saved' && savedAt ? `Saved ${formatTime(savedAt)}` : saveChip.detail;

  const show = (p: MobileTab) => !narrow || tab === p;
  const openSide = (t: SideTool) => {
    setSide(t);
    setMenu(false);
    if (narrow) setTab('settings');
  };
  // While a saved section is being changed, Publish and Schedule wait (C N3):
  // either would put the linked copy live as it was, not the change.
  const savedEditWait = savedEdit ? 'Save the saved section to the library, or cancel, first.' : undefined;
  const openDialog = (d: Dialog) => {
    setMenu(false);
    if (savedEditWait && (d === 'publish' || d === 'schedule')) {
      setFlash(savedEditWait);
      return;
    }
    setDialog(d);
  };

  const toolItems: ToolItem[] = [
    { label: 'Find and replace', keys: 'Mod+F', onClick: () => openSide('find') },
    { label: 'Check the page', keys: 'Shift+Mod+K', onClick: () => openSide({ type: 'check', tab: 'accessibility' }) },
    { label: 'Check links', onClick: () => openSide({ type: 'check', tab: 'links' }) },
    { label: 'Media library', keys: 'Shift+Mod+M', onClick: () => openDialog('media') },
    { label: 'Compare with a published version', onClick: () => openDialog('compare') },
    { label: 'Share the draft', onClick: () => openDialog('preview-link') },
    { label: 'Schedule', onClick: () => openDialog('schedule'), disabled: !!savedEdit, title: savedEditWait },
    { label: 'History', onClick: () => openDialog('history') },
    { label: 'Discard draft', onClick: () => openDialog('discard') },
    { label: 'Keyboard shortcuts', keys: 'Mod+/', onClick: () => openDialog('shortcuts') },
    {
      label: 'View live page',
      onClick: () => {
        setMenu(false);
        window.open(`${siteOrigin}/learn`, '_blank', 'noreferrer');
      },
    },
    {
      label: 'Help',
      onClick: () => {
        setMenu(false);
        setHelp(true);
      },
    },
  ];

  const bulkCount = multi.size;
  const sectionForLibrary = typeof dialog === 'object' && dialog?.type === 'save-library'
    ? content.sections.find((s) => s.id === dialog.sectionId)
    : undefined;

  return (
    <EditorServicesContext.Provider value={services}>
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
            <span className="le-chips" role="status" aria-live="polite">
              <span className={`le-chip is-${saveChip.tone}`} title={saveDetail}>
                <span className="le-chip-dot" aria-hidden="true" />
                {saveChip.label}
                <span className="sr-only">: {saveDetail}</span>
              </span>
              <button
                type="button"
                className={`le-chip is-${liveChip.tone}`}
                title={liveChip.detail}
                onClick={() => (scheduledAt ? openDialog('schedule') : unpublished ? openDialog('publish') : undefined)}
              >
                <span className="le-chip-dot" aria-hidden="true" />
                {liveChip.label}
                <span className="sr-only">: {liveChip.detail}</span>
              </button>
            </span>
          </div>

          <div className="le-bar-mid">
            <div className="le-group" role="group" aria-label="Undo and redo">
              <button type="button" className="le-icon-btn" onClick={doUndo} disabled={history.past.length === 0} aria-label="Undo" title={`Undo (${keys('Mod+Z')})`}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4 2.5 7.5 6 11M3 7.5h6.5a4 4 0 0 1 0 8H8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button type="button" className="le-icon-btn" onClick={doRedo} disabled={history.future.length === 0} aria-label="Redo" title={`Redo (${keys('Shift+Mod+Z')})`}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 4l3.5 3.5L10 11M13 7.5H6.5a4 4 0 0 0 0 8H8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
            <div className="le-group le-devices" role="radiogroup" aria-label="Preview width">
              {(['desktop', 'tablet', 'phone'] as Device[]).map((d, i) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={device === d}
                  className={`le-icon-btn${device === d ? ' is-on' : ''}`}
                  onClick={() => setDevice(d)}
                  aria-label={`${d[0].toUpperCase()}${d.slice(1)} width`}
                  title={`${d[0].toUpperCase()}${d.slice(1)} (${DEVICE_WIDTH[d]}px, ${keys(`Shift+Mod+${i + 1}`)})`}
                >
                  <DeviceIcon device={d} />
                </button>
              ))}
            </div>
            <div className="le-group le-zoom" role="group" aria-label="Zoom the preview">
              <button type="button" className="le-icon-btn" onClick={() => zoomBy(-1)} disabled={zoom <= ZOOMS[0]} aria-label="Zoom out" title={`Zoom out (${keys('Mod+-')})`}>
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
              <button type="button" className="le-zoom-value" onClick={() => zoomBy(0)} title={`Back to fit (${keys('Mod+0')})`} aria-label={`Zoom ${Math.round(zoom * 100)} percent, press to reset`}>
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" className="le-icon-btn" onClick={() => zoomBy(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} aria-label="Zoom in" title={`Zoom in (${keys('Mod+=')})`}>
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
            </div>
          </div>

          <div className="le-bar-right">
            <button type="button" className="btn btn-default btn-sm le-hide-mid" onClick={() => openSide('find')} title={keys('Mod+F')}>
              Find
            </button>
            <button type="button" className="btn btn-default btn-sm le-hide-mid" onClick={() => openSide({ type: 'check', tab: 'accessibility' })} title={keys('Shift+Mod+K')}>
              Check
            </button>
            <button type="button" className="btn btn-default btn-sm le-hide-mid" onClick={() => openDialog('media')}>
              Media
            </button>
            <div className="le-menu-wrap">
              <button
                type="button"
                className="btn btn-default btn-sm"
                aria-haspopup="menu"
                aria-expanded={menu}
                onClick={() => setMenu((m) => !m)}
              >
                More
              </button>
              {menu && <ToolsMenu items={toolItems} keys={keys} onClose={() => setMenu(false)} />}
            </div>
            <button type="button" className="btn btn-default btn-sm le-hide-phone" data-tour="help" onClick={() => setHelp(true)} aria-label="Help">
              Help
            </button>
            <a className="btn btn-default btn-sm le-hide-mid" href={`${siteOrigin}/learn`} target="_blank" rel="noreferrer">
              View live page
            </a>
            <button
              type="button"
              className="btn btn-default btn-sm le-hide-narrow"
              onClick={() => openDialog('schedule')}
              disabled={!!savedEdit}
              title={savedEditWait}
            >
              Schedule
            </button>
            <button
              type="button"
              className="whova-btn-main small"
              data-tour="publish"
              onClick={() => setDialog('publish')}
              disabled={saveState === 'conflict' || !!savedEdit}
              title={savedEditWait}
            >
              Publish
            </button>
            <AccountMenu variant="editor" />
          </div>
        </header>

        {scheduledAt && (
          <div className="le-banner le-banner-tight">
            <ScheduledBanner
              at={scheduledAt}
              draftChanged={changedSinceSchedule}
              onChange={() => openDialog('schedule')}
              onCancel={() => void cancelSchedule()}
            />
          </div>
        )}
        {scheduleFailure && !scheduledAt && (
          <ScheduleFailedBanner
            failure={scheduleFailure}
            onReschedule={() => openDialog('schedule')}
            onDismiss={() => setScheduleFailure(undefined)}
          />
        )}
        {savedEdit && (
          <div className="whova-banner info le-banner le-saved-edit" role="status">
            <div>
              <strong>You&apos;re changing the saved section &quot;{savedEdit.name}&quot;.</strong> Every page that links it
              updates when you save it.
              <div className="le-banner-actions">
                <button
                  type="button"
                  className="whova-btn-main small"
                  disabled={savedEditBusy}
                  onClick={() => void finishSavedEdit(true)}
                >
                  {savedEditBusy ? 'Saving...' : 'Save to library'}
                </button>
                <button type="button" className="btn btn-default btn-sm" disabled={savedEditBusy} onClick={() => void finishSavedEdit(false)}>
                  Cancel
                </button>
              </div>
              {savedEditError && (
                <p className="le-saved-edit-error" role="alert">
                  {savedEditError}
                </p>
              )}
            </div>
          </div>
        )}
        {offer && (
          <div className="whova-banner warning le-banner le-recovery" role="alert">
            <div>
              <strong>You have changes from {recoveryTimeLabel(offer.at, Date.now())} that were not saved.</strong> This browser
              kept them.
              <div className="le-banner-actions">
                <button type="button" className="whova-btn-main small" onClick={restoreCopy}>
                  Restore them
                </button>
                <button type="button" className="btn btn-default btn-sm" onClick={throwCopyAway}>
                  Throw them away
                </button>
              </div>
            </div>
          </div>
        )}
        {saveState === 'conflict' && (
          <div className="whova-banner danger le-banner" role="alert">
            <div>
              <strong>Someone else saved this page while you were editing.</strong> Your latest changes are not saved yet.
              {confirmTheirs ? (
                <div className="le-banner-actions le-conflict-confirm" key="confirm">
                  <span>Load their version? This throws away your changes that are not saved yet.</span>
                  <button type="button" className="btn btn-default btn-sm" onClick={() => setConfirmTheirs(false)} ref={cancelTheirsRef}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => void loadTheirs(true)}>
                    Throw away my changes
                  </button>
                </div>
              ) : (
                <div className="le-banner-actions" key="choose">
                  <button type="button" className="btn btn-default btn-sm" onClick={() => void loadTheirs()} ref={loadTheirsRef}>
                    Load their version
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => void keepMine()}>
                    Keep mine and replace their saved changes
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {error && saveState !== 'conflict' && (
          <div className="whova-banner warning le-banner" role="alert">
            <div>
              <strong>{error.message}</strong>
              {error.problems && error.problems.length > 0 && (
                <ul className="le-problems">
                  {error.problems.slice(0, 3).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                  {error.problems.length > 3 && <li>and {error.problems.length - 3} more</li>}
                </ul>
              )}
            </div>
          </div>
        )}
        {bulkCount > 0 && (
          <BulkBar
            count={bulkCount}
            sections={content.sections}
            allHidden={blocksInPageOrder(content, multi).every((b) => b.hidden)}
            onHide={hideSelected}
            onCopy={() => void copyByButton()}
            onDuplicate={duplicateSelected}
            onMove={(sectionId) => {
              const s = content.sections.find((x) => x.id === sectionId);
              edit({ type: 'moveBlocks', blockIds: [...multi], toSectionId: sectionId, toIndex: s?.blocks.length ?? 0 });
              setFlash(`Moved to ${s?.label || 'the section'}.`);
            }}
            onDelete={() => removeSelected('deleted')}
            onClear={() => setMulti(new Set())}
          />
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
                {t === 'settings' && side ? (side === 'find' ? 'Find' : 'Check') : t[0].toUpperCase() + t.slice(1)}
                {t === 'outline' && warnings.length > 0 && <span className="le-dot" aria-label={`${warnings.length} warnings`} />}
              </button>
            ))}
          </div>
        )}

        <div className={`le-body${narrow ? ' is-narrow' : ''}`} key={epoch}>
          {show('outline') && (
            <aside className="le-pane le-pane-outline" id="le-pane-outline" aria-label="Page outline" role={narrow ? 'tabpanel' : undefined} data-tour="outline">
              <Outline
                {...pane}
                multi={multi}
                onMulti={setMulti}
                onAddSection={(index) => openDialog({ type: 'add-section', index })}
              />
              <div className="le-ol-clip">
                <button type="button" className="le-ol-cliptn" onClick={() => void copyByButton()} disabled={!clipText()} title={keys('Mod+C')}>
                  Copy
                </button>
                <button type="button" className="le-ol-cliptn" onClick={() => void pasteByButton()} title={keys('Mod+V')}>
                  Paste
                </button>
              </div>
            </aside>
          )}
          {show('preview') && (
            <main className="le-pane le-pane-preview" id="le-pane-preview" aria-label="Preview" role={narrow ? 'tabpanel' : undefined} ref={stageRef} data-tour="preview" data-zoomed={zoom !== 1 || undefined}>
              <div className="le-frame" style={{ width, zoom: frameZoom, ['--le-unzoom' as string]: 1 / frameZoom }} data-device={device}>
                <LearnPreview {...pane} siteOrigin={siteOrigin} device={device} multi={multi} onBlockClick={onBlockClick} library={library} openedAt={openedAt} />
              </div>
            </main>
          )}
          {show('settings') && (
            <aside className="le-pane le-pane-settings" id="le-pane-settings" aria-label={side ? 'Page tools' : 'Settings'} role={narrow ? 'tabpanel' : undefined} data-tour="settings">
              {side === 'find' ? (
                <FindReplacePanel content={content} library={library} libraryNames={libraryNames} onEdit={edit} onJump={jump} onClose={() => setSide(null)} />
              ) : side ? (
                <CheckerPanel
                  key={side.tab}
                  content={content}
                  blockers={blockers}
                  onJump={jump}
                  onClose={() => setSide(null)}
                  initialTab={side.tab}
                />
              ) : (
                <SettingsPanel
                  {...pane}
                  siteOrigin={siteOrigin}
                  uploadImage={uploadImage}
                  onSaveToLibrary={(sectionId) =>
                    // On the copy being changed it saves the change, not a second saved section (N2).
                    isSavedSectionCopy(latest.current, sectionId)
                      ? void finishSavedEdit(true)
                      : openDialog({ type: 'save-library', sectionId })
                  }
                />
              )}
            </aside>
          )}
        </div>

        {dialog === 'publish' && (
          <PublishDialog
            before={live && canonicalContent(live)}
            firstPublish={!published}
            after={expandedDraft}
            blockers={blockers}
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
        {typeof dialog === 'object' && dialog?.type === 'leave' && (
          <LeaveDialog
            conflict={saveState === 'conflict'}
            kept={recoveryKept.current}
            onLeave={() => {
              const go = dialog.go;
              setDialog(null);
              go();
            }}
            onClose={() => {
              dialog.stay?.();
              setDialog(null);
            }}
          />
        )}
        {dialog === 'history' && (
          <HistoryDialog
            versions={versions}
            siteOrigin={siteOrigin}
            library={library}
            hasUnpublished={unpublished}
            onRestored={onRestored}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
        {dialog === 'compare' && <CompareDialog versions={versions} draft={expandedDraft} library={library} siteOrigin={siteOrigin} onClose={() => setDialog(null)} />}
        {dialog === 'schedule' && (
          <ScheduleDialog
            scheduledAt={scheduledAt ?? null}
            baseRevision={() => revision.current}
            onConflict={() => setSaveState('conflict')}
            onScheduled={(at) => {
              setScheduledAt(at);
              setChangedSinceSchedule(false);
              setScheduleFailure(undefined);
              setFlash(`Scheduled. The draft goes live ${formatScheduled(at)}.`);
            }}
            onCancelled={() => {
              setScheduledAt(undefined);
              setFlash('Schedule cancelled. Nothing goes live until you publish.');
            }}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'preview-link' && (
          <PreviewLinkDialog siteOrigin={siteOrigin} token={previewToken} onToken={(t) => setPreviewToken(t ?? undefined)} onClose={() => setDialog(null)} />
        )}
        {dialog === 'media' && <MediaLibrary mode="manage" content={content} published={published} onClose={() => setDialog(null)} />}
        {typeof dialog === 'object' && dialog?.type === 'add-section' && (
          <AddSectionDialog
            onInsert={(section) => insertSection(section, dialog.index)}
            onInsertReusable={(libraryId, name) => {
              const block = { ...createBlock('reusable'), libraryId } as LearnBlock;
              insertSection(
                { id: `s${block.id.slice(1)}`, label: name, background: 'plain', width: 'normal', paddingTop: 'none', paddingBottom: 'none', blocks: [block] },
                dialog.index,
              );
              void refreshLibrary();
            }}
            onEditSaved={
              savedEdit
                ? undefined
                : (libraryId, name, section) => beginSavedEdit(startEditFromLibrary(latest.current, dialog.index, libraryId, section, name))
            }
            onClose={() => {
              setDialog(null);
              // Saved sections can be renamed or deleted in the dialog.
              void refreshLibrary();
            }}
          />
        )}
        {sectionForLibrary && (
          <SaveToLibraryDialog
            section={sectionForLibrary}
            onClose={() => setDialog(null)}
            onSaved={(item) => {
              setFlash(`Saved "${item.name}" to the library. Add it from Add a section.`);
              void refreshLibrary();
            }}
          />
        )}
        {picking && (
          <MediaLibrary
            mode="pick"
            title={picking.title}
            content={content}
            published={published}
            onPick={(img) => {
              picking.resolve(img);
              setPicking(null);
            }}
            onClose={() => {
              picking.resolve(null);
              setPicking(null);
            }}
          />
        )}
        {editingImage && (
          <ImageEditor
            image={editingImage.image}
            siteOrigin={siteOrigin}
            onDone={(img) => {
              editingImage.resolve(img);
              setEditingImage(null);
            }}
            onClose={() => {
              editingImage.resolve(null);
              setEditingImage(null);
            }}
          />
        )}
        {help && (
          <HelpPanel
            onClose={() => setHelp(false)}
            onStartTour={() => {
              setHelp(false);
              tour.start();
            }}
            onShowShortcuts={() => {
              setHelp(false);
              setDialog('shortcuts');
            }}
          />
        )}
        {tour.show && !dialog && <FirstRunTour onDone={tour.finish} />}
      </div>
    </EditorServicesContext.Provider>
  );
}

type ToolItem = { label: string; keys?: string; onClick: () => void; disabled?: boolean; title?: string };

/** The More menu: every page tool by name, for people who do not know the shortcuts. */
function ToolsMenu({
  items,
  keys,
  onClose,
}: {
  items: ToolItem[];
  keys: (combo: string) => string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="le-menu"
      role="menu"
      aria-label="Page tools"
      onKeyDown={(e) => {
        const list = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {items.map((it) => (
        <button key={it.label} type="button" role="menuitem" className="le-menu-item" onClick={it.onClick} disabled={it.disabled} title={it.title}>
          <span>{it.label}</span>
          {it.keys && <kbd>{keys(it.keys)}</kbd>}
        </button>
      ))}
    </div>
  );
}

/** What can be done to several blocks at once. */
function BulkBar({
  count,
  sections,
  allHidden,
  onHide,
  onCopy,
  onDuplicate,
  onMove,
  onDelete,
  onClear,
}: {
  count: number;
  sections: LearnSection[];
  allHidden: boolean;
  onHide: () => void;
  onCopy: () => void;
  onDuplicate: () => void;
  onMove: (sectionId: string) => void;
  onDelete: () => void;
  onClear: () => void;
}): ReactNode {
  return (
    <div className="le-bulk" role="toolbar" aria-label={`${count} blocks selected`}>
      <strong>{count} blocks selected</strong>
      <button type="button" className="btn btn-default btn-sm" onClick={onHide}>
        {allHidden ? 'Show' : 'Hide'}
      </button>
      <button type="button" className="btn btn-default btn-sm" onClick={onCopy}>
        Copy
      </button>
      <button type="button" className="btn btn-default btn-sm" onClick={onDuplicate}>
        Duplicate
      </button>
      <label className="le-bulk-move">
        <span className="sr-only">Move to section</span>
        <select
          className="whova-select"
          value=""
          onChange={(e) => {
            if (e.target.value) onMove(e.target.value);
          }}
        >
          <option value="">Move to...</option>
          {sectionPickLabels(sections).map((label, i) => (
            <option key={sections[i].id} value={sections[i].id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>
        Delete
      </button>
      <button type="button" className="le-bulk-clear" onClick={onClear}>
        Clear selection
      </button>
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
