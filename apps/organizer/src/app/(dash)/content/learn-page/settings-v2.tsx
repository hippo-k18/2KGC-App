'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ColorValue, ImageShape, LearnBlock, LearnPageContent, LearnSection, LinkButton, PageImage } from '@kgc/shared';
import {
  EMBED_PROVIDERS,
  EMPTY_IMAGE,
  blockColumnOf,
  blockSummary,
  embedProviderFromUrl,
  embedSrc,
  layoutColumns,
  newId,
  plainText,
  type BlockOf,
  type BlockPatch,
  type EmbedProvider,
  type PagePatch,
  type SectionPatch,
} from '@/lib/learn-editor-core';
import {
  BRAND_COLORS,
  DEFAULT_TEXT_HEX,
  MIN_CONTRAST,
  anchorProblem,
  colorHex,
  contrastRatio,
  isHexColor,
  sectionBgHex,
  slugifyAnchor,
} from '@/lib/learn-tools-core';
import { useEditorServices } from './editor-context';
import { resolveSrc, type UploadImage } from './editor-types';
import { ImageTools } from './image-tools';
import { RichField } from './rich-field';
import {
  BUTTON_STYLES,
  COLUMN_COUNTS,
  SHAPES,
  Area,
  Check,
  Group,
  OptionalLink,
  RowTools,
  Segmented,
  Text,
  Thumb,
  linkWarning,
  move,
  replaceAt,
  without,
  type Opt,
} from './settings-fields';
import './settings-v2.css';

/**
 * Settings forms for the v2 block kinds, the appearance options every block
 * gained, and the new section and page options (T318). The shell decides where
 * each goes; like `settings-panel.tsx`, nothing here holds content and every
 * change goes through `upd` or `onPatch`.
 */

type Upd = (patch: BlockPatch) => void;

const EMPTY_PAGE: LearnPageContent = { seoTitle: '', seoDescription: '', sections: [] };

const noUpload: UploadImage = async () => ({ ok: false, error: 'Uploading is not available here.' });

/** The shell's services with safe stand-ins, so a form rendered on its own still works. */
function useServices() {
  const svc = useEditorServices();
  return {
    siteOrigin: svc?.siteOrigin ?? '',
    uploadImage: svc?.uploadImage ?? noUpload,
    pickImage: svc?.pickImage,
    content: svc?.content ?? EMPTY_PAGE,
  };
}

/** The latest value, for callbacks that resolve after an upload or a dialog. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

function MaxNote({ count, max, what }: { count: number; max: number; what: string }) {
  return count >= max ? <p className="le-set-hint">You can have up to {max} {what} here.</p> : null;
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-default btn-sm" onClick={onClick}>
      {label}
    </button>
  );
}

function ShapeTiles({ value, onChange }: { value: ImageShape; onChange: (v: ImageShape) => void }) {
  const name = useId();
  return (
    <fieldset className="le-set-field le-set-fieldset">
      <legend className="le-set-label">Shape</legend>
      <div className="le-set-tiles">
        {SHAPES.map((s) => (
          <label key={s.value} className="le-set-tile">
            <input type="radio" name={name} checked={value === s.value} onChange={() => onChange(s.value)} />
            <span className="le-set-tile-box" aria-hidden="true">
              <span className="le-set-tile-shape" style={{ borderRadius: s.radius, width: s.square ? 26 : 36, height: 26 }} />
            </span>
            <span className="le-set-tile-name">{s.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ItemHead({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="le-set-item-head">
      <span className="le-set-item-title">{title}</span>
      {children}
    </div>
  );
}

// ─── Colour ───────────────────────────────────────────────────────────────────

type BrandName = Exclude<ColorValue, `#${string}`>;
const BRANDS = Object.entries(BRAND_COLORS) as [BrandName, { hex: string; label: string }][];
const FIRST_CUSTOM = '#2069bc';

export function ColorField({
  legend,
  value,
  onChange,
  against,
  allowClear = false,
}: {
  legend: string;
  value: ColorValue | undefined;
  onChange: (v: ColorValue | undefined) => void;
  /** The background hex the colour will sit on, to judge contrast. */
  against?: string;
  /** A Clear button instead of a Default swatch. */
  allowClear?: boolean;
}) {
  const name = useId();
  const hexId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const custom = !!value && isHexColor(value);
  const hex = colorHex(value);
  const ratio = against && hex ? contrastRatio(hex, against) : null;

  function pick(v: ColorValue | undefined) {
    setDraft(null);
    onChange(v);
  }

  return (
    <fieldset className="le-set-field le-set-fieldset">
      <legend className="le-set-label">{legend}</legend>
      <div className="le-v2-colors">
        {!allowClear && (
          <label className="le-v2-color">
            <input type="radio" name={name} checked={value === undefined} onChange={() => pick(undefined)} />
            <span className="le-v2-color-chip default" aria-hidden="true" />
            <span className="le-v2-color-name">Default</span>
          </label>
        )}
        {BRANDS.map(([key, c]) => (
          <label key={key} className="le-v2-color">
            <input type="radio" name={name} checked={value === key} onChange={() => pick(key)} />
            <span className="le-v2-color-chip" aria-hidden="true" style={{ background: c.hex }} />
            <span className="le-v2-color-name">{c.label}</span>
          </label>
        ))}
        <label className="le-v2-color">
          <input
            type="radio"
            name={name}
            checked={custom}
            onChange={() => {
              const start = hex ?? FIRST_CUSTOM;
              if (isHexColor(start)) pick(start);
            }}
          />
          <span
            className={`le-v2-color-chip${custom ? '' : ' custom'}`}
            aria-hidden="true"
            style={custom && hex ? { background: hex } : undefined}
          />
          <span className="le-v2-color-name">Custom</span>
        </label>
      </div>
      {custom && (
        <div className="le-v2-custom">
          <input
            type="color"
            className="le-v2-picker"
            aria-label={`${legend}: pick a custom colour`}
            value={hex ?? FIRST_CUSTOM}
            onChange={(e) => {
              const v = e.target.value.toLowerCase();
              if (isHexColor(v)) pick(v);
            }}
          />
          <label className="le-v2-custom-label" htmlFor={hexId}>
            Colour code
          </label>
          <input
            id={hexId}
            className="whova-text-input le-set-input le-v2-hex"
            value={draft ?? hex ?? ''}
            maxLength={7}
            spellCheck={false}
            onChange={(e) => {
              const v = e.target.value.trim().toLowerCase();
              if (isHexColor(v)) pick(v);
              else setDraft(e.target.value);
            }}
          />
        </div>
      )}
      {custom && draft !== null && (
        <p className="le-set-error" role="alert">
          Use # and six letters or numbers, like #2069bc.
        </p>
      )}
      {allowClear && value !== undefined && (
        <button type="button" className="le-set-link le-v2-clear" onClick={() => pick(undefined)}>
          Clear
        </button>
      )}
      {ratio !== null && ratio < MIN_CONTRAST && (
        <p className="le-set-warn" role="status">
          Hard to read on this background ({ratio.toFixed(1)}:1). Aim for 4.5:1 or more.
        </p>
      )}
    </fieldset>
  );
}

// ─── Link name (anchor) ───────────────────────────────────────────────────────

function AnchorField({
  value,
  ownerId,
  source,
  onChange,
}: {
  value: string | undefined;
  ownerId: string;
  /** The text "Make from text" turns into a link name. */
  source: string;
  onChange: (v: string | undefined) => void;
}) {
  const { content } = useServices();
  const [copied, setCopied] = useState(false);
  const anchor = value ?? '';
  const problem = anchorProblem(content, anchor, ownerId);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  function make() {
    const base = slugifyAnchor(source);
    if (!base) return;
    // A second "Our team" heading gets our-team-2 rather than a clash.
    let next = base;
    for (let n = 2; n < 100 && anchorProblem(content, next, ownerId); n++) next = `${base.slice(0, 60)}-${n}`;
    onChange(next);
  }

  function copy() {
    void navigator.clipboard?.writeText(`#${anchor}`).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }

  return (
    <div className="le-v2-anchor">
      <Text
        label="Link name (optional)"
        value={anchor}
        placeholder="our-team"
        maxLength={64}
        onChange={(v) => onChange(v ? v.toLowerCase().replace(/\s+/g, '-') : undefined)}
        hint={
          anchor && !problem
            ? `Link to it with #${anchor}`
            : 'Lets a button or link jump straight here. Link to it with #name.'
        }
        warn={problem}
      />
      <div className="le-v2-anchor-actions">
        <button type="button" className="btn btn-default btn-sm" onClick={make} disabled={!slugifyAnchor(source)}>
          Make from text
        </button>
        {anchor && !problem && (
          <button type="button" className="btn btn-default btn-sm" onClick={copy}>
            {copied ? 'Copied' : `Copy #${anchor}`}
          </button>
        )}
        <span className="le-set-visually-hidden" role="status" aria-live="polite">
          {copied ? `Copied #${anchor}` : ''}
        </span>
      </div>
    </div>
  );
}

const VISIBLE_ON: Opt<'desktop' | 'mobile'>[] = [
  { value: undefined, label: 'All screens' },
  { value: 'desktop', label: 'Wide screens only' },
  { value: 'mobile', label: 'Phones only' },
];

function VisibleOnField({ value, onChange }: { value: LearnBlock['visibleOn']; onChange: (v: 'desktop' | 'mobile' | undefined) => void }) {
  return (
    <Segmented legend="Show on" value={value === 'all' ? undefined : value} options={VISIBLE_ON} onChange={onChange} />
  );
}

const NOTE_MAX = 200;

function NoteField({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const note = value ?? '';
  return (
    <Area
      label="Note for colleagues (never shown on the website)"
      rows={2}
      maxLength={NOTE_MAX}
      value={note}
      onChange={(v) => onChange(v ? v : undefined)}
      hint={`${note.length} / ${NOTE_MAX}`}
    />
  );
}

// ─── Every block ──────────────────────────────────────────────────────────────

const MAX_WIDTHS: Opt<NonNullable<LearnBlock['maxWidth']>>[] = [
  { value: undefined, label: 'Default' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'full', label: 'Full' },
];

/** The words a block's link name is made from. */
function blockText(block: LearnBlock): string {
  if ('title' in block && typeof block.title === 'string' && block.title) return block.title;
  if ('text' in block && block.text) return plainText(block.text);
  const s = blockSummary(block);
  const i = s.indexOf(': ');
  return i >= 0 ? s.slice(i + 2) : s;
}

export function BlockCommonSettings({ block, upd }: { block: LearnBlock; upd: Upd }) {
  const { content } = useServices();
  const section = content.sections.find((s) => s.blocks.some((b) => b.id === block.id));
  return (
    <Group title="Appearance and visibility">
      <VisibleOnField value={block.visibleOn} onChange={(visibleOn) => upd({ visibleOn })} />
      <Segmented legend="Width" value={block.maxWidth} options={MAX_WIDTHS} onChange={(maxWidth) => upd({ maxWidth })} />
      <Check label="Put it in a light card" checked={!!block.boxed} onChange={(v) => upd({ boxed: v ? true : undefined })} />
      <ColorField
        legend="Text colour"
        value={block.textColor}
        onChange={(textColor) => upd({ textColor })}
        against={section ? sectionBgHex(section) : undefined}
      />
      <AnchorField value={block.anchor} ownerId={block.id} source={blockText(block)} onChange={(anchor) => upd({ anchor })} />
      <NoteField value={block.note} onChange={(note) => upd({ note })} />
    </Group>
  );
}

// ─── Buttons (image and text) ─────────────────────────────────────────────────

const MAX_BUTTONS = 6;

function ButtonsList({ buttons, onChange }: { buttons: LinkButton[]; onChange: (b: LinkButton[] | undefined) => void }) {
  const set = (next: LinkButton[]) => onChange(next.length ? next : undefined);
  return (
    <>
      {buttons.length > 0 && (
        <ol className="le-set-items">
          {buttons.map((b, i) => (
            <li key={i} className="le-set-item">
              <ItemHead title={`Button ${i + 1}`}>
                <RowTools
                  index={i}
                  count={buttons.length}
                  name={`button ${i + 1}`}
                  onMove={(to) => set(move(buttons, i, to))}
                  onRemove={() => set(buttons.filter((_, j) => j !== i))}
                />
              </ItemHead>
              <Text label="Label" value={b.label} onChange={(label) => set(replaceAt(buttons, i, { ...b, label }))} />
              <Text
                label="Link"
                type="url"
                value={b.href}
                placeholder="https://"
                onChange={(href) => set(replaceAt(buttons, i, { ...b, href }))}
                warn={linkWarning(b.href)}
              />
              <Segmented
                legend="Style"
                value={b.style}
                options={BUTTON_STYLES}
                onChange={(style) => style && set(replaceAt(buttons, i, { ...b, style }))}
              />
            </li>
          ))}
        </ol>
      )}
      {buttons.length < MAX_BUTTONS ? (
        <AddButton
          label="+ Add button"
          onClick={() => set([...buttons, { label: 'New button', href: '', style: buttons.length ? 'secondary' : 'primary' }])}
        />
      ) : (
        <MaxNote count={buttons.length} max={MAX_BUTTONS} what="buttons" />
      )}
    </>
  );
}

// ─── v2 blocks ────────────────────────────────────────────────────────────────

function ImageTextSettings({ block, upd }: { block: BlockOf<'imageText'>; upd: Upd }) {
  const { siteOrigin, uploadImage } = useServices();
  return (
    <Group title="Image and text">
      <ImageTools
        image={block.image}
        onChange={(img) => upd({ image: img ?? { ...EMPTY_IMAGE } })}
        uploadImage={uploadImage}
        siteOrigin={siteOrigin}
      />
      <Segmented
        legend="Image side"
        value={block.imageSide}
        options={[
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
        ]}
        onChange={(imageSide) => imageSide && upd({ imageSide })}
      />
      <Segmented
        legend="Image width"
        value={block.imageWidth}
        options={[
          { value: 'third', label: 'One third' },
          { value: 'half', label: 'Half' },
        ]}
        onChange={(imageWidth) => imageWidth && upd({ imageWidth })}
      />
      <ShapeTiles value={block.shape} onChange={(shape) => upd({ shape })} />
      <RichField label="Text" rows={6} value={block.text} onChange={(text) => upd({ text })} />
      <p className="le-set-label">Buttons (optional)</p>
      <ButtonsList buttons={block.buttons ?? []} onChange={(buttons) => upd({ buttons })} />
    </Group>
  );
}

type GalleryImage = BlockOf<'gallery'>['images'][number];
const MAX_GALLERY = 40;

function GallerySettings({ block, upd }: { block: BlockOf<'gallery'>; upd: Upd }) {
  const { siteOrigin, uploadImage, pickImage } = useServices();
  const [open, setOpen] = useState<string | null>(null);
  const latest = useLatest(block.images);
  const set = (images: GalleryImage[]) => upd({ images });
  const append = (img: PageImage) => set([...latest.current, { ...img, id: newId('g') }]);
  const full = block.images.length >= MAX_GALLERY;

  return (
    <Group title="Gallery">
      <Segmented
        legend="Layout"
        value={block.layout}
        options={[
          { value: 'grid', label: 'Grid' },
          { value: 'carousel', label: 'Slideshow' },
          { value: 'masonry', label: 'Staggered' },
        ]}
        onChange={(layout) => layout && upd({ layout })}
      />
      {block.layout !== 'carousel' && (
        <Segmented legend="Columns" value={block.columns} options={COLUMN_COUNTS} onChange={(columns) => columns && upd({ columns })} />
      )}
      <Check
        label="Open a large view when someone clicks a photo"
        checked={block.lightbox}
        onChange={(lightbox) => upd({ lightbox })}
      />
      <p className="le-set-label">
        Photos <span className="le-set-count">{block.images.length}</span>
      </p>
      {block.images.length > 0 && (
        <ul className="le-set-people">
          {block.images.map((img, i) => {
            const isOpen = open === img.id;
            const name = `photo ${i + 1}`;
            return (
              <li key={img.id} className={`le-set-person${isOpen ? ' open' : ''}`}>
                <div className="le-set-person-row">
                  <button
                    type="button"
                    className="le-set-person-toggle le-v2-row-toggle"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : img.id)}
                  >
                    <Thumb image={img} siteOrigin={siteOrigin} />
                    <span className="le-set-person-text">
                      <span className="le-set-person-name">Photo {i + 1}</span>
                      <span className="le-set-person-role">{img.caption || img.alt || 'No description yet'}</span>
                    </span>
                    <span className="le-set-caret" aria-hidden="true">
                      {isOpen ? '▾' : '▸'}
                    </span>
                  </button>
                </div>
                {isOpen && (
                  <div className="le-set-person-body">
                    <ImageTools
                      compact
                      label={`Photo ${i + 1}`}
                      image={img}
                      onChange={(next) =>
                        set(
                          next
                            ? replaceAt(latest.current, i, { ...next, id: img.id, ...(img.caption ? { caption: img.caption } : {}) })
                            : latest.current.filter((x) => x.id !== img.id),
                        )
                      }
                      uploadImage={uploadImage}
                      siteOrigin={siteOrigin}
                    />
                    <Text
                      label="Caption (optional)"
                      value={img.caption ?? ''}
                      onChange={(v) => set(replaceAt(block.images, i, v ? { ...img, caption: v } : without(img, 'caption')))}
                    />
                    <div className="le-set-person-foot">
                      <RowTools
                        index={i}
                        count={block.images.length}
                        name={name}
                        onMove={(to) => set(move(block.images, i, to))}
                        onRemove={() => set(block.images.filter((x) => x.id !== img.id))}
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {full ? (
        <MaxNote count={block.images.length} max={MAX_GALLERY} what="photos" />
      ) : (
        <div className="le-v2-add-image">
          <ImageTools
            compact
            label="New photo"
            image={undefined}
            onChange={(img) => img && append(img)}
            uploadImage={uploadImage}
            siteOrigin={siteOrigin}
          />
          {pickImage && (
            <button
              type="button"
              className="le-set-link"
              onClick={() =>
                void pickImage({ title: 'Choose a photo for the gallery' }).then((img) => {
                  if (img) append(img);
                })
              }
            >
              Choose from the media library
            </button>
          )}
        </div>
      )}
    </Group>
  );
}

function QuoteSettings({ block, upd }: { block: BlockOf<'quote'>; upd: Upd }) {
  const { siteOrigin, uploadImage } = useServices();
  return (
    <Group title="Quote">
      <RichField label="What they said" rows={4} value={block.text} onChange={(text) => upd({ text })} />
      <Text label="Name (optional)" value={block.name ?? ''} onChange={(v) => upd({ name: v || undefined })} />
      <Text label="Role or company (optional)" value={block.role ?? ''} onChange={(v) => upd({ role: v || undefined })} />
      <div className="le-set-field">
        <span className="le-set-label">Photo (optional)</span>
        <ImageTools
          compact
          label={block.name ? `Photo of ${block.name}` : 'Photo'}
          image={block.photo}
          onChange={(photo) => upd({ photo })}
          uploadImage={uploadImage}
          siteOrigin={siteOrigin}
        />
      </div>
      <Segmented
        legend="Style"
        value={block.style}
        options={[
          { value: 'plain', label: 'Plain' },
          { value: 'large', label: 'Large' },
          { value: 'card', label: 'Card' },
        ]}
        onChange={(style) => style && upd({ style })}
      />
    </Group>
  );
}

const TONES: { value: BlockOf<'callout'>['tone']; label: string }[] = [
  { value: 'info', label: 'Information' },
  { value: 'success', label: 'Good news' },
  { value: 'warning', label: 'Warning' },
  { value: 'brand', label: 'KGC blue' },
];

function CalloutSettings({ block, upd }: { block: BlockOf<'callout'>; upd: Upd }) {
  return (
    <Group title="Callout">
      <Segmented
        legend="Colour"
        value={block.tone}
        options={TONES.map((t) => ({
          value: t.value,
          label: t.label,
          icon: <span className={`le-v2-tone le-v2-tone-${t.value}`} aria-hidden="true" />,
        }))}
        onChange={(tone) => tone && upd({ tone })}
      />
      <Text label="Title (optional)" value={block.title ?? ''} onChange={(v) => upd({ title: v || undefined })} />
      <RichField label="Text" rows={4} value={block.text} onChange={(text) => upd({ text })} />
    </Group>
  );
}

type AccordionItem = BlockOf<'accordion'>['items'][number];
const MAX_ACCORDION = 30;

function AccordionSettings({ block, upd }: { block: BlockOf<'accordion'>; upd: Upd }) {
  const set = (items: AccordionItem[]) => upd({ items });
  return (
    <Group title="Questions and answers">
      <Check
        label="Let readers open more than one at a time"
        checked={block.allowMany}
        onChange={(allowMany) => upd({ allowMany })}
      />
      <ol className="le-set-items">
        {block.items.map((it, i) => (
          <li key={it.id} className="le-set-item">
            <ItemHead title={`Item ${i + 1}`}>
              <RowTools
                index={i}
                count={block.items.length}
                name={`item ${i + 1}`}
                onMove={(to) => set(move(block.items, i, to))}
                onRemove={() => set(block.items.filter((x) => x.id !== it.id))}
              />
            </ItemHead>
            <Text label="Title" value={it.title} onChange={(title) => set(replaceAt(block.items, i, { ...it, title }))} />
            <RichField label="Text" value={it.text} onChange={(text) => set(replaceAt(block.items, i, { ...it, text }))} />
            <Check
              label="Open when the page loads"
              checked={!!it.open}
              onChange={(v) => set(replaceAt(block.items, i, v ? { ...it, open: true } : without(it, 'open')))}
            />
          </li>
        ))}
      </ol>
      {block.items.length < MAX_ACCORDION ? (
        <AddButton label="+ Add item" onClick={() => set([...block.items, { id: newId('i'), title: '', text: '' }])} />
      ) : (
        <MaxNote count={block.items.length} max={MAX_ACCORDION} what="items" />
      )}
    </Group>
  );
}

type TabItem = BlockOf<'tabs'>['items'][number];
const MAX_TABS = 8;

function TabsSettings({ block, upd }: { block: BlockOf<'tabs'>; upd: Upd }) {
  const set = (items: TabItem[]) => upd({ items });
  return (
    <Group title="Tabs">
      <ol className="le-set-items">
        {block.items.map((it, i) => (
          <li key={it.id} className="le-set-item">
            <ItemHead title={`Tab ${i + 1}`}>
              <RowTools
                index={i}
                count={block.items.length}
                name={`tab ${i + 1}`}
                onMove={(to) => set(move(block.items, i, to))}
                onRemove={() => set(block.items.filter((x) => x.id !== it.id))}
              />
            </ItemHead>
            <Text label="Tab name" value={it.title} onChange={(title) => set(replaceAt(block.items, i, { ...it, title }))} />
            <RichField label="Text" value={it.text} onChange={(text) => set(replaceAt(block.items, i, { ...it, text }))} />
          </li>
        ))}
      </ol>
      {block.items.length < MAX_TABS ? (
        <AddButton label="+ Add tab" onClick={() => set([...block.items, { id: newId('i'), title: '', text: '' }])} />
      ) : (
        <MaxNote count={block.items.length} max={MAX_TABS} what="tabs" />
      )}
    </Group>
  );
}

type StatItem = BlockOf<'stats'>['items'][number];
const MAX_STATS = 12;

function StatsSettings({ block, upd }: { block: BlockOf<'stats'>; upd: Upd }) {
  const set = (items: StatItem[]) => upd({ items });
  return (
    <Group title="Numbers">
      <Segmented legend="Columns" value={block.columns} options={COLUMN_COUNTS} onChange={(columns) => columns && upd({ columns })} />
      <ol className="le-set-items">
        {block.items.map((it, i) => (
          <li key={it.id} className="le-set-item">
            <ItemHead title={`Number ${i + 1}`}>
              <RowTools
                index={i}
                count={block.items.length}
                name={`number ${i + 1}`}
                onMove={(to) => set(move(block.items, i, to))}
                onRemove={() => set(block.items.filter((x) => x.id !== it.id))}
              />
            </ItemHead>
            <div className="le-v2-pair">
              <Text
                label="Number"
                value={it.value}
                placeholder="500+"
                onChange={(value) => set(replaceAt(block.items, i, { ...it, value }))}
              />
              <Text
                label="What it counts"
                value={it.label}
                placeholder="Learners"
                onChange={(label) => set(replaceAt(block.items, i, { ...it, label }))}
              />
            </div>
          </li>
        ))}
      </ol>
      {block.items.length < MAX_STATS ? (
        <AddButton label="+ Add number" onClick={() => set([...block.items, { id: newId('i'), value: '', label: '' }])} />
      ) : (
        <MaxNote count={block.items.length} max={MAX_STATS} what="numbers" />
      )}
    </Group>
  );
}

type CardItem = BlockOf<'cards'>['items'][number];
const MAX_CARDS = 12;

function CardsSettings({ block, upd }: { block: BlockOf<'cards'>; upd: Upd }) {
  const { siteOrigin, uploadImage } = useServices();
  const latest = useLatest(block.items);
  const set = (items: CardItem[]) => upd({ items });
  const setItem = (i: number, item: CardItem) => set(replaceAt(block.items, i, item));
  return (
    <Group title="Cards">
      <Segmented legend="Columns" value={block.columns} options={COLUMN_COUNTS} onChange={(columns) => columns && upd({ columns })} />
      <ol className="le-set-items">
        {block.items.map((it, i) => (
          <li key={it.id} className="le-set-item">
            <ItemHead title={`Card ${i + 1}`}>
              <RowTools
                index={i}
                count={block.items.length}
                name={`card ${i + 1}`}
                onMove={(to) => set(move(block.items, i, to))}
                onRemove={() => set(block.items.filter((x) => x.id !== it.id))}
              />
            </ItemHead>
            <div className="le-set-field">
              <span className="le-set-label">Image (optional)</span>
              <ImageTools
                compact
                label={`Image for card ${i + 1}`}
                image={it.image}
                onChange={(img) => {
                  // An upload finishes later; patch the card as it is then.
                  const now = latest.current.find((x) => x.id === it.id);
                  if (!now) return;
                  const at = latest.current.indexOf(now);
                  set(replaceAt(latest.current, at, img ? { ...now, image: img } : without(now, 'image')));
                }}
                uploadImage={uploadImage}
                siteOrigin={siteOrigin}
              />
            </div>
            <Text label="Title" value={it.title} onChange={(title) => setItem(i, { ...it, title })} />
            <RichField label="Text" value={it.text} onChange={(text) => setItem(i, { ...it, text })} />
            <Text
              label="Label on the card (optional)"
              value={it.badge ?? ''}
              placeholder="New"
              maxLength={30}
              onChange={(v) => setItem(i, v ? { ...it, badge: v } : without(it, 'badge'))}
            />
            <OptionalLink link={it.link} onChange={(link) => setItem(i, link ? { ...it, link } : without(it, 'link'))} />
          </li>
        ))}
      </ol>
      {block.items.length < MAX_CARDS ? (
        <AddButton label="+ Add card" onClick={() => set([...block.items, { id: newId('i'), title: '', text: '' }])} />
      ) : (
        <MaxNote count={block.items.length} max={MAX_CARDS} what="cards" />
      )}
    </Group>
  );
}

type LogoItem = BlockOf<'logos'>['items'][number];
const MAX_LOGOS = 40;

function LogosSettings({ block, upd }: { block: BlockOf<'logos'>; upd: Upd }) {
  const { siteOrigin, uploadImage, pickImage } = useServices();
  const latest = useLatest(block.items);
  const set = (items: LogoItem[]) => upd({ items });
  const setItem = (i: number, item: LogoItem) => set(replaceAt(block.items, i, item));
  const append = (img: PageImage) => set([...latest.current, { ...img, id: newId('l') }]);
  return (
    <Group title="Logos">
      <Check label="Show logos in grey" checked={block.grayscale} onChange={(grayscale) => upd({ grayscale })} />
      {block.items.length > 0 && (
        <ol className="le-set-items">
          {block.items.map((it, i) => {
            const name = it.alt || `logo ${i + 1}`;
            return (
              <li key={it.id} className="le-set-item">
                <ItemHead title={it.alt || `Logo ${i + 1}`}>
                  <RowTools
                    index={i}
                    count={block.items.length}
                    name={name}
                    onMove={(to) => set(move(block.items, i, to))}
                    onRemove={() => set(block.items.filter((x) => x.id !== it.id))}
                  />
                </ItemHead>
                {/* The company name below is the alt text, so the image field's own alt box is hidden. */}
                <div className="le-v2-noalt">
                  <ImageTools
                    compact
                    label={`Logo of ${name}`}
                    image={it}
                    onChange={(img) => {
                      const now = latest.current.find((x) => x.id === it.id);
                      if (!now) return;
                      const at = latest.current.indexOf(now);
                      set(
                        img
                          ? replaceAt(latest.current, at, { ...img, alt: now.alt, id: now.id, ...(now.href ? { href: now.href } : {}) })
                          : latest.current.filter((x) => x.id !== it.id),
                      );
                    }}
                    uploadImage={uploadImage}
                    siteOrigin={siteOrigin}
                  />
                </div>
                <Text
                  label="Company name"
                  value={it.alt}
                  onChange={(alt) => setItem(i, { ...it, alt })}
                  hint="Read out by screen readers in place of the logo."
                  warn={it.alt.trim() ? null : 'Add the company name so everyone knows whose logo this is.'}
                />
                <Text
                  label="Link (optional)"
                  type="url"
                  value={it.href ?? ''}
                  placeholder="https://"
                  onChange={(v) => setItem(i, v ? { ...it, href: v } : without(it, 'href'))}
                  warn={linkWarning(it.href ?? '')}
                />
              </li>
            );
          })}
        </ol>
      )}
      {block.items.length < MAX_LOGOS ? (
        <div className="le-v2-add-image le-v2-noalt">
          <ImageTools
            compact
            label="New logo"
            image={undefined}
            onChange={(img) => img && append(img)}
            uploadImage={uploadImage}
            siteOrigin={siteOrigin}
          />
          {pickImage && (
            <button
              type="button"
              className="le-set-link"
              onClick={() =>
                void pickImage({ title: 'Choose a logo' }).then((img) => {
                  if (img) append(img);
                })
              }
            >
              Choose from the media library
            </button>
          )}
        </div>
      ) : (
        <MaxNote count={block.items.length} max={MAX_LOGOS} what="logos" />
      )}
    </Group>
  );
}

const PROVIDERS = Object.entries(EMBED_PROVIDERS) as [EmbedProvider, (typeof EMBED_PROVIDERS)[EmbedProvider]][];
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 1200;

function EmbedSettings({ block, upd }: { block: BlockOf<'embed'>; upd: Upd }) {
  const selectId = useId();
  const heightId = useId();
  const info = EMBED_PROVIDERS[block.provider];
  const url = block.url.trim();
  const found = url ? embedSrc(block.provider, url) : null;
  const height = block.height;
  const heightBad = height !== undefined && (height < MIN_HEIGHT || height > MAX_HEIGHT);
  const example = info.hint.startsWith('https://') ? `For example: ${info.hint}` : info.hint;

  return (
    <Group title="Embed">
      <div className="le-set-field">
        <label className="le-set-label" htmlFor={selectId}>
          Service
        </label>
        <select
          id={selectId}
          className="whova-text-input le-set-input le-v2-select"
          value={block.provider}
          onChange={(e) => upd({ provider: e.target.value as EmbedProvider })}
        >
          {PROVIDERS.map(([p, v]) => (
            <option key={p} value={p}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      <Text
        label={`${info.label} link`}
        type="url"
        value={block.url}
        placeholder="https://"
        onChange={(next) => {
          const p = embedProviderFromUrl(next);
          upd(p && p !== block.provider ? { url: next, provider: p } : { url: next });
        }}
        hint={`${example}. Paste any supported link and the service is picked for you.`}
      />
      <p className={`le-set-status${found ? ' ok' : url ? ' bad' : ''}`} role="status" aria-live="polite">
        {found ? `${info.label} link found` : url ? `That is not a ${info.label} link` : `Paste a ${info.label} link`}
      </p>
      <Segmented
        legend="Shape"
        value={block.aspect}
        options={[
          { value: '16:9', label: 'Wide (16:9)' },
          { value: '4:3', label: 'Standard (4:3)' },
          { value: '1:1', label: 'Square' },
          { value: 'auto', label: 'Set height' },
        ]}
        onChange={(aspect) => aspect && upd(aspect === 'auto' ? { aspect, height: height ?? 600 } : { aspect, height: undefined })}
      />
      {block.aspect === 'auto' && (
        <div className="le-set-field">
          <label className="le-set-label" htmlFor={heightId}>
            Height in pixels
          </label>
          <input
            id={heightId}
            type="number"
            inputMode="numeric"
            className="whova-text-input le-set-input le-v2-number"
            min={MIN_HEIGHT}
            max={MAX_HEIGHT}
            step={10}
            value={height ?? ''}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              upd({ height: Number.isFinite(n) ? n : undefined });
            }}
            onBlur={() => {
              if (height !== undefined && heightBad) upd({ height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)) });
            }}
          />
          <p className={heightBad ? 'le-set-warn' : 'le-set-hint'} role={heightBad ? 'status' : undefined}>
            Between {MIN_HEIGHT} and {MAX_HEIGHT}.
          </p>
        </div>
      )}
      <Text
        label="Title for screen readers"
        value={block.title}
        placeholder="Map of the venue"
        onChange={(title) => upd({ title })}
        hint="Says what is inside, for people who cannot see it."
        warn={block.title.trim() ? null : 'Add a title. Screen readers need it to describe the embed.'}
      />
    </Group>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** ms to the `datetime-local` format, in the viewer's own time zone. */
function toLocalInput(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

function fromNow(until: number, now: number): string {
  const diff = until - now;
  if (diff <= 0) return 'That time has already passed, so readers see the text for afterwards.';
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const when =
    diff >= DAY
      ? rtf.format(Math.round(diff / DAY), 'day')
      : diff >= HOUR
        ? rtf.format(Math.round(diff / HOUR), 'hour')
        : rtf.format(Math.max(1, Math.ceil(diff / 60_000)), 'minute');
  return `That is ${when}.`;
}

function CountdownSettings({ block, upd }: { block: BlockOf<'countdown'>; upd: Upd }) {
  const id = useId();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <Group title="Countdown">
      <div className="le-set-field">
        <label className="le-set-label" htmlFor={id}>
          Count down to
        </label>
        <input
          id={id}
          type="datetime-local"
          className="whova-text-input le-set-input"
          value={toLocalInput(block.until)}
          onChange={(e) => {
            const ms = e.target.value ? new Date(e.target.value).getTime() : 0;
            if (Number.isFinite(ms)) upd({ until: ms });
          }}
        />
        <p className="le-set-hint">In your own time zone{zone ? ` (${zone.replace(/_/g, ' ')})` : ''}.</p>
        {block.until > 0 ? (
          <p className={`le-set-status${block.until > now ? ' ok' : ' bad'}`} role="status">
            {fromNow(block.until, now)}
          </p>
        ) : (
          <p className="le-set-warn" role="status">
            Choose a date and time.
          </p>
        )}
      </div>
      <Text label="Text above the clock (optional)" value={block.label ?? ''} placeholder="Starts in" onChange={(v) => upd({ label: v || undefined })} />
      <Text
        label="Text once the time has passed (optional)"
        value={block.doneText ?? ''}
        placeholder="It has started."
        onChange={(v) => upd({ doneText: v || undefined })}
      />
    </Group>
  );
}

function TableSettings({ block, upd }: { block: BlockOf<'table'>; upd: Upd }) {
  return (
    <Group title="Table">
      <RichField
        label="Table"
        variant="full"
        rows={8}
        value={block.doc}
        onChange={(v) =>
          // The stand-in editor hands back text; a doc of plain paragraphs keeps the contract until T317's editor lands.
          upd({ doc: typeof v === 'string' ? textToDoc(v) : v })
        }
      />
      <Check label="Shade every other row" checked={block.striped} onChange={(striped) => upd({ striped })} />
      <Text
        label="Caption (optional)"
        value={block.caption ?? ''}
        onChange={(v) => upd({ caption: v || undefined })}
        hint="Shown under the table and read out first by screen readers."
      />
    </Group>
  );
}

function textToDoc(text: string): BlockOf<'table'>['doc'] {
  return {
    type: 'doc',
    content: text
      .split(/\n{2,}/)
      .filter((p) => p.trim())
      .map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
  };
}

function TocSettings({ block, upd }: { block: BlockOf<'toc'>; upd: Upd }) {
  return (
    <Group title="Contents list">
      <Text label="Title (optional)" value={block.title ?? ''} placeholder="On this page" onChange={(v) => upd({ title: v || undefined })} />
      <p className="le-set-hint">
        Lists every heading that has a link name. To add a heading here, give it a link name in its settings.
      </p>
    </Group>
  );
}

function ReusableSettings({ block }: { block: BlockOf<'reusable'> }) {
  const id = useId();
  return (
    <Group title="Saved section">
      <p className="le-set-hint le-v2-lead">
        Shows a saved section from your library. Change it in the library and every copy updates.
      </p>
      <div className="le-set-field">
        <label className="le-set-label" htmlFor={id}>
          Saved section id
        </label>
        <input id={id} className="whova-text-input le-set-input" value={block.libraryId || 'None chosen yet'} readOnly />
      </div>
    </Group>
  );
}

export function V2BlockSettings({ block, upd }: { block: LearnBlock; upd: (p: BlockPatch) => void }) {
  switch (block.kind) {
    case 'imageText':
      return <ImageTextSettings block={block} upd={upd} />;
    case 'gallery':
      return <GallerySettings block={block} upd={upd} />;
    case 'quote':
      return <QuoteSettings block={block} upd={upd} />;
    case 'callout':
      return <CalloutSettings block={block} upd={upd} />;
    case 'accordion':
      return <AccordionSettings block={block} upd={upd} />;
    case 'tabs':
      return <TabsSettings block={block} upd={upd} />;
    case 'stats':
      return <StatsSettings block={block} upd={upd} />;
    case 'cards':
      return <CardsSettings block={block} upd={upd} />;
    case 'logos':
      return <LogosSettings block={block} upd={upd} />;
    case 'embed':
      return <EmbedSettings block={block} upd={upd} />;
    case 'countdown':
      return <CountdownSettings block={block} upd={upd} />;
    case 'table':
      return <TableSettings block={block} upd={upd} />;
    case 'toc':
      return <TocSettings block={block} upd={upd} />;
    case 'reusable':
      return <ReusableSettings block={block} />;
    default:
      return null;
  }
}

// ─── Section ──────────────────────────────────────────────────────────────────

type Layout = NonNullable<LearnSection['layout']>;

/** Column widths out of 28, for the little layout pictures. */
const LAYOUT_SHAPES: Record<Layout, [number, number][]> = {
  single: [[0, 28]],
  'two-equal': [[0, 13], [15, 13]],
  'two-wide-left': [[0, 18], [20, 8]],
  'two-wide-right': [[0, 8], [10, 18]],
  three: [[0, 8], [10, 8], [20, 8]],
};

function layoutIcon(layout: Layout) {
  return (
    <svg viewBox="0 0 28 16" width="28" height="16" aria-hidden="true">
      {LAYOUT_SHAPES[layout].map(([x, w]) => (
        <rect key={x} x={x} y="1" width={w} height="14" rx="2" fill="currentColor" opacity="0.8" />
      ))}
    </svg>
  );
}

const LAYOUTS: Opt<Exclude<Layout, 'single'>>[] = [
  { value: undefined, label: 'One column', icon: layoutIcon('single') },
  { value: 'two-equal', label: 'Two equal', icon: layoutIcon('two-equal') },
  { value: 'two-wide-left', label: 'Wide left', icon: layoutIcon('two-wide-left') },
  { value: 'two-wide-right', label: 'Wide right', icon: layoutIcon('two-wide-right') },
  { value: 'three', label: 'Three', icon: layoutIcon('three') },
];

const OVERLAY_MAX = 0.8;
/** Below this the photo shows through enough that text over it is a gamble. */
const OVERLAY_READABLE = 0.4;

export function SectionV2Settings({ section, upd }: { section: LearnSection; upd: (p: SectionPatch) => void }) {
  const { siteOrigin, uploadImage } = useServices();
  const overlayId = useId();
  const multi = layoutColumns(section.layout) > 1;
  const hasImage = !!section.backgroundImage?.src;
  const overlay = section.overlay ?? 0;

  const bg = sectionBgHex(section);
  const readable = Math.max(contrastRatio(bg, DEFAULT_TEXT_HEX), contrastRatio(bg, '#ffffff')) >= MIN_CONTRAST;
  let readWarn: string | null = null;
  if (hasImage && overlay < OVERLAY_READABLE)
    readWarn = 'Text over a photo can be hard to read. Darken the photo to 40% or more.';
  else if (!readable) readWarn = 'Text may be hard to read on this colour. Choose a darker or lighter one.';

  return (
    <>
      <Group title="Layout">
        <Segmented
          legend="Columns"
          value={section.layout === 'single' ? undefined : section.layout}
          options={LAYOUTS}
          onChange={(layout) => upd({ layout })}
        />
        {multi && (
          <p className="le-set-hint le-v2-lead">
            Drag blocks between columns in the outline or the preview, or choose a column in each block&apos;s settings.
          </p>
        )}
      </Group>
      <Group title="Background extras">
        <ColorField
          legend="Background colour (overrides the style above)"
          value={section.backgroundColor}
          onChange={(backgroundColor) => upd({ backgroundColor })}
          allowClear
        />
        <div className="le-set-field">
          <span className="le-set-label">Background photo (optional)</span>
          <ImageTools
            label="Background photo"
            image={section.backgroundImage}
            onChange={(img) => upd(img ? { backgroundImage: img } : { backgroundImage: undefined, overlay: undefined })}
            uploadImage={uploadImage}
            siteOrigin={siteOrigin}
          />
        </div>
        {hasImage && (
          <div className="le-set-field">
            <label className="le-set-label" htmlFor={overlayId}>
              Darken the photo
              <span className="le-set-count">{Math.round(overlay * 100)}%</span>
            </label>
            <input
              id={overlayId}
              type="range"
              className="le-v2-range"
              min={0}
              max={OVERLAY_MAX}
              step={0.05}
              value={overlay}
              aria-valuetext={`${Math.round(overlay * 100)}%`}
              onChange={(e) => {
                const v = Math.round(parseFloat(e.target.value) * 100) / 100;
                upd({ overlay: v > 0 ? Math.min(OVERLAY_MAX, v) : undefined });
              }}
            />
          </div>
        )}
        {readWarn && (
          <p className="le-set-warn" role="status">
            {readWarn}
          </p>
        )}
      </Group>
      <Group title="Visibility and links">
        <VisibleOnField value={section.visibleOn} onChange={(visibleOn) => upd({ visibleOn })} />
        <AnchorField value={section.anchor} ownerId={section.id} source={section.label} onChange={(anchor) => upd({ anchor })} />
        <NoteField value={section.note} onChange={(note) => upd({ note })} />
      </Group>
    </>
  );
}

/** Which column of a multi-column section a block sits in. Renders nothing for one column. */
export function BlockColumnPicker({
  section,
  blockId,
  onChange,
}: {
  section: LearnSection;
  blockId: string;
  onChange: (column: number) => void;
}) {
  const n = layoutColumns(section.layout);
  if (n <= 1) return null;
  const options: Opt<number>[] = Array.from({ length: n }, (_, i) => ({ value: i, label: `Column ${i + 1}` }));
  return (
    <Segmented
      legend="Column"
      value={blockColumnOf(section, blockId)}
      options={options}
      onChange={(c) => c !== undefined && onChange(c)}
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const SHARE_MIN_WIDTH = 600;
const SHARE_DOMAIN = 'www.knowledgegraph.tech';

export function PageV2Settings({ content, onPatch }: { content: LearnPageContent; onPatch: (p: PagePatch) => void }) {
  const { siteOrigin, uploadImage } = useServices();
  const img = content.ogImage?.src ? content.ogImage : undefined;
  const small = !!img && img.width > 0 && img.width < SHARE_MIN_WIDTH;
  return (
    <>
      <Group title="Sharing">
        <div className="le-set-field">
          <span className="le-set-label">Share image</span>
          <ImageTools
            label="Share image"
            image={content.ogImage}
            onChange={(ogImage) => onPatch({ ogImage })}
            uploadImage={uploadImage}
            siteOrigin={siteOrigin}
          />
          <p className="le-set-hint">
            Shown when someone shares the page on LinkedIn, Slack or email. 1200 by 630 pixels works best.
          </p>
          {small && (
            <p className="le-set-warn" role="status">
              This image is {img.width} pixels wide. Use one at least {SHARE_MIN_WIDTH} wide so it stays sharp.
            </p>
          )}
        </div>
        <figure className="le-v2-share">
          <figcaption className="le-set-label">How a shared link looks</figcaption>
          <div className="le-v2-share-card">
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element -- a Storage or site URL, preview only
              <img
                className="le-v2-share-img"
                src={resolveSrc(img.src, siteOrigin)}
                alt=""
                style={{ objectPosition: `${(img.focusX ?? 0.5) * 100}% ${(img.focusY ?? 0.5) * 100}%` }}
              />
            ) : (
              <span className="le-v2-share-img empty">No share image</span>
            )}
            <span className="le-v2-share-text">
              <span className="le-v2-share-domain">{SHARE_DOMAIN}</span>
              <span className="le-v2-share-title">{content.seoTitle || 'Page title'}</span>
              {content.seoDescription && <span className="le-v2-share-desc">{content.seoDescription}</span>}
            </span>
          </div>
        </figure>
      </Group>
      <Group title="Search engines">
        <Check
          label="Hide this page from Google and other search engines"
          checked={!!content.noindex}
          onChange={(v) => onPatch({ noindex: v ? true : undefined })}
        />
        {content.noindex && (
          <div className="whova-banner warning le-set-banner" role="status">
            Search engines will drop this page once you publish. People can still open it from a link.
          </div>
        )}
      </Group>
    </>
  );
}
