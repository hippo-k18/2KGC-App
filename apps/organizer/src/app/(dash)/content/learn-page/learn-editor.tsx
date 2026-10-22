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
  startHistory,
  undo,
  type EditAction,
  type History,
  type Selection,
} from '@/lib/learn-editor-core';
import { autosaveStep, historyAfterServerReplace } from '@/lib/learn-autosave-core';
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
  uploadLearnImageAction,
  type LearnEditorState,
  type LearnVersionSummary,
} from './api';
import { AccountMenu } from '../../account-menu';
import { CheckerPanel, type CheckerTab } from './checker-panel';
import { CompareDialog } from './compare-dialog';
import { DiscardDialog, HistoryDialog, PublishDialog } from './dialogs';
import { EditorServicesContext, type EditorServices } from './editor-context';
import { DEVICE_WIDTH, type Device, type UploadImage } from './editor-types';
import { FindReplacePanel } from './find-replace';
import { HelpPanel } from './help-panel';
import { ImageEditor } from './image-editor';
import { MediaLibrary } from './media-library';
import { Outline } from './outline';
import { LearnPreview, type BlockClickFn } from './preview';
import { PreviewLinkDialog } from './preview-link-dialog';
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
  | { type: 'save-library'; sectionId: string };
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
}: {
  initial: LearnEditorState;
  siteOrigin: string;
  /** The server's clock when the page was rendered, for the preview's countdown. */
  openedAt?: number;
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
  const refreshLibrary = useCallback(async () => {
    try {
      const res = await listLearnLibraryAction();
      if (res.ok) setLibrary(new Map(res.items.map((item) => [item.id, item.section])));
    } catch {
      // Offline or a server hiccup: the placeholders stay until the next refresh.
    }
  }, []);
  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

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
  }, []);

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

  const loadTheirs = useCallback(async () => {
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
    }),
    [anchors, content, siteOrigin, uploadImage],
  );

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
    setPublished(sending);
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

  const onRestored = useCallback(
    (draft: LearnPageContent, rev: number) => {
      replaceDraft(draft, rev);
      setFlash('Version restored into the draft. Publish to make it live.');
    },
    [replaceDraft],
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
  const openDialog = (d: Dialog) => {
    setDialog(d);
    setMenu(false);
  };

  const toolItems: { label: string; keys?: string; onClick: () => void }[] = [
    { label: 'Find and replace', keys: 'Mod+F', onClick: () => openSide('find') },
    { label: 'Check the page', keys: 'Shift+Mod+K', onClick: () => openSide({ type: 'check', tab: 'accessibility' }) },
    { label: 'Check links', onClick: () => openSide({ type: 'check', tab: 'links' }) },
    { label: 'Media library', keys: 'Shift+Mod+M', onClick: () => openDialog('media') },
    { label: 'Compare with a published version', onClick: () => openDialog('compare') },
    { label: 'Share the draft', onClick: () => openDialog('preview-link') },
    { label: 'Schedule', onClick: () => openDialog('schedule') },
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
            <button type="button" className="btn btn-default btn-sm le-hide-narrow" onClick={() => openDialog('schedule')}>
              Schedule
            </button>
            <button
              type="button"
              className="whova-btn-main small"
              data-tour="publish"
              onClick={() => setDialog('publish')}
              disabled={saveState === 'conflict'}
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
                <FindReplacePanel content={content} onEdit={edit} onJump={jump} onClose={() => setSide(null)} />
              ) : side ? (
                <CheckerPanel key={side.tab} content={content} onJump={jump} onClose={() => setSide(null)} initialTab={side.tab} />
              ) : (
                <SettingsPanel
                  {...pane}
                  siteOrigin={siteOrigin}
                  uploadImage={uploadImage}
                  onSaveToLibrary={(sectionId) => openDialog({ type: 'save-library', sectionId })}
                />
              )}
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
          <HistoryDialog versions={versions} siteOrigin={siteOrigin} onRestored={onRestored} onClose={() => setDialog(null)} />
        )}
        {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
        {dialog === 'compare' && <CompareDialog versions={versions} draft={content} siteOrigin={siteOrigin} onClose={() => setDialog(null)} />}
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

/** The More menu: every page tool by name, for people who do not know the shortcuts. */
function ToolsMenu({
  items,
  keys,
  onClose,
}: {
  items: { label: string; keys?: string; onClick: () => void }[];
  keys: (combo: string) => string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
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
        const list = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
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
        <button key={it.label} type="button" role="menuitem" className="le-menu-item" onClick={it.onClick}>
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
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label || 'Untitled section'}
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
