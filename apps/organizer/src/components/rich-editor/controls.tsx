'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { platformKeys } from '../../lib/rich-editor/tools';

/**
 * The toolbar's building blocks: a labelled button with a tooltip that names
 * its shortcut, a popover menu button, a modal dialog, and the arrow-key
 * focus model of an ARIA toolbar (one tab stop, arrows move between tools).
 */

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export const keysFor = (keys?: string) => (keys ? platformKeys(keys, IS_MAC) : '');

/** Keeps the editor's selection while a tool is clicked. */
const keepSelection = (e: { preventDefault: () => void }) => e.preventDefault();

export interface ToolButtonProps {
  label: string;
  keys?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  /** Inside a popover panel rather than on the toolbar itself. */
  inPanel?: boolean;
}

export function ToolButton({ label, keys, pressed, disabled, onClick, children, className, inPanel }: ToolButtonProps) {
  const shown = keysFor(keys);
  return (
    <button
      type="button"
      className={`rt-btn${className ? ` ${className}` : ''}`}
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={keys ? keys.replace(/Cmd/g, IS_MAC ? 'Meta' : 'Control') : undefined}
      data-tip={shown ? `${label} (${shown})` : label}
      data-rt-item={inPanel ? undefined : ''}
      disabled={disabled}
      onMouseDown={keepSelection}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Separator() {
  return <span className="rt-sep" role="separator" aria-orientation="vertical" />;
}

/** Keeps a floating panel inside the window, which matters at phone width. */
function useKeepInView(ref: RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    el.style.transform = '';
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    let dx = 0;
    if (r.right > vw - 8) dx = vw - 8 - r.right;
    if (r.left + dx < 8) dx = 8 - r.left;
    if (dx) el.style.transform = `translateX(${Math.round(dx)}px)`;
  }, [open, ref]);
}

export interface PopoverProps {
  label: string;
  keys?: string;
  pressed?: boolean;
  disabled?: boolean;
  /** The trigger's face. */
  face: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
  /** Wider trigger with a caret, for a value such as a colour. */
  caret?: boolean;
  onOpen?: () => void;
}

export function Popover({ label, keys, pressed, disabled, face, children, className, caret, onOpen }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useKeepInView(panel, open);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // First control in the panel, so a keyboard user lands inside it.
    const first = panel.current?.querySelector<HTMLElement>('button:not([disabled]), input, select');
    first?.focus({ preventScroll: true });
  }, [open]);

  const shown = keysFor(keys);
  return (
    <span className={`rt-pop${className ? ` ${className}` : ''}`} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`rt-btn${caret ? ' rt-btn-caret' : ''}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-pressed={pressed}
        data-tip={shown ? `${label} (${shown})` : label}
        data-rt-item=""
        disabled={disabled}
        onMouseDown={keepSelection}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen((v) => !v);
        }}
      >
        {face}
        {caret && (
          <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true" className="rt-caret">
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="3" />
          </svg>
        )}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          className="rt-panel"
          role="dialog"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        >
          {children(() => close(false))}
        </div>
      )}
    </span>
  );
}

/** Arrow keys move between toolbar items; only one of them is in the tab order. */
export function useRovingToolbar(ref: RefObject<HTMLElement | null>) {
  const active = useRef(0);

  const items = useCallback(() => {
    const root = ref.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>('[data-rt-item]')).filter(
      (el) => !el.closest('.rt-panel') && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0,
    );
  }, [ref]);

  const sync = useCallback(() => {
    const list = items();
    if (active.current >= list.length) active.current = 0;
    list.forEach((el, i) => {
      el.tabIndex = i === active.current ? 0 : -1;
    });
  }, [items]);

  useEffect(() => {
    sync();
  });

  const onFocus = (e: { target: EventTarget }) => {
    const i = items().indexOf(e.target as HTMLElement);
    if (i >= 0) {
      active.current = i;
      sync();
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('.rt-panel') || t.tagName === 'INPUT') return;
    const list = items();
    const i = list.indexOf(t);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    if (next < 0) return;
    e.preventDefault();
    active.current = next;
    sync();
    list[next].focus();
  };

  return { onFocus, onKeyDown };
}

export interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/** A modal over the whole window, in a portal so a preview frame cannot clip it. */
export function Dialog({ title, onClose, children, footer, wide }: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const first = box.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button');
    first?.focus();
  }, []);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !box.current) return;
    const focusable = Array.from(
      box.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, a[href]'),
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="rt-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        className={`rt-dialog${wide ? ' rt-dialog-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <div className="rt-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="rt-icon-btn" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="rt-dialog-body">{children}</div>
        {footer && <div className="rt-dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
