/**
 * Pure helpers for drawing a `LearnPageContent`: the website's /learn route and
 * the dashboard's preview both use these, so the two never disagree about what
 * a stored page means.
 *
 * ── Never a broken page ─────────────────────────────────────────────────────
 *
 * `parseLearnPageContent` reads whatever is stored and returns a page that is
 * safe to render, or `null` when there is nothing worth rendering (the route
 * then shows `LEARN_PAGE_DEFAULT`). It is forgiving inside the page and strict
 * about its shape: an unknown option falls back to its default, a block that
 * cannot be drawn (an unknown kind from a newer editor, an image with no
 * source) is dropped, and only a document with no title or no sections at all
 * counts as invalid.
 */

import { isSafeHref, parseInline, type InlineSpan } from "./rich-text-core.js";
import { defaultEmbedTitle, isLearnEmbedProvider, learnEmbedSrc } from "./learn-embed-core.js";
import { isAnchor, parseColorValue, videoEmbedSrc } from "./learn-render-core.js";
import { isRichContentEmpty, isRichDoc, sanitizeRichDoc } from "./rich-doc-core.js";
import {
  LEARN_IMAGE_PREFIX,
  LEARN_PAGE_DEFAULT,
  type Align,
  type BandBackground,
  type Columns,
  type ImageShape,
  type ImageWidth,
  type LearnBlock,
  type LearnPageContent,
  type LearnSection,
  type LinkButton,
  type PageImage,
  type Person,
  type RichContent,
  type RichDoc,
  type Spacing,
  type TextSize,
} from "./learn-page.js";

const BACKGROUNDS: readonly BandBackground[] = ["plain", "white-wave", "light-blue-wave", "blue", "grey-wave"];
const ALIGNS: readonly Align[] = ["left", "center", "right"];
const SPACINGS: readonly Spacing[] = ["none", "small", "medium", "large"];
const TEXT_SIZES: readonly TextSize[] = ["small", "normal", "large", "x-large"];
const IMAGE_WIDTHS: readonly ImageWidth[] = ["small", "medium", "large", "full"];
const IMAGE_SHAPES: readonly ImageShape[] = ["square", "rounded", "circle", "original"];
const SECTION_WIDTHS: readonly LearnSection["width"][] = ["narrow", "normal", "wide"];
const BUTTON_STYLES: readonly LinkButton["style"][] = ["primary", "secondary", "text"];
/** "all" is the default, so only the two restrictions are kept. */
const SHOWN_ON = ["desktop", "mobile"] as const;
const MAX_WIDTHS = ["small", "medium", "large", "full"] as const;
const LAYOUTS: readonly NonNullable<LearnSection["layout"]>[] = ["single", "two-equal", "two-wide-left", "two-wide-right", "three"];

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const oneOf = <T>(v: unknown, list: readonly T[], fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback;
const maybeOneOf = <T>(v: unknown, list: readonly T[]): T | undefined =>
  list.includes(v as T) ? (v as T) : undefined;
const columns = (v: unknown, fallback: Columns): Columns =>
  v === 1 || v === 2 || v === 3 || v === 4 ? v : fallback;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const clamp01 = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined;
/** A whole number of pixels, 1 to 100,000; anything else (0.4, 1e300) is treated as unset. */
const positive = (v: unknown): number | undefined => {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const n = Math.round(v);
  return n >= 1 && n <= 100_000 ? n : undefined;
};

/**
 * The dates a countdown may count to, the editor's range (`LEARN_LIMITS` in
 * the dashboard's `learn-page-core.ts`). Outside it a stored `until` is
 * treated as unset: `new Date(1e16).toISOString()` throws, and a page that
 * throws is a 500 on www (T324 F1).
 */
export const LEARN_COUNTDOWN_FROM = Date.UTC(2020, 0, 1);
export const LEARN_COUNTDOWN_TO = Date.UTC(2100, 0, 1);

/** A countdown target the page can draw, or `undefined`. */
export function learnCountdownUntil(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const n = Math.round(v);
  return n >= LEARN_COUNTDOWN_FROM && n < LEARN_COUNTDOWN_TO ? n : undefined;
}

/** Drops `undefined` values so a parsed block compares equal to a hand-written one. */
function compact<T extends Obj>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/**
 * Where a page image may come from, read back from Firestore on www (T324 F2).
 * Mirrors the dashboard's save check (`isAllowedLearnImageSrc`), so a doc
 * written straight to Firestore cannot make every visitor's browser fetch
 * from somebody else's host:
 * - a site asset under `/kgc/` (the page as it ships uses those), or
 * - a Firebase Storage token URL whose object is under `pageLayouts/learn/`,
 *   in our bucket when `bucket` is given, or from the local Storage emulator
 *   when `allowEmulator` is not `false`.
 *
 * Without options (the dashboard preview, which runs in the browser and does
 * not know the bucket) any bucket and the emulator pass. The website passes
 * both (`learnImageOptions` in `apps/web/src/lib/data.ts`).
 */
export interface LearnImageOptions {
  /** The project's Storage bucket; an uploaded image must be in it. */
  bucket?: string;
  /** Accept `http://localhost:<port>` Storage emulator URLs. Defaults to true. */
  allowEmulator?: boolean;
}

const STORAGE_ORIGIN = "https://firebasestorage.googleapis.com";
const EMULATOR_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

export function isLearnImageSrc(src: unknown, opts: LearnImageOptions = {}): boolean {
  if (typeof src !== "string") return false;
  const s = src.trim();
  if (s.length > 2_000) return false;
  if (s.startsWith("/")) return /^\/kgc\/[A-Za-z0-9._\-/]+$/.test(s) && !s.includes("..") && !s.includes("//");
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return false;
  }
  if (url.origin !== STORAGE_ORIGIN && !(opts.allowEmulator !== false && EMULATOR_ORIGIN.test(url.origin))) return false;
  if (url.username || url.password) return false;
  const match = /^\/v0\/b\/([a-z0-9._-]+)\/o\/([^/]+)$/.exec(url.pathname);
  if (!match || (opts.bucket !== undefined && match[1] !== opts.bucket)) return false;
  let objectPath: string;
  try {
    objectPath = decodeURIComponent(match[2]!);
  } catch {
    return false;
  }
  if (!objectPath.startsWith(LEARN_IMAGE_PREFIX) || objectPath.includes("..")) return false;
  return url.searchParams.get("alt") === "media" && Boolean(url.searchParams.get("token"));
}

/** Storage download URLs, which `next/image` may optimize (see `next.config.ts`). */
export function isStorageImageSrc(src: string): boolean {
  return /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//.test(src.trim());
}

function parseImage(v: unknown, o: LearnImageOptions): PageImage | undefined {
  if (!isObj(v)) return undefined;
  const src = str(v.src)?.trim();
  if (!src || !isLearnImageSrc(src, o)) return undefined;
  return compact({
    src,
    alt: str(v.alt) ?? "",
    width: positive(v.width) ?? 1200,
    height: positive(v.height) ?? 800,
    focusX: clamp01(v.focusX),
    focusY: clamp01(v.focusY),
  });
}

function parseLink(v: unknown): LinkButton | undefined {
  if (!isObj(v)) return undefined;
  const label = str(v.label)?.trim();
  const href = str(v.href)?.trim();
  if (!label || !href || !isSafeHref(href)) return undefined;
  return { label, href, style: oneOf(v.style, BUTTON_STYLES, "primary") };
}

function parsePerson(v: unknown, i: number, o: LearnImageOptions): Person | undefined {
  if (!isObj(v)) return undefined;
  const name = str(v.name)?.trim();
  if (!name) return undefined;
  const linkedin = str(v.linkedin)?.trim();
  return compact({
    id: str(v.id) || `person-${i}`,
    name,
    role: str(v.role) ?? "",
    photo: parseImage(v.photo, o),
    linkedin: linkedin && isSafeHref(linkedin) ? linkedin : undefined,
    bio: parseRichContent(v.bio),
  });
}

function parseBlock(v: unknown, i: number, o: LearnImageOptions): LearnBlock | undefined {
  if (!isObj(v)) return undefined;
  if (v.hidden === true) return undefined;
  const base = compact({
    id: str(v.id) || `block-${i}`,
    align: maybeOneOf(v.align, ALIGNS),
    spaceAbove: maybeOneOf(v.spaceAbove, SPACINGS),
    spaceBelow: maybeOneOf(v.spaceBelow, SPACINGS),
    // v2 (T319). `note` is for colleagues in the editor and is never kept here.
    visibleOn: maybeOneOf(v.visibleOn, SHOWN_ON),
    anchor: isAnchor(v.anchor) ? v.anchor : undefined,
    maxWidth: maybeOneOf(v.maxWidth, MAX_WIDTHS),
    boxed: v.boxed === true ? true : undefined,
    textColor: parseColorValue(v.textColor),
  });

  switch (v.kind) {
    case "heading": {
      const text = parseRichContent(v.text);
      if (!text) return undefined;
      const level: 1 | 2 | 3 | 4 = v.level === 1 || v.level === 3 || v.level === 4 ? v.level : 2;
      return compact({ ...base, kind: "heading" as const, text, level, size: maybeOneOf(v.size, TEXT_SIZES) });
    }
    case "text": {
      const text = parseRichContent(v.text);
      if (!text) return undefined;
      return compact({ ...base, kind: "text" as const, text, size: maybeOneOf(v.size, TEXT_SIZES) });
    }
    case "image": {
      const image = parseImage(v.image, o);
      if (!image) return undefined;
      const href = str(v.href)?.trim();
      return compact({
        ...base,
        kind: "image" as const,
        image,
        width: oneOf(v.width, IMAGE_WIDTHS, "medium"),
        shape: oneOf(v.shape, IMAGE_SHAPES, "original"),
        caption: str(v.caption)?.trim() || undefined,
        href: href && isSafeHref(href) ? href : undefined,
      });
    }
    case "buttons": {
      const buttons = arr(v.buttons).map(parseLink).filter((b): b is LinkButton => !!b);
      if (buttons.length === 0) return undefined;
      return { ...base, kind: "buttons", buttons };
    }
    case "people": {
      const people = arr(v.people)
        .map((p, j) => parsePerson(p, j, o))
        .filter((p): p is Person => !!p);
      if (people.length === 0) return undefined;
      return {
        ...base,
        kind: "people",
        style: v.style === "list" ? "list" : "cards",
        columns: columns(v.columns, 3),
        people,
      };
    }
    case "list": {
      const items = arr(v.items)
        .map((it, j) => {
          if (!isObj(it)) return undefined;
          const text = parseRichContent(it.text) ?? "";
          const title = str(it.title)?.trim() || undefined;
          if (!text && !title) return undefined;
          const children = arr(it.children).filter((c): c is string => typeof c === "string" && c.trim() !== "");
          return compact({
            id: str(it.id) || `item-${j}`,
            title,
            text,
            children: children.length ? children : undefined,
            link: parseLink(it.link),
          });
        })
        .filter((it) => !!it);
      if (items.length === 0) return undefined;
      return { ...base, kind: "list", ordered: v.ordered === true, items };
    }
    case "columns": {
      const items = arr(v.items)
        .map((it, j) => {
          if (!isObj(it)) return undefined;
          const text = parseRichContent(it.text) ?? "";
          const title = str(it.title)?.trim() || undefined;
          const image = parseImage(it.image, o);
          if (!text && !title && !image) return undefined;
          return compact({ id: str(it.id) || `col-${j}`, image, title, text, link: parseLink(it.link) });
        })
        .filter((it) => !!it);
      if (items.length === 0) return undefined;
      return { ...base, kind: "columns", columns: columns(v.columns, Math.min(4, items.length) as Columns), items };
    }
    case "video": {
      const url = str(v.url)?.trim();
      if (!url || !videoEmbed(url)) return undefined;
      return compact({ ...base, kind: "video" as const, url, caption: str(v.caption)?.trim() || undefined });
    }
    case "divider":
      return { ...base, kind: "divider" };
    case "spacer":
      return { ...base, kind: "spacer", size: oneOf(v.size, SPACINGS, "medium") };
    default:
      return parseBlockV2(v, base, o);
  }
}

type Base = Pick<LearnBlock, "id" | "align" | "spaceAbove" | "spaceBelow" | "visibleOn" | "anchor" | "maxWidth" | "boxed" | "textColor">;

const items = <T>(v: unknown, f: (it: Obj, j: number) => T | undefined): T[] =>
  arr(v)
    .map((it, j) => (isObj(it) ? f(it, j) : undefined))
    .filter((it): it is T => it !== undefined);

const links = (v: unknown): LinkButton[] => arr(v).map(parseLink).filter((b): b is LinkButton => !!b);

/** The fourteen v2 kinds (T315 contract). Same rules: forgiving inside, a block that cannot be drawn is dropped. */
function parseBlockV2(v: Obj, base: Base, o: LearnImageOptions): LearnBlock | undefined {
  switch (v.kind) {
    case "imageText": {
      const text = parseRichContent(v.text);
      if (!text) return undefined;
      const buttons = links(v.buttons);
      return compact({
        ...base,
        kind: "imageText" as const,
        // With no picture (or one we do not allow) the text and buttons still
        // show, in one column (T328 N3). The empty image is the editor's own
        // "no picture yet"; `hasLearnImage` is false for it.
        image: parseImage(v.image, o) ?? { src: "", alt: "", width: 0, height: 0 },
        imageSide: v.imageSide === "right" ? ("right" as const) : ("left" as const),
        imageWidth: v.imageWidth === "third" ? ("third" as const) : ("half" as const),
        shape: oneOf(v.shape, IMAGE_SHAPES, "rounded"),
        text,
        buttons: buttons.length ? buttons : undefined,
      });
    }
    case "gallery": {
      const images = items(v.images, (it, j) => {
        const image = parseImage(it, o);
        return image && compact({ ...image, id: str(it.id) || `img-${j}`, caption: str(it.caption)?.trim() || undefined });
      });
      if (images.length === 0) return undefined;
      return {
        ...base,
        kind: "gallery",
        layout: oneOf(v.layout, ["grid", "carousel", "masonry"] as const, "grid"),
        columns: columns(v.columns, 3),
        images,
        lightbox: v.lightbox !== false,
      };
    }
    case "quote": {
      const text = parseRichContent(v.text);
      if (!text) return undefined;
      return compact({
        ...base,
        kind: "quote" as const,
        text,
        name: str(v.name)?.trim() || undefined,
        role: str(v.role)?.trim() || undefined,
        photo: parseImage(v.photo, o),
        style: oneOf(v.style, ["plain", "large", "card"] as const, "plain"),
      });
    }
    case "callout": {
      const text = parseRichContent(v.text);
      const title = str(v.title)?.trim() || undefined;
      if (!text && !title) return undefined;
      return compact({
        ...base,
        kind: "callout" as const,
        tone: oneOf(v.tone, ["info", "success", "warning", "brand"] as const, "info"),
        title,
        text: text ?? "",
      });
    }
    case "accordion": {
      const list = items(v.items, (it, j) => {
        const title = str(it.title)?.trim();
        if (!title) return undefined;
        return compact({ id: str(it.id) || `acc-${j}`, title, text: parseRichContent(it.text) ?? "", open: it.open === true ? true : undefined });
      });
      if (list.length === 0) return undefined;
      return { ...base, kind: "accordion", items: list, allowMany: v.allowMany === true };
    }
    case "tabs": {
      const list = items(v.items, (it, j) => {
        const title = str(it.title)?.trim();
        if (!title) return undefined;
        return { id: str(it.id) || `tab-${j}`, title, text: parseRichContent(it.text) ?? "" };
      });
      if (list.length === 0) return undefined;
      return { ...base, kind: "tabs", items: list };
    }
    case "stats": {
      const list = items(v.items, (it, j) => {
        const value = str(it.value)?.trim();
        if (!value) return undefined;
        return { id: str(it.id) || `stat-${j}`, value, label: str(it.label)?.trim() ?? "" };
      });
      if (list.length === 0) return undefined;
      return { ...base, kind: "stats", columns: columns(v.columns, Math.min(4, list.length) as Columns), items: list };
    }
    case "cards": {
      const list = items(v.items, (it, j) => {
        const title = str(it.title)?.trim();
        if (!title) return undefined;
        return compact({
          id: str(it.id) || `card-${j}`,
          image: parseImage(it.image, o),
          title,
          text: parseRichContent(it.text) ?? "",
          link: parseLink(it.link),
          badge: str(it.badge)?.trim() || undefined,
        });
      });
      if (list.length === 0) return undefined;
      return { ...base, kind: "cards", columns: columns(v.columns, 3), items: list };
    }
    case "logos": {
      const list = items(v.items, (it, j) => {
        const image = parseImage(it, o);
        if (!image) return undefined;
        const href = str(it.href)?.trim();
        return compact({ ...image, id: str(it.id) || `logo-${j}`, href: href && isSafeHref(href) ? href : undefined });
      });
      if (list.length === 0) return undefined;
      return { ...base, kind: "logos", grayscale: v.grayscale === true, items: list };
    }
    case "embed": {
      const provider = isLearnEmbedProvider(v.provider) ? v.provider : undefined;
      const url = str(v.url)?.trim();
      if (!provider || !url || !learnEmbedSrc(provider, url)) return undefined;
      const height = positive(v.height);
      return compact({
        ...base,
        kind: "embed" as const,
        provider,
        url,
        aspect: oneOf(v.aspect, ["16:9", "4:3", "1:1", "auto"] as const, "16:9"),
        height: height && height >= 100 && height <= 2000 ? height : undefined,
        title: str(v.title)?.trim() || defaultEmbedTitle(provider),
      });
    }
    case "countdown": {
      const until = learnCountdownUntil(v.until);
      if (until === undefined) return undefined;
      return compact({
        ...base,
        kind: "countdown" as const,
        until,
        label: str(v.label)?.trim() || undefined,
        doneText: str(v.doneText)?.trim() || undefined,
      });
    }
    case "table": {
      const doc = parseRichDoc(v.doc);
      if (!doc || !doc.content.some((n) => n.type === "table")) return undefined;
      return compact({ ...base, kind: "table" as const, doc, striped: v.striped === true, caption: str(v.caption)?.trim() || undefined });
    }
    case "toc":
      return compact({ ...base, kind: "toc" as const, title: str(v.title)?.trim() || undefined });
    case "reusable": {
      const libraryId = str(v.libraryId)?.trim();
      if (!libraryId || !/^[\w-]{1,128}$/.test(libraryId)) return undefined;
      return { ...base, kind: "reusable", libraryId };
    }
    default:
      // A kind this build does not know, from a newer editor: skipped, not fatal.
      return undefined;
  }
}

/** One section made safe to render, as in a page; for library sections (`reusable` blocks). */
export function parseLearnSection(v: unknown, o: LearnImageOptions = {}): LearnSection | undefined {
  return parseSection(v, 0, o);
}

function parseSection(v: unknown, i: number, o: LearnImageOptions): LearnSection | undefined {
  if (!isObj(v) || v.hidden === true) return undefined;
  const blocks = arr(v.blocks)
    .map((b, j) => parseBlock(b, j, o))
    .filter((b): b is LearnBlock => !!b);
  if (blocks.length === 0) return undefined;
  return compact({
    id: str(v.id) || `section-${i}`,
    label: str(v.label) ?? "",
    background: oneOf(v.background, BACKGROUNDS, "plain"),
    waveBehindFirstImage: v.waveBehindFirstImage === true ? true : undefined,
    width: oneOf(v.width, SECTION_WIDTHS, "normal"),
    paddingTop: oneOf(v.paddingTop, SPACINGS, "large"),
    paddingBottom: oneOf(v.paddingBottom, SPACINGS, "large"),
    blocks,
    // v2 (T319). `note` stays in the editor.
    backgroundColor: parseColorValue(v.backgroundColor),
    backgroundImage: parseImage(v.backgroundImage, o),
    overlay: typeof v.overlay === "number" && Number.isFinite(v.overlay) ? Math.min(0.8, Math.max(0, v.overlay)) || undefined : undefined,
    anchor: isAnchor(v.anchor) ? v.anchor : undefined,
    visibleOn: maybeOneOf(v.visibleOn, SHOWN_ON),
    layout: (() => {
      const l = maybeOneOf(v.layout, LAYOUTS);
      return l && l !== "single" ? l : undefined;
    })(),
    blockColumn: parseBlockColumn(v.blockColumn, blocks),
  });
}

function parseBlockColumn(v: unknown, blocks: LearnBlock[]): Record<string, number> | undefined {
  if (!isObj(v)) return undefined;
  const ids = new Set(blocks.map((b) => b.id));
  const out: Record<string, number> = {};
  for (const [k, c] of Object.entries(v)) {
    if (ids.has(k) && typeof c === "number" && Number.isInteger(c) && c >= 0 && c <= 2) out[k] = c;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * A stored page made safe to render, with hidden sections and blocks already
 * removed, or `null` when there is nothing to show.
 */
export function parseLearnPageContent(value: unknown, o: LearnImageOptions = {}): LearnPageContent | null {
  if (!isObj(value)) return null;
  const seoTitle = str(value.seoTitle)?.trim();
  if (!seoTitle || !Array.isArray(value.sections)) return null;
  const sections = value.sections.map((s, i) => parseSection(s, i, o)).filter((s): s is LearnSection => !!s);
  if (sections.length === 0) return null;
  dropDuplicateAnchors(sections);
  return compact({
    seoTitle,
    seoDescription: str(value.seoDescription)?.trim() ?? "",
    sections,
    ogImage: parseImage(value.ogImage, o),
    noindex: value.noindex === true ? true : undefined,
  });
}

/** Two targets with one anchor would make a link land on the first; the later one loses its anchor. */
function dropDuplicateAnchors(sections: LearnSection[]): void {
  const seen = new Set<string>();
  for (const s of sections) {
    if (s.anchor) {
      if (seen.has(s.anchor)) delete s.anchor;
      else seen.add(s.anchor);
    }
    for (const b of s.blocks) {
      if (!b.anchor) continue;
      if (seen.has(b.anchor)) delete b.anchor;
      else seen.add(b.anchor);
    }
  }
}

/** What /learn shows for a stored `published` value: it, or today's page. */
export function learnPageOrDefault(published: unknown, o: LearnImageOptions = {}): LearnPageContent {
  return parseLearnPageContent(published, o) ?? LEARN_PAGE_DEFAULT;
}

/**
 * A YouTube or Vimeo address as its embed address, or `null` for anything
 * else. Only these two, so a pasted link can never frame an arbitrary site.
 */
export function videoEmbed(url: string): { provider: "youtube" | "vimeo"; src: string } | null {
  try {
    return videoEmbedSrc(new URL(url.trim()));
  } catch {
    return null;
  }
}

/**
 * Rich text as paragraphs of lines of spans. A blank line starts a paragraph
 * and a single line break stays a line break (`parseRichText` joins those,
 * which suits venue notes but not a two-line heading).
 */
export function learnRichParagraphs(text: string): InlineSpan[][][] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map((line) => line.trim()).filter((line) => line !== ""))
    .filter((lines) => lines.length > 0)
    .map((lines) => lines.map((line) => parseInline(line)));
}

/**
 * May this block be drawn? Hidden blocks are not, and neither are an Image
 * block whose image has not been chosen (`src` empty, which the editor's
 * draft may hold) or a Video block with no link. The website's route has
 * already dropped those through `parseLearnPageContent`; this is for a
 * renderer handed a raw draft.
 */
export function isDrawableLearnBlock(block: LearnBlock): boolean {
  if (block.hidden) return false;
  if (block.kind === "image") return typeof block.image?.src === "string" && block.image.src.trim() !== "";
  if (block.kind === "video") return typeof block.url === "string" && block.url.trim() !== "";
  return true;
}

/** An optional image (a person's photo, a column's picture) that has a file to show. */
export function hasLearnImage(image: PageImage | undefined): image is PageImage {
  return !!image && typeof image.src === "string" && image.src.trim() !== "";
}

/**
 * The letters on a person's tile when they have no photo: the first letter of
 * up to two words of the name, "?" for none. The editor preview draws the same
 * tile (T324 D12).
 */
export function personInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?"
  );
}

/** CSS `object-position` for an image's focal point. */
export function focalPosition(image: PageImage): string | undefined {
  if (image.focusX === undefined && image.focusY === undefined) return undefined;
  const pct = (n: number | undefined) => `${Math.round((n ?? 0.5) * 1000) / 10}%`;
  return `${pct(image.focusX)} ${pct(image.focusY)}`;
}

/* ── Rich text documents (v2) ─────────────────────────────────────────────
 *
 * A stored `RichDoc` goes through T315's lenient `sanitizeRichDoc`
 * (rich-doc-core.ts), the same whitelist the server validates against: a
 * node, mark or attribute the contract does not list is dropped, never
 * passed through. A doc with no words is treated as absent, like an empty
 * string.
 */

/** Text or a document, with nothing to show treated as absent. */
export function parseRichContent(v: unknown): RichContent | undefined {
  if (typeof v === "string") return v.trim() ? v : undefined;
  return parseRichDoc(v);
}

export function parseRichDoc(v: unknown): RichDoc | undefined {
  if (!isRichDoc(v)) return undefined;
  const doc = sanitizeRichDoc(v);
  return isRichContentEmpty(doc) && !doc.content.some((n) => n.type === "horizontalRule") ? undefined : doc;
}
