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
import {
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
const positive = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;

/** Drops `undefined` values so a parsed block compares equal to a hand-written one. */
function compact<T extends Obj>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/**
 * Where an image may come from: a site asset (`/kgc/...`) or an http(s) URL,
 * in practice Firebase Storage. Never `//host`, `data:` or `javascript:`.
 */
export function isLearnImageSrc(src: string): boolean {
  const s = src.trim();
  if (s.startsWith("/")) return !/^[/\\][/\\]/.test(s);
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Storage download URLs, which `next/image` may optimize (see `next.config.ts`). */
export function isStorageImageSrc(src: string): boolean {
  return /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//.test(src.trim());
}

function parseImage(v: unknown): PageImage | undefined {
  if (!isObj(v)) return undefined;
  const src = str(v.src)?.trim();
  if (!src || !isLearnImageSrc(src)) return undefined;
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

function parsePerson(v: unknown, i: number): Person | undefined {
  if (!isObj(v)) return undefined;
  const name = str(v.name)?.trim();
  if (!name) return undefined;
  const linkedin = str(v.linkedin)?.trim();
  return compact({
    id: str(v.id) || `person-${i}`,
    name,
    role: str(v.role) ?? "",
    photo: parseImage(v.photo),
    linkedin: linkedin && isSafeHref(linkedin) ? linkedin : undefined,
    bio: str(v.bio),
  });
}

function parseBlock(v: unknown, i: number): LearnBlock | undefined {
  if (!isObj(v)) return undefined;
  if (v.hidden === true) return undefined;
  const base = compact({
    id: str(v.id) || `block-${i}`,
    align: maybeOneOf(v.align, ALIGNS),
    spaceAbove: maybeOneOf(v.spaceAbove, SPACINGS),
    spaceBelow: maybeOneOf(v.spaceBelow, SPACINGS),
  });

  switch (v.kind) {
    case "heading": {
      const text = str(v.text);
      if (!text?.trim()) return undefined;
      const level: 1 | 2 | 3 = v.level === 1 || v.level === 3 ? v.level : 2;
      return compact({ ...base, kind: "heading" as const, text, level, size: maybeOneOf(v.size, TEXT_SIZES) });
    }
    case "text": {
      const text = str(v.text);
      if (!text?.trim()) return undefined;
      return compact({ ...base, kind: "text" as const, text, size: maybeOneOf(v.size, TEXT_SIZES) });
    }
    case "image": {
      const image = parseImage(v.image);
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
        .map(parsePerson)
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
          const text = str(it.text) ?? "";
          const title = str(it.title)?.trim() || undefined;
          if (!text.trim() && !title) return undefined;
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
          const text = str(it.text) ?? "";
          const title = str(it.title)?.trim() || undefined;
          const image = parseImage(it.image);
          if (!text.trim() && !title && !image) return undefined;
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
      // A kind this build does not know, from a newer editor: skipped, not fatal.
      return undefined;
  }
}

function parseSection(v: unknown, i: number): LearnSection | undefined {
  if (!isObj(v) || v.hidden === true) return undefined;
  const blocks = arr(v.blocks)
    .map(parseBlock)
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
  });
}

/**
 * A stored page made safe to render, with hidden sections and blocks already
 * removed, or `null` when there is nothing to show.
 */
export function parseLearnPageContent(value: unknown): LearnPageContent | null {
  if (!isObj(value)) return null;
  const seoTitle = str(value.seoTitle)?.trim();
  if (!seoTitle || !Array.isArray(value.sections)) return null;
  const sections = value.sections.map(parseSection).filter((s): s is LearnSection => !!s);
  if (sections.length === 0) return null;
  return { seoTitle, seoDescription: str(value.seoDescription)?.trim() ?? "", sections };
}

/** What /learn shows for a stored `published` value: it, or today's page. */
export function learnPageOrDefault(published: unknown): LearnPageContent {
  return parseLearnPageContent(published) ?? LEARN_PAGE_DEFAULT;
}

/**
 * A YouTube or Vimeo address as its embed address, or `null` for anything
 * else. Only these two, so a pasted link can never frame an arbitrary site.
 */
export function videoEmbed(url: string): { provider: "youtube" | "vimeo"; src: string } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const id = (s: string | null | undefined) => (s && /^[\w-]{6,20}$/.test(s) ? s : null);

  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    const v =
      u.pathname === "/watch"
        ? id(u.searchParams.get("v"))
        : ["embed", "shorts", "live"].includes(parts[0] ?? "")
          ? id(parts[1])
          : null;
    return v ? { provider: "youtube", src: `https://www.youtube-nocookie.com/embed/${v}` } : null;
  }
  if (host === "youtu.be") {
    const v = id(u.pathname.slice(1));
    return v ? { provider: "youtube", src: `https://www.youtube-nocookie.com/embed/${v}` } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = /(?:^|\/)(\d{5,12})(?:\/|$)/.exec(u.pathname);
    return m ? { provider: "vimeo", src: `https://player.vimeo.com/video/${m[1]}?dnt=1` } : null;
  }
  return null;
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

/** CSS `object-position` for an image's focal point. */
export function focalPosition(image: PageImage): string | undefined {
  if (image.focusX === undefined && image.focusY === undefined) return undefined;
  const pct = (n: number | undefined) => `${Math.round((n ?? 0.5) * 1000) / 10}%`;
  return `${pct(image.focusX)} ${pct(image.focusY)}`;
}
