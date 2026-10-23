'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { ImageShape, ImageWidth, LinkButton, PageImage, RichContent } from '@kgc/shared';
import type { Editor } from '@tiptap/core';
import { AllSelection, Selection } from '@tiptap/pm/state';
import { RichEditor, editorForElement, type CaretInfo, type HostKey } from '@/components/rich-editor';
import { isOffsite, normalizeLinkInput } from '@/lib/learn-inline-core';
import type { BlockPatch } from '@/lib/learn-editor-core';
import { isRefusedHref, LEARN_LIMITS } from '@/lib/learn-page-core';
import { useEditorServices } from '../editor-context';
import { Picture } from '../preview-parts';
import { useRichAnchors, useRichChange } from '../rich-field';
import './inline.css';

/**
 * The pieces that make every word on the Learn preview editable where it is
 * drawn (T329): plain words, rich text, a link or button with a small box for
 * its address, an image with a floating bar, and the little add and remove
 * controls of a repeating item. The owner asked for the page to work like a
 * document: click the words and type.
 */

/* ── The block being edited ─────────────────────────────────────────────── */

export interface InlineBlockCtx {
  blockId: string;
  /** One edit of the block, coalesced into one undo step per pause like any typing. */
  patch: (patch: BlockPatch) => void;
}

export const InlineBlockContext = createContext<InlineBlockCtx | null>(null);

export function useInlineBlock(): InlineBlockCtx {
  const ctx = useContext(InlineBlockContext);
  if (!ctx) throw new Error('An in-place field is outside its block.');
  return ctx;
}

/**
 * Floating things (the formatting bubble, the block picker) mount in the
 * editor's own full-window layer: outside the zoomed preview, so they keep
 * their size, and in the same stacking layer as the editor's dialogs, which
 * then cover them.
 */
export function floatingLayer(): HTMLElement {
  return document.querySelector<HTMLElement>('.le-root') ?? document.body;
}

/* ── Where the caret goes next ──────────────────────────────────────────── */

/**
 * After Enter makes a new item, or Backspace removes one, the field that
 * should take the caret is named here. A field drawn for the first time
 * claims it when it appears; one already on the page (the item above, after
 * one is removed) is looked for each frame, because nothing new is drawn to
 * claim it (T332: the caret used to be lost, and the next words with it).
 */
export type FocusMode = 'end' | 'start' | 'select';

let pendingFocus: { key: string; mode: FocusMode } | null = null;

export function requestFieldFocus(key: string, mode: FocusMode = 'end') {
  const mine = { key, mode };
  pendingFocus = mine;
  let left = 30;
  // Once placed, the caret is watched for a few frames more: the block may be
  // drawn again just after (a production build gets there sooner than the
  // first frame), and a caret that falls back to the page is put back.
  let watch = 0;
  const tick = () => {
    if (watch > 0) {
      if (pendingFocus && pendingFocus !== mine) return;
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost) focusFieldNow(key, 'end');
      if (--watch > 0) requestAnimationFrame(tick);
      return;
    }
    if (pendingFocus !== mine) return;
    if (focusFieldNow(key, mode)) {
      pendingFocus = null;
      watch = 12;
      requestAnimationFrame(tick);
      return;
    }
    if (--left > 0) requestAnimationFrame(tick);
    else pendingFocus = null;
  };
  requestAnimationFrame(tick);
}

function claimFocus(key: string): FocusMode | null {
  if (pendingFocus?.key !== key) return null;
  const { mode } = pendingFocus;
  pendingFocus = null;
  return mode;
}

/** True while a field has been asked for and has not taken the caret yet. */
export function focusPending(): boolean {
  return pendingFocus !== null;
}

/** The in-place fields that take typing: plain words and rich text, not images. */
const TYPED_FIELD = '.lp-rich-field[data-lp-field], [contenteditable][data-lp-field]';

function typedFieldsIn(el: Element | null | undefined): HTMLElement[] {
  if (!el) return [];
  const own = el.matches(TYPED_FIELD) ? [el as HTMLElement] : [];
  return [...own, ...el.querySelectorAll<HTMLElement>(TYPED_FIELD)];
}

/**
 * Where the caret goes when `gone` is removed from the page: the end of the
 * last field of its block before it (the item above), else the start of the
 * first one after it. Null when the block has no other words.
 */
export function fieldAfterRemoving(gone: Element): { key: string; mode: FocusMode } | null {
  const all = typedFieldsIn(gone.closest('[data-block-id]')).filter((f) => !gone.contains(f));
  const before = all.filter((f) => gone.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_PRECEDING);
  const pick = before.length ? { el: before[before.length - 1], mode: 'end' as const } : all.length ? { el: all[0], mode: 'start' as const } : null;
  return pick ? { key: pick.el.getAttribute('data-lp-field') ?? '', mode: pick.mode } : null;
}

/**
 * Runs a removal and puts the caret in the field `fieldAfterRemoving` names,
 * unless the removal placed it itself. With no words left in the block (its
 * last column removed), the focus goes to the block's own "+ Add" button,
 * still on the block and never on the page.
 */
export function removeKeepingCaret(gone: Element | null, remove: () => void) {
  const next = gone ? fieldAfterRemoving(gone) : null;
  const blockId = gone?.closest('[data-block-id]')?.getAttribute('data-block-id');
  pendingFocus = null;
  remove();
  if (pendingFocus) return;
  if (next) requestFieldFocus(next.key, next.mode);
  else if (blockId) {
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"] .lp-item-add`)?.focus({ preventScroll: true }),
    );
  }
}

/**
 * The last guard against lost words (T332). When the field holding the caret
 * goes from the page (its item removed, its block drawn again) and the focus
 * falls back to the page itself, the next key went nowhere, and a Backspace
 * then deleted the whole block. Now the next key first puts the caret back in
 * the nearest field of that block, where the key then lands; a Backspace or
 * Delete only does that.
 */
export function useCaretSafetyNet() {
  useEffect(() => {
    let last: { el: Element; blockId: string; y: number } | null = null;
    const onIn = (e: globalThis.FocusEvent) => {
      const t = e.target as Element | null;
      const block = t?.closest?.('[data-block-id]');
      if (!t || !block || !t.closest('[data-lp-field]') || !(t as HTMLElement).isContentEditable) return;
      last = { el: t, blockId: block.getAttribute('data-block-id') ?? '', y: t.getBoundingClientRect().top };
    };
    const swallow = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (document.activeElement && document.activeElement !== document.body) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.key === 'Escape' || e.key === 'Tab') return;
      // A key between a removal and the frame that places the caret: place it now.
      if (pendingFocus) {
        const want = pendingFocus;
        if (focusFieldNow(want.key, want.mode)) {
          if (pendingFocus === want) pendingFocus = null;
          swallow(e);
        } else if (last && !last.el.isConnected) swallow(e);
        return;
      }
      if (!last || last.el.isConnected) return;
      const fields = typedFieldsIn(document.querySelector(`[data-block-id="${CSS.escape(last.blockId)}"]`));
      const y = last.y;
      last = null;
      if (!fields.length) return;
      const near = fields.reduce((a, b) => (Math.abs(b.getBoundingClientRect().top - y) < Math.abs(a.getBoundingClientRect().top - y) ? b : a));
      if (focusFieldNow(near.getAttribute('data-lp-field') ?? '', 'end')) swallow(e);
    };
    document.addEventListener('focusin', onIn);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('focusin', onIn);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);
}

/** Selects every word of a plain editable element, so typing replaces starter words. */
function selectAllIn(el: HTMLElement) {
  el.focus({ preventScroll: true });
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Puts the caret at the end of a plain editable element. */
function caretToEnd(el: HTMLElement) {
  el.focus({ preventScroll: true });
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}

/**
 * The first click on a block selects it and draws its editable twin; the
 * caret then goes where that click landed, as in a document. Tries for a few
 * frames, because a rich text field appears one frame after its block.
 */
export function placeCaretAt(x: number, y: number, root: Element | null, tries = 30) {
  // Read now, while the block is still drawn as the website draws it: the
  // words under the pointer and where in them. Selecting the block draws its
  // editable twin, where empty optional fields can move things down a little,
  // so the same point may no longer be over the same words.
  const before = document.caretRangeFromPoint?.(x, y);
  const clicked =
    before && before.startContainer.nodeType === Node.TEXT_NODE && root?.contains(before.startContainer)
      ? { text: before.startContainer.textContent ?? '', offset: before.startOffset }
      : null;

  const attempt = (left: number) => {
    const same = clicked ? sameWords(root, clicked.text, x, y) : null;
    const field = same?.field ?? fieldNear(x, y, root);
    // A rich text field is drawn a frame or two after its block: wait for its editor.
    const pm = field?.querySelector('.ProseMirror') ?? null;
    if (!field || (field.matches('.lp-rich-field') && !editorForElement(pm))) {
      if (left > 0) requestAnimationFrame(() => attempt(left - 1));
      return;
    }
    // An image answers with its bar, as if it had been clicked again.
    const imageHit = field.querySelector<HTMLButtonElement>(':scope > .lp-img-hit');
    if (imageHit) {
      imageHit.focus({ preventScroll: true });
      imageHit.click();
      return;
    }
    const editor = editorForElement(pm);
    if (editor) {
      let pos: number | undefined;
      if (same && clicked) {
        try {
          pos = editor.view.posAtDOM(same.node, Math.min(clicked.offset, same.node.length));
        } catch {
          pos = undefined;
        }
      }
      pos ??= editor.view.posAtCoords({ left: x, top: y })?.pos;
      editor.chain().focus(pos ?? 'end', { scrollIntoView: false }).run();
      return;
    }
    const target = field.isContentEditable ? field : field.querySelector<HTMLElement>('[contenteditable]');
    if (!target) return;
    target.focus({ preventScroll: true });
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    if (same && clicked && target.contains(same.node)) {
      range.setStart(same.node, Math.min(clicked.offset, same.node.length));
    } else {
      const atPoint = document.caretRangeFromPoint?.(x, y);
      if (atPoint && target.contains(atPoint.startContainer)) range.setStart(atPoint.startContainer, atPoint.startOffset);
      else {
        caretToEnd(target);
        return;
      }
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  };
  requestAnimationFrame(() => attempt(tries));
}

/** The text node in an editable field holding exactly the words that were clicked, nearest the click when several do. */
function sameWords(root: Element | null, text: string, x: number, y: number): { field: HTMLElement; node: Text } | null {
  if (!root || !text.trim()) return null;
  let best: { field: HTMLElement; node: Text } | null = null;
  let bestD = Infinity;
  for (const field of root.querySelectorAll<HTMLElement>('[data-lp-field]')) {
    const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.textContent !== text) continue;
      const r = document.createRange();
      r.selectNodeContents(node);
      const b = r.getBoundingClientRect();
      const d = Math.hypot(b.left + b.width / 2 - x, b.top + b.height / 2 - y);
      if (d < bestD) {
        bestD = d;
        best = { field, node };
      }
    }
  }
  return best;
}

/** The field under the point, or the nearest one in the block when the click fell between fields. */
function fieldNear(x: number, y: number, root: Element | null): HTMLElement | null {
  const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-lp-field]');
  if (hit && (!root || root.contains(hit))) return hit;
  if (!root) return null;
  let best: HTMLElement | null = null;
  let bestD = Infinity;
  for (const el of root.querySelectorAll<HTMLElement>('[data-lp-field]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const d = dx * dx + dy * dy * 4;
    if (d < bestD) {
      bestD = d;
      best = el;
    }
  }
  return best;
}

/** The shell's services, or a stand-in that picks nothing (a block drawn outside the editor). */
export function useEditorServicesSafe() {
  const services = useEditorServices();
  return (
    services ?? {
      siteOrigin: '',
      anchors: [],
      pickImage: async () => null,
      editImage: async () => null,
    }
  );
}

/* ── Plain words ────────────────────────────────────────────────────────── */

function caretInfo(el: HTMLElement): CaretInfo {
  const text = el.textContent ?? '';
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { empty: text === '', atStart: false, atEnd: false };
  const r = sel.getRangeAt(0);
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(r.startContainer, r.startOffset);
  const offset = before.toString().length;
  return { empty: text === '', atStart: r.collapsed && offset === 0, atEnd: r.collapsed && offset === text.length };
}

/** How many characters of `el` the selection covers. */
function selectedLength(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return 0;
  return sel.toString().length;
}

const HOST_KEYS: Record<string, HostKey> = { Enter: 'Enter', Backspace: 'Backspace', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown' };

export interface PlainTextProps {
  value: string;
  onChange: (text: string) => void;
  /** Names the field for the caret store, unique on the page. */
  fieldKey: string;
  /** What a screen reader calls it, and the grey hint while it is empty. */
  label: string;
  placeholder?: string;
  tag?: 'span' | 'p' | 'h3' | 'strong' | 'div';
  className?: string;
  onHostKey?: (key: HostKey, at: CaretInfo) => boolean;
  /**
   * The server's limit for the field (`LEARN_LIMITS`). Typing stops there and
   * a paste is cut to fit, so one long field cannot hold up the page's
   * autosave (T332).
   */
  maxLength?: number;
}

/**
 * Words with no formatting (a name, a title, a caption), typed straight into
 * the page. `plaintext-only` keeps pasted styles out; Enter never makes a
 * second line, it goes to the host (a new item) or does nothing.
 */
export function PlainText({ value, onChange, fieldKey, label, placeholder, tag = 'span', className, onHostKey, maxLength }: PlainTextProps) {
  const ref = useRef<HTMLElement>(null);
  const Tag = tag;
  const max = useRef(maxLength);
  max.current = maxLength;

  // The text is the element's own, not React's: React re-rendering children
  // under a caret moves the caret. It is written only when the stored value
  // changed from somewhere else (undo, the panel, find and replace).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if ((el.textContent ?? '') !== value) el.textContent = value;
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    const mode = el ? claimFocus(fieldKey) : null;
    if (!el || !mode) return;
    if (mode === 'select') selectAllIn(el);
    else {
      caretToEnd(el);
      if (mode === 'start') window.getSelection()?.collapse(el, 0);
    }
  });

  // Typing past the limit does nothing, as in a box with a maxlength.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onBefore = (e: InputEvent) => {
      const limit = max.current;
      if (!limit || !e.inputType.startsWith('insert') || e.inputType === 'insertFromPaste') return;
      const room = limit - (el.textContent ?? '').length + selectedLength(el);
      if ((e.data ?? '').length > room) e.preventDefault();
    };
    el.addEventListener('beforeinput', onBefore);
    return () => el.removeEventListener('beforeinput', onBefore);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const key = e.key === 'Tab' ? (e.shiftKey ? 'ShiftTab' : 'Tab') : HOST_KEYS[e.key];
    if (key && !e.metaKey && !e.ctrlKey && !e.altKey && !(key === 'Enter' && e.shiftKey)) {
      if (onHostKey?.(key, caretInfo(e.currentTarget))) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === 'Enter') e.preventDefault();
    if (e.key === 'Escape') e.currentTarget.blur();
  };

  return (
    <Tag
      ref={ref as never}
      className={`lp-plain${className ? ` ${className}` : ''}`}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      data-placeholder={placeholder ?? label}
      data-lp-field={fieldKey}
      spellCheck
      data-maxlength={maxLength}
      onInput={(e) => {
        const el = e.currentTarget;
        let text = (el.textContent ?? '').replace(/\n/g, ' ');
        // Whatever got past the guard above (a composed character, a drop).
        if (maxLength && text.length > maxLength) {
          text = text.slice(0, maxLength);
          el.textContent = text;
          caretToEnd(el);
        }
        onChange(text);
      }}
      onKeyDown={onKeyDown}
      // Pasted words only, on one line.
      onPaste={(e) => {
        e.preventDefault();
        let text = e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' ');
        if (maxLength) text = text.slice(0, Math.max(0, maxLength - (e.currentTarget.textContent ?? '').length + selectedLength(e.currentTarget)));
        if (text) document.execCommand('insertText', false, text);
      }}
    />
  );
}

/* ── Rich text ──────────────────────────────────────────────────────────── */

export interface InlineRichProps {
  value: RichContent;
  onChange: (value: RichContent) => void;
  fieldKey: string;
  label: string;
  placeholder?: string;
  singleLine?: boolean;
  className?: string;
  onHostKey?: (key: HostKey, at: CaretInfo) => boolean;
  onEditor?: Parameters<typeof RichEditor>[0]['onEditor'];
  tableOnly?: boolean;
}

/** T317's editor in its inline form, with the floating toolbar over selected words. */
export function InlineRich({ value, onChange, fieldKey, label, placeholder, singleLine = false, className, onHostKey, onEditor, tableOnly }: InlineRichProps) {
  const anchors = useRichAnchors();
  const change = useRichChange(value, singleLine, onChange);
  return (
    <div className={`lp-editing lp-rich-field${className ? ` ${className}` : ''}`} data-lp-field={fieldKey}>
      <RichEditor
        value={value}
        onChange={change}
        variant="inline"
        singleLine={singleLine}
        anchors={anchors}
        ariaLabel={label}
        placeholder={placeholder ?? label}
        onHostKey={onHostKey}
        floatingRoot={floatingLayer}
        tableOnly={tableOnly}
        onEditor={(editor) => {
          const mode = editor ? claimFocus(fieldKey) : null;
          if (editor && mode) focusEditorNow(editor, mode);
          onEditor?.(editor);
        }}
      />
    </div>
  );
}

/* ── Popovers ───────────────────────────────────────────────────────────── */

/**
 * A small box under a field while it has the focus. On a phone it is a sheet
 * along the bottom of the screen instead (`inline.css`), so a thumb can reach it.
 */
function useFocusWithin(): [
  boolean,
  { onFocus: (e: FocusEvent) => void; onBlur: (e: FocusEvent) => void; onKeyDown: (e: KeyboardEvent) => void },
  (v: boolean) => void,
] {
  const [open, setOpen] = useState(false);
  return [
    open,
    {
      onFocus: (e: FocusEvent) => {
        setOpen(true);
        // On a phone the box is a sheet over the bottom of the screen: lift the words above it.
        const field = e.target as HTMLElement;
        if (window.matchMedia('(max-width: 700px)').matches && field.isContentEditable) {
          requestAnimationFrame(() => field.scrollIntoView({ block: 'center' }));
        }
      },
      onBlur: (e: FocusEvent) => {
        const next = e.relatedTarget as Node | null;
        if (!next || !(e.currentTarget as Node).contains(next)) setOpen(false);
      },
      // Escape puts the box away and leaves the words; the page's own Escape is not triggered.
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        setOpen(false);
        (document.activeElement as HTMLElement | null)?.blur();
      },
    },
    setOpen,
  ];
}

/* ── Links and buttons ──────────────────────────────────────────────────── */

const BUTTON_CLASS = { primary: 'lp-btn lp-btn-primary', secondary: 'lp-btn lp-btn-secondary', text: 'lp-textlink' } as const;

export interface EditableLinkProps {
  link: LinkButton;
  onChange: (link: LinkButton) => void;
  onRemove?: () => void;
  fieldKey: string;
  /** How it is drawn: the block's own classes for a button or a text link. */
  className?: string;
  label?: string;
}

/**
 * A button or link whose words are typed in place. While it has the focus, a
 * small box under it takes the address: paste a link, or pick a part of this
 * page. A link to another website opens a new tab on the page by itself, and
 * the box says so.
 */
export function EditableLink({ link, onChange, onRemove, fieldKey, className, label = 'Button' }: EditableLinkProps) {
  const [open, focusProps] = useFocusWithin();
  const services = useEditorServices();
  const anchors = services?.anchors ?? [];
  const id = useId();
  const address = useTypedAddress(link.href, (href) => onChange({ ...link, href }), normalizeLinkInput);
  const self = useRef<HTMLSpanElement>(null);

  const cls = className ?? BUTTON_CLASS[link.style] ?? BUTTON_CLASS.primary;
  return (
    <span ref={self} className="lp-link-edit" {...focusProps} data-open={open || undefined}>
      <PlainText
        value={link.label}
        onChange={(text) => onChange({ ...link, label: text })}
        fieldKey={fieldKey}
        label={`${label} words`}
        placeholder="Button words"
        className={cls}
        maxLength={LEARN_LIMITS.label}
      />
      {open && (
        <span className="lp-pop lp-link-pop" role="group" aria-label={`${label} address`} onClick={(e) => e.stopPropagation()}>
          <label className="lp-pop-label" htmlFor={id}>
            Goes to
          </label>
          <input
            id={id}
            className="lp-pop-input"
            placeholder="Paste a link, like https://example.com"
            spellCheck={false}
            maxLength={LEARN_LIMITS.href}
            {...address.inputProps}
          />
          {anchors.length > 0 && (
            <select
              className="lp-pop-input"
              aria-label="Or a part of this page"
              value={link.href.startsWith('#') ? link.href.slice(1) : ''}
              onChange={(e) => e.target.value && address.commit(`#${e.target.value}`, true)}
            >
              <option value="">Or a part of this page...</option>
              {anchors.map((a) => (
                <option key={a.anchor} value={a.anchor}>
                  {a.label}
                </option>
              ))}
            </select>
          )}
          {address.error ? (
            <span className="lp-pop-error" role="alert">
              {address.error}
            </span>
          ) : link.href && isOffsite(link.href) ? (
            <span className="lp-pop-note">Another website: it opens in a new tab.</span>
          ) : !link.href ? (
            <span className="lp-pop-note">No address yet, so the button does nothing.</span>
          ) : null}
          {onRemove && (
            <button type="button" className="lp-pop-remove" onClick={() => removeKeepingCaret(self.current, onRemove)}>
              Remove {label.toLowerCase()}
            </button>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * The words typed in an address box, stored as they are typed (T332): the
 * page used to keep them until Enter or leaving the box, so "Saved" showed
 * while the address was not, and a reload lost it. An address that cannot be
 * stored yet (half typed, or `javascript:`) is held in the box, and says why
 * after a pause or on Enter. The box is not rewritten under the caret: the
 * stored form (https:// added) shows once you leave it.
 */
function useTypedAddress(
  value: string,
  onChange: (href: string) => void,
  check: (typed: string) => { href: string } | { error: string },
) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const sent = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    // A change from elsewhere (undo, the panel); not the echo of our own.
    if (value !== sent.current) {
      sent.current = value;
      setDraft(value);
      setError('');
    }
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (typed: string, final: boolean) => {
    clearTimeout(timer.current);
    if (!typed.trim()) {
      setError('');
      if (sent.current !== '') {
        sent.current = '';
        onChange('');
      }
      return;
    }
    const r = check(typed);
    if ('error' in r) {
      if (final) setError(r.error);
      else timer.current = setTimeout(() => setError(r.error), 900);
      return;
    }
    setError('');
    if (r.href !== sent.current) {
      sent.current = r.href;
      onChange(r.href);
    }
    if (final) setDraft(r.href);
  };

  return {
    error,
    commit,
    inputProps: {
      value: draft,
      'aria-invalid': error ? true : undefined,
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        setDraft(e.target.value);
        commit(e.target.value, false);
      },
      onBlur: () => commit(draft, true),
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(draft, true);
        }
      },
    },
  };
}

/* ── Images ─────────────────────────────────────────────────────────────── */

const SIZES: { value: ImageWidth; label: string }[] = [
  { value: 'small', label: 'S' },
  { value: 'medium', label: 'M' },
  { value: 'large', label: 'L' },
  { value: 'full', label: 'Full' },
];

const SIZE_NAMES: Record<ImageWidth, string> = { small: 'Small', medium: 'Medium', large: 'Large', full: 'Full width' };

export interface EditableImageProps {
  image: PageImage | undefined;
  onChange: (image: PageImage) => void;
  onRemove?: () => void;
  shape: ImageShape;
  siteOrigin: string;
  className?: string;
  /** What it is, for the buttons ("Photo", "Logo"). */
  label?: string;
  size?: { value: ImageWidth; onChange: (w: ImageWidth) => void };
  /** Shown instead of the picture when there is none, for a card that may go without. */
  emptyText?: string;
  fieldKey: string;
  /** Where a click on the picture goes on the website, for an image or a logo that links somewhere. */
  link?: { value: string; onChange: (href: string) => void };
}

/**
 * An image that answers a click with a small bar: Replace (the media
 * library), Edit image (crop, rotate, focal point), a description for screen
 * readers, the size where the block has one, and Remove.
 */
export function EditableImage({ image, onChange, onRemove, shape, siteOrigin, className, label = 'Image', size, emptyText, fieldKey, link }: EditableImageProps) {
  const services = useEditorServices();
  // The bar opens on a click, not on focus: the media library gives the focus
  // back to the picture when it closes, which reopened the bar over the page (T332).
  const [open, { onBlur, onKeyDown }, setOpen] = useFocusWithin();
  const focusProps = { onBlur, onKeyDown };
  const self = useRef<HTMLSpanElement>(null);
  const [alt, setAlt] = useState(false);
  const [linking, setLinking] = useState(false);
  const altId = useId();

  const replace = async () => {
    const picked = await services?.pickImage({ title: `Choose ${label.toLowerCase()}` });
    if (picked) onChange(picked);
    // Done with this picture: the bar goes, so it does not cover the page.
    setOpen(false);
  };
  const edit = async () => {
    if (!image?.src) return;
    const edited = await services?.editImage(image);
    if (edited) onChange(edited);
    setOpen(false);
  };

  const has = !!image?.src;
  return (
    <span ref={self} className="lp-img-edit" {...focusProps} data-open={open || undefined} data-lp-field={fieldKey}>
      <button
        type="button"
        className="lp-img-hit"
        aria-label={has ? `${label}: ${image?.alt || 'no description'}. Change it` : `Choose ${label.toLowerCase()}`}
        onClick={(e) => {
          e.stopPropagation();
          if (!has) void replace();
          else setOpen(true);
        }}
      >
        {has || !emptyText ? (
          <Picture image={image ?? { src: '', alt: '', width: 0, height: 0 }} shape={shape} siteOrigin={siteOrigin} className={className} />
        ) : (
          <span className={`lp-img-empty lp-img-add ${className ?? ''}`}>{emptyText}</span>
        )}
      </button>
      {open && has && image && (
        <span className="lp-pop lp-img-bar" role="toolbar" aria-label={`${label} tools`} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => void replace()}>
            Replace
          </button>
          <button type="button" onClick={() => void edit()}>
            Edit image
          </button>
          <button type="button" aria-expanded={alt} onClick={() => setAlt((v) => !v)}>
            Description
          </button>
          {size && (
            <span className="lp-img-sizes" role="radiogroup" aria-label="Size">
              {SIZES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={size.value === s.value}
                  aria-label={SIZE_NAMES[s.value]}
                  title={SIZE_NAMES[s.value]}
                  onClick={() => size.onChange(s.value)}
                >
                  {s.label}
                </button>
              ))}
            </span>
          )}
          {link && (
            <button type="button" aria-expanded={linking} onClick={() => setLinking((v) => !v)}>
              Link
            </button>
          )}
          {onRemove && (
            <button type="button" className="lp-pop-remove" onClick={() => removeKeepingCaret(self.current, () => (setOpen(false), onRemove()))}>
              Remove
            </button>
          )}
          {linking && link && (
            <span className="lp-img-alt">
              <UrlField label="Goes to when clicked" value={link.value} onChange={link.onChange} placeholder="https://example.com (leave empty for no link)" />
            </span>
          )}
          {alt && (
            <span className="lp-img-alt">
              <label htmlFor={altId}>Description for screen readers</label>
              <input
                id={altId}
                className="lp-pop-input"
                maxLength={LEARN_LIMITS.alt}
                value={image.alt}
                placeholder="What the picture shows, for people who cannot see it"
                onChange={(e) => onChange({ ...image, alt: e.target.value })}
              />
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/* ── Repeating items ────────────────────────────────────────────────────── */

/** A small round "x" on an item, shown while the pointer or the caret is in it. */
export function RemoveItem({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      className="lp-item-remove"
      aria-label={`Remove ${label}`}
      title={`Remove ${label}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        // The caret goes to the item above, never to the page, where the next
        // Backspace would delete the whole block (T332).
        removeKeepingCaret(e.currentTarget.closest('.lp-item-shell'), onRemove);
      }}
    >
      <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** "+ Add a card" after the last item. */
export function AddItem({ label, onAdd, className }: { label: string; onAdd: () => void; className?: string }) {
  return (
    <button
      type="button"
      className={`lp-item-add${className ? ` ${className}` : ''}`}
      // Backspace here is a slip after removing the last item, not "delete the block".
      onKeyDown={(e) => {
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onClick={(e) => {
        e.stopPropagation();
        onAdd();
      }}
    >
      <span aria-hidden="true">+</span> {label}
    </button>
  );
}

/** A wrapper that shows its RemoveItem on hover or focus. */
export function ItemShell({ children, className, tag = 'div' }: { children: ReactNode; className?: string; tag?: 'div' | 'li' | 'article' | 'figure' }) {
  const Tag = tag;
  return <Tag className={`lp-item-shell${className ? ` ${className}` : ''}`}>{children}</Tag>;
}

/** A stable callback for a patch built from the latest props. */
export function usePatch<T>(fn: (value: T) => BlockPatch): (value: T) => void {
  const { patch } = useInlineBlock();
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  return useCallback((value: T) => patch(latest.current(value)), [patch]);
}

/**
 * Puts the caret in a rich text field at once. TipTap's own focus command
 * waits for the next frame, and a key pressed in that frame went to the page
 * (T332): this sets the selection and focuses the view straight away.
 */
function focusEditorNow(editor: Editor, at: FocusMode) {
  if (editor.isDestroyed) return;
  const { state, view } = editor;
  const sel = at === 'select' ? new AllSelection(state.doc) : at === 'start' ? Selection.atStart(state.doc) : Selection.atEnd(state.doc);
  view.dispatch(state.tr.setSelection(sel));
  view.focus();
}

/** Focuses a field already on the page (the item above, the item below). */
export function focusFieldNow(key: string, at: FocusMode = 'end'): boolean {
  const field = document.querySelector<HTMLElement>(`[data-lp-field="${CSS.escape(key)}"]`);
  if (!field) return false;
  const editor = editorForElement(field.querySelector('.ProseMirror'));
  if (editor) {
    focusEditorNow(editor, at);
    return true;
  }
  if (field.matches('.lp-rich-field')) return false;
  const el = field.isContentEditable ? field : field.querySelector<HTMLElement>('[contenteditable]');
  if (!el) return false;
  if (at === 'select') selectAllIn(el);
  else {
    caretToEnd(el);
    if (at === 'start') window.getSelection()?.collapse(el, 0);
  }
  return true;
}

/** A video or map link, stored as typed: only an address no page may open is held back. */
function rawAddress(typed: string): { href: string } | { error: string } {
  const t = typed.trim();
  return isRefusedHref(t) ? { error: 'Use a link that starts with https://.' } : { href: t };
}

/**
 * An address on its own (a video, a map, a LinkedIn profile): a labelled box
 * under the thing it belongs to, stored as it is typed (`useTypedAddress`).
 */
export function UrlField({
  label,
  value,
  onChange,
  placeholder,
  normalize = true,
  onDone,
}: {
  label: string;
  value: string;
  onChange: (href: string) => void;
  placeholder?: string;
  /** Run the typed address through the same rules as a button's (adds https, refuses javascript:). */
  normalize?: boolean;
  /** Enter or Escape in the box: the host may put it away. */
  onDone?: () => void;
}) {
  const id = useId();
  const address = useTypedAddress(value, onChange, normalize ? normalizeLinkInput : rawAddress);
  return (
    <span className="lp-url-field" onClick={(e) => e.stopPropagation()}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="lp-pop-input"
        placeholder={placeholder}
        spellCheck={false}
        maxLength={LEARN_LIMITS.href}
        {...address.inputProps}
        onKeyDown={(e) => {
          address.inputProps.onKeyDown(e);
          if (e.key === 'Escape' || (e.key === 'Enter' && !address.error)) onDone?.();
        }}
      />
      {address.error && (
        <span className="lp-pop-error" role="alert">
          {address.error}
        </span>
      )}
    </span>
  );
}
