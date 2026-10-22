import {
  LEARN_IMAGE_PREFIX,
  type LearnLibraryItem,
  type LearnMediaItem,
  type LearnPageContent,
  type LearnSection,
  type PageImage,
} from '@kgc/shared';

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

/** Every image a section holds, with where it is, in reading order. */
function sectionImages(section: LearnSection, where: string): { image: PageImage; where: string }[] {
  const out: { image: PageImage; where: string }[] = [];
  const add = (image: PageImage | undefined, w: string) => {
    if (image && typeof image.src === 'string') out.push({ image, where: w });
  };
  add(section.backgroundImage, `${where}, background`);
  (section.blocks ?? []).forEach((b, i) => {
    const w = `${where}, block ${i + 1} (${b.kind})`;
    switch (b.kind) {
      case 'image':
      case 'imageText':
        add(b.image, w);
        break;
      case 'people':
        b.people.forEach((p) => add(p.photo, `${w}, ${p.name || 'a person'}`));
        break;
      case 'columns':
      case 'cards':
        b.items.forEach((it, j) => add(it.image, `${w}, item ${j + 1}`));
        break;
      case 'gallery':
        b.images.forEach((img, j) => add(img, `${w}, image ${j + 1}`));
        break;
      case 'logos':
        b.items.forEach((img, j) => add(img, `${w}, logo ${j + 1}`));
        break;
      case 'quote':
        add(b.photo, w);
        break;
      default:
        break;
    }
  });
  return out;
}

/** Every image on a page, with a place an editor can find. */
export function contentImages(content: LearnPageContent | null | undefined): { image: PageImage; where: string }[] {
  if (!content) return [];
  const out: { image: PageImage; where: string }[] = [];
  if (content.ogImage) out.push({ image: content.ogImage, where: 'sharing image' });
  (content.sections ?? []).forEach((s, i) => {
    out.push(...sectionImages(s, `section ${i + 1}${s.label ? ` "${s.label}"` : ''}`));
  });
  return out;
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
    out.push({ label: `Version of ${new Date(v.publishedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`, content: v.content });
  }
  for (const l of input.library ?? []) out.push({ label: `Saved section "${l.item.name}"`, section: l.item.section });
  return out;
}

/** For every object path in use, the places it is used ("Draft: section 2 "Team", block 3 (people), Maru"). */
export function imageUseMap(sources: readonly MediaSource[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const src of sources) {
    const images = src.section ? sectionImages(src.section, 'section') : contentImages(src.content);
    for (const { image, where } of images) {
      const path = learnImageObjectPath(image.src);
      if (!path) continue;
      const list = map.get(path) ?? [];
      list.push(`${src.label}: ${where}`);
      map.set(path, list);
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

/** A Firestore auto id or a media id: what an action accepts before it reads anything. */
export function isRowId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}
