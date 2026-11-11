/**
 * Pure helpers for drawing the v2 parts of a Learn page (T319): colours,
 * embeds, the countdown, the table of contents, reusable sections and
 * multi-column section layouts.
 *
 * The website's `LearnPageView` and the dashboard's preview twins both call
 * these, so the two apps cannot disagree about what a stored value means.
 * Nothing here returns markup; the renderers map results to their own
 * components.
 */

import { contrastRatio } from "./brand-theme.js";
import type { LearnEmbedProvider } from "./learn-embed-core.js";
import { isColorValue, normalizeColor, richContentToPlainText, slugifyAnchor } from "./rich-doc-core.js";
import type {
  ColorValue,
  LearnBlock,
  LearnPageContent,
  LearnSection,
  RichContent,
  RichNode,
} from "./learn-page.js";

/* ── Colours ──────────────────────────────────────────────────────────── */

/** The brand colours by name, as the site paints them (`globals.css` palette). */
export const LEARN_COLORS = {
  navy: "#263759",
  blue: "#1159af",
  "light-blue": "#8dccee",
  teal: "#17556a",
  orange: "#f68621",
  grey: "#e0e5ee",
  dark: "#1f1a11",
  white: "#ffffff",
} as const satisfies Record<Exclude<ColorValue, `#${string}`>, string>;

export type LearnColorToken = keyof typeof LEARN_COLORS;

export function isColorToken(v: unknown): v is LearnColorToken {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(LEARN_COLORS, v);
}

/** A brand name, or a custom colour in exactly `#rrggbb` form (lower-cased). */
export function parseColorValue(v: unknown): ColorValue | undefined {
  return isColorValue(v) ? normalizeColor(v) : undefined;
}

/**
 * How a renderer applies a colour: a brand name becomes a class suffix (the
 * CSS holds the value), a custom colour becomes an inline value, and only
 * after it has passed `parseColorValue`, so no free CSS reaches a style.
 */
export function learnColor(v: ColorValue | undefined): { token?: LearnColorToken; hex?: string } {
  if (v === undefined) return {};
  if (isColorToken(v)) return { token: v };
  const hex = parseColorValue(v);
  return hex ? { hex } : {};
}

/** The colour as `#rrggbb`, for contrast sums. */
export function colorHex(v: ColorValue): string | undefined {
  if (isColorToken(v)) return LEARN_COLORS[v];
  return parseColorValue(v);
}

/** Whether white text reads better than the page's dark text on this background. */
export function isDarkBackground(v: ColorValue | undefined): boolean {
  const hex = v === undefined ? undefined : colorHex(v);
  if (!hex) return false;
  return contrastRatio(hex, "#ffffff") > contrastRatio(hex, LEARN_COLORS.dark);
}

/** A section's own colours: dark when its colour is dark or it has a photo under an overlay. */
export function sectionIsDark(section: Pick<LearnSection, "backgroundColor" | "backgroundImage" | "overlay">): boolean {
  if (hasPhoto(section)) return (section.overlay ?? 0) >= 0.3 || isDarkBackground(section.backgroundColor);
  return isDarkBackground(section.backgroundColor);
}

/**
 * A section photo with a file to show. A draft may hold one left empty
 * (`src: ''`, "not chosen yet", T320), which draws as no photo.
 */
function hasPhoto(section: Pick<LearnSection, "backgroundImage">): boolean {
  const src = section.backgroundImage?.src;
  return typeof src === "string" && src.trim() !== "";
}

/* ── Anchors ──────────────────────────────────────────────────────────── */

export const ANCHOR_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isAnchor(v: unknown): v is string {
  return typeof v === "string" && ANCHOR_RE.test(v);
}

/* ── Table of contents ────────────────────────────────────────────────── */

export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3 | 4;
}

/**
 * The id each heading block is drawn with: its own anchor, or one made from
 * its words, made unique against every anchor on the page. The `toc` block
 * links to these and the renderer puts them on the headings, from the same
 * call, so a link can never miss.
 */
export function headingIds(content: LearnPageContent): Map<string, string> {
  const taken = new Set<string>();
  for (const s of content.sections) {
    if (s.anchor) taken.add(s.anchor);
    for (const b of s.blocks) if (b.anchor) taken.add(b.anchor);
  }
  const ids = new Map<string, string>();
  for (const s of content.sections) {
    if (s.hidden) continue;
    for (const b of s.blocks) {
      if (b.hidden || b.kind !== "heading") continue;
      if (b.anchor) {
        ids.set(b.id, b.anchor);
        continue;
      }
      const base = slugifyAnchor(richContentToPlainText(b.text, { oneLine: true })) || "section";
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      taken.add(id);
      ids.set(b.id, id);
    }
  }
  return ids;
}

/** Headings level 2 to 4 in page order, for the `toc` block. Level 1 is the page title. */
export function tocEntries(content: LearnPageContent, ids: ReadonlyMap<string, string> = headingIds(content)): TocEntry[] {
  const out: TocEntry[] = [];
  for (const s of content.sections) {
    if (s.hidden) continue;
    for (const b of s.blocks) {
      if (b.hidden || b.kind !== "heading" || b.level === 1) continue;
      const id = ids.get(b.id);
      const text = richContentToPlainText(b.text, { oneLine: true });
      if (id && text) out.push({ id, text, level: b.level });
    }
  }
  return out;
}

/* ── Countdown ────────────────────────────────────────────────────────── */

export interface CountdownParts {
  done: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Whole days, hours, minutes and seconds from `now` until `until` (ms), never negative. */
export function countdownParts(until: number, now: number): CountdownParts {
  const left = Math.max(0, Math.floor((until - now) / 1000));
  return {
    done: left === 0,
    days: Math.floor(left / 86400),
    hours: Math.floor((left % 86400) / 3600),
    minutes: Math.floor((left % 3600) / 60),
    seconds: left % 60,
  };
}

/* ── Embeds ───────────────────────────────────────────────────────────── */

/*
 * Which addresses may be framed, and the iframe `src` for each, is T315's
 * `learnEmbedSrc` (learn-embed-core.ts). These are only the frame's shape.
 */

/** The height an `auto` embed takes when the block gives none, per provider. */
export const EMBED_DEFAULT_HEIGHT: Record<LearnEmbedProvider, number> = {
  youtube: 450,
  vimeo: 450,
  "google-maps": 450,
  "google-forms": 900,
  "google-docs": 800,
  "google-slides": 480,
  calendly: 700,
  typeform: 560,
  loom: 450,
  spotify: 352,
};

/**
 * What the iframe may do. Scripts and same-origin are needed by every one of
 * these players and forms; top navigation is not granted, so an embed can
 * never take the visitor off the page.
 */
export const EMBED_SANDBOX =
  "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation";

/** YouTube or Vimeo, shared with v1's `videoEmbed`. */
export function videoEmbedSrc(u: URL): { provider: "youtube" | "vimeo"; src: string } | null {
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

/** Box shape for an embed: a ratio, or a fixed height for `auto`. */
export function embedBox(block: Extract<LearnBlock, { kind: "embed" }>): { ratio?: string; height?: number } {
  if (block.aspect === "auto") {
    const h = block.height && block.height >= 120 && block.height <= 2000 ? Math.round(block.height) : EMBED_DEFAULT_HEIGHT[block.provider];
    return { height: h };
  }
  return { ratio: block.aspect.replace(":", " / ") };
}

/* ── Section layouts ──────────────────────────────────────────────────── */

export type SectionLayout = NonNullable<LearnSection["layout"]>;

export const SECTION_LAYOUT_COLUMNS: Record<SectionLayout, number> = {
  single: 1,
  "two-equal": 2,
  "two-wide-left": 2,
  "two-wide-right": 2,
  three: 3,
};

/**
 * The blocks of a multi-column section, column by column, in their page
 * order. A block with no column, or one past the last column, goes in the
 * first, so nothing is ever lost when the layout narrows.
 */
export function sectionColumns<B extends { id: string }>(
  layout: SectionLayout | undefined,
  blocks: B[],
  blockColumn: Record<string, number> | undefined,
): B[][] {
  const n = SECTION_LAYOUT_COLUMNS[layout ?? "single"];
  const cols: B[][] = Array.from({ length: n }, () => []);
  for (const b of blocks) {
    const c = blockColumn?.[b.id];
    const i = typeof c === "number" && Number.isInteger(c) && c >= 0 && c < n ? c : 0;
    cols[i]!.push(b);
  }
  return cols;
}

/* ── Option classes ───────────────────────────────────────────────────── */

type BlockOptions = Pick<LearnBlock, "visibleOn" | "maxWidth" | "boxed" | "textColor">;
type SectionOptions = Pick<LearnSection, "visibleOn" | "backgroundColor" | "backgroundImage" | "overlay" | "layout">;

/**
 * The v2 block options as `lp-*` classes, plus the one inline value a custom
 * text colour needs. Both renderers put these on the block's outer element.
 */
export function blockOptionClasses(b: BlockOptions): { classes: string[]; color?: string } {
  const classes: string[] = [];
  if (b.visibleOn === "desktop" || b.visibleOn === "mobile") classes.push(`lp-vis-${b.visibleOn}`);
  if (b.maxWidth) classes.push(`lp-mw-${b.maxWidth}`);
  if (b.boxed) classes.push("lp-boxed");
  const c = learnColor(b.textColor);
  if (c.token) classes.push(`lp-tc-${c.token}`);
  if (c.hex) classes.push("lp-tc");
  return { classes, color: c.hex };
}

/**
 * The v2 section options as classes on the band, plus the band colour when
 * it is a custom one (as the `--lp-band` variable the band already paints).
 */
export function sectionOptionClasses(s: SectionOptions): { classes: string[]; band?: string } {
  const classes: string[] = [];
  if (s.visibleOn === "desktop" || s.visibleOn === "mobile") classes.push(`lp-vis-${s.visibleOn}`);
  const c = learnColor(s.backgroundColor);
  if (c.token || c.hex) classes.push("lp-bgc");
  if (c.token) classes.push(`lp-bgc-${c.token}`);
  if (hasPhoto(s)) classes.push("lp-has-bgimg");
  if (sectionIsDark(s)) classes.push("lp-on-dark");
  if (s.layout && s.layout !== "single") classes.push("lp-has-layout");
  return { classes, band: c.hex };
}
