'use client';

import { useContext, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import {
  learnCountdownUntil,
  tocEntries,
  type LearnBlock,
  type LinkButton,
  type PageImage,
  type Person,
} from '@kgc/shared';
import { newId, previewColumns, previewPick, videoEmbedUrl, type BlockOf } from '@/lib/learn-editor-core';
import {
  addChildAfter,
  addItemAfter,
  indentItem,
  newButton,
  outdentChild,
  removeAt,
  removeChild,
  removeItem,
  replaceAt,
  setChild,
  type ListFocus,
  type ListItem,
} from '@/lib/learn-inline-core';
import type { CaretInfo, HostKey } from '@/components/rich-editor';
import { blockShell, LearnCountdown } from '../preview-blocks';
import { PreviewBlockCtxContext, PreviewContentContext, V2Body } from '../preview-v2';
import {
  AddItem,
  EditableImage,
  EditableLink,
  focusFieldNow,
  InlineRich,
  PlainText,
  RemoveItem,
  requestFieldFocus,
  UrlField,
  useEditorServicesSafe,
  useInlineBlock,
} from './fields';

/**
 * Every block kind drawn with its words editable in place (T329). Each one
 * repeats the markup and classes of the block as the preview draws it
 * (`BlockBody` in `preview.tsx` for the v1 kinds, the website's twin in
 * `preview-blocks/` for v2), so selecting a block does not move anything on
 * the page: the same words simply become typeable.
 */

const IMAGE_WIDTHS = ['small', 'medium', 'large', 'full'] as const;
const BUTTON_STYLES = ['primary', 'secondary', 'text'] as const;

function gridVars(columns: unknown): CSSProperties {
  const n = previewColumns(columns);
  return { ['--lp-cols' as string]: n, ['--lp-cols-t' as string]: Math.min(n, 2) } as CSSProperties;
}

/** The twin's outer class for a v2 block, without the options the block shell already applies. */
function twinClass(block: LearnBlock, ...extra: string[]): string {
  const bare = { ...block, hidden: false } as LearnBlock;
  for (const k of ['spaceAbove', 'spaceBelow', 'maxWidth', 'boxed', 'textColor', 'anchor', 'visibleOn'] as const) delete (bare as Partial<LearnBlock>)[k];
  return blockShell(bare, ...extra).className;
}

/** The website twin's classes for a button in a v2 block. */
function twinButtonClass(b: LinkButton): string {
  return b.style === 'secondary' ? 'btn btn-secondary lp-btn' : b.style === 'text' ? 'lp-btn-text' : 'btn btn-primary lp-btn';
}

/** The v1 preview's classes for a button. */
function v1ButtonClass(b: LinkButton): string {
  return `lp-btn lp-btn-${previewPick(b.style, BUTTON_STYLES, 'primary')}`;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '+'
  );
}

export interface EditableBodyProps {
  block: LearnBlock;
  siteOrigin: string;
}

/** The editable body of a block, or null for a kind with no words of its own (divider, spacer, saved section). */
export function EditableBody({ block, siteOrigin }: EditableBodyProps): ReactNode {
  switch (block.kind) {
    case 'image':
      return <ImageEdit block={block} siteOrigin={siteOrigin} />;
    case 'buttons':
      return <ButtonsEdit block={block} />;
    case 'people':
      return <PeopleEdit block={block} siteOrigin={siteOrigin} />;
    case 'list':
      return <ListEdit block={block} />;
    case 'columns':
      return <ColumnsEdit block={block} siteOrigin={siteOrigin} />;
    case 'video':
      return <VideoEdit block={block} />;
    case 'imageText':
      return <ImageTextEdit block={block} siteOrigin={siteOrigin} />;
    case 'gallery':
      return <GalleryEdit block={block} siteOrigin={siteOrigin} />;
    case 'quote':
      return <QuoteEdit block={block} siteOrigin={siteOrigin} />;
    case 'callout':
      return <CalloutEdit block={block} />;
    case 'accordion':
      return <AccordionEdit block={block} />;
    case 'tabs':
      return <TabsEdit block={block} />;
    case 'stats':
      return <StatsEdit block={block} />;
    case 'cards':
      return <CardsEdit block={block} siteOrigin={siteOrigin} />;
    case 'logos':
      return <LogosEdit block={block} siteOrigin={siteOrigin} />;
    case 'embed':
      return <EmbedEdit block={block} siteOrigin={siteOrigin} />;
    case 'countdown':
      return <CountdownEdit block={block} />;
    case 'table':
      return <TableEdit block={block} />;
    case 'toc':
      return <TocEdit block={block} />;
    default:
      return null;
  }
}

/** True when the kind has an editable body here (heading and text are edited by `preview.tsx` itself). */
export function hasEditableBody(kind: LearnBlock['kind']): boolean {
  return !['heading', 'text', 'divider', 'spacer', 'reusable'].includes(kind);
}

/* ── v1 kinds ──────────────────────────────────────────────────────────── */

function ImageEdit({ block, siteOrigin }: { block: BlockOf<'image'>; siteOrigin: string }) {
  const { patch, blockId } = useInlineBlock();
  const width = previewPick(block.width, IMAGE_WIDTHS, 'medium');
  return (
    <figure className={`lp-figure lp-w-${width}`}>
      <EditableImage
        image={block.image}
        shape={block.shape}
        siteOrigin={siteOrigin}
        fieldKey={`${blockId}:image`}
        onChange={(image) => patch({ image })}
        size={{ value: width, onChange: (w) => patch({ width: w }) }}
        link={{ value: block.href ?? '', onChange: (href) => patch({ href }) }}
      />
      <PlainText
        tag="div"
        className="lp-caption"
        value={block.caption ?? ''}
        onChange={(caption) => patch({ caption })}
        fieldKey={`${blockId}:caption`}
        label="Caption"
        placeholder="Add a caption (optional)"
      />
    </figure>
  );
}

function ButtonRowEdit({ buttons, onChange, fieldPrefix, classOf, className }: {
  buttons: LinkButton[];
  onChange: (buttons: LinkButton[]) => void;
  fieldPrefix: string;
  classOf: (b: LinkButton) => string;
  className: string;
}) {
  return (
    <div className={className}>
      {buttons.map((b, i) => (
        <EditableLink
          key={i}
          link={b}
          className={classOf(b)}
          fieldKey={`${fieldPrefix}:${i}`}
          onChange={(nb) => onChange(replaceAt(buttons, i, nb))}
          onRemove={() => onChange(removeAt(buttons, i))}
        />
      ))}
      <AddItem
        label="Add button"
        onAdd={() => {
          requestFieldFocus(`${fieldPrefix}:${buttons.length}`);
          onChange([...buttons, newButton()]);
        }}
      />
    </div>
  );
}

function ButtonsEdit({ block }: { block: BlockOf<'buttons'> }) {
  const { patch, blockId } = useInlineBlock();
  return (
    <ButtonRowEdit
      buttons={block.buttons}
      onChange={(buttons) => patch({ buttons })}
      fieldPrefix={`${blockId}:btn`}
      classOf={v1ButtonClass}
      className="lp-buttons"
    />
  );
}

function LinkedInEdit({ person, onChange }: { person: Person; onChange: (p: Person) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="lp-li-edit">
      <button
        type="button"
        className={`lp-li${person.linkedin ? '' : ' is-empty'}`}
        aria-label={person.linkedin ? 'Change the LinkedIn link' : 'Add a LinkedIn link'}
        aria-expanded={open}
        title="LinkedIn link"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <svg width="20" height="20" viewBox="0 0 448 512" fill="currentColor" aria-hidden="true">
          <path d="M100.28 448H7.4V148.9h92.88zM53.79 108.1C24.09 108.1 0 83.5 0 53.8a53.79 53.79 0 0 1 107.58 0c0 29.7-24.1 54.3-53.79 54.3zM447.9 448h-92.68V302.4c0-34.7-.7-79.2-48.29-79.2-48.29 0-55.69 37.7-55.69 76.7V448h-92.78V148.9h89.08v40.8h1.3c12.4-23.5 42.69-48.3 87.88-48.3 94 0 111.28 61.9 111.28 142.3V448z" />
        </svg>
      </button>
      {open && (
        <span className="lp-pop lp-li-pop">
          <UrlField
            label="LinkedIn profile"
            value={person.linkedin ?? ''}
            placeholder="https://www.linkedin.com/in/name"
            onChange={(href) => {
              const next = { ...person };
              if (href) next.linkedin = href;
              else delete next.linkedin;
              onChange(next);
            }}
          />
        </span>
      )}
    </span>
  );
}

function PeopleEdit({ block, siteOrigin }: { block: BlockOf<'people'>; siteOrigin: string }) {
  const { patch, blockId } = useInlineBlock();
  const set = (i: number, p: Person) => patch({ people: replaceAt(block.people, i, p) });
  const add = (
    <AddItem
      label="Add person"
      onAdd={() => {
        const p: Person = { id: newId('p'), name: '', role: '' };
        requestFieldFocus(`${blockId}:p:${p.id}:name`);
        patch({ people: [...block.people, p] });
      }}
    />
  );
  if (block.style === 'list') {
    return (
      <div className="lp-roster" style={{ ['--lp-cols' as string]: previewColumns(block.columns) } as CSSProperties}>
        {block.people.map((p, i) => (
          <div key={p.id} className="lp-item-shell">
            <RemoveItem label={p.name || 'this person'} onRemove={() => patch({ people: removeAt(block.people, i) })} />
            <PlainText className="lp-roster-name" value={p.name} onChange={(name) => set(i, { ...p, name })} fieldKey={`${blockId}:p:${p.id}:name`} label="Name" />
            <PlainText className="lp-roster-role" value={p.role} onChange={(role) => set(i, { ...p, role })} fieldKey={`${blockId}:p:${p.id}:role`} label="Role" />
            <LinkedInEdit person={p} onChange={(np) => set(i, np)} />
          </div>
        ))}
        {add}
      </div>
    );
  }
  return (
    <div className="lp-people" style={gridVars(block.columns)}>
      {block.people.map((p, i) => (
        <div key={p.id} className="lp-person lp-item-shell">
          <RemoveItem label={p.name || 'this person'} onRemove={() => patch({ people: removeAt(block.people, i) })} />
          <EditableImage
            image={p.photo}
            shape="square"
            siteOrigin={siteOrigin}
            className="lp-person-photo"
            label="Photo"
            emptyText={initials(p.name)}
            fieldKey={`${blockId}:p:${p.id}:photo`}
            onChange={(photo) => set(i, { ...p, photo })}
            onRemove={() => {
              const next = { ...p };
              delete next.photo;
              set(i, next);
            }}
          />
          <div className="lp-person-row">
            <div>
              <PlainText className="lp-person-name" value={p.name} onChange={(name) => set(i, { ...p, name })} fieldKey={`${blockId}:p:${p.id}:name`} label="Name" />
              <PlainText tag="p" className="lp-person-role" value={p.role} onChange={(role) => set(i, { ...p, role })} fieldKey={`${blockId}:p:${p.id}:role`} label="Role" />
            </div>
            <LinkedInEdit person={p} onChange={(np) => set(i, np)} />
          </div>
          <div className="lp-person-bio">
            <InlineRich value={p.bio ?? ''} onChange={(bio) => set(i, { ...p, bio })} fieldKey={`${blockId}:p:${p.id}:bio`} label="About this person" placeholder="A short bio (optional)" />
          </div>
        </div>
      ))}
      {add}
    </div>
  );
}

/**
 * A list as in a document: Enter makes the next item, Backspace in an empty
 * one removes it, Tab tucks an item under the one above, Shift+Tab brings a
 * sub-item back out, and the arrows move between items.
 */
function ListEdit({ block }: { block: BlockOf<'list'> }) {
  const { patch, blockId } = useInlineBlock();
  const items = block.items;
  const keyOf = (f: ListFocus) => (f.child === undefined ? `${blockId}:li:${f.itemId}` : `${blockId}:li:${f.itemId}:${f.child}`);
  const apply = (r: { items: ListItem[]; focus: ListFocus } | null) => {
    if (!r) return false;
    requestFieldFocus(keyOf(r.focus));
    patch({ items: r.items });
    return true;
  };
  /** The field above or below, in reading order: items and their sub-items. */
  const neighbour = (i: number, child: number | undefined, dir: 1 | -1): string | null => {
    const flat: ListFocus[] = items.flatMap((it) => [{ itemId: it.id }, ...(it.children ?? []).map((_, c) => ({ itemId: it.id, child: c }))]);
    const here = flat.findIndex((f) => f.itemId === items[i].id && f.child === child);
    const f = flat[here + dir];
    return f ? keyOf(f) : null;
  };
  const move = (i: number, child: number | undefined, dir: 1 | -1) => {
    const k = neighbour(i, child, dir);
    return k ? focusFieldNow(k, dir === 1 ? 'start' : 'end') : false;
  };

  const itemKey = (i: number) => (key: HostKey, at: CaretInfo): boolean => {
    const it = items[i];
    switch (key) {
      case 'Enter':
        return apply(addItemAfter(items, i));
      case 'Backspace':
        return at.empty && !it.title && !it.children?.length && !it.link ? apply(removeItem(items, i)) : false;
      case 'Tab':
        return apply(indentItem(items, i));
      case 'ArrowUp':
        return at.atStart ? move(i, undefined, -1) : false;
      case 'ArrowDown':
        return at.atEnd ? move(i, undefined, 1) : false;
      default:
        return false;
    }
  };
  const childKey = (i: number, c: number) => (key: HostKey, at: CaretInfo): boolean => {
    switch (key) {
      case 'Enter':
        return apply(addChildAfter(items, i, c));
      case 'Backspace':
        return at.empty ? apply(removeChild(items, i, c)) : false;
      case 'ShiftTab':
        return apply(outdentChild(items, i, c));
      case 'Tab':
        // One level of sub-items is all the page has.
        return true;
      case 'ArrowUp':
        return at.atStart ? move(i, c, -1) : false;
      case 'ArrowDown':
        return at.atEnd ? move(i, c, 1) : false;
      default:
        return false;
    }
  };

  const List = block.ordered ? 'ol' : 'ul';
  const set = (i: number, it: ListItem) => patch({ items: replaceAt(items, i, it) });
  return (
    <div className="lp-list-edit">
      <List className="lp-list">
        {items.map((item, i) => (
          <li key={item.id} className="lp-item-shell">
            {items.length > 1 && <RemoveItem label="this item" onRemove={() => apply(removeItem(items, i))} />}
            {item.title !== undefined && item.title !== '' && (
              <>
                <PlainText tag="strong" value={item.title} onChange={(title) => set(i, { ...item, title })} fieldKey={`${blockId}:li:${item.id}:title`} label="Item title" />{' '}
              </>
            )}
            <InlineRich
              singleLine
              className="lp-inline-rich"
              value={item.text}
              onChange={(text) => set(i, { ...item, text })}
              fieldKey={`${blockId}:li:${item.id}`}
              label={`List item ${i + 1}`}
              placeholder="List item"
              onHostKey={itemKey(i)}
            />
            {item.link && (
              <>
                {' '}
                <EditableLink
                  link={item.link}
                  className="lp-textlink"
                  label="Link"
                  fieldKey={`${blockId}:li:${item.id}:link`}
                  onChange={(link) => set(i, { ...item, link })}
                  onRemove={() => {
                    const next = { ...item };
                    delete next.link;
                    set(i, next);
                  }}
                />
              </>
            )}
            {item.children && item.children.length > 0 && (
              <ul>
                {item.children.map((c, ci) => (
                  <li key={ci}>
                    <PlainText
                      value={c}
                      onChange={(text) => patch({ items: setChild(items, i, ci, text) })}
                      fieldKey={`${blockId}:li:${item.id}:${ci}`}
                      label={`Sub-item ${ci + 1} of item ${i + 1}`}
                      placeholder="Sub-item"
                      onHostKey={childKey(i, ci)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </List>
      <AddItem label="Add item" onAdd={() => apply(addItemAfter(items, items.length - 1))} />
      <p className="lp-edit-hint">Enter adds an item, Tab moves it under the one above.</p>
    </div>
  );
}

function ColumnsEdit({ block, siteOrigin }: { block: BlockOf<'columns'>; siteOrigin: string }) {
  const { patch, blockId } = useInlineBlock();
  type Item = BlockOf<'columns'>['items'][number];
  const set = (i: number, it: Item) => patch({ items: replaceAt(block.items, i, it) });
  return (
    <div className="lp-columns" style={gridVars(block.columns)}>
      {block.items.map((item, i) => (
        <div key={item.id} className="lp-col lp-item-shell">
          <RemoveItem label="this column" onRemove={() => patch({ items: removeAt(block.items, i) })} />
          <EditableImage
            image={item.image}
            shape="original"
            siteOrigin={siteOrigin}
            className="lp-col-img"
            label="Picture"
            emptyText="+ Picture"
            fieldKey={`${blockId}:c:${item.id}:img`}
            onChange={(image) => set(i, { ...item, image })}
            onRemove={() => {
              const next = { ...item };
              delete next.image;
              set(i, next);
            }}
          />
          <PlainText tag="h3" className="lp-col-title" value={item.title ?? ''} onChange={(title) => set(i, { ...item, title })} fieldKey={`${blockId}:c:${item.id}:title`} label="Title" placeholder="Title (optional)" />
          <div className="lp-col-text">
            <InlineRich value={item.text} onChange={(text) => set(i, { ...item, text })} fieldKey={`${blockId}:c:${item.id}:text`} label="Text" placeholder="Text" />
          </div>
          {item.link ? (
            <EditableLink
              link={item.link}
              className="lp-textlink"
              label="Link"
              fieldKey={`${blockId}:c:${item.id}:link`}
              onChange={(link) => set(i, { ...item, link })}
              onRemove={() => {
                const next = { ...item };
                delete next.link;
                set(i, next);
              }}
            />
          ) : (
            <AddItem
              className="is-quiet"
              label="Add a link"
              onAdd={() => {
                requestFieldFocus(`${blockId}:c:${item.id}:link`);
                set(i, { ...item, link: { label: 'Learn more', href: '', style: 'text' } });
              }}
            />
          )}
        </div>
      ))}
      <AddItem
        label="Add column"
        onAdd={() => {
          const it: Item = { id: newId('col'), title: '', text: '' };
          requestFieldFocus(`${blockId}:c:${it.id}:title`);
          patch({ items: [...block.items, it] });
        }}
      />
    </div>
  );
}

function VideoEdit({ block }: { block: BlockOf<'video'> }) {
  const { patch, blockId } = useInlineBlock();
  const embed = videoEmbedUrl(block.url);
  return (
    <figure className="lp-video">
      {embed ? (
        <iframe
          src={embed}
          title={block.caption || 'Video'}
          loading="lazy"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className="lp-video-empty">{block.url.trim() ? 'Use a YouTube or Vimeo link' : 'Paste a video link below'}</div>
      )}
      <UrlField label="Video link" value={block.url} normalize={false} placeholder="A YouTube or Vimeo link" onChange={(url) => patch({ url })} />
      <PlainText tag="div" className="lp-caption" value={block.caption ?? ''} onChange={(caption) => patch({ caption })} fieldKey={`${blockId}:caption`} label="Caption" placeholder="Add a caption (optional)" />
    </figure>
  );
}

/* ── v2 kinds ──────────────────────────────────────────────────────────── */

function ImageTextEdit({ block, siteOrigin }: { block: BlockOf<'imageText'>; siteOrigin: string }) {
  const { patch, blockId } = useInlineBlock();
  return (
    <div className={twinClass(block, `lp-it-${block.imageSide}`, `lp-it-${block.imageWidth}`)}>
      <div className="lp-it-media">
        <EditableImage image={block.image} shape={block.shape} siteOrigin={siteOrigin} className={`lp-shape-${block.shape}`} fieldKey={`${blockId}:image`} onChange={(image) => patch({ image })} />
      </div>
      <div className="lp-it-body">
        <InlineRich value={block.text} onChange={(text) => patch({ text })} fieldKey={`${blockId}:text`} label="Text" />
        <ButtonRowEdit buttons={block.buttons ?? []} onChange={(buttons) => patch({ buttons })} fieldPrefix={`${blockId}:btn`} classOf={twinButtonClass} className="lp-it-buttons" />
      </div>
    </div>
  );
}

function GalleryEdit({ block, siteOrigin }: { block: BlockOf<'gallery'>; siteOrigin: string }) {
  const { patch, blockId } = useInlineBlock();
  const services = useEditorServicesSafe();
  type Im = BlockOf<'gallery'>['images'][number];
  const add = async () => {
    const picked = await services.pickImage({ title: 'Add a photo' });
    if (picked) patch({ images: [...block.images, { ...picked, id: newId('g') }] });
  };
  return (
    <div className={twinClass(block, 'lp-gallery-grid-block')}>
      <ul className={`lp-gallery-list lp-gallery-grid lp-cols-${previewColumns(block.columns)}`}>
        {block.images.map((im, i) => (
          <li key={im.id} className="lp-item-shell">
            <figure>
              <EditableImage
                image={im}
                shape={block.layout === 'grid' ? 'square' : 'original'}
                siteOrigin={siteOrigin}
                label="Photo"
                fieldKey={`${blockId}:g:${im.id}`}
                onChange={(next: PageImage) => patch({ images: replaceAt(block.images, i, { ...next, id: im.id, caption: im.caption } as Im) })}
                onRemove={() => patch({ images: removeAt(block.images, i) })}
              />
              <PlainText tag="div" className="lp-caption" value={im.caption ?? ''} onChange={(caption) => patch({ images: replaceAt(block.images, i, { ...im, caption }) })} fieldKey={`${blockId}:g:${im.id}:cap`} label="Caption" placeholder="Caption (optional)" />
            </figure>
          </li>
        ))}
        <li>
          <AddItem label="Add photo" onAdd={() => void add()} />
        </li>
      </ul>
      {block.layout !== 'grid' && <p className="lp-edit-hint">Shown as a grid while you edit. On the page it is a {block.layout === 'carousel' ? 'sliding row' : 'brick wall'}.</p>}
    </div>
  );
}

function QuoteEdit({ block, siteOrigin }: { block: BlockOf<'quote'>; siteOrigin: string }) {
  const { patch, blockId } = useInlineBlock();
  return (
    <figure className={twinClass(block, `lp-quote-${block.style}`)}>
      <blockquote>
        <InlineRich value={block.text} onChange={(text) => patch({ text })} fieldKey={`${blockId}:text`} label="Quote" placeholder="The quote" />
      </blockquote>
      <figcaption>
        <EditableImage
          image={block.photo}
          shape="circle"
          siteOrigin={siteOrigin}
          className="lp-quote-photo"
          label="Photo"
          emptyText="+ Photo"
          fieldKey={`${blockId}:photo`}
          onChange={(photo) => patch({ photo })}
          onRemove={() => patch({ photo: undefined })}
        />
        <span>
          <PlainText className="lp-quote-name" value={block.name ?? ''} onChange={(name) => patch({ name })} fieldKey={`${blockId}:name`} label="Who said it" placeholder="Name" />
          <PlainText className="lp-quote-role" value={block.role ?? ''} onChange={(role) => patch({ role })} fieldKey={`${blockId}:role`} label="Their role" placeholder="Role (optional)" />
        </span>
      </figcaption>
    </figure>
  );
}

const CALLOUT_ICON = {
  info: 'M12 8h.01M11 12h1v5h1',
  success: 'M8 12.5l2.5 2.5L16 9.5',
  warning: 'M12 8v5M12 16h.01',
  brand: 'M12 7l1.6 3.3 3.6.5-2.6 2.5.6 3.6L12 15.2 8.8 16.9l.6-3.6-2.6-2.5 3.6-.5z',
} as const;

function CalloutEdit({ block }: { block: BlockOf<'callout'> }) {
  const { patch, blockId } = useInlineBlock();
  return (
    <div className={twinClass(block, `lp-tone-${block.tone}`)} role="note">
      <svg className="lp-callout-icon" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d={CALLOUT_ICON[block.tone] ?? CALLOUT_ICON.info} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="lp-callout-body">
        <PlainText tag="p" className="lp-callout-title" value={block.title ?? ''} onChange={(title) => patch({ title })} fieldKey={`${blockId}:title`} label="Title" placeholder="Title (optional)" />
        <InlineRich value={block.text} onChange={(text) => patch({ text })} fieldKey={`${blockId}:text`} label="Text" />
      </div>
    </div>
  );
}

function AccordionEdit({ block }: { block: BlockOf<'accordion'> }) {
  const { patch, blockId } = useInlineBlock();
  type Item = BlockOf<'accordion'>['items'][number];
  const set = (i: number, it: Item) => patch({ items: replaceAt(block.items, i, it) });
  return (
    <div className={twinClass(block)}>
      {block.items.map((it, i) => (
        // Open while editing, so every answer can be typed; the summary does not fold it.
        <details key={it.id} className="lp-acc-item lp-item-shell" open>
          <summary onClick={(e) => e.preventDefault()}>
            <PlainText value={it.title} onChange={(title) => set(i, { ...it, title })} fieldKey={`${blockId}:a:${it.id}:title`} label={`Question ${i + 1}`} placeholder="Question" />
            <RemoveItem label="this question" onRemove={() => patch({ items: removeAt(block.items, i) })} />
          </summary>
          <div className="lp-acc-body">
            <InlineRich value={it.text} onChange={(text) => set(i, { ...it, text })} fieldKey={`${blockId}:a:${it.id}:text`} label={`Answer ${i + 1}`} placeholder="Answer" />
          </div>
        </details>
      ))}
      <AddItem
        label="Add question"
        onAdd={() => {
          const it: Item = { id: newId('acc'), title: '', text: '' };
          requestFieldFocus(`${blockId}:a:${it.id}:title`);
          patch({ items: [...block.items, it] });
        }}
      />
    </div>
  );
}

function TabsEdit({ block }: { block: BlockOf<'tabs'> }) {
  const { patch, blockId } = useInlineBlock();
  const [active, setActive] = useState(0);
  type Item = BlockOf<'tabs'>['items'][number];
  const at = Math.min(active, Math.max(0, block.items.length - 1));
  const cur = block.items[at];
  const set = (i: number, it: Item) => patch({ items: replaceAt(block.items, i, it) });
  return (
    <div className={twinClass(block)}>
      <div className="lp-tablist" role="tablist">
        {block.items.map((it, i) => (
          <span key={it.id} className="lp-tab lp-item-shell" role="tab" aria-selected={i === at} onClick={() => setActive(i)}>
            <PlainText value={it.title} onChange={(title) => set(i, { ...it, title })} fieldKey={`${blockId}:t:${it.id}:title`} label={`Tab ${i + 1} name`} placeholder="Tab name" />
            {block.items.length > 1 && (
              <RemoveItem
                label="this tab"
                onRemove={() => {
                  patch({ items: removeAt(block.items, i) });
                  setActive(Math.max(0, i - 1));
                }}
              />
            )}
          </span>
        ))}
        <AddItem
          label="Add tab"
          onAdd={() => {
            const it: Item = { id: newId('tab'), title: '', text: '' };
            requestFieldFocus(`${blockId}:t:${it.id}:title`);
            patch({ items: [...block.items, it] });
            setActive(block.items.length);
          }}
        />
      </div>
      {cur && (
        <div className="lp-tabpanel" role="tabpanel">
          <InlineRich key={cur.id} value={cur.text} onChange={(text) => set(at, { ...cur, text })} fieldKey={`${blockId}:t:${cur.id}:text`} label={`Tab ${at + 1} text`} />
        </div>
      )}
    </div>
  );
}

function StatsEdit({ block }: { block: BlockOf<'stats'> }) {
  const { patch, blockId } = useInlineBlock();
  type Item = BlockOf<'stats'>['items'][number];
  const set = (i: number, it: Item) => patch({ items: replaceAt(block.items, i, it) });
  return (
    <ul className={twinClass(block, `lp-cols-${block.columns}`)}>
      {block.items.map((it, i) => (
        <li key={it.id} className="lp-item-shell">
          <RemoveItem label="this number" onRemove={() => patch({ items: removeAt(block.items, i) })} />
          <PlainText className="lp-stat-value" value={it.value} onChange={(value) => set(i, { ...it, value })} fieldKey={`${blockId}:s:${it.id}:value`} label="Number" placeholder="120+" />
          <PlainText className="lp-stat-label" value={it.label} onChange={(label) => set(i, { ...it, label })} fieldKey={`${blockId}:s:${it.id}:label`} label="What it counts" placeholder="Label" />
        </li>
      ))}
      <li>
        <AddItem
          label="Add number"
          onAdd={() => {
            const it: Item = { id: newId('st'), value: '', label: '' };
            requestFieldFocus(`${blockId}:s:${it.id}:value`);
            patch({ items: [...block.items, it] });
          }}
        />
      </li>
    </ul>
  );
}

function CardsEdit({ block, siteOrigin }: { block: BlockOf<'cards'>; siteOrigin: string }) {
  const { patch, blockId } = useInlineBlock();
  type Item = BlockOf<'cards'>['items'][number];
  const set = (i: number, it: Item) => patch({ items: replaceAt(block.items, i, it) });
  return (
    <ul className={twinClass(block, `lp-cols-${block.columns}`)}>
      {block.items.map((it, i) => (
        <li key={it.id} className="lp-card lp-item-shell">
          <RemoveItem label="this card" onRemove={() => patch({ items: removeAt(block.items, i) })} />
          <EditableImage
            image={it.image}
            shape="original"
            siteOrigin={siteOrigin}
            className="lp-card-image"
            label="Picture"
            emptyText="+ Picture"
            fieldKey={`${blockId}:k:${it.id}:img`}
            onChange={(image) => set(i, { ...it, image })}
            onRemove={() => {
              const next = { ...it };
              delete next.image;
              set(i, next);
            }}
          />
          <div className="lp-card-body">
            {it.badge !== undefined && it.badge !== '' && (
              <PlainText className="lp-card-badge" value={it.badge} onChange={(badge) => set(i, { ...it, badge })} fieldKey={`${blockId}:k:${it.id}:badge`} label="Badge" />
            )}
            <PlainText tag="h3" value={it.title} onChange={(title) => set(i, { ...it, title })} fieldKey={`${blockId}:k:${it.id}:title`} label="Card title" placeholder="Title" />
            <InlineRich value={it.text} onChange={(text) => set(i, { ...it, text })} fieldKey={`${blockId}:k:${it.id}:text`} label="Card text" placeholder="Text" />
            <p className="lp-card-link">
              {it.link ? (
                <EditableLink
                  link={it.link}
                  className={it.link.style === 'text' ? '' : twinButtonClass(it.link)}
                  label="Link"
                  fieldKey={`${blockId}:k:${it.id}:link`}
                  onChange={(link) => set(i, { ...it, link })}
                  onRemove={() => {
                    const next = { ...it };
                    delete next.link;
                    set(i, next);
                  }}
                />
              ) : (
                <AddItem
                  className="is-quiet"
                  label="Add a link"
                  onAdd={() => {
                    requestFieldFocus(`${blockId}:k:${it.id}:link`);
                    set(i, { ...it, link: { label: 'Learn more', href: '', style: 'text' } });
                  }}
                />
              )}
            </p>
          </div>
        </li>
      ))}
      <li>
        <AddItem
          label="Add card"
          onAdd={() => {
            const it: Item = { id: newId('card'), title: '', text: '' };
            requestFieldFocus(`${blockId}:k:${it.id}:title`);
            patch({ items: [...block.items, it] });
          }}
        />
      </li>
    </ul>
  );
}

function LogosEdit({ block, siteOrigin }: { block: BlockOf<'logos'>; siteOrigin: string }) {
  const { patch, blockId } = useInlineBlock();
  const services = useEditorServicesSafe();
  type Item = BlockOf<'logos'>['items'][number];
  const add = async () => {
    const picked = await services.pickImage({ title: 'Add a logo' });
    if (picked) patch({ items: [...block.items, { ...picked, id: newId('logo') }] });
  };
  return (
    <ul className={twinClass(block, block.grayscale ? 'lp-logos-gray' : '')}>
      {block.items.map((it, i) => (
        <li key={it.id} className="lp-item-shell">
          <EditableImage
            image={it}
            shape="original"
            siteOrigin={siteOrigin}
            label="Logo"
            fieldKey={`${blockId}:l:${it.id}`}
            onChange={(next) => patch({ items: replaceAt(block.items, i, { ...next, id: it.id, href: it.href } as Item) })}
            onRemove={() => patch({ items: removeAt(block.items, i) })}
            link={{
              value: it.href ?? '',
              onChange: (href) => {
                const next = { ...it };
                if (href) next.href = href;
                else delete next.href;
                patch({ items: replaceAt(block.items, i, next) });
              },
            }}
          />
        </li>
      ))}
      <li>
        <AddItem label="Add logo" onAdd={() => void add()} />
      </li>
    </ul>
  );
}

function EmbedEdit({ block, siteOrigin }: { block: BlockOf<'embed'>; siteOrigin: string }) {
  const { patch } = useInlineBlock();
  return (
    <div className="lp-edit-stack">
      <V2Body block={block} siteOrigin={siteOrigin} selected />
      <UrlField label="Link to show" value={block.url} normalize={false} placeholder="Paste the share link" onChange={(url) => patch({ url })} />
    </div>
  );
}

function CountdownEdit({ block }: { block: BlockOf<'countdown'> }) {
  const { patch, blockId } = useInlineBlock();
  const ctx = useContext(PreviewBlockCtxContext);
  const until = learnCountdownUntil(block.until);
  return (
    <div className={twinClass(block)}>
      <PlainText tag="p" className="lp-countdown-label" value={block.label ?? ''} onChange={(label) => patch({ label })} fieldKey={`${blockId}:label`} label="Words above the countdown" placeholder="Starts in" />
      {until !== undefined && ctx ? (
        <time dateTime={new Date(until).toISOString()} className="lp-countdown-time">
          <LearnCountdown until={until} now={ctx.now} doneText={block.doneText} />
        </time>
      ) : (
        <p className="lp-edit-hint">Choose the date in the panel on the right.</p>
      )}
    </div>
  );
}

/** A table: every cell typed in place, with + buttons to add a row or a column at the edges. */
function TableEdit({ block }: { block: BlockOf<'table'> }) {
  const { patch, blockId } = useInlineBlock();
  const editor = useRef<Editor | null>(null);
  const grow = (what: 'row' | 'column') => {
    const e = editor.current;
    if (!e) return;
    // The end of the document is the last cell when the table is all there is.
    if (!e.isActive('table')) e.commands.focus('end');
    if (what === 'row') e.chain().focus().addRowAfter().run();
    else e.chain().focus().addColumnAfter().run();
  };
  return (
    <div className={`${twinClass(block)} lp-table-edit${block.striped ? ' is-striped' : ''}`}>
      <div className="lp-table-wrap">
        <InlineRich
          value={block.doc}
          onChange={(doc) => typeof doc !== 'string' && patch({ doc })}
          fieldKey={`${blockId}:doc`}
          label="Table"
          onEditor={(e) => {
            editor.current = e;
          }}
        />
        <button type="button" className="lp-table-plus lp-table-plus-col" aria-label="Add a column" title="Add a column" onMouseDown={(e) => e.preventDefault()} onClick={(e) => (e.stopPropagation(), grow('column'))}>
          +
        </button>
        <button type="button" className="lp-table-plus lp-table-plus-row" aria-label="Add a row" title="Add a row" onMouseDown={(e) => e.preventDefault()} onClick={(e) => (e.stopPropagation(), grow('row'))}>
          +
        </button>
      </div>
      <PlainText tag="div" className="lp-caption" value={block.caption ?? ''} onChange={(caption) => patch({ caption })} fieldKey={`${blockId}:caption`} label="Table caption" placeholder="Caption (optional)" />
    </div>
  );
}

function TocEdit({ block }: { block: BlockOf<'toc'> }) {
  const { patch, blockId } = useInlineBlock();
  const content = useContext(PreviewContentContext);
  const ctx = useContext(PreviewBlockCtxContext);
  const entries = content && ctx ? tocEntries(content, ctx.headingIds) : [];
  return (
    <nav className={twinClass(block)} aria-label={block.title || 'On this page'}>
      <PlainText tag="p" className="lp-toc-title" value={block.title ?? ''} onChange={(title) => patch({ title })} fieldKey={`${blockId}:title`} label="Contents title" placeholder="On this page" />
      {entries.length === 0 ? (
        <p className="lp-v2-muted">Headings on the page are listed here.</p>
      ) : (
        <ol>
          {entries.map((e) => (
            <li key={e.id} className={`lp-toc-l${e.level}`}>
              <a href={`#${e.id}`}>{e.text}</a>
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}

