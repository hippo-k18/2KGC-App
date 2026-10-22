import {
  LEARN_IMAGE_PREFIX,
  LEARN_PAGE_DEFAULT,
  isSafeHref,
  learnPageOrDefault,
  type LearnBlock,
  type LearnPageContent,
  type LearnPageDoc,
  type LearnSection,
  type LinkButton,
  type PageImage,
  type Person,
} from '@kgc/shared';

/**
 * The KGC | Learn page editor's rules, with no Firestore in them (T309).
 *
 * `learn-page.ts` is the server half that reads and writes `pageLayouts/learn`;
 * everything it decides is decided here, so `learn-page-core.test.ts` can pin it
 * and the editor (a client component) can import the same limits and validator
 * to warn before a save is refused.
 *
 * ── Why the server validates the whole page on every save ────────────────────
 *
 * The draft arrives as one JSON object from the browser, and the website
 * renders the published copy of it on www to people who are not signed in to
 * anything. A field the editor never sends is still a field a crafted request
 * can send. So the content is rebuilt here from the contract, key by key:
 * unknown fields are dropped, enums are checked, strings are capped, links must
 * pass `isSafeHref`, and an image may only point at this page's own uploads or
 * at the site's own `/kgc/` assets. What gets stored is the rebuilt copy, never
 * the input.
 */

export const LEARN_LIMITS = {
  sections: 40,
  blocksPerSection: 60,
  totalBlocks: 400,
  buttons: 6,
  people: 100,
  listItems: 100,
  listChildren: 20,
  columnItems: 12,
  seoTitle: 120,
  seoDescription: 320,
  label: 80,
  heading: 500,
  richText: 10_000,
  shortText: 300,
  caption: 500,
  bio: 5_000,
  href: 2_000,
  alt: 300,
  id: 64,
  note: 200,
  imageMaxBytes: 10 * 1024 * 1024,
  imageMaxWidth: 2400,
  /** Firestore's document cap is 1 MiB and the doc holds two copies plus metadata. */
  contentBytes: 400 * 1024,
} as const;

/** How many published versions are kept in `pageLayouts/learn/versions`. */
export const LEARN_VERSIONS_KEPT = 50;

/**
 * Today's /learn page as blocks (T311), what an editor starts from when nothing
 * is stored and what revert falls back to. Re-exported so the editor and the
 * tests have one import for the rules and the default.
 */
export { LEARN_PAGE_DEFAULT };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const BAND_BACKGROUNDS = ['plain', 'white-wave', 'light-blue-wave', 'blue', 'grey-wave'] as const;
const ALIGNS = ['left', 'center', 'right'] as const;
const SPACINGS = ['none', 'small', 'medium', 'large'] as const;
const TEXT_SIZES = ['small', 'normal', 'large', 'x-large'] as const;
const IMAGE_WIDTHS = ['small', 'medium', 'large', 'full'] as const;
const IMAGE_SHAPES = ['square', 'rounded', 'circle', 'original'] as const;
const SECTION_WIDTHS = ['narrow', 'normal', 'wide'] as const;
const BUTTON_STYLES = ['primary', 'secondary', 'text'] as const;
const COLUMNS = [1, 2, 3, 4] as const;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Hosts a stored image URL may come from: production, and the local Storage emulator. */
const STORAGE_ORIGINS = ['https://firebasestorage.googleapis.com'];
const EMULATOR_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

/**
 * May an image block point here?
 *
 * Two kinds of source only. A site asset under `/kgc/` (the page as it ships
 * today uses those), or a Firebase Storage token URL whose object path is under
 * `pageLayouts/learn/`, which only `uploadLearnImage` writes. Anything else,
 * including another folder of the same bucket, is refused: an image is
 * rendered on www and must not become a way to show somebody else's file there.
 */
export interface LearnValidateOptions {
  /** Accept image URLs from a local Storage emulator; the server passes it only when the emulator is configured. */
  allowEmulator?: boolean;
  /**
   * The project's own Storage bucket. When given, an uploaded image must be in
   * it: the `pageLayouts/learn/` folder of somebody else's bucket is not ours.
   * The server always passes it (`learnValidateOptions()` in `learn-page.ts`).
   */
  bucket?: string;
}

export function isAllowedLearnImageSrc(src: string, opts: LearnValidateOptions = {}): boolean {
  if (typeof src !== 'string' || src.length > LEARN_LIMITS.href) return false;
  if (src.startsWith('/kgc/')) {
    return /^\/kgc\/[A-Za-z0-9._\-/]+$/.test(src) && !src.includes('..') && !src.includes('//');
  }
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  const originOk =
    STORAGE_ORIGINS.includes(url.origin) || (opts.allowEmulator === true && EMULATOR_ORIGIN.test(url.origin));
  if (!originOk) return false;
  const match = /^\/v0\/b\/([a-z0-9._-]+)\/o\/([^/]+)$/.exec(url.pathname);
  if (!match) return false;
  if (opts.bucket !== undefined && match[1] !== opts.bucket) return false;
  let objectPath: string;
  try {
    objectPath = decodeURIComponent(match[2]);
  } catch {
    return false;
  }
  if (!objectPath.startsWith(LEARN_IMAGE_PREFIX) || objectPath.includes('..')) return false;
  return url.searchParams.get('alt') === 'media' && Boolean(url.searchParams.get('token'));
}

export type LearnValidation =
  | { ok: true; content: LearnPageContent }
  | { ok: false; problems: string[] };

class Problems {
  list: string[] = [];
  add(where: string, what: string) {
    if (this.list.length < 50) this.list.push(where ? `${where}: ${what}` : what);
  }
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function oneOf<T extends string | number>(v: unknown, allowed: readonly T[]): v is T {
  return (allowed as readonly unknown[]).includes(v);
}

/**
 * The validator's working state: where it is in the page, for messages an
 * organizer can follow ("Section 2, block 3"), and the ids already seen.
 */
interface Ctx {
  p: Problems;
  allowEmulator: boolean;
  bucket: string | undefined;
  sectionIds: Set<string>;
  blockIds: Set<string>;
}

function str(
  ctx: Ctx,
  where: string,
  name: string,
  v: unknown,
  max: number,
  opts: { required?: boolean } = {},
): string | undefined {
  if (v === undefined || v === null) {
    if (opts.required) ctx.p.add(where, `${name} is missing.`);
    return opts.required ? '' : undefined;
  }
  if (typeof v !== 'string') {
    ctx.p.add(where, `${name} must be text.`);
    return opts.required ? '' : undefined;
  }
  if (v.length > max) ctx.p.add(where, `${name} is ${v.length} characters; the limit is ${max}.`);
  return v;
}

function id(ctx: Ctx, where: string, v: unknown, seen?: Set<string>): string {
  if (typeof v !== 'string' || !ID.test(v)) {
    ctx.p.add(where, 'has a missing or malformed id.');
    return typeof v === 'string' ? v : '';
  }
  if (seen) {
    if (seen.has(v)) ctx.p.add(where, `uses the id "${v}" twice.`);
    seen.add(v);
  }
  return v;
}

function href(ctx: Ctx, where: string, name: string, v: unknown, opts: { required?: boolean } = {}): string | undefined {
  const s = str(ctx, where, name, v, LEARN_LIMITS.href, opts);
  if (s === undefined) return undefined;
  if (s.trim() === '' && !opts.required) return undefined;
  if (!isSafeHref(s)) ctx.p.add(where, `${name} "${s.slice(0, 80)}" is not a link the site can open.`);
  return s.trim();
}

function enumField<T extends string | number>(
  ctx: Ctx,
  where: string,
  name: string,
  v: unknown,
  allowed: readonly T[],
  opts: { required?: boolean } = {},
): T | undefined {
  if (v === undefined || v === null) {
    if (opts.required) ctx.p.add(where, `${name} is missing.`);
    return opts.required ? allowed[0] : undefined;
  }
  if (!oneOf(v, allowed)) {
    ctx.p.add(where, `${name} must be one of ${allowed.join(', ')}.`);
    return allowed[0];
  }
  return v;
}

function bool(v: unknown): boolean | undefined {
  return v === true ? true : undefined;
}

/**
 * An image not chosen yet: what the editor's new Image block and its Remove
 * button hold (`EMPTY_IMAGE`, `{ src: '', width: 0, height: 0 }`). It is
 * stored in the draft so autosave keeps working while the block is
 * unfinished; publish refuses it (`publishBlockers`) and the renderers skip
 * it. Any image whose `src` is exactly `''` counts, whatever its size says,
 * and is stored with a size of 0 by 0: a stale size on an empty image is not
 * worth stopping autosave over.
 */
export function isEmptyLearnImage(v: unknown): boolean {
  return isObj(v) && v.src === '';
}

function image(ctx: Ctx, where: string, v: unknown): PageImage {
  if (!isObj(v)) {
    ctx.p.add(where, 'image is missing.');
    return { src: '', alt: '', width: 1, height: 1 };
  }
  if (isEmptyLearnImage(v)) {
    return { src: '', alt: str(ctx, where, 'Alt text', v.alt ?? '', LEARN_LIMITS.alt) ?? '', width: 0, height: 0 };
  }
  const src = str(ctx, where, 'Image', v.src, LEARN_LIMITS.href, { required: true }) ?? '';
  if (src && !isAllowedLearnImageSrc(src, { allowEmulator: ctx.allowEmulator, bucket: ctx.bucket })) {
    ctx.p.add(where, 'image must be uploaded here or be a /kgc/ site image.');
  }
  const out: PageImage = {
    src,
    alt: str(ctx, where, 'Alt text', v.alt ?? '', LEARN_LIMITS.alt) ?? '',
    width: dimension(ctx, where, 'width', v.width),
    height: dimension(ctx, where, 'height', v.height),
  };
  const fx = fraction(ctx, where, 'focusX', v.focusX);
  const fy = fraction(ctx, where, 'focusY', v.focusY);
  if (fx !== undefined) out.focusX = fx;
  if (fy !== undefined) out.focusY = fy;
  return out;
}

function dimension(ctx: Ctx, where: string, name: string, v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 20_000) {
    ctx.p.add(where, `image ${name} must be a whole number of pixels.`);
    return 1;
  }
  return v;
}

function fraction(ctx: Ctx, where: string, name: string, v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
    ctx.p.add(where, `${name} must be between 0 and 1.`);
    return undefined;
  }
  return v;
}

function button(ctx: Ctx, where: string, v: unknown): LinkButton {
  if (!isObj(v)) {
    ctx.p.add(where, 'button is malformed.');
    return { label: '', href: '/', style: 'primary' };
  }
  return {
    label: str(ctx, where, 'Button label', v.label, LEARN_LIMITS.label, { required: true }) ?? '',
    href: href(ctx, where, 'Button link', v.href, { required: true }) ?? '',
    style: enumField(ctx, where, 'Button style', v.style, BUTTON_STYLES, { required: true })!,
  };
}

function array(ctx: Ctx, where: string, name: string, v: unknown, max: number): unknown[] {
  if (!Array.isArray(v)) {
    ctx.p.add(where, `${name} must be a list.`);
    return [];
  }
  if (v.length > max) ctx.p.add(where, `has ${v.length} ${name}; the limit is ${max}.`);
  return v.slice(0, max);
}

function person(ctx: Ctx, where: string, v: unknown, seen: Set<string>): Person {
  if (!isObj(v)) {
    ctx.p.add(where, 'person is malformed.');
    return { id: '', name: '', role: '' };
  }
  const out: Person = {
    id: id(ctx, where, v.id, seen),
    name: str(ctx, where, 'Name', v.name, LEARN_LIMITS.shortText, { required: true }) ?? '',
    role: str(ctx, where, 'Role', v.role ?? '', LEARN_LIMITS.shortText) ?? '',
  };
  // An optional image that was never chosen is simply absent.
  if (v.photo !== undefined && v.photo !== null && !isEmptyLearnImage(v.photo)) out.photo = image(ctx, where, v.photo);
  const li = href(ctx, where, 'LinkedIn link', v.linkedin);
  if (li !== undefined) out.linkedin = li;
  const bio = str(ctx, where, 'Bio', v.bio, LEARN_LIMITS.bio);
  if (bio !== undefined && bio !== '') out.bio = bio;
  return out;
}

/** Copies the optional layout fields every block shares, leaving absent ones absent. */
function base(ctx: Ctx, where: string, v: Obj) {
  const out: { id: string; hidden?: boolean; align?: (typeof ALIGNS)[number]; spaceAbove?: (typeof SPACINGS)[number]; spaceBelow?: (typeof SPACINGS)[number] } = {
    id: id(ctx, where, v.id, ctx.blockIds),
  };
  if (bool(v.hidden)) out.hidden = true;
  const align = enumField(ctx, where, 'Alignment', v.align, ALIGNS);
  if (align) out.align = align;
  const above = enumField(ctx, where, 'Space above', v.spaceAbove, SPACINGS);
  if (above) out.spaceAbove = above;
  const below = enumField(ctx, where, 'Space below', v.spaceBelow, SPACINGS);
  if (below) out.spaceBelow = below;
  return out;
}

function block(ctx: Ctx, where: string, v: unknown): LearnBlock | null {
  if (!isObj(v)) {
    ctx.p.add(where, 'is malformed.');
    return null;
  }
  const b = base(ctx, where, v);
  switch (v.kind) {
    case 'heading': {
      const out: LearnBlock = {
        ...b,
        kind: 'heading',
        text: str(ctx, where, 'Heading', v.text, LEARN_LIMITS.heading, { required: true }) ?? '',
        level: enumField(ctx, where, 'Heading level', v.level, [1, 2, 3] as const, { required: true })!,
      };
      const size = enumField(ctx, where, 'Text size', v.size, TEXT_SIZES);
      if (size) out.size = size;
      return out;
    }
    case 'text': {
      const out: LearnBlock = {
        ...b,
        kind: 'text',
        text: str(ctx, where, 'Text', v.text, LEARN_LIMITS.richText, { required: true }) ?? '',
      };
      const size = enumField(ctx, where, 'Text size', v.size, TEXT_SIZES);
      if (size) out.size = size;
      return out;
    }
    case 'image': {
      const out: LearnBlock = {
        ...b,
        kind: 'image',
        image: image(ctx, where, v.image),
        width: enumField(ctx, where, 'Image width', v.width, IMAGE_WIDTHS, { required: true })!,
        shape: enumField(ctx, where, 'Image shape', v.shape, IMAGE_SHAPES, { required: true })!,
      };
      const caption = str(ctx, where, 'Caption', v.caption, LEARN_LIMITS.caption);
      if (caption) out.caption = caption;
      const link = href(ctx, where, 'Image link', v.href);
      if (link !== undefined) out.href = link;
      return out;
    }
    case 'buttons':
      return {
        ...b,
        kind: 'buttons',
        buttons: array(ctx, where, 'buttons', v.buttons, LEARN_LIMITS.buttons).map((x, i) =>
          button(ctx, `${where}, button ${i + 1}`, x),
        ),
      };
    case 'people': {
      const seen = new Set<string>();
      return {
        ...b,
        kind: 'people',
        style: enumField(ctx, where, 'People style', v.style, ['cards', 'list'] as const, { required: true })!,
        columns: enumField(ctx, where, 'Columns', v.columns, COLUMNS, { required: true })!,
        people: array(ctx, where, 'people', v.people, LEARN_LIMITS.people).map((x, i) =>
          person(ctx, `${where}, person ${i + 1}`, x, seen),
        ),
      };
    }
    case 'list': {
      const seen = new Set<string>();
      return {
        ...b,
        kind: 'list',
        ordered: v.ordered === true,
        items: array(ctx, where, 'items', v.items, LEARN_LIMITS.listItems).map((x, i) => {
          const w = `${where}, item ${i + 1}`;
          if (!isObj(x)) {
            ctx.p.add(w, 'is malformed.');
            return { id: '', text: '' };
          }
          const item: { id: string; title?: string; text: string; children?: string[]; link?: LinkButton } = {
            id: id(ctx, w, x.id, seen),
            text: str(ctx, w, 'Text', x.text, LEARN_LIMITS.richText, { required: true }) ?? '',
          };
          const title = str(ctx, w, 'Title', x.title, LEARN_LIMITS.heading);
          if (title) item.title = title;
          if (x.children !== undefined && x.children !== null) {
            item.children = array(ctx, w, 'sub-items', x.children, LEARN_LIMITS.listChildren).map(
              (c, j) => str(ctx, `${w}, sub-item ${j + 1}`, 'Text', c, LEARN_LIMITS.richText, { required: true }) ?? '',
            );
          }
          if (x.link !== undefined && x.link !== null) item.link = button(ctx, w, x.link);
          return item;
        }),
      };
    }
    case 'columns': {
      const seen = new Set<string>();
      return {
        ...b,
        kind: 'columns',
        columns: enumField(ctx, where, 'Columns', v.columns, COLUMNS, { required: true })!,
        items: array(ctx, where, 'columns', v.items, LEARN_LIMITS.columnItems).map((x, i) => {
          const w = `${where}, column ${i + 1}`;
          if (!isObj(x)) {
            ctx.p.add(w, 'is malformed.');
            return { id: '', text: '' };
          }
          const item: { id: string; image?: PageImage; title?: string; text: string; link?: LinkButton } = {
            id: id(ctx, w, x.id, seen),
            text: str(ctx, w, 'Text', x.text, LEARN_LIMITS.richText, { required: true }) ?? '',
          };
          if (x.image !== undefined && x.image !== null && !isEmptyLearnImage(x.image)) item.image = image(ctx, w, x.image);
          const title = str(ctx, w, 'Title', x.title, LEARN_LIMITS.heading);
          if (title) item.title = title;
          if (x.link !== undefined && x.link !== null) item.link = button(ctx, w, x.link);
          return item;
        }),
      };
    }
    case 'video': {
      const raw = str(ctx, where, 'Video link', v.url, LEARN_LIMITS.href, { required: true }) ?? '';
      // An empty link is a video block not filled in yet: stored, refused at publish.
      const url = raw.trim() === '' ? '' : raw;
      if (url !== '' && (!/^https:\/\/[^\s]+$/.test(url) || !isSafeHref(url)))
        ctx.p.add(where, 'Video link must start with https://.');
      const out: LearnBlock = { ...b, kind: 'video', url };
      const caption = str(ctx, where, 'Caption', v.caption, LEARN_LIMITS.caption);
      if (caption) out.caption = caption;
      return out;
    }
    case 'divider':
      return { ...b, kind: 'divider' };
    case 'spacer':
      return { ...b, kind: 'spacer', size: enumField(ctx, where, 'Spacer size', v.size, SPACINGS, { required: true })! };
    default:
      ctx.p.add(where, `has an unknown kind "${String(v.kind).slice(0, 40)}".`);
      return null;
  }
}

function section(ctx: Ctx, where: string, v: unknown): LearnSection | null {
  if (!isObj(v)) {
    ctx.p.add(where, 'is malformed.');
    return null;
  }
  const blocks = array(ctx, where, 'blocks', v.blocks, LEARN_LIMITS.blocksPerSection);
  const out: LearnSection = {
    id: id(ctx, where, v.id, ctx.sectionIds),
    label: str(ctx, where, 'Section name', v.label ?? '', LEARN_LIMITS.label) ?? '',
    background: enumField(ctx, where, 'Background', v.background, BAND_BACKGROUNDS, { required: true })!,
    width: enumField(ctx, where, 'Width', v.width, SECTION_WIDTHS, { required: true })!,
    paddingTop: enumField(ctx, where, 'Padding above', v.paddingTop, SPACINGS, { required: true })!,
    paddingBottom: enumField(ctx, where, 'Padding below', v.paddingBottom, SPACINGS, { required: true })!,
    blocks: blocks
      .map((b, i) => block(ctx, `${where}, block ${i + 1}`, b))
      .filter((b): b is LearnBlock => b !== null),
  };
  if (bool(v.waveBehindFirstImage)) out.waveBehindFirstImage = true;
  if (bool(v.hidden)) out.hidden = true;
  return out;
}

/**
 * Rebuild `input` as a `LearnPageContent`, or say what is wrong with it.
 *
 * `allowEmulator` accepts image URLs from a local Storage emulator; the server
 * passes it only when the emulator is configured. `bucket` pins uploaded
 * images to the project's own bucket.
 */
export function validateLearnContent(input: unknown, opts: LearnValidateOptions = {}): LearnValidation {
  const ctx: Ctx = {
    p: new Problems(),
    allowEmulator: opts.allowEmulator === true,
    bucket: opts.bucket,
    sectionIds: new Set(),
    blockIds: new Set(),
  };
  if (!isObj(input)) return { ok: false, problems: ['The page content is missing or malformed.'] };

  const sections = array(ctx, '', 'sections', input.sections, LEARN_LIMITS.sections);
  const content: LearnPageContent = {
    seoTitle: str(ctx, 'Search settings', 'Page title', input.seoTitle, LEARN_LIMITS.seoTitle, { required: true }) ?? '',
    seoDescription:
      str(ctx, 'Search settings', 'Description', input.seoDescription ?? '', LEARN_LIMITS.seoDescription) ?? '',
    sections: sections
      .map((s, i) => section(ctx, `Section ${i + 1}`, s))
      .filter((s): s is LearnSection => s !== null),
  };
  if (content.seoTitle.trim() === '') ctx.p.add('Search settings', 'Page title is empty.');

  const total = content.sections.reduce((n, s) => n + s.blocks.length, 0);
  if (total > LEARN_LIMITS.totalBlocks) {
    ctx.p.add('', `The page has ${total} blocks; the limit is ${LEARN_LIMITS.totalBlocks}.`);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(content)).length;
  if (bytes > LEARN_LIMITS.contentBytes) {
    ctx.p.add('', `The page is ${Math.round(bytes / 1024)} KB of text; the limit is ${LEARN_LIMITS.contentBytes / 1024} KB.`);
  }

  return ctx.p.list.length > 0 ? { ok: false, problems: ctx.p.list } : { ok: true, content };
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/** The stored document, or what an editor sees when there is none yet. */
export function effectiveDoc(stored: LearnPageDoc | null | undefined): LearnPageDoc {
  if (isObj(stored)) {
    // A revision that is not a whole number (a hand-edited doc) would make
    // every later write `NaN` or a string; count it as 0 so a discard or a
    // restore can still repair the document.
    const r = (stored as LearnPageDoc).revision;
    return Number.isInteger(r) && r >= 0 ? stored : { ...stored, revision: 0 };
  }
  return {
    draft: LEARN_PAGE_DEFAULT,
    published: null,
    draftUpdatedAt: 0,
    draftUpdatedBy: '',
    revision: 0,
  };
}

export class LearnConflict extends Error {
  constructor(readonly currentRevision: number) {
    super(
      'Someone else saved this page after you opened it. Reload to see their changes, then make yours again.',
    );
    this.name = 'LearnConflict';
  }
}

/** The fields of a doc that are always present, plus the published ones when set. */
function docOf(d: LearnPageDoc): LearnPageDoc {
  const out: LearnPageDoc = {
    draft: d.draft,
    published: d.published ?? null,
    draftUpdatedAt: d.draftUpdatedAt,
    draftUpdatedBy: d.draftUpdatedBy,
    revision: d.revision,
  };
  if (d.publishedAt !== undefined) out.publishedAt = d.publishedAt;
  if (d.publishedBy !== undefined) out.publishedBy = d.publishedBy;
  return out;
}

/** Save `content` as the draft, refusing when `baseRevision` is stale. */
export function planSave(
  stored: LearnPageDoc | null | undefined,
  content: LearnPageContent,
  baseRevision: number,
  actor: string,
  now: number,
): LearnPageDoc {
  const cur = effectiveDoc(stored);
  if (baseRevision !== cur.revision) throw new LearnConflict(cur.revision);
  return docOf({ ...cur, draft: content, draftUpdatedAt: now, draftUpdatedBy: actor, revision: cur.revision + 1 });
}

/**
 * Blocks that cannot go on the website yet: an Image block with no image
 * chosen, a Video block with no link. The draft may hold them (autosave must
 * not stop while someone is still filling a block in), but publish refuses
 * them with these messages, which name the block and its section.
 */
export function publishBlockers(content: LearnPageContent): string[] {
  const out: string[] = [];
  content.sections.forEach((s, i) => {
    const name = s.label.trim() || `Section ${i + 1}`;
    for (const b of s.blocks) {
      if (b.kind === 'image' && !b.image.src) {
        out.push(`The Image block in "${name}" has no image yet. Choose one or remove the block.`);
      } else if (b.kind === 'video' && !b.url.trim()) {
        out.push(`The Video block in "${name}" has no video link yet. Add one or remove the block.`);
      }
    }
  });
  return out;
}

/** Publish refused because some blocks are not filled in (`publishBlockers`). */
export class LearnNotReady extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' '));
    this.name = 'LearnNotReady';
  }
}

/** Stored content (the draft or a version) that no longer passes the validator. */
export class LearnUnreadable extends Error {
  constructor(
    message: string,
    readonly problems: string[] = [],
  ) {
    super(message);
    this.name = 'LearnUnreadable';
  }
}

/**
 * Copy the draft to published. The caller writes `version` beside it.
 * Throws `LearnNotReady` while an Image or Video block is still empty.
 */
export function planPublish(
  stored: LearnPageDoc,
  actor: string,
  now: number,
  note?: string,
): { doc: LearnPageDoc; version: { content: LearnPageContent; publishedAt: number; publishedBy: string; note?: string } } {
  const blockers = publishBlockers(stored.draft);
  if (blockers.length > 0) throw new LearnNotReady(blockers);
  const doc = docOf({ ...stored, published: stored.draft, publishedAt: now, publishedBy: actor });
  const version: { content: LearnPageContent; publishedAt: number; publishedBy: string; note?: string } = {
    content: stored.draft,
    publishedAt: now,
    publishedBy: actor,
  };
  const trimmed = note?.trim();
  if (trimmed) version.note = trimmed.slice(0, LEARN_LIMITS.note);
  return { doc, version };
}

/** Replace the draft wholesale (revert or restore), bumping the revision. */
export function planReplaceDraft(
  stored: LearnPageDoc | null | undefined,
  content: LearnPageContent,
  actor: string,
  now: number,
): LearnPageDoc {
  const cur = effectiveDoc(stored);
  return docOf({ ...cur, draft: content, draftUpdatedAt: now, draftUpdatedBy: actor, revision: cur.revision + 1 });
}

/**
 * What revert puts back: the published copy, or the default page when nothing
 * is published or the published copy no longer passes the validator (a
 * revert is how an unreadable draft gets repaired, so it must not copy
 * unreadable content back in).
 */
export function revertTarget(stored: LearnPageDoc | null | undefined, opts: LearnValidateOptions = {}): LearnPageContent {
  const published = isObj(stored) ? stored.published : null;
  if (published === null || published === undefined) return LEARN_PAGE_DEFAULT;
  const v = validateLearnContent(published, opts);
  return v.ok ? v.content : LEARN_PAGE_DEFAULT;
}

/**
 * A published version's id as Firestore makes it (20 letters and digits; up
 * to 64 accepted). Checked before the id reaches `doc()`, which throws on a
 * path with a slash, an empty id or a reserved `__name__`.
 */
export function isLearnVersionId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9]{1,64}$/.test(v);
}

/**
 * The stored document as the editor may open it: the draft rebuilt by the
 * validator, or `unreadable` with the problems when it does not pass (a doc
 * written by hand or by an older build). The published copy is only used to
 * show what changed, so an unreadable one falls back to what www renders for
 * it (`learnPageOrDefault`) rather than blocking the editor.
 */
export function readStoredDoc(
  raw: unknown,
  opts: LearnValidateOptions = {},
): { ok: true; doc: LearnPageDoc } | { ok: false; problems: string[] } {
  if (raw === null || raw === undefined) return { ok: true, doc: effectiveDoc(null) };
  if (!isObj(raw)) return { ok: false, problems: ['The stored page is not a document.'] };
  const stored = effectiveDoc(raw as unknown as LearnPageDoc);
  const draft = validateLearnContent(stored.draft, opts);
  if (!draft.ok) return { ok: false, problems: draft.problems };
  let published: LearnPageContent | null = null;
  if (stored.published !== null && stored.published !== undefined) {
    const v = validateLearnContent(stored.published, opts);
    published = v.ok ? v.content : learnPageOrDefault(stored.published);
  }
  const doc: LearnPageDoc = {
    draft: draft.content,
    published,
    draftUpdatedAt: typeof stored.draftUpdatedAt === 'number' ? stored.draftUpdatedAt : 0,
    draftUpdatedBy: typeof stored.draftUpdatedBy === 'string' ? stored.draftUpdatedBy : '',
    revision: stored.revision,
  };
  if (typeof stored.publishedAt === 'number') doc.publishedAt = stored.publishedAt;
  if (typeof stored.publishedBy === 'string') doc.publishedBy = stored.publishedBy;
  return { ok: true, doc };
}

/** Ids of versions beyond the newest `keep`, given newest-first summaries. */
export function versionsToPrune(newestFirst: readonly { id: string }[], keep = LEARN_VERSIONS_KEPT): string[] {
  return newestFirst.slice(keep).map((v) => v.id);
}

/** Order-insensitive deep equality for two contents, for "unpublished changes". */
export function sameContent(a: LearnPageContent | null | undefined, b: LearnPageContent | null | undefined): boolean {
  return stableJson(a ?? null) === stableJson(b ?? null);
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (isObj(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export function hasUnpublishedChanges(doc: LearnPageDoc, exists: boolean): boolean {
  if (!exists) return false;
  return !sameContent(doc.draft, doc.published);
}

/** Width and height that keep the aspect ratio inside `maxWidth`. */
export function fitWidth(width: number, height: number, maxWidth: number): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}
