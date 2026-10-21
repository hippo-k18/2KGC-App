'use client';

import { useId, useState, type DragEvent, type ReactNode } from 'react';
import type { Align, LearnSection, LinkButton, Person, Spacing } from '@kgc/shared';
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
import {
  ALIGNS,
  BACKGROUNDS,
  BUTTON_STYLES,
  COLUMN_COUNTS,
  IMAGE_WIDTHS,
  SHAPES,
  SPACING,
  SPACING_WITH_DEFAULT,
  TEXT_SIZES,
  Area,
  Check,
  ConfirmButton,
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
} from './settings-fields';
import './settings.css';

/**
 * The right-hand pane of the Learn page editor: every setting of whatever is
 * selected, as plain labelled choices for a course lead who is not technical
 * (T310). Nothing here holds the content; every input reads from props and
 * every change goes through `onEdit`, so undo and redo move the fields too.
 */

type Extra = { siteOrigin: string; uploadImage: UploadImage };
type Ctx = Extra & { upd: (patch: BlockPatch) => void };

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
