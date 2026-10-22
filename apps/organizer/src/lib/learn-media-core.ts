import {
  LEARN_IMAGE_PREFIX,
  type LearnLibraryItem,
  type LearnMediaItem,
  type LearnPageContent,
  type LearnSection,
  type PageImage,
} from '@kgc/shared';
import { parseLearnImageEditedFrom, type LearnImageEditedFrom } from './learn-image-edit-core';

/**
 * The Learn page's media library and saved sections, with no Firestore in them
 * (T315). `learn-media.ts` reads and writes; this decides.
 *
 * ── Where an image is used ──────────────────────────────────────────────────
 *
 * An uploaded image can sit in the draft, on the live page, in any of the 50
 * kept versions (which Restore can bring back) and in a saved section. Deleting
 * the file under any of those would leave a broken image somewhere, so a delete
 * is refused while any use remains, and the refusal names each place. Images
 * are matched by their Storage object path, not their full URL, so a URL with
 * a different token for the same file still counts.
 */

export const MEDIA_LIMITS = {
  fileName: 120,
  tags: 12,
  tag: 32,
  search: 100,
  libraryName: 80,
  /** More rows than this is not a library anyone scrolls; list refuses to grow past it. */
  listed: 2_000,
} as const;

/** The Storage object path behind an uploaded image URL, or null for a `/kgc/` asset or anything else. */
export function learnImageObjectPath(src: string): string | null {
  if (typeof src !== 'string') return null;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  const m = /^\/v0\/b\/[^/]+\/o\/([^/]+)$/.exec(url.pathname);
  if (!m) return null;
  let path: string;
  try {
    path = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  if (!path.startsWith(LEARN_IMAGE_PREFIX) || path.includes('..')) return null;
  return path;
}

/** A media row's id: the random file name without its extension. */
export function mediaIdForPath(path: string): string | null {
  const m = /^pageLayouts\/learn\/([A-Za-z0-9-]{1,64})\.[a-z0-9]{2,5}$/.exec(path);
  return m ? m[1] : null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Every image a section holds, with where it is, in reading order. `where` is
 * the section's name ("Programmes", or "Section 4" when it has none) and each
 * place is said the way the editor shows it ("Programmes, image"), not as
 * block numbers. A stored section of the wrong shape gives what can be read
 * of it rather than throwing, so one odd old version never hides the rest.
 */
function sectionImages(section: unknown, where: string): { image: PageImage; where: string }[] {
  const out: { image: PageImage; where: string }[] = [];
  if (!isObj(section)) return out;
  const at = (what: string) => (where ? `${where}, ${what}` : what);
  const add = (image: unknown, what: string) => {
    if (isObj(image) && typeof image.src === 'string') out.push({ image: image as unknown as PageImage, where: at(what) });
  };
  add(section.backgroundImage, 'background image');
  for (const raw of list(section.blocks)) {
    if (!isObj(raw)) continue;
    const b = raw as Record<string, unknown>;
    switch (b.kind) {
      case 'image':
        add(b.image, 'image');
        break;
      case 'imageText':
        add(b.image, 'image and text');
        break;
      case 'people':
        for (const p of list(b.people)) {
          if (!isObj(p)) continue;
          add(p.photo, typeof p.name === 'string' && p.name.trim() ? `photo of ${p.name.trim()}` : 'people photo');
        }
        break;
      case 'columns':
        list(b.items).forEach((it, j) => isObj(it) && add(it.image, `column ${j + 1}`));
        break;
      case 'cards':
        list(b.items).forEach((it, j) => isObj(it) && add(it.image, `card ${j + 1}`));
        break;
      case 'gallery':
        list(b.images).forEach((img, j) => add(img, `gallery image ${j + 1}`));
        break;
      case 'logos':
        list(b.items).forEach((img, j) => add(img, `logo ${j + 1}`));
        break;
      case 'quote':
        add(b.photo, 'quote photo');
        break;
      default:
        break;
    }
  }
  return out;
}

/** A section's name as the editor shows it. */
function sectionName(section: unknown, index: number): string {
  const label = isObj(section) && typeof section.label === 'string' ? section.label.trim() : '';
  return label || `Section ${index + 1}`;
}

/** Every image on a page, with a place an editor can find. */
export function contentImages(content: LearnPageContent | null | undefined): { image: PageImage; where: string }[] {
  if (!isObj(content)) return [];
  const out: { image: PageImage; where: string }[] = [];
  const og = (content as Record<string, unknown>).ogImage;
  if (isObj(og) && typeof og.src === 'string') out.push({ image: og as unknown as PageImage, where: 'sharing image' });
  list((content as Record<string, unknown>).sections).forEach((s, i) => {
    out.push(...sectionImages(s, sectionName(s, i)));
  });
  return out;
}

const VERSION_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** "Old version from Oct 22, 2026": how a kept version is named in "Where it is used". */
export function versionLabel(publishedAt: unknown): string {
  return typeof publishedAt === 'number' && Number.isFinite(publishedAt)
    ? `Old version from ${VERSION_DATE.format(publishedAt)}`
    : 'Old version';
}

/** What a page looks like to the where-used scan: a label ("Draft") and its content. */
export interface MediaSource {
  label: string;
  content?: LearnPageContent | null;
  section?: LearnSection;
}

/** The places that may hold an image: the draft, the live page, kept versions, and saved sections. */
export function mediaSources(input: {
  draft?: LearnPageContent | null;
  published?: LearnPageContent | null;
  versions?: { id: string; publishedAt: number; content: LearnPageContent }[];
  library?: { id: string; item: LearnLibraryItem }[];
}): MediaSource[] {
  const out: MediaSource[] = [];
  if (input.draft) out.push({ label: 'Draft', content: input.draft });
  if (input.published) out.push({ label: 'Live page', content: input.published });
  for (const v of input.versions ?? []) {
    out.push({ label: versionLabel(v?.publishedAt), content: v?.content });
  }
  for (const l of input.library ?? []) {
    const name = isObj(l?.item) && typeof l.item.name === 'string' ? l.item.name : '';
    out.push({ label: name ? `Saved section "${name}"` : 'A saved section', section: isObj(l?.item) ? l.item.section : undefined });
  }
  return out;
}

/** For every object path in use, the places it is used ("Draft: Team, photo of Maru"). */
export function imageUseMap(sources: readonly MediaSource[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const src of sources) {
    const images = 'section' in src ? sectionImages(src.section, '') : contentImages(src.content);
    for (const { image, where } of images) {
      const path = learnImageObjectPath(image.src);
      if (!path) continue;
      const places = map.get(path) ?? [];
      places.push(`${src.label}: ${where}`);
      map.set(path, places);
    }
  }
  return map;
}

/** The refusal an editor reads when a delete would break a page. */
export function inUseMessage(what: string, uses: readonly string[]): string {
  const shown = uses.slice(0, 5).join('; ');
  const more = uses.length > 5 ? `; and ${uses.length - 5} more` : '';
  return `${what} is still used, so it was not deleted. Remove it from these places first: ${shown}${more}.`;
}

// ---------------------------------------------------------------------------
// Names, tags and search
// ---------------------------------------------------------------------------

/** A display name: one line, no control characters, capped. Empty is refused. */
export function cleanName(input: unknown, max: number): string | null {
  if (typeof input !== 'string') return null;
  const s = input.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s === '' || s.length > max) return null;
  return s;
}

/** The name a file arrives with, as a display name. Never empty. */
export function uploadName(name: unknown): string {
  const base = typeof name === 'string' ? name.split(/[\\/]/).pop() ?? '' : '';
  return cleanName(base.slice(0, MEDIA_LIMITS.fileName), MEDIA_LIMITS.fileName) ?? 'image';
}

/**
 * Tags as stored: lower case, trimmed, letters, digits, spaces and dashes,
 * each once, at most 12. Returns null (refuse) rather than quietly dropping a
 * tag somebody typed.
 */
export function cleanTags(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') return null;
    const t = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (t === '') continue;
    if (t.length > MEDIA_LIMITS.tag || !/^[\p{L}\p{N} -]+$/u.test(t)) return null;
    if (!out.includes(t)) out.push(t);
  }
  return out.length > MEDIA_LIMITS.tags ? null : out;
}

export type MediaSort = 'newest' | 'oldest' | 'name' | 'largest' | 'smallest';
export const MEDIA_SORTS: readonly MediaSort[] = ['newest', 'oldest', 'name', 'largest', 'smallest'];

export interface MediaRow extends LearnMediaItem {
  id: string;
  /** On an edited copy: the original it was cut from and the settings used (T325). */
  editedFrom?: LearnImageEditedFrom;
}

const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * A stored media row as the library can use it, or why it cannot be. Rows are
 * written only by this code, but a row of the wrong shape (a hand edit, an old
 * format) must cost that one image, not the whole library: the caller skips a
 * refused row and logs it. A row is usable when it has an image with a source
 * and a size, which is what a block needs; everything else gets a default.
 */
export function parseMediaRow(id: string, data: unknown): { ok: true; row: MediaRow } | { ok: false; reason: string } {
  if (!isObj(data)) return { ok: false, reason: 'not an object' };
  const image = data.image;
  if (!isObj(image)) return { ok: false, reason: 'no image' };
  if (typeof image.src !== 'string' || image.src === '') return { ok: false, reason: 'image has no source' };
  const width = finite(image.width, 0);
  const height = finite(image.height, 0);
  if (width <= 0 || height <= 0) return { ok: false, reason: 'image has no size' };
  const img: PageImage = { src: image.src, alt: typeof image.alt === 'string' ? image.alt : '', width, height };
  if (typeof image.focusX === 'number' && image.focusX >= 0 && image.focusX <= 1) img.focusX = image.focusX;
  if (typeof image.focusY === 'number' && image.focusY >= 0 && image.focusY <= 1) img.focusY = image.focusY;
  const path = learnImageObjectPath(image.src);
  const fileName =
    typeof data.fileName === 'string' && data.fileName.trim() ? data.fileName : (path?.split('/').pop() ?? 'image');
  const row: MediaRow = {
    id,
    image: img,
    fileName,
    bytes: Math.max(0, finite(data.bytes, 0)),
    uploadedAt: finite(data.uploadedAt, 0),
    uploadedBy: typeof data.uploadedBy === 'string' ? data.uploadedBy : '',
  };
  const tags = list(data.tags).filter((t): t is string => typeof t === 'string');
  if (tags.length) row.tags = tags;
  const from = parseLearnImageEditedFrom(data.editedFrom);
  if (from) row.editedFrom = from;
  return { ok: true, row };
}

/**
 * One row per stored file. Before T325 an edited copy's row had an auto id
 * and Rescan added a second row for the same file under its file name; the
 * row named after the file wins, then the older one.
 */
export function dedupeMediaRows<T extends MediaRow>(rows: readonly T[]): { rows: T[]; duplicates: T[] } {
  const keep = new Map<string, T>();
  const duplicates: T[] = [];
  for (const r of rows) {
    const path = learnImageObjectPath(r.image.src);
    const key = path ?? `row:${r.id}`;
    const cur = keep.get(key);
    if (!cur) {
      keep.set(key, r);
      continue;
    }
    const own = path ? mediaIdForPath(path) : null;
    const better = (r.id === own) !== (cur.id === own) ? r.id === own : r.uploadedAt < cur.uploadedAt;
    if (better) {
      keep.set(key, r);
      duplicates.push(cur);
    } else duplicates.push(r);
  }
  const kept = new Set(keep.values());
  return { rows: rows.filter((r) => kept.has(r)), duplicates };
}

/**
 * Search, filter by tag and sort, in memory: the library is one page's images,
 * hundreds at most, and Firestore cannot search inside a string anyway.
 * The search matches the name, the alt text and the tags, ignoring case and
 * accents; every word must match.
 */
export function queryMedia<T extends MediaRow>(
  rows: readonly T[],
  opts: { search?: string; tag?: string; sort?: MediaSort } = {},
): T[] {
  const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = fold((opts.search ?? '').slice(0, MEDIA_LIMITS.search)).split(/\s+/).filter(Boolean);
  const tag = opts.tag?.trim().toLowerCase();
  const out = rows.filter((r) => {
    if (tag && !(r.tags ?? []).includes(tag)) return false;
    if (words.length === 0) return true;
    const hay = fold([r.fileName, r.image?.alt ?? '', ...(r.tags ?? [])].join(' '));
    return words.every((w) => hay.includes(w));
  });
  const sort = MEDIA_SORTS.includes(opts.sort as MediaSort) ? opts.sort : 'newest';
  const byName = (a: T, b: T) => a.fileName.localeCompare(b.fileName, 'en', { sensitivity: 'base', numeric: true });
  out.sort((a, b) => {
    switch (sort) {
      case 'oldest':
        return a.uploadedAt - b.uploadedAt || byName(a, b);
      case 'name':
        return byName(a, b) || b.uploadedAt - a.uploadedAt;
      case 'largest':
        return b.bytes - a.bytes || byName(a, b);
      case 'smallest':
        return a.bytes - b.bytes || byName(a, b);
      default:
        return b.uploadedAt - a.uploadedAt || byName(a, b);
    }
  });
  return out;
}

/** Every tag in use, alphabetically, for the filter. */
export function allTags(rows: readonly { tags?: string[] }[]): string[] {
  return [...new Set(rows.flatMap((r) => r.tags ?? []))].sort((a, b) => a.localeCompare(b));
}

/**
 * A Firestore auto id or a media id: what an action accepts before it reads
 * anything. Firestore reserves ids that start and end with two underscores
 * (`__proto__`, `__name__`) and answers them with an error only after retries,
 * so they are refused here.
 */
export function isRowId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) && !/^__.*__$/.test(id);
}

/**
 * Where a page points at a saved section, in the same plain words as the image
 * places ("Programmes, saved section"). Tolerates a stored page of the wrong shape.
 */
export function savedSectionUses(content: unknown, libraryId: string): string[] {
  const out: string[] = [];
  if (!isObj(content)) return out;
  list(content.sections).forEach((s, i) => {
    if (!isObj(s)) return;
    for (const b of list(s.blocks)) {
      if (isObj(b) && b.kind === 'reusable' && b.libraryId === libraryId) out.push(`${sectionName(s, i)}, saved section`);
    }
  });
  return out;
}
