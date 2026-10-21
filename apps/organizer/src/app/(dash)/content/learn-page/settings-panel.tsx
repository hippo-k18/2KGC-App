'use client';

import { useId, useState, type DragEvent, type ReactNode } from 'react';
import type {
  Align,
  BandBackground,
  Columns,
  ImageShape,
  ImageWidth,
  LearnSection,
  LinkButton,
  PageImage,
  Person,
  Spacing,
  TextSize,
} from '@kgc/shared';
import {
  findBlock,
  kindLabel,
  newId,
  videoEmbedUrl,
  EMPTY_IMAGE,
  type BlockOf,
  type BlockPatch,
  type SectionPatch,
} from '@/lib/learn-editor-core';
import { resolveSrc, type PaneProps, type UploadImage } from './editor-types';
import { ImageTools } from './image-tools';
import './settings.css';

/**
 * The right-hand pane of the Learn page editor: every setting of whatever is
 * selected, as plain labelled choices for a course lead who is not technical
 * (T310). Nothing here holds the content; every input reads from props and
 * every change goes through `onEdit`, so undo and redo move the fields too.
 */

type Extra = { siteOrigin: string; uploadImage: UploadImage };
type Ctx = Extra & { upd: (patch: BlockPatch) => void };

// ─── Small pieces ─────────────────────────────────────────────────────────────

interface Opt<T> {
  value: T | undefined;
  label: string;
  icon?: ReactNode;
}

/** A row of radio buttons that looks like a segmented control. Nothing checked means the default. */
function Segmented<T extends string | number>({
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

function Text({
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

function Area({
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

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="le-set-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="le-set-group">
      <h3 className="le-set-group-title">{title}</h3>
      {children}
    </section>
  );
}

/** Delete with an inline "are you sure", never `window.confirm`. */
function ConfirmButton({
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
function RowTools({
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

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function replaceAt<T>(list: T[], i: number, item: T): T[] {
  return list.map((x, j) => (j === i ? item : x));
}

function linkWarning(href: string): string | null {
  const h = href.trim();
  if (!h) return null;
  return /^(https?:\/\/|mailto:|tel:)/i.test(h)
    ? null
    : 'Links should start with https://, http://, mailto: or tel:';
}

/** A copy without one optional key, so "no photo" is an absent key rather than `undefined`. */
function without<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

// ─── Shared choices ───────────────────────────────────────────────────────────

const SPACING: Opt<Spacing>[] = [
  { value: 'none', label: 'None' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];
const SPACING_WITH_DEFAULT: Opt<Spacing>[] = [{ value: undefined, label: 'Default' }, ...SPACING];

const TEXT_SIZES: Opt<TextSize>[] = [
  { value: 'small', label: 'Small' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
  { value: 'x-large', label: 'Extra large' },
];

const COLUMN_COUNTS: Opt<Columns>[] = [1, 2, 3, 4].map((n) => ({ value: n as Columns, label: String(n) }));

const BUTTON_STYLES: Opt<LinkButton['style']>[] = [
  { value: 'primary', label: 'Filled' },
  { value: 'secondary', label: 'Outline' },
  { value: 'text', label: 'Text link' },
];

function alignIcon(a: Align) {
  const lines = a === 'left' ? [[2, 12], [2, 8], [2, 11]] : a === 'right' ? [[2, 12], [6, 8], [3, 11]] : [[2, 12], [4, 8], [2.5, 11]];
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {lines.map(([x, w], i) => (
        <rect key={i} x={a === 'center' ? 8 - w / 2 : x} y={3 + i * 4} width={w} height="2" rx="1" fill="currentColor" />
      ))}
    </svg>
  );
}

const ALIGNS: Opt<Align>[] = (['left', 'center', 'right'] as const).map((a) => ({
  value: a,
  label: a === 'left' ? 'Align left' : a === 'center' ? 'Align center' : 'Align right',
  icon: alignIcon(a),
}));

const BACKGROUNDS: { value: BandBackground; label: string; color: string; wave?: string }[] = [
  { value: 'plain', label: 'White', color: '#ffffff' },
  { value: 'white-wave', label: 'White with wave', color: '#ffffff', wave: 'wave-3.png' },
  { value: 'light-blue-wave', label: 'Light blue with wave', color: '#e3f5fd', wave: 'wave-3.png' },
  { value: 'blue', label: 'Blue', color: '#8dccee' },
  { value: 'grey-wave', label: 'Grey with wave', color: '#e0e5ee', wave: 'wave-13.png' },
];

const IMAGE_WIDTHS: { value: ImageWidth; label: string; pct: number }[] = [
  { value: 'small', label: 'Small', pct: 25 },
  { value: 'medium', label: 'Medium', pct: 50 },
  { value: 'large', label: 'Large', pct: 75 },
  { value: 'full', label: 'Full width', pct: 100 },
];

const SHAPES: { value: ImageShape; label: string; radius: string; square: boolean }[] = [
  { value: 'original', label: 'Original', radius: '0', square: false },
  { value: 'square', label: 'Square', radius: '0', square: true },
  { value: 'rounded', label: 'Rounded', radius: '6px', square: false },
  { value: 'circle', label: 'Circle', radius: '50%', square: true },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

function PageSettings({ content, onEdit }: Pick<PaneProps, 'content' | 'onEdit'>) {
  const titleId = useId();
  const descId = useId();
  return (
    <>
      <Group title="Search and browser tab">
        <div className="le-set-field">
          <label className="le-set-label" htmlFor={titleId}>
            Page title
            <span className="le-set-count">{content.seoTitle.length} / 120</span>
          </label>
          <input
            id={titleId}
            className="whova-text-input le-set-input"
            value={content.seoTitle}
            maxLength={120}
            onChange={(e) => onEdit({ type: 'setPage', patch: { seoTitle: e.target.value } })}
          />
        </div>
        <div className="le-set-field">
          <label className="le-set-label" htmlFor={descId}>
            Page description
            <span className="le-set-count">{content.seoDescription.length} / 320</span>
          </label>
          <textarea
            id={descId}
            className="whova-text-input le-set-input le-set-area"
            rows={4}
            value={content.seoDescription}
            maxLength={320}
            onChange={(e) => onEdit({ type: 'setPage', patch: { seoDescription: e.target.value } })}
          />
        </div>
        <p className="le-set-hint">Shown in the browser tab and in search results.</p>
      </Group>
      <Group title="How to edit">
        <ul className="le-set-tips">
          <li>Click any part of the preview to edit it.</li>
          <li>Drag items in the outline to change their order.</li>
          <li>Your changes save as a draft automatically.</li>
          <li>Nothing is public until you press Publish.</li>
        </ul>
      </Group>
    </>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

function SectionSettings({
  section,
  onEdit,
  siteOrigin,
}: {
  section: LearnSection;
  onEdit: PaneProps['onEdit'];
  siteOrigin: string;
}) {
  const bgName = useId();
  const upd = (patch: SectionPatch) => onEdit({ type: 'updateSection', sectionId: section.id, patch });
  return (
    <>
      <Group title="Section">
        <Text
          label="Section name"
          value={section.label}
          onChange={(label) => upd({ label })}
          hint="Only shown here in the editor, to help you find it."
        />
        <fieldset className="le-set-field le-set-fieldset">
          <legend className="le-set-label">Background</legend>
          <div className="le-set-swatches">
            {BACKGROUNDS.map((b) => (
              <label key={b.value} className="le-set-swatch">
                <input
                  type="radio"
                  name={bgName}
                  checked={section.background === b.value}
                  onChange={() =>
                    upd(
                      b.value === 'grey-wave'
                        ? { background: b.value }
                        : { background: b.value, waveBehindFirstImage: undefined },
                    )
                  }
                />
                <span
                  className="le-set-swatch-chip"
                  aria-hidden="true"
                  style={{
                    backgroundColor: b.color,
                    backgroundImage: b.wave ? `url(${resolveSrc(`/kgc/${b.wave}`, siteOrigin)})` : undefined,
                  }}
                />
                <span className="le-set-swatch-name">{b.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {section.background === 'grey-wave' && (
          <Check
            label="Wave behind the first image"
            checked={!!section.waveBehindFirstImage}
            onChange={(v) => upd({ waveBehindFirstImage: v ? true : undefined })}
          />
        )}
        <Segmented
          legend="Width"
          value={section.width}
          options={[
            { value: 'narrow', label: 'Narrow' },
            { value: 'normal', label: 'Normal' },
            { value: 'wide', label: 'Wide' },
          ]}
          onChange={(width) => width && upd({ width })}
        />
        <Segmented
          legend="Padding top"
          value={section.paddingTop}
          options={SPACING}
          onChange={(paddingTop) => paddingTop && upd({ paddingTop })}
        />
        <Segmented
          legend="Padding bottom"
          value={section.paddingBottom}
          options={SPACING}
          onChange={(paddingBottom) => paddingBottom && upd({ paddingBottom })}
        />
      </Group>
    </>
  );
}

// ─── Blocks ───────────────────────────────────────────────────────────────────

const RICH_HINT = (
  <>
    Use **bold**, *italic* and [link text](https://...). Leave a blank line to start a new paragraph.
  </>
);

function HeadingSettings({ block, upd }: { block: BlockOf<'heading'> } & Ctx) {
  return (
    <Group title="Heading">
      <Area
        label="Text"
        rows={2}
        value={block.text}
        onChange={(text) => upd({ text })}
        hint="Tip: click the heading in the preview to edit it in place."
      />
      <Segmented
        legend="Level"
        value={block.level}
        options={[
          { value: 1, label: 'Big title (H1)' },
          { value: 2, label: 'Section heading (H2)' },
          { value: 3, label: 'Small heading (H3)' },
        ]}
        onChange={(level) => level && upd({ level })}
      />
      <Segmented legend="Text size" value={block.size} options={TEXT_SIZES} onChange={(size) => upd({ size })} />
    </Group>
  );
}

function TextSettings({ block, upd }: { block: BlockOf<'text'> } & Ctx) {
  return (
    <Group title="Text">
      <Area label="Text" rows={6} value={block.text} onChange={(text) => upd({ text })} hint={RICH_HINT} />
      <Segmented legend="Text size" value={block.size} options={TEXT_SIZES} onChange={(size) => upd({ size })} />
    </Group>
  );
}

function ImageSettings({ block, upd, siteOrigin, uploadImage }: { block: BlockOf<'image'> } & Ctx) {
  const shapeName = useId();
  return (
    <Group title="Image">
      <ImageTools
        image={block.image}
        onChange={(img) => upd({ image: img ?? { ...EMPTY_IMAGE } })}
        uploadImage={uploadImage}
        siteOrigin={siteOrigin}
      />
      <Segmented
        legend="Width"
        value={block.width}
        options={IMAGE_WIDTHS.map((w) => ({
          value: w.value,
          label: w.label,
          icon: (
            <span className="le-set-bar" aria-hidden="true">
              <span style={{ width: `${w.pct}%` }} />
            </span>
          ),
        }))}
        onChange={(width) => width && upd({ width })}
      />
      <fieldset className="le-set-field le-set-fieldset">
        <legend className="le-set-label">Shape</legend>
        <div className="le-set-tiles">
          {SHAPES.map((s) => (
            <label key={s.value} className="le-set-tile">
              <input
                type="radio"
                name={shapeName}
                checked={block.shape === s.value}
                onChange={() => upd({ shape: s.value })}
              />
              <span className="le-set-tile-box" aria-hidden="true">
                <span
                  className="le-set-tile-shape"
                  style={{ borderRadius: s.radius, width: s.square ? 26 : 36, height: 26 }}
                />
              </span>
              <span className="le-set-tile-name">{s.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Text label="Caption (optional)" value={block.caption ?? ''} onChange={(caption) => upd({ caption: caption || undefined })} />
      <Text
        label="Link (optional)"
        type="url"
        value={block.href ?? ''}
        placeholder="https://"
        onChange={(href) => upd({ href: href || undefined })}
        hint="Where the image goes when someone clicks it."
        warn={linkWarning(block.href ?? '')}
      />
    </Group>
  );
}

const MAX_BUTTONS = 6;

function ButtonsSettings({ block, upd }: { block: BlockOf<'buttons'> } & Ctx) {
  const set = (buttons: LinkButton[]) => upd({ buttons });
  return (
    <Group title="Buttons">
      <ol className="le-set-items">
        {block.buttons.map((b, i) => (
          <li key={i} className="le-set-item">
            <div className="le-set-item-head">
              <span className="le-set-item-title">Button {i + 1}</span>
              <RowTools
                index={i}
                count={block.buttons.length}
                name={`button ${i + 1}`}
                onMove={(to) => set(move(block.buttons, i, to))}
                onRemove={() => set(block.buttons.filter((_, j) => j !== i))}
              />
            </div>
            <Text label="Label" value={b.label} onChange={(label) => set(replaceAt(block.buttons, i, { ...b, label }))} />
            <Text
              label="Link"
              type="url"
              value={b.href}
              placeholder="https://"
              onChange={(href) => set(replaceAt(block.buttons, i, { ...b, href }))}
              warn={linkWarning(b.href)}
            />
            <Segmented
              legend="Style"
              value={b.style}
              options={BUTTON_STYLES}
              onChange={(style) => style && set(replaceAt(block.buttons, i, { ...b, style }))}
            />
          </li>
        ))}
      </ol>
      {block.buttons.length < MAX_BUTTONS ? (
        <button
          type="button"
          className="btn btn-default btn-sm"
          onClick={() => set([...block.buttons, { label: 'New button', href: '', style: block.buttons.length ? 'secondary' : 'primary' }])}
        >
          + Add button
        </button>
      ) : (
        <p className="le-set-hint">You can have up to {MAX_BUTTONS} buttons here.</p>
      )}
    </Group>
  );
}

function Thumb({ image, siteOrigin }: { image?: PageImage; siteOrigin: string }) {
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

function PeopleSettings({ block, upd, siteOrigin, uploadImage }: { block: BlockOf<'people'> } & Ctx) {
  const [open, setOpen] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const set = (people: Person[]) => upd({ people });
  const setPerson = (i: number, p: Person) => set(replaceAt(block.people, i, p));

  function onDrop(e: DragEvent, to: number) {
    if (dragFrom === null) return;
    e.preventDefault();
    set(move(block.people, dragFrom, to));
    setDragFrom(null);
    setDragOver(null);
  }

  return (
    <Group title="People">
      <Segmented
        legend="Style"
        value={block.style}
        options={[
          { value: 'cards', label: 'Cards with photos' },
          { value: 'list', label: 'Names list' },
        ]}
        onChange={(style) => style && upd({ style })}
      />
      <Segmented legend="Columns" value={block.columns} options={COLUMN_COUNTS} onChange={(columns) => columns && upd({ columns })} />
      <p className="le-set-label">
        People <span className="le-set-count">{block.people.length}</span>
      </p>
      <ul className="le-set-people">
        {block.people.map((p, i) => {
          const isOpen = open === p.id;
          const name = p.name || `person ${i + 1}`;
          return (
            <li
              key={p.id}
              className={`le-set-person${isOpen ? ' open' : ''}${dragOver === i && dragFrom !== i ? ' drop' : ''}${dragFrom === i ? ' dragging' : ''}`}
              onDragOver={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOver !== i) setDragOver(i);
              }}
              onDrop={(e) => onDrop(e, i)}
            >
              <div
                className="le-set-person-row"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', p.id);
                  setDragFrom(i);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragOver(null);
                }}
              >
                <span className="le-set-grip" aria-hidden="true" title="Drag to reorder">
                  ⋮⋮
                </span>
                <button
                  type="button"
                  className="le-set-person-toggle"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : p.id)}
                >
                  <Thumb image={p.photo} siteOrigin={siteOrigin} />
                  <span className="le-set-person-text">
                    <span className="le-set-person-name">{p.name || 'No name yet'}</span>
                    <span className="le-set-person-role">{p.role}</span>
                  </span>
                  <span className="le-set-caret" aria-hidden="true">
                    {isOpen ? '▾' : '▸'}
                  </span>
                </button>
              </div>
              {isOpen && (
                <div className="le-set-person-body">
                  <Text label="Name" value={p.name} onChange={(v) => setPerson(i, { ...p, name: v })} />
                  <Text label="Role" value={p.role} onChange={(v) => setPerson(i, { ...p, role: v })} />
                  <Text
                    label="LinkedIn link (optional)"
                    type="url"
                    value={p.linkedin ?? ''}
                    placeholder="https://www.linkedin.com/in/..."
                    onChange={(v) => setPerson(i, v ? { ...p, linkedin: v } : without(p, 'linkedin'))}
                    warn={linkWarning(p.linkedin ?? '')}
                  />
                  <Area
                    label="Bio (optional)"
                    rows={4}
                    value={p.bio ?? ''}
                    onChange={(v) => setPerson(i, v ? { ...p, bio: v } : without(p, 'bio'))}
                    hint={RICH_HINT}
                  />
                  <div className="le-set-field">
                    <span className="le-set-label">Photo</span>
                    <ImageTools
                      compact
                      label={`Photo of ${name}`}
                      image={p.photo}
                      onChange={(img) => setPerson(i, img ? { ...p, photo: img } : without(p, 'photo'))}
                      uploadImage={uploadImage}
                      siteOrigin={siteOrigin}
                    />
                  </div>
                  <div className="le-set-person-foot">
                    <RowTools
                      index={i}
                      count={block.people.length}
                      name={name}
                      confirmRemove
                      onMove={(to) => set(move(block.people, i, to))}
                      onRemove={() => set(block.people.filter((x) => x.id !== p.id))}
                    />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="btn btn-default btn-sm"
        onClick={() => {
          const id = newId('p');
          set([...block.people, { id, name: '', role: '' }]);
          setOpen(id);
        }}
      >
        + Add person
      </button>
    </Group>
  );
}

/** An optional link on a list item or a column. */
function OptionalLink({ link, onChange }: { link?: LinkButton; onChange: (l: LinkButton | undefined) => void }) {
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

type ListItem = BlockOf<'list'>['items'][number];
const MAX_LIST_ITEMS = 50;

function ListSettings({ block, upd }: { block: BlockOf<'list'> } & Ctx) {
  const set = (items: ListItem[]) => upd({ items });
  const setItem = (i: number, item: ListItem) => set(replaceAt(block.items, i, item));
  return (
    <Group title="List">
      <Check label="Numbered" checked={block.ordered} onChange={(ordered) => upd({ ordered })} />
      <ol className="le-set-items">
        {block.items.map((it, i) => (
          <li key={it.id} className="le-set-item">
            <div className="le-set-item-head">
              <span className="le-set-item-title">Item {i + 1}</span>
              <RowTools
                index={i}
                count={block.items.length}
                name={`item ${i + 1}`}
                onMove={(to) => set(move(block.items, i, to))}
                onRemove={() => set(block.items.filter((x) => x.id !== it.id))}
              />
            </div>
            <Text
              label="Title (optional, shown bold)"
              value={it.title ?? ''}
              onChange={(v) => setItem(i, v ? { ...it, title: v } : without(it, 'title'))}
            />
            <Area label="Text" value={it.text} onChange={(text) => setItem(i, { ...it, text })} />
            <Area
              label="Sub-items (optional, one per line)"
              value={(it.children ?? []).join('\n')}
              onChange={(v) => setItem(i, v ? { ...it, children: v.split('\n') } : without(it, 'children'))}
              onBlur={() => {
                if (!it.children) return;
                const kept = it.children.map((c) => c.trim()).filter(Boolean);
                if (kept.length !== it.children.length || kept.some((c, j) => c !== it.children?.[j]))
                  setItem(i, kept.length ? { ...it, children: kept } : without(it, 'children'));
              }}
            />
            <OptionalLink
              link={it.link}
              onChange={(link) => setItem(i, link ? { ...it, link } : without(it, 'link'))}
            />
          </li>
        ))}
      </ol>
      {block.items.length < MAX_LIST_ITEMS && (
        <button
          type="button"
          className="btn btn-default btn-sm"
          onClick={() => set([...block.items, { id: newId('i'), text: '' }])}
        >
          + Add item
        </button>
      )}
    </Group>
  );
}

type ColumnItem = BlockOf<'columns'>['items'][number];
const MAX_COLUMN_ITEMS = 12;

function ColumnsSettings({ block, upd, siteOrigin, uploadImage }: { block: BlockOf<'columns'> } & Ctx) {
  const set = (items: ColumnItem[]) => upd({ items });
  const setItem = (i: number, item: ColumnItem) => set(replaceAt(block.items, i, item));
  return (
    <Group title="Columns">
      <Segmented
        legend="Columns"
        value={block.columns}
        options={COLUMN_COUNTS}
        onChange={(columns) => columns && upd({ columns })}
      />
      <ol className="le-set-items">
        {block.items.map((it, i) => (
          <li key={it.id} className="le-set-item">
            <div className="le-set-item-head">
              <span className="le-set-item-title">Column {i + 1}</span>
              <RowTools
                index={i}
                count={block.items.length}
                name={`column ${i + 1}`}
                onMove={(to) => set(move(block.items, i, to))}
                onRemove={() => set(block.items.filter((x) => x.id !== it.id))}
              />
            </div>
            <div className="le-set-field">
              <span className="le-set-label">Image (optional)</span>
              <ImageTools
                compact
                label={`Image for column ${i + 1}`}
                image={it.image}
                onChange={(img) => setItem(i, img ? { ...it, image: img } : without(it, 'image'))}
                uploadImage={uploadImage}
                siteOrigin={siteOrigin}
              />
            </div>
            <Text
              label="Title (optional)"
              value={it.title ?? ''}
              onChange={(v) => setItem(i, v ? { ...it, title: v } : without(it, 'title'))}
            />
            <Area label="Text" value={it.text} onChange={(text) => setItem(i, { ...it, text })} hint={RICH_HINT} />
            <OptionalLink
              link={it.link}
              onChange={(link) => setItem(i, link ? { ...it, link } : without(it, 'link'))}
            />
          </li>
        ))}
      </ol>
      {block.items.length < MAX_COLUMN_ITEMS ? (
        <button
          type="button"
          className="btn btn-default btn-sm"
          onClick={() => set([...block.items, { id: newId('c'), title: '', text: '' }])}
        >
          + Add column
        </button>
      ) : (
        <p className="le-set-hint">You can have up to {MAX_COLUMN_ITEMS} columns here.</p>
      )}
    </Group>
  );
}

function VideoSettings({ block, upd }: { block: BlockOf<'video'> } & Ctx) {
  const embed = block.url.trim() ? videoEmbedUrl(block.url) : null;
  const status = embed
    ? embed.includes('vimeo')
      ? 'Vimeo video found'
      : 'YouTube video found'
    : 'Paste a YouTube or Vimeo link';
  return (
    <Group title="Video">
      <Text
        label="Video link"
        type="url"
        value={block.url}
        placeholder="https://www.youtube.com/watch?v=..."
        onChange={(url) => upd({ url })}
      />
      <p
        className={`le-set-status${embed ? ' ok' : block.url.trim() ? ' bad' : ''}`}
        role="status"
        aria-live="polite"
      >
        {status}
      </p>
      <Text label="Caption (optional)" value={block.caption ?? ''} onChange={(caption) => upd({ caption: caption || undefined })} />
    </Group>
  );
}

function SpacerSettings({ block, upd }: { block: BlockOf<'spacer'> } & Ctx) {
  return (
    <Group title="Spacer">
      <Segmented legend="Size" value={block.size} options={SPACING} onChange={(size) => size && upd({ size })} />
    </Group>
  );
}

function LayoutSettings({
  align,
  spaceAbove,
  spaceBelow,
  upd,
}: {
  align?: Align;
  spaceAbove?: Spacing;
  spaceBelow?: Spacing;
  upd: (patch: BlockPatch) => void;
}) {
  return (
    <Group title="Layout">
      <Segmented legend="Alignment" iconOnly value={align} options={ALIGNS} onChange={(a) => upd({ align: a })} />
      <Segmented
        legend="Space above"
        value={spaceAbove}
        options={SPACING_WITH_DEFAULT}
        onChange={(v) => upd({ spaceAbove: v })}
      />
      <Segmented
        legend="Space below"
        value={spaceBelow}
        options={SPACING_WITH_DEFAULT}
        onChange={(v) => upd({ spaceBelow: v })}
      />
    </Group>
  );
}

// ─── The panel ────────────────────────────────────────────────────────────────

export function SettingsPanel(props: PaneProps & Extra) {
  const { content, selection, onEdit, onSelect, warnings, siteOrigin, uploadImage } = props;

  const section =
    selection.kind === 'page' ? undefined : content.sections.find((s) => s.id === selection.sectionId);
  const block =
    selection.kind === 'block' ? findBlock(content, selection.sectionId, selection.blockId) : undefined;

  let title = 'Page';
  if (selection.kind === 'section' && section) title = `Section: ${section.label || 'Untitled'}`;
  if (selection.kind === 'block' && block) title = kindLabel(block.kind);

  const target = block ?? (selection.kind === 'section' ? section : undefined);
  const hidden = !!target?.hidden;
  const what = block ? 'block' : 'section';
  const myWarnings = warnings.filter((w) =>
    block ? w.blockId === block.id : section && selection.kind === 'section' ? w.sectionId === section.id && !w.blockId : false,
  );

  function toggleHidden() {
    const patch = { hidden: hidden ? undefined : true };
    if (block && section) onEdit({ type: 'updateBlock', sectionId: section.id, blockId: block.id, patch });
    else if (section) onEdit({ type: 'updateSection', sectionId: section.id, patch });
  }
  function duplicate() {
    if (block && section) onEdit({ type: 'duplicateBlock', sectionId: section.id, blockId: block.id });
    else if (section) onEdit({ type: 'duplicateSection', sectionId: section.id });
  }
  function remove() {
    if (block && section) {
      onEdit({ type: 'removeBlock', sectionId: section.id, blockId: block.id });
      onSelect({ kind: 'section', sectionId: section.id });
    } else if (section) {
      onEdit({ type: 'removeSection', sectionId: section.id });
      onSelect({ kind: 'page' });
    }
  }

  let body: ReactNode;
  if (block && section) {
    const ctx: Ctx = {
      siteOrigin,
      uploadImage,
      upd: (patch) => onEdit({ type: 'updateBlock', sectionId: section.id, blockId: block.id, patch }),
    };
    let specific: ReactNode = null;
    switch (block.kind) {
      case 'heading':
        specific = <HeadingSettings block={block} {...ctx} />;
        break;
      case 'text':
        specific = <TextSettings block={block} {...ctx} />;
        break;
      case 'image':
        specific = <ImageSettings block={block} {...ctx} />;
        break;
      case 'buttons':
        specific = <ButtonsSettings block={block} {...ctx} />;
        break;
      case 'people':
        specific = <PeopleSettings block={block} {...ctx} />;
        break;
      case 'list':
        specific = <ListSettings block={block} {...ctx} />;
        break;
      case 'columns':
        specific = <ColumnsSettings block={block} {...ctx} />;
        break;
      case 'video':
        specific = <VideoSettings block={block} {...ctx} />;
        break;
      case 'spacer':
        specific = <SpacerSettings block={block} {...ctx} />;
        break;
      case 'divider':
        specific = <p className="le-set-hint">A thin line across the page. Only the layout below can be changed.</p>;
        break;
    }
    body = (
      <>
        {specific}
        <LayoutSettings align={block.align} spaceAbove={block.spaceAbove} spaceBelow={block.spaceBelow} upd={ctx.upd} />
      </>
    );
  } else if (section && selection.kind === 'section') {
    body = <SectionSettings section={section} onEdit={onEdit} siteOrigin={siteOrigin} />;
  } else {
    body = <PageSettings content={content} onEdit={onEdit} />;
  }

  // A new selection starts with every row closed and no question pending.
  const key =
    selection.kind === 'page'
      ? 'page'
      : selection.kind === 'section'
        ? `s:${selection.sectionId}`
        : `b:${selection.blockId}`;

  return (
    <aside className="le-set" aria-label="Settings">
      <header className="le-set-head" key={`h:${key}`}>
        <div className="le-set-head-title">
          <h2 className="le-set-title">{title}</h2>
          {block && section && (
            <button
              type="button"
              className="le-set-link le-set-crumb"
              onClick={() => onSelect({ kind: 'section', sectionId: section.id })}
            >
              In section: {section.label || 'Untitled'}
            </button>
          )}
          {selection.kind === 'section' && section && (
            <button type="button" className="le-set-link le-set-crumb" onClick={() => onSelect({ kind: 'page' })}>
              Page settings
            </button>
          )}
        </div>
        {target && (
          <div className="le-set-head-actions">
            <button type="button" className="btn btn-default btn-sm" onClick={toggleHidden} aria-pressed={hidden}>
              {hidden ? 'Show' : 'Hide'}
            </button>
            <button type="button" className="btn btn-default btn-sm" onClick={duplicate}>
              Duplicate
            </button>
            <ConfirmButton
              label="Delete"
              question={block ? 'Delete this block?' : 'Delete this section and everything in it?'}
              confirmLabel="Delete"
              onConfirm={remove}
            />
          </div>
        )}
      </header>
      <div className="le-set-body" key={key}>
        {hidden && (
          <p className="le-set-note" role="status">
            This {what} is hidden. It stays in your draft but does not show on the page.
          </p>
        )}
        {myWarnings.length > 0 && (
          <div className="whova-banner warning le-set-banner" role="status">
            <ul>
              {myWarnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          </div>
        )}
        {body}
      </div>
    </aside>
  );
}
