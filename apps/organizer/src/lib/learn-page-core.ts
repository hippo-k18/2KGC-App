import {
  LEARN_EMBED_PROVIDERS,
  LEARN_IMAGE_PREFIX,
  LEARN_PAGE_DEFAULT,
  RICH_DOC_LIMITS,
  emptyRichDoc,
  isColorValue,
  isRichDoc,
  isSafeHref,
  isSafeRichHref,
  learnEmbedLinkProblem,
  learnPageOrDefault,
  normalizeColor,
  validateRichDoc,
  type ColorValue,
  type LearnBlock,
  type LearnLibrarySections,
  type LearnPageContent,
  type LearnPageDoc,
  type LearnSavedSectionEdit,
  type LearnSection,
  type LinkButton,
  type PageImage,
  type Person,
  type RichContent,
  type RichDoc,
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
 *
 * ── What refuses a save, and what only refuses publish (T325) ────────────────
 *
 * Autosave sends the draft while somebody is still typing, so a value that is
 * merely unfinished must never refuse the whole draft: a new button with no
 * address yet, `linkedin.com/in/x` before the https:// goes in, a Google Maps
 * link the embed cannot show, an empty embed title, a link name half typed or
 * the same as another, a countdown year being typed, a table with its last row
 * deleted, a saved section that was deleted from the library. Those are stored
 * as typed and `publishBlockers` refuses to publish them, naming the block.
 * Only what no amount of typing produces refuses a save: the wrong type, an
 * unknown kind or enum, over a size limit, an image from anywhere but our own
 * uploads, and a link with a dangerous scheme (`javascript:`, `data:` and the
 * like) or a scheme-relative `//host`. Every renderer checks links again with
 * `isSafeHref`, so a half-typed address in the draft never reaches a visitor.
 *
 * v2 (T315) adds rich text (a `RichDoc` wherever the contract says
 * `RichContent`, checked by `validateRichDoc` from `@kgc/shared`), fourteen
 * block kinds, per-block and per-section styling, and anchors that must be
 * unique across the page. A v1 page is still a valid v2 page: every v2 field
 * is optional and a Markdown string is still accepted wherever text goes.
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
  /* v2 (T315) */
  anchor: 64,
  galleryImages: 60,
  logos: 60,
  accordionItems: 50,
  tabs: 12,
  stats: 12,
  cards: 24,
  statValue: 40,
  badge: 40,
  /** Characters of text in a table block (the rich doc default). */
  tableChars: RICH_DOC_LIMITS.chars,
  embedHeightMin: 100,
  embedHeightMax: 2000,
  /** Countdown targets, fixed bounds rather than "now" so validation is deterministic. */
  countdownFrom: Date.UTC(2020, 0, 1),
  countdownTo: Date.UTC(2100, 0, 1),
  overlayMax: 0.8,
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
const VISIBLE_ON = ['all', 'desktop', 'mobile'] as const;
const MAX_WIDTHS = ['small', 'medium', 'large', 'full'] as const;
const SECTION_LAYOUTS = ['single', 'two-equal', 'two-wide-left', 'two-wide-right', 'three'] as const;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ANCHOR = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * A link no editing step produces and no renderer may ever open: a script,
 * data or file scheme (with the spaces and control characters a browser
 * ignores taken out first, so `java script:` counts), or a scheme-relative
 * `//host` or `\\host`. These refuse the save; any other link that is not
 * safe yet is an unfinished one (`isUnfinishedHref`).
 */
export function isRefusedHref(v: string): boolean {
  const squashed = v.replace(/[\u0000-\u0020\u007f]/g, '').toLowerCase();
  return /^(javascript|vbscript|data|file|blob):/.test(squashed) || /^[/\\][/\\]/.test(squashed);
}

/** A stored link the site cannot open yet: empty, half typed, or not a safe address. Publish refuses it. */
export function isUnfinishedHref(v: string): boolean {
  return v.trim() === '' || !isSafeHref(v);
}

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
  /** Validating a section on its way into the library: it may not hold a `reusable` block. */
  forLibrary?: boolean;
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

export type LearnSectionValidation = { ok: true; section: LearnSection } | { ok: false; problems: string[] };

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
 * Section anchors and block anchors share one set because both become `#name`
 * on the same page.
 */
interface Ctx {
  p: Problems;
  allowEmulator: boolean;
  bucket: string | undefined;
  sectionIds: Set<string>;
  blockIds: Set<string>;
  forLibrary: boolean;
}

function newCtx(opts: LearnValidateOptions): Ctx {
  return {
    p: new Problems(),
    allowEmulator: opts.allowEmulator === true,
    bucket: opts.bucket,
    sectionIds: new Set(),
    blockIds: new Set(),
    forLibrary: opts.forLibrary === true,
  };
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

/**
 * A `RichContent` field: the v1 Markdown string under the same length cap as
 * before, or a `RichDoc` checked by `validateRichDoc` with that cap on its
 * characters. The doc stored is the validator's rebuilt copy.
 */
function rich(
  ctx: Ctx,
  where: string,
  name: string,
  v: unknown,
  max: number,
  opts: { required?: boolean; inline?: boolean } = {},
): RichContent | undefined {
  if (isRichDoc(v)) {
    const r = validateRichDoc(withoutUnfinishedLinks(v), { maxChars: max, inline: opts.inline === true });
    if (r.ok) return r.doc;
    for (const problem of r.problems) ctx.p.add(where, problem);
    return emptyRichDoc();
  }
  return str(ctx, where, name, v, max, opts);
}

/**
 * The doc with every link mark whose address is unfinished taken off (the
 * words stay). The editor's link dialog only applies a finished address, but
 * pasted HTML can carry `href="page.html"`, and that must not stop autosave.
 * The sanitizer every renderer runs drops such a link the same way. A refused
 * address (`isRefusedHref`) or an oversized one is left for `validateRichDoc`
 * to refuse. Never throws; anything that is not a mark list is left alone.
 */
function withoutUnfinishedLinks<T>(node: T): T {
  if (Array.isArray(node)) return node.map(withoutUnfinishedLinks) as T;
  if (!isObj(node)) return node;
  const out: Obj = {};
  for (const [k, val] of Object.entries(node)) {
    if (k === 'marks' && Array.isArray(val)) {
      out.marks = val.filter(
        (m) =>
          !(
            isObj(m) &&
            m.type === 'link' &&
            typeof m.href === 'string' &&
            m.href.length <= RICH_DOC_LIMITS.href &&
            !isRefusedHref(m.href) &&
            !isSafeRichHref(m.href)
          ),
      );
    } else {
      out[k] = withoutUnfinishedLinks(val);
    }
  }
  return out as T;
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

/**
 * An in-page link target. Stored as typed: the editor saves on every key, so
 * `our-` on the way to `our-team`, or a name another block already has, is
 * an unfinished link name, refused at publish (`publishBlockers`), not here.
 * The website keeps only well-formed, first-seen anchors either way.
 */
function anchor(ctx: Ctx, where: string, v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') {
    ctx.p.add(where, 'Anchor must be text.');
    return undefined;
  }
  if (v.length > LEARN_LIMITS.anchor) {
    ctx.p.add(where, `Anchor is ${v.length} characters; the limit is ${LEARN_LIMITS.anchor}.`);
    return undefined;
  }
  return v;
}

function color(ctx: Ctx, where: string, name: string, v: unknown): ColorValue | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (!isColorValue(v)) {
    ctx.p.add(where, `${name} must be a brand colour or #rrggbb.`);
    return undefined;
  }
  return normalizeColor(v);
}

/**
 * A link field, stored trimmed. An empty optional link is absent. An empty
 * required one (a new button) or one still being typed is stored as it is and
 * refused at publish (`publishBlockers`); only a refused scheme
 * (`isRefusedHref`) refuses the save.
 */
function href(ctx: Ctx, where: string, name: string, v: unknown, opts: { required?: boolean } = {}): string | undefined {
  const s = str(ctx, where, name, v, LEARN_LIMITS.href, opts);
  if (s === undefined) return undefined;
  const t = s.trim();
  if (t === '' && !opts.required) return undefined;
  if (isRefusedHref(t)) ctx.p.add(where, `${name} "${t.slice(0, 80)}" is not a link the site can open.`);
  return t;
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

function optImage(ctx: Ctx, where: string, v: unknown): PageImage | undefined {
  return v === undefined || v === null ? undefined : image(ctx, where, v);
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

function optButton(ctx: Ctx, where: string, v: unknown): LinkButton | undefined {
  return v === undefined || v === null ? undefined : button(ctx, where, v);
}

function array(ctx: Ctx, where: string, name: string, v: unknown, max: number): unknown[] {
  if (!Array.isArray(v)) {
    ctx.p.add(where, `${name} must be a list.`);
    return [];
  }
  if (v.length > max) ctx.p.add(where, `has ${v.length} ${name}; the limit is ${max}.`);
  return v.slice(0, max);
}

/**
 * The entries of a block's item list, each given its "where" and checked as an
 * object with a well-formed id unique within the block. `build` sees the item
 * and its id and returns the rebuilt item.
 */
function items<T>(
  ctx: Ctx,
  where: string,
  name: string,
  v: unknown,
  max: number,
  noun: string,
  build: (x: Obj, w: string, itemId: string) => T,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  array(ctx, where, name, v, max).forEach((x, i) => {
    const w = `${where}, ${noun} ${i + 1}`;
    if (!isObj(x)) {
      ctx.p.add(w, 'is malformed.');
      return;
    }
    out.push(build(x, w, id(ctx, w, x.id, seen)));
  });
  return out;
}

/** Copies the keys whose value is not undefined, so absent stays absent. */
function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
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
  const bio = rich(ctx, where, 'Bio', v.bio, LEARN_LIMITS.bio);
  if (bio !== undefined && bio !== '') out.bio = bio;
  return out;
}

type BaseFields = Omit<Extract<LearnBlock, { kind: 'divider' }>, 'kind'>;

/** Copies the optional layout fields every block shares, leaving absent ones absent. */
function base(ctx: Ctx, where: string, v: Obj): BaseFields {
  const out: BaseFields = { id: id(ctx, where, v.id, ctx.blockIds) };
  if (bool(v.hidden)) out.hidden = true;
  const align = enumField(ctx, where, 'Alignment', v.align, ALIGNS);
  if (align) out.align = align;
  const above = enumField(ctx, where, 'Space above', v.spaceAbove, SPACINGS);
  if (above) out.spaceAbove = above;
  const below = enumField(ctx, where, 'Space below', v.spaceBelow, SPACINGS);
  if (below) out.spaceBelow = below;
  const visibleOn = enumField(ctx, where, 'Show on', v.visibleOn, VISIBLE_ON);
  if (visibleOn) out.visibleOn = visibleOn;
  const a = anchor(ctx, where, v.anchor);
  if (a) out.anchor = a;
  const maxWidth = enumField(ctx, where, 'Block width', v.maxWidth, MAX_WIDTHS);
  if (maxWidth) out.maxWidth = maxWidth;
  if (bool(v.boxed)) out.boxed = true;
  const textColor = color(ctx, where, 'Text colour', v.textColor);
  if (textColor) out.textColor = textColor;
  const note = str(ctx, where, 'Note', v.note, LEARN_LIMITS.note);
  if (note) out.note = note;
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
        text: rich(ctx, where, 'Heading', v.text, LEARN_LIMITS.heading, { required: true, inline: true }) ?? '',
        level: enumField(ctx, where, 'Heading level', v.level, [1, 2, 3, 4] as const, { required: true })!,
      };
      const size = enumField(ctx, where, 'Text size', v.size, TEXT_SIZES);
      if (size) out.size = size;
      return out;
    }
    case 'text': {
      const out: LearnBlock = {
        ...b,
        kind: 'text',
        text: rich(ctx, where, 'Text', v.text, LEARN_LIMITS.richText, { required: true }) ?? '',
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
          const item: { id: string; title?: string; text: RichContent; children?: string[]; link?: LinkButton } = {
            id: id(ctx, w, x.id, seen),
            text: rich(ctx, w, 'Text', x.text, LEARN_LIMITS.richText, { required: true }) ?? '',
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
          const item: { id: string; image?: PageImage; title?: string; text: RichContent; link?: LinkButton } = {
            id: id(ctx, w, x.id, seen),
            text: rich(ctx, w, 'Text', x.text, LEARN_LIMITS.richText, { required: true }) ?? '',
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
      // An empty link is a video block not filled in yet, and an http:// or
      // half-typed one is unfinished: both stored, refused at publish.
      const url = raw.trim() === '' ? '' : raw;
      if (url !== '' && isRefusedHref(url)) ctx.p.add(where, 'Video link must start with https://.');
      const out: LearnBlock = { ...b, kind: 'video', url };
      const caption = str(ctx, where, 'Caption', v.caption, LEARN_LIMITS.caption);
      if (caption) out.caption = caption;
      return out;
    }
    case 'divider':
      return { ...b, kind: 'divider' };
    case 'spacer':
      return { ...b, kind: 'spacer', size: enumField(ctx, where, 'Spacer size', v.size, SPACINGS, { required: true })! };

    /* ── v2 (T315) ── */
    case 'imageText': {
      const out: LearnBlock = {
        ...b,
        kind: 'imageText',
        image: image(ctx, where, v.image),
        imageSide: enumField(ctx, where, 'Image side', v.imageSide, ['left', 'right'] as const, { required: true })!,
        imageWidth: enumField(ctx, where, 'Image width', v.imageWidth, ['third', 'half'] as const, { required: true })!,
        shape: enumField(ctx, where, 'Image shape', v.shape, IMAGE_SHAPES, { required: true })!,
        text: rich(ctx, where, 'Text', v.text, LEARN_LIMITS.richText, { required: true }) ?? '',
      };
      if (v.buttons !== undefined && v.buttons !== null) {
        out.buttons = array(ctx, where, 'buttons', v.buttons, LEARN_LIMITS.buttons).map((x, i) =>
          button(ctx, `${where}, button ${i + 1}`, x),
        );
      }
      return out;
    }
    case 'gallery':
      return {
        ...b,
        kind: 'gallery',
        layout: enumField(ctx, where, 'Gallery layout', v.layout, ['grid', 'carousel', 'masonry'] as const, { required: true })!,
        columns: enumField(ctx, where, 'Columns', v.columns, COLUMNS, { required: true })!,
        images: items(ctx, where, 'images', v.images, LEARN_LIMITS.galleryImages, 'image', (x, w, itemId) =>
          compact({
            ...image(ctx, w, x),
            id: itemId,
            caption: str(ctx, w, 'Caption', x.caption, LEARN_LIMITS.caption) || undefined,
          }),
        ),
        lightbox: v.lightbox === true,
      };
    case 'quote':
      return compact({
        ...b,
        kind: 'quote' as const,
        text: rich(ctx, where, 'Quote', v.text, LEARN_LIMITS.richText, { required: true }) ?? '',
        name: str(ctx, where, 'Name', v.name, LEARN_LIMITS.shortText) || undefined,
        role: str(ctx, where, 'Role', v.role, LEARN_LIMITS.shortText) || undefined,
        photo: optImage(ctx, where, v.photo),
        style: enumField(ctx, where, 'Quote style', v.style, ['plain', 'large', 'card'] as const, { required: true })!,
      });
    case 'callout':
      return compact({
        ...b,
        kind: 'callout' as const,
        tone: enumField(ctx, where, 'Tone', v.tone, ['info', 'success', 'warning', 'brand'] as const, { required: true })!,
        title: str(ctx, where, 'Title', v.title, LEARN_LIMITS.heading) || undefined,
        text: rich(ctx, where, 'Text', v.text, LEARN_LIMITS.richText, { required: true }) ?? '',
      });
    case 'accordion':
      return {
        ...b,
        kind: 'accordion',
        items: items(ctx, where, 'items', v.items, LEARN_LIMITS.accordionItems, 'item', (x, w, itemId) =>
          compact({
            id: itemId,
            title: str(ctx, w, 'Title', x.title, LEARN_LIMITS.heading, { required: true }) ?? '',
            text: rich(ctx, w, 'Text', x.text, LEARN_LIMITS.richText, { required: true }) ?? '',
            open: bool(x.open),
          }),
        ),
        allowMany: v.allowMany === true,
      };
    case 'tabs':
      return {
        ...b,
        kind: 'tabs',
        items: items(ctx, where, 'tabs', v.items, LEARN_LIMITS.tabs, 'tab', (x, w, itemId) => ({
          id: itemId,
          title: str(ctx, w, 'Title', x.title, LEARN_LIMITS.heading, { required: true }) ?? '',
          text: rich(ctx, w, 'Text', x.text, LEARN_LIMITS.richText, { required: true }) ?? '',
        })),
      };
    case 'stats':
      return {
        ...b,
        kind: 'stats',
        columns: enumField(ctx, where, 'Columns', v.columns, COLUMNS, { required: true })!,
        items: items(ctx, where, 'figures', v.items, LEARN_LIMITS.stats, 'figure', (x, w, itemId) => ({
          id: itemId,
          value: str(ctx, w, 'Figure', x.value, LEARN_LIMITS.statValue, { required: true }) ?? '',
          label: str(ctx, w, 'Label', x.label, LEARN_LIMITS.shortText, { required: true }) ?? '',
        })),
      };
    case 'cards':
      return {
        ...b,
        kind: 'cards',
        columns: enumField(ctx, where, 'Columns', v.columns, COLUMNS, { required: true })!,
        items: items(ctx, where, 'cards', v.items, LEARN_LIMITS.cards, 'card', (x, w, itemId) =>
          compact({
            id: itemId,
            image: optImage(ctx, w, x.image),
            title: str(ctx, w, 'Title', x.title, LEARN_LIMITS.heading, { required: true }) ?? '',
            text: rich(ctx, w, 'Text', x.text, LEARN_LIMITS.richText, { required: true }) ?? '',
            link: optButton(ctx, w, x.link),
            badge: str(ctx, w, 'Badge', x.badge, LEARN_LIMITS.badge) || undefined,
          }),
        ),
      };
    case 'logos':
      return {
        ...b,
        kind: 'logos',
        grayscale: v.grayscale === true,
        items: items(ctx, where, 'logos', v.items, LEARN_LIMITS.logos, 'logo', (x, w, itemId) =>
          compact({ ...image(ctx, w, x), id: itemId, href: href(ctx, w, 'Logo link', x.href) }),
        ),
      };
    case 'embed': {
      const provider = enumField(ctx, where, 'Embed type', v.provider, LEARN_EMBED_PROVIDERS, { required: true })!;
      const url = (str(ctx, where, 'Embed link', v.url, LEARN_LIMITS.href, { required: true }) ?? '').trim();
      // An empty link is "not added yet", and one `learnEmbedSrc` cannot show
      // (a short maps.app.goo.gl link, a half-pasted address) is unfinished:
      // both stored and refused at publish (`publishBlockers`). The iframe
      // address is always rebuilt from the allowlist, never taken from here.
      if (url !== '' && isRefusedHref(url)) ctx.p.add(where, 'Embed link is not a link the site can open.');
      // An empty title is allowed: the renderers fall back to `defaultEmbedTitle`
      // and the Checker asks for a real one.
      const title = str(ctx, where, 'Embed title', v.title ?? '', LEARN_LIMITS.shortText) ?? '';
      const out: LearnBlock = {
        ...b,
        kind: 'embed',
        provider,
        url,
        aspect: enumField(ctx, where, 'Aspect', v.aspect, ['16:9', '4:3', '1:1', 'auto'] as const, { required: true })!,
        title,
      };
      if (v.height !== undefined && v.height !== null) {
        const h = v.height;
        // `6` on the way to `600` is stored and refused at publish; the
        // renderers ignore a height outside their own range.
        if (typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > EMBED_HEIGHT_STORED_MAX) {
          ctx.p.add(where, 'Embed height must be a whole number of pixels.');
        } else {
          out.height = h;
        }
      }
      return out;
    }
    case 'countdown': {
      const until = v.until;
      // 0 is "no date chosen yet", and a real date outside 2020 to 2099 is
      // one being typed (the year field passes through 0002 on the way to
      // 2027): both stored, refused at publish (`publishBlockers`). Only what
      // is not a date at all refuses the save.
      if (typeof until !== 'number' || !Number.isInteger(until) || Math.abs(until) > MAX_DATE_MS) {
        ctx.p.add(where, 'Countdown date must be a real date between 2020 and 2099.');
      }
      return compact({
        ...b,
        kind: 'countdown' as const,
        until: typeof until === 'number' ? until : 0,
        label: str(ctx, where, 'Label', v.label, LEARN_LIMITS.shortText) || undefined,
        doneText: str(ctx, where, 'Text when done', v.doneText, LEARN_LIMITS.shortText) || undefined,
      });
    }
    case 'table': {
      let doc: RichDoc = emptyRichDoc();
      if (!isRichDoc(v.doc)) {
        ctx.p.add(where, 'Table is missing.');
      } else {
        const r = validateRichDoc(withoutUnfinishedLinks(v.doc), { maxChars: LEARN_LIMITS.tableChars });
        if (r.ok) {
          // A table with every row deleted is unfinished, refused at publish.
          doc = r.doc;
        } else {
          for (const problem of r.problems) ctx.p.add(where, problem);
        }
      }
      return compact({
        ...b,
        kind: 'table' as const,
        doc,
        striped: v.striped === true,
        caption: str(ctx, where, 'Caption', v.caption, LEARN_LIMITS.caption) || undefined,
      });
    }
    case 'toc':
      return compact({ ...b, kind: 'toc' as const, title: str(ctx, where, 'Title', v.title, LEARN_LIMITS.heading) || undefined });
    case 'reusable': {
      const libraryId = typeof v.libraryId === 'string' ? v.libraryId : '';
      if (ctx.forLibrary) {
        ctx.p.add(where, 'A saved section cannot hold another saved section.');
      } else if (libraryId === '') {
        // Not chosen yet, as an empty Image block is: the draft keeps it so
        // autosave goes on, and publish refuses it (`publishBlockers`).
      } else if (!ID.test(libraryId)) {
        ctx.p.add(where, 'Saved section id is missing or malformed.');
      }
      // A saved section deleted from the library (Undo can bring back a block
      // that points at one) is not checked here: the draft saves, and publish
      // refuses it by name (`publishBlockers` with the library).
      return { ...b, kind: 'reusable', libraryId };
    }
    default:
      ctx.p.add(where, `has an unknown kind "${String(v.kind).slice(0, 40)}".`);
      return null;
  }
}

/** The largest embed height stored; the renderers use 100 to 2000 (`LEARN_LIMITS`). */
const EMBED_HEIGHT_STORED_MAX = 100_000;
/** The farthest a JavaScript date reaches either side of 1970. */
const MAX_DATE_MS = 8.64e15;

/** How many columns each section layout has; absent or `single` is one. */
const LAYOUT_COLUMNS: Record<(typeof SECTION_LAYOUTS)[number], number> = {
  single: 1,
  'two-equal': 2,
  'two-wide-left': 2,
  'two-wide-right': 2,
  three: 3,
};

/**
 * Which column each block sits in. Blocks with no entry sit in the first
 * column. The map follows the section rather than refusing it: switching to
 * fewer columns, or deleting a block, can leave entries behind, and that must
 * not stop autosave. So an entry for a block the section does not hold is
 * dropped, a column past the layout's last is moved into its last, and a
 * one-column section keeps no map. An empty map is dropped. A value that is
 * not a whole number is still refused: no editing step makes one.
 */
function blockColumn(
  ctx: Ctx,
  where: string,
  v: unknown,
  layout: LearnSection['layout'],
  blocks: readonly LearnBlock[],
): Record<string, number> | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) {
    ctx.p.add(where, 'Block columns are malformed.');
    return undefined;
  }
  const keys = Object.keys(v);
  if (keys.length === 0) return undefined;
  if (keys.length > LEARN_LIMITS.blocksPerSection) {
    ctx.p.add(where, 'Block columns name more blocks than a section holds.');
    return undefined;
  }
  const columns = LAYOUT_COLUMNS[layout ?? 'single'];
  const ids = new Set(blocks.map((b) => b.id));
  const out: Record<string, number> = {};
  for (const key of keys) {
    const col = v[key];
    if (typeof col !== 'number' || !Number.isInteger(col) || col < 0) {
      ctx.p.add(where, `places "${key.slice(0, 64)}" in column ${String(col).slice(0, 20)}, which is not a column number.`);
    } else if (ids.has(key) && columns > 1) {
      out[key] = Math.min(col, columns - 1);
    }
  }
  return out;
}

function section(ctx: Ctx, where: string, v: unknown): LearnSection | null {
  if (!isObj(v)) {
    ctx.p.add(where, 'is malformed.');
    return null;
  }
  const blocks = array(ctx, where, 'blocks', v.blocks, LEARN_LIMITS.blocksPerSection);
  const sectionId = id(ctx, where, v.id, ctx.sectionIds);
  const out: LearnSection = {
    id: sectionId,
    label: str(ctx, where, 'Section name', v.label ?? '', LEARN_LIMITS.label) ?? '',
    background: enumField(ctx, where, 'Background', v.background, BAND_BACKGROUNDS, { required: true })!,
    width: enumField(ctx, where, 'Width', v.width, SECTION_WIDTHS, { required: true })!,
    paddingTop: enumField(ctx, where, 'Padding above', v.paddingTop, SPACINGS, { required: true })!,
    paddingBottom: enumField(ctx, where, 'Padding below', v.paddingBottom, SPACINGS, { required: true })!,
    blocks: [],
  };
  if (bool(v.waveBehindFirstImage)) out.waveBehindFirstImage = true;
  if (bool(v.hidden)) out.hidden = true;
  const bg = color(ctx, where, 'Background colour', v.backgroundColor);
  if (bg) out.backgroundColor = bg;
  const bgImage = optImage(ctx, where, v.backgroundImage);
  if (bgImage) out.backgroundImage = bgImage;
  if (v.overlay !== undefined && v.overlay !== null) {
    const o = v.overlay;
    if (typeof o !== 'number' || !Number.isFinite(o) || o < 0 || o > LEARN_LIMITS.overlayMax) {
      ctx.p.add(where, `Overlay must be between 0 and ${LEARN_LIMITS.overlayMax}.`);
    } else {
      out.overlay = o;
    }
  }
  const a = anchor(ctx, where, v.anchor);
  if (a) out.anchor = a;
  const visibleOn = enumField(ctx, where, 'Show on', v.visibleOn, VISIBLE_ON);
  if (visibleOn) out.visibleOn = visibleOn;
  const layout = enumField(ctx, where, 'Layout', v.layout, SECTION_LAYOUTS);
  if (layout) out.layout = layout;
  const note = str(ctx, where, 'Note', v.note, LEARN_LIMITS.note);
  if (note) out.note = note;

  out.blocks = blocks.map((b, i) => block(ctx, `${where}, block ${i + 1}`, b)).filter((b): b is LearnBlock => b !== null);
  const cols = blockColumn(ctx, where, v.blockColumn, out.layout, out.blocks);
  if (cols && Object.keys(cols).length > 0) out.blockColumn = cols;
  return out;
}

/** A map of ids to ids or anchors, as a saved-section edit keeps them. */
function idMap(v: unknown, values: 'id' | 'anchor'): Record<string, string> | null {
  if (!isObj(v) || Object.keys(v).length > LEARN_LIMITS.blocksPerSection) return null;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) {
    if (!ID.test(k) || typeof x !== 'string') return null;
    if (values === 'id' ? !ID.test(x) : x === '' || x.length > LEARN_LIMITS.anchor) return null;
    out[k] = x;
  }
  return out;
}

/**
 * The marker on the copy that Edit saved section opened (T328), kept in the
 * stored draft so a reload keeps the edit going. Never rendered: publish puts
 * the link back from `restore` (`asPublished` in `@kgc/shared`)
 * and validates the page that results, and the website's reader drops it. A
 * marker naming another section is a duplicated copy's and is dropped, as is
 * any after the first, so the page has one edit at most. A marker no editing
 * step makes is refused. The section and block in `restore` are checked by the
 * same rules as the page's, with ids counted on their own: they are the
 * link's section and block as they were, not part of the page until Cancel.
 */
function savedSectionEdit(ctx: Ctx, where: string, v: unknown, sectionId: string): LearnSavedSectionEdit | undefined {
  if (v === undefined || v === null) return undefined;
  const bad = () => {
    ctx.p.add(where, 'The saved section being changed is malformed. Cancel the change or reload.');
    return undefined;
  };
  if (!isObj(v) || !isObj(v.restore)) return bad();
  if (v.sectionId !== sectionId) return undefined;
  const ids = idMap(v.ids, 'id');
  const anchors = idMap(v.anchors ?? {}, 'anchor');
  if (typeof v.libraryId !== 'string' || !ID.test(v.libraryId) || typeof v.name !== 'string' || !ids || !anchors) return bad();
  const name = v.name.slice(0, LEARN_LIMITS.label);
  const own: Ctx = { ...ctx, sectionIds: new Set(), blockIds: new Set(), forLibrary: false };
  const r = v.restore;
  let restore: LearnSavedSectionEdit['restore'];
  if (r.kind === 'none') {
    restore = { kind: 'none' };
  } else if (r.kind === 'whole') {
    if (!isObj(r.host) || r.host.id !== sectionId) return bad();
    const host = section(own, where, r.host);
    if (!host) return undefined;
    restore = { kind: 'whole', host };
  } else if (r.kind === 'inPlace') {
    const index = r.index;
    const column = r.column;
    if (typeof r.hostSectionId !== 'string' || !ID.test(r.hostSectionId)) return bad();
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > LEARN_LIMITS.blocksPerSection) return bad();
    if (column !== undefined && (typeof column !== 'number' || !Number.isInteger(column) || column < 0 || column > 2)) return bad();
    if (!isObj(r.block) || r.block.kind !== 'reusable') return bad();
    const linked = block(own, where, r.block);
    if (!linked) return undefined;
    restore = { kind: 'inPlace', hostSectionId: r.hostSectionId, index, block: linked };
    if (column !== undefined) restore.column = column;
  } else {
    return bad();
  }
  return { libraryId: v.libraryId, name, sectionId, ids, anchors, restore };
}

function contentBytes(ctx: Ctx, value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  if (bytes > LEARN_LIMITS.contentBytes) {
    ctx.p.add('', `The page is ${Math.round(bytes / 1024)} KB of text; the limit is ${LEARN_LIMITS.contentBytes / 1024} KB.`);
  }
}

/**
 * Rebuild `input` as a `LearnPageContent`, or say what is wrong with it.
 *
 * `allowEmulator` accepts image URLs from a local Storage emulator; the server
 * passes it only when the emulator is configured. `libraryIds`, when given,
 * is the set of saved sections a `reusable` block may point at.
 */
export function validateLearnContent(input: unknown, opts: LearnValidateOptions = {}): LearnValidation {
  const ctx = newCtx(opts);
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
  // The one saved section being changed on the page, if any (T328).
  let editing = false;
  content.sections.forEach((s, i) => {
    const raw = sections[i];
    if (editing || !isObj(raw) || raw.libraryEdit === undefined) return;
    const edit = savedSectionEdit(ctx, `Section ${i + 1}`, raw.libraryEdit, s.id);
    if (edit) {
      s.libraryEdit = edit;
      editing = true;
    }
  });
  // An empty page title is refused at publish (`publishBlockers`), not here:
  // clearing the field to type a new one must not stop autosave.
  const og = optImage(ctx, 'Sharing image', input.ogImage);
  if (og) content.ogImage = og;
  if (bool(input.noindex)) content.noindex = true;

  const total = content.sections.reduce((n, s) => n + s.blocks.length, 0);
  if (total > LEARN_LIMITS.totalBlocks) {
    ctx.p.add('', `The page has ${total} blocks; the limit is ${LEARN_LIMITS.totalBlocks}.`);
  }
  contentBytes(ctx, content);

  return ctx.p.list.length > 0 ? { ok: false, problems: ctx.p.list } : { ok: true, content };
}

/**
 * Rebuild one section on its own, by the same rules as a section of the page,
 * for the saved-section library. Ids and anchors are checked within the
 * section only. With `forLibrary`, a `reusable` block inside is refused,
 * because a saved section may not point at another one.
 */
export function validateLearnSection(input: unknown, opts: LearnValidateOptions = {}): LearnSectionValidation {
  const ctx = newCtx(opts);
  if (!isObj(input)) return { ok: false, problems: ['The section is missing or malformed.'] };
  const out = section(ctx, 'Section', input);
  if (out) contentBytes(ctx, out);
  return ctx.p.list.length > 0 || !out ? { ok: false, problems: ctx.p.list } : { ok: true, section: out };
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

/** The fields of a doc that are always present, plus the optional ones when set. */
export function docOf(d: LearnPageDoc): LearnPageDoc {
  const out: LearnPageDoc = {
    draft: d.draft,
    published: d.published ?? null,
    draftUpdatedAt: d.draftUpdatedAt,
    draftUpdatedBy: d.draftUpdatedBy,
    revision: d.revision,
  };
  if (d.publishedAt !== undefined) out.publishedAt = d.publishedAt;
  if (d.publishedBy !== undefined) out.publishedBy = d.publishedBy;
  // T316: a draft save keeps a pending schedule and a live preview link.
  if (d.scheduledPublishAt !== undefined) out.scheduledPublishAt = d.scheduledPublishAt;
  if (d.scheduledBy !== undefined) out.scheduledBy = d.scheduledBy;
  if (d.scheduledRevision !== undefined) out.scheduledRevision = d.scheduledRevision;
  if (d.previewToken !== undefined) out.previewToken = d.previewToken;
  if (d.scheduleFailure !== undefined) out.scheduleFailure = d.scheduleFailure;
  return out;
}

/**
 * The doc with no publish scheduled (T316): what a publish, a cancel or a new
 * schedule starts from. A recorded scheduled-publish failure goes too: it
 * explained why the last schedule did not run, and once somebody publishes or
 * schedules again it describes nothing that is still true.
 */
export function withoutSchedule(d: LearnPageDoc): LearnPageDoc {
  const out = docOf(d);
  delete out.scheduledPublishAt;
  delete out.scheduledBy;
  delete out.scheduledRevision;
  delete out.scheduleFailure;
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

/** Each block kind as the Add block picker names it, for publish messages. */
const KIND_LABEL: Record<LearnBlock['kind'], string> = {
  heading: 'Heading',
  text: 'Text',
  image: 'Image',
  buttons: 'Buttons',
  people: 'People',
  list: 'List',
  columns: 'Columns',
  video: 'Video',
  divider: 'Divider',
  spacer: 'Empty space',
  imageText: 'Image and text',
  gallery: 'Gallery',
  quote: 'Quote',
  callout: 'Note box',
  accordion: 'Questions',
  tabs: 'Tabs',
  stats: 'Numbers',
  cards: 'Cards',
  logos: 'Logos',
  embed: 'Map, form or video',
  countdown: 'Countdown',
  table: 'Table',
  toc: 'Contents list',
  reusable: 'Saved section',
};

function listOf<T>(v: T[] | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

/** Every link a block holds, with what the publish message calls it. */
function blockLinks(b: LearnBlock): { href: unknown; noun: string }[] {
  const link = (l: LinkButton | undefined) => (isObj(l) ? [{ href: l.href, noun: 'link' }] : []);
  switch (b.kind) {
    case 'buttons':
      return listOf(b.buttons).flatMap(link);
    case 'imageText':
      return listOf(b.buttons).flatMap(link);
    case 'image':
      return b.href !== undefined ? [{ href: b.href, noun: 'link' }] : [];
    case 'people':
      return listOf(b.people).flatMap((p) => (isObj(p) && p.linkedin !== undefined ? [{ href: p.linkedin, noun: 'LinkedIn link' }] : []));
    case 'list':
    case 'columns':
    case 'cards':
      return listOf<{ link?: LinkButton }>(b.items).flatMap((i) => (isObj(i) ? link(i.link) : []));
    case 'logos':
      return listOf(b.items).flatMap((i) => (isObj(i) && i.href !== undefined ? [{ href: i.href, noun: 'link' }] : []));
    default:
      return [];
  }
}

/** Shown in a message: what was typed, short. */
function typed(v: string): string {
  const t = v.trim();
  return t.length > 60 ? `${t.slice(0, 57)}...` : t;
}

/**
 * Why one block (of the page or of a saved section it uses) cannot go on the
 * website yet, as messages naming it and its section. Defensive about shape:
 * a saved section comes from the library as stored.
 */
function blockBlockers(b: LearnBlock, name: string, out: string[], library: LearnLibrarySections | undefined) {
  if (!isObj(b)) return;
  const label = KIND_LABEL[b.kind] ?? 'A';
  const where = `The ${label} block in "${name}"`;
  for (const { href, noun } of blockLinks(b)) {
    if (typeof href !== 'string' || href.trim() === '') {
      out.push(`${where} has a ${noun} with no address yet. Add one or remove the ${noun}.`);
    } else if (isUnfinishedHref(href)) {
      out.push(`${where} has a ${noun} that is not finished: "${typed(href)}". Use a full address, like https://example.com.`);
    }
  }
  switch (b.kind) {
    case 'image':
      if (!b.image?.src) out.push(`${where} has no image yet. Choose one or remove the block.`);
      break;
    case 'video': {
      const url = typeof b.url === 'string' ? b.url.trim() : '';
      if (!url) out.push(`${where} has no video link yet. Add one or remove the block.`);
      else if (!/^https:\/\/[^\s]+$/.test(url) || !isSafeHref(url))
        out.push(`${where} has a link that is not finished: "${typed(url)}". Use a YouTube or Vimeo link that starts with https://.`);
      break;
    }
    case 'embed': {
      const url = typeof b.url === 'string' ? b.url.trim() : '';
      const problem = url ? learnEmbedLinkProblem(b.provider, url) : null;
      if (!url) out.push(`${where} has no link yet. Add one or remove the block.`);
      else if (problem) out.push(`${where} has a link that can't be shown. ${problem}`);
      if (typeof b.height === 'number' && (b.height < LEARN_LIMITS.embedHeightMin || b.height > LEARN_LIMITS.embedHeightMax)) {
        out.push(
          `${where} is set to ${b.height} pixels tall. Use a height from ${LEARN_LIMITS.embedHeightMin} to ${LEARN_LIMITS.embedHeightMax}.`,
        );
      }
      break;
    }
    case 'countdown':
      if (!b.until) out.push(`${where} has no date yet. Choose one or remove the block.`);
      else if (!(b.until >= LEARN_LIMITS.countdownFrom && b.until < LEARN_LIMITS.countdownTo))
        out.push(`${where} has a date outside 2020 to 2099. Choose another date.`);
      break;
    case 'table':
      if (!listOf(b.doc?.content).some((n) => n?.type === 'table'))
        out.push(`${where} has no rows yet. Add a row or remove the block.`);
      break;
    case 'reusable': {
      if (!b.libraryId) {
        out.push(`${where} has no saved section chosen yet. Choose one or remove the block.`);
        break;
      }
      if (!library) break;
      const saved: LearnSection | undefined =
        library instanceof Map
          ? library.get(b.libraryId)
          : Object.prototype.hasOwnProperty.call(library, b.libraryId)
            ? (library as Readonly<Record<string, LearnSection>>)[b.libraryId]
            : undefined;
      if (!saved) {
        out.push(`${where} shows a saved section that was deleted. Remove the block or choose another saved section.`);
      } else if (!b.hidden) {
        // What the saved section would put on the page, under this section's name
        // (`expandReusableBlocks` drops a hidden one, and never nests them).
        for (const inner of listOf(saved.blocks)) {
          if (isObj(inner) && inner.kind !== 'reusable') {
            blockBlockers(inner, name, out, undefined);
            anchorBlockers(inner.anchor, name, out);
          }
        }
      }
      break;
    }
  }
}

function anchorBlockers(a: unknown, name: string, out: string[]) {
  if (typeof a === 'string' && a !== '' && !ANCHOR.test(a)) {
    out.push(`The link name "${typed(a)}" in "${name}" can only use lower-case letters, numbers and single dashes, like our-team.`);
  }
}

/**
 * Why the page cannot go on the website yet: blocks not filled in (an Image
 * with no image, a Video, Embed or Countdown with nothing chosen, a Saved
 * section block with none chosen), and since T325 everything the validator
 * stores unfinished so autosave goes on: a link with no address or one still
 * being typed, an embed link that cannot be shown, an embed height or a
 * countdown date out of range, a table with no rows, a link name that is not
 * well formed or is used twice, an empty page title. With `library`, a Saved
 * section block pointing at a deleted section is refused too, and the blocks
 * of each saved section it uses are checked under the host section's name.
 *
 * The draft keeps all of these (autosave must not stop while someone is still
 * filling a block in); publish, scheduled or not, refuses them with these
 * messages, which name the block and its section. The publish dialog runs the
 * same function, so the two never disagree.
 */
export function publishBlockers(content: LearnPageContent, library?: LearnLibrarySections): string[] {
  const out: string[] = [];
  if (typeof content.seoTitle !== 'string' || content.seoTitle.trim() === '') {
    out.push('The page title in Search settings is empty. Add one before publishing.');
  }
  const anchorCount = new Map<string, number>();
  const count = (a: unknown) => {
    if (typeof a === 'string' && a !== '') anchorCount.set(a, (anchorCount.get(a) ?? 0) + 1);
  };
  listOf(content.sections).forEach((s, i) => {
    if (!isObj(s)) return;
    const name = (typeof s.label === 'string' && s.label.trim()) || `Section ${i + 1}`;
    anchorBlockers(s.anchor, name, out);
    count(s.anchor);
    for (const b of listOf(s.blocks)) {
      if (!isObj(b)) continue;
      blockBlockers(b, name, out, library);
      if (b.kind !== 'reusable') {
        anchorBlockers(b.anchor, name, out);
        count(b.anchor);
      }
    }
  });
  for (const [a, n] of anchorCount) {
    if (n > 1) out.push(`The link name "${typed(a)}" is used ${n} times on the page. Each link name must be different.`);
  }
  return out;
}

/**
 * What a publish checks, in one list: the draft with the library (empty and
 * deleted saved sections, and what is inside each one used) and the expanded
 * page that would go live. Both are checked so nothing the expansion drops
 * (an empty Saved section block expands to nothing, T324 X1) or adds can
 * slip past. The two lists mostly agree, so a message the expanded page
 * repeats is counted against the draft's, not listed twice; two blocks with
 * the same problem still give two messages.
 */
export function publishProblems(
  draft: LearnPageContent,
  library: LearnLibrarySections,
  expanded: LearnPageContent,
): string[] {
  const out = publishBlockers(draft, library);
  const unmatched = new Map<string, number>();
  for (const m of out) unmatched.set(m, (unmatched.get(m) ?? 0) + 1);
  for (const m of publishBlockers(expanded)) {
    const n = unmatched.get(m) ?? 0;
    if (n > 0) unmatched.set(m, n - 1);
    else out.push(m);
  }
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
  // Publishing by hand also settles a pending schedule: the draft it would have published is live.
  const doc = withoutSchedule({ ...stored, published: stored.draft, publishedAt: now, publishedBy: actor });
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
  // T316's schedule and preview link, typed one by one: the editor shows the
  // schedule and offers the link, so a field of the wrong type is dropped here
  // rather than rendered.
  if (typeof stored.scheduledPublishAt === 'number' && Number.isFinite(stored.scheduledPublishAt)) {
    doc.scheduledPublishAt = stored.scheduledPublishAt;
    if (typeof stored.scheduledBy === 'string') doc.scheduledBy = stored.scheduledBy;
    if (Number.isInteger(stored.scheduledRevision)) doc.scheduledRevision = stored.scheduledRevision;
  }
  if (typeof stored.previewToken === 'string' && stored.previewToken) doc.previewToken = stored.previewToken;
  const failure = stored.scheduleFailure;
  if (isObj(failure) && typeof failure.at === 'number' && typeof failure.message === 'string') {
    doc.scheduleFailure = { at: failure.at, message: failure.message };
  }
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
