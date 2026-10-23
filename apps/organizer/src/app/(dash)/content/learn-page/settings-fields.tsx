'use client';

import { createContext, useContext, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Align, BandBackground, Columns, ImageShape, ImageWidth, LinkButton, PageImage, Spacing, TextSize } from '@kgc/shared';
import { resolveSrc } from './editor-types';
import './settings.css';

/**
 * The labelled inputs every settings form of the Learn editor is built from
 * (T310, split out in T318 so the v2 block forms share them). They hold no
 * content: each reads its value from props and reports a change.
 */

// ─── Small pieces ─────────────────────────────────────────────────────────────

export interface Opt<T> {
  value: T | undefined;
  label: string;
  icon?: ReactNode;
}

/** A row of radio buttons that looks like a segmented control. Nothing checked means the default. */
export function Segmented<T extends string | number>({
  legend,
  value,
  options,
  onChange,
  iconOnly = false,
}: {
  legend: string;
  value: T | undefined;
  options: Opt<T>[];
  onChange: (v: T | undefined) => void;
  iconOnly?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="le-set-field le-set-fieldset">
      <legend className="le-set-label">{legend}</legend>
      <div className={`le-set-seg${iconOnly ? ' icons' : ''}`}>
        {options.map((o) => {
          const key = o.value === undefined ? 'default' : String(o.value);
          return (
            <label key={key} className="le-set-seg-opt" title={iconOnly ? o.label : undefined}>
              <input
                type="radio"
                name={name}
                checked={o.value === value}
                onChange={() => onChange(o.value)}
                aria-label={iconOnly ? o.label : undefined}
              />
              <span>
                {o.icon}
                {!iconOnly && o.label}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Text({
  label,
  value,
  onChange,
  hint,
  placeholder,
  maxLength,
  warn,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  placeholder?: string;
  maxLength?: number;
  warn?: string | null;
  type?: 'text' | 'url';
}) {
  const id = useId();
  return (
    <div className="le-set-field">
      <label className="le-set-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        className="whova-text-input le-set-input"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="le-set-hint">{hint}</p>}
      {warn && (
        <p className="le-set-warn" role="status">
          {warn}
        </p>
      )}
    </div>
  );
}

export function Area({
  label,
  value,
  onChange,
  hint,
  rows = 3,
  maxLength,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  rows?: number;
  maxLength?: number;
  onBlur?: () => void;
}) {
  const id = useId();
  return (
    <div className="le-set-field">
      <label className="le-set-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="whova-text-input le-set-input le-set-area"
        rows={rows}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {hint && <p className="le-set-hint">{hint}</p>}
    </div>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="le-set-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// ─── More options ─────────────────────────────────────────────────────────────

/*
 * The panel shows the few options most people need first and keeps the rest
 * under one "More options" disclosure. A form wraps its rarer fields in
 * <More>, which moves them into that disclosure through a portal, so a form
 * stays one component with one set of state while its fields sit in two
 * places. Whether the disclosure is open is remembered for the whole panel.
 */

const MORE_KEY = 'learn-editor:more-options';
const moreListeners = new Set<() => void>();
let moreOpen: boolean | null = null;

function getMoreOpen(): boolean {
  if (moreOpen === null) {
    try {
      moreOpen = window.localStorage.getItem(MORE_KEY) === 'open';
    } catch {
      moreOpen = false;
    }
  }
  return moreOpen;
}

function setMoreOpen(open: boolean) {
  moreOpen = open;
  try {
    window.localStorage.setItem(MORE_KEY, open ? 'open' : 'closed');
  } catch {
    // Storage blocked: it stays as chosen until the page reloads.
  }
  moreListeners.forEach((l) => l());
}

function subscribeMoreOpen(l: () => void) {
  moreListeners.add(l);
  return () => {
    moreListeners.delete(l);
  };
}

/** undefined: no disclosure, render in place. null: the disclosure is not on screen yet. */
const MoreSlot = createContext<HTMLElement | null | undefined>(undefined);

/** Fields most people never need: shown under "More options" when the panel has one. */
export function More({ children }: { children: ReactNode }) {
  const slot = useContext(MoreSlot);
  if (slot === undefined) return <>{children}</>;
  return slot ? createPortal(children, slot) : null;
}

/** Wraps a panel body and adds the closed-by-default "More options" disclosure under it. */
export function WithMoreOptions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const open = useSyncExternalStore(subscribeMoreOpen, getMoreOpen, () => false);
  const bodyId = useId();
  return (
    <MoreSlot.Provider value={slot}>
      {children}
      <div className="le-set-more">
        <button
          type="button"
          className="le-set-more-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setMoreOpen(!open)}
        >
          <span className="le-set-caret" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          More options
        </button>
        <div id={bodyId} ref={setSlot} className="le-set-more-body" hidden={!open} />
      </div>
    </MoreSlot.Provider>
  );
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="le-set-group">
      <h3 className="le-set-group-title">{title}</h3>
      {children}
    </section>
  );
}

/** Delete with an inline "are you sure", never `window.confirm`. */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  className = 'btn btn-default btn-sm',
}: {
  label: string;
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button type="button" className={className} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  return (
    <span className="le-set-confirm" role="group" aria-label={question}>
      <span className="le-set-confirm-q">{question}</span>
      <button
        type="button"
        className="btn btn-danger btn-sm"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="btn btn-default btn-sm" onClick={() => setAsking(false)} autoFocus>
        Cancel
      </button>
    </span>
  );
}

/** Up, down and remove for one row of a list. */
export function RowTools({
  index,
  count,
  name,
  onMove,
  onRemove,
  confirmRemove,
}: {
  index: number;
  count: number;
  name: string;
  onMove: (to: number) => void;
  onRemove: () => void;
  confirmRemove?: boolean;
}) {
  return (
    <span className="le-set-rowtools">
      <button
        type="button"
        className="le-set-icon-btn"
        aria-label={`Move ${name} up`}
        title="Move up"
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M8 3 L13 9 H3 Z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="le-set-icon-btn"
        aria-label={`Move ${name} down`}
        title="Move down"
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M8 13 L3 7 H13 Z" fill="currentColor" />
        </svg>
      </button>
      {confirmRemove ? (
        <ConfirmButton
          label="Remove"
          question={`Remove ${name}?`}
          confirmLabel="Remove"
          onConfirm={onRemove}
          className="le-set-link danger"
        />
      ) : (
        <button type="button" className="le-set-link danger" aria-label={`Remove ${name}`} onClick={onRemove}>
          Remove
        </button>
      )}
    </span>
  );
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function replaceAt<T>(list: T[], i: number, item: T): T[] {
  return list.map((x, j) => (j === i ? item : x));
}

export function linkWarning(href: string): string | null {
  const h = href.trim();
  if (!h) return null;
  return /^(https?:\/\/|mailto:|tel:)/i.test(h)
    ? null
    : 'Links should start with https://, http://, mailto: or tel:';
}

/** A copy without one optional key, so "no photo" is an absent key rather than `undefined`. */
export function without<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

// ─── Shared choices ───────────────────────────────────────────────────────────

export const SPACING: Opt<Spacing>[] = [
  { value: 'none', label: 'None' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];
export const SPACING_WITH_DEFAULT: Opt<Spacing>[] = [{ value: undefined, label: 'Default' }, ...SPACING];

export const TEXT_SIZES: Opt<TextSize>[] = [
  { value: 'small', label: 'Small' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
  { value: 'x-large', label: 'Extra large' },
];

export const COLUMN_COUNTS: Opt<Columns>[] = [1, 2, 3, 4].map((n) => ({ value: n as Columns, label: String(n) }));

export const BUTTON_STYLES: Opt<LinkButton['style']>[] = [
  { value: 'primary', label: 'Filled' },
  { value: 'secondary', label: 'Outline' },
  { value: 'text', label: 'Text link' },
];

export function alignIcon(a: Align) {
  const lines = a === 'left' ? [[2, 12], [2, 8], [2, 11]] : a === 'right' ? [[2, 12], [6, 8], [3, 11]] : [[2, 12], [4, 8], [2.5, 11]];
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {lines.map(([x, w], i) => (
        <rect key={i} x={a === 'center' ? 8 - w / 2 : x} y={3 + i * 4} width={w} height="2" rx="1" fill="currentColor" />
      ))}
    </svg>
  );
}

export const ALIGNS: Opt<Align>[] = (['left', 'center', 'right'] as const).map((a) => ({
  value: a,
  label: a === 'left' ? 'Align left' : a === 'center' ? 'Align center' : 'Align right',
  icon: alignIcon(a),
}));

export const BACKGROUNDS: { value: BandBackground; label: string; color: string; wave?: string }[] = [
  { value: 'plain', label: 'White', color: '#ffffff' },
  { value: 'white-wave', label: 'White with wave', color: '#ffffff', wave: 'wave-3.png' },
  { value: 'light-blue-wave', label: 'Light blue with wave', color: '#e3f5fd', wave: 'wave-3.png' },
  { value: 'blue', label: 'Blue', color: '#8dccee' },
  { value: 'grey-wave', label: 'Grey with wave', color: '#e0e5ee', wave: 'wave-13.png' },
];

export const IMAGE_WIDTHS: { value: ImageWidth; label: string; pct: number }[] = [
  { value: 'small', label: 'Small', pct: 25 },
  { value: 'medium', label: 'Medium', pct: 50 },
  { value: 'large', label: 'Large', pct: 75 },
  { value: 'full', label: 'Full width', pct: 100 },
];

export const SHAPES: { value: ImageShape; label: string; radius: string; square: boolean }[] = [
  { value: 'original', label: 'Original', radius: '0', square: false },
  { value: 'square', label: 'Square', radius: '0', square: true },
  { value: 'rounded', label: 'Rounded', radius: '6px', square: false },
  { value: 'circle', label: 'Circle', radius: '50%', square: true },
];

export function Thumb({ image, siteOrigin }: { image?: PageImage; siteOrigin: string }) {
  if (!image?.src) return <span className="le-set-thumb empty" aria-hidden="true" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a Storage or site URL, 28px
    <img
      className="le-set-thumb"
      src={resolveSrc(image.src, siteOrigin)}
      alt=""
      style={{ objectPosition: `${(image.focusX ?? 0.5) * 100}% ${(image.focusY ?? 0.5) * 100}%` }}
    />
  );
}

/** An optional link on a list item or a column. */
export function OptionalLink({ link, onChange }: { link?: LinkButton; onChange: (l: LinkButton | undefined) => void }) {
  if (!link)
    return (
      <button
        type="button"
        className="le-set-link"
        onClick={() => onChange({ label: 'Learn more', href: '', style: 'text' })}
      >
        + Add a link
      </button>
    );
  return (
    <div className="le-set-sublink">
      <Text label="Link text" value={link.label} onChange={(label) => onChange({ ...link, label })} />
      <Text
        label="Link"
        type="url"
        value={link.href}
        placeholder="https://"
        onChange={(href) => onChange({ ...link, href })}
        warn={linkWarning(link.href)}
      />
      <Segmented
        legend="Link style"
        value={link.style}
        options={BUTTON_STYLES}
        onChange={(style) => style && onChange({ ...link, style })}
      />
      <button type="button" className="le-set-link danger" onClick={() => onChange(undefined)}>
        Remove link
      </button>
    </div>
  );
}

