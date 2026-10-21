/**
 * The Learn editor's media library and image editor, with no React in them
 * (T318): searching and sorting the library rows, tag counts, checking files
 * before a multi-upload, and the crop, rotate and flip geometry.
 *
 * Geometry convention, shared with `transformLearnImageAction`: the crop is
 * taken from the ORIGINAL pixels first, then the result is rotated clockwise,
 * then flipped. The editor keeps its crop and focal point in the original's
 * coordinates and only converts to what the person sees for drawing, so a
 * rotate or flip never has to re-fit the crop.
 */

// ─── Library rows ────────────────────────────────────────────────────────────

/** The parts of a media row these helpers read; `MediaRow` fits it. */
export interface MediaLike {
  fileName: string;
  bytes: number;
  uploadedAt: number;
  tags?: string[];
  image: { src: string; alt: string };
}

export type MediaSort = 'newest' | 'oldest' | 'name' | 'largest';

export const MEDIA_SORTS: { id: MediaSort; label: string }[] = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'name', label: 'Name A to Z' },
  { id: 'largest', label: 'Largest first' },
];

/** The words of a search, lower-cased; empty when there is nothing to search for. */
export function searchWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when every word of the search appears in the file name, the alt text or a tag. */
export function matchesSearch(row: MediaLike, query: string): boolean {
  const words = searchWords(query);
  if (words.length === 0) return true;
  const hay = [row.fileName, row.image.alt, ...(row.tags ?? [])].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Same rule as the server's update action, so a chip matches what gets saved. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 30);
}

export const MAX_TAGS = 20;

/** Adds a tag once; returns the same list when it is empty, a repeat or one too many. */
export function addTag(tags: readonly string[] | undefined, raw: string): string[] {
  const list = [...(tags ?? [])];
  const tag = normalizeTag(raw);
  if (!tag || list.includes(tag) || list.length >= MAX_TAGS) return list;
  return [...list, tag];
}

export function removeTag(tags: readonly string[] | undefined, tag: string): string[] {
  return (tags ?? []).filter((t) => t !== tag);
}

export function filterMedia<T extends MediaLike>(rows: readonly T[], query: string, tag: string | null): T[] {
  return rows.filter((r) => (!tag || (r.tags ?? []).includes(tag)) && matchesSearch(r, query));
}

export function sortMedia<T extends MediaLike>(rows: readonly T[], sort: MediaSort): T[] {
  const out = [...rows];
  const newest = (a: T, b: T) => b.uploadedAt - a.uploadedAt;
  switch (sort) {
    case 'newest':
      return out.sort(newest);
    case 'oldest':
      return out.sort((a, b) => a.uploadedAt - b.uploadedAt);
    case 'name':
      return out.sort(
        (a, b) => a.fileName.localeCompare(b.fileName, 'en', { sensitivity: 'base', numeric: true }) || newest(a, b),
      );
    case 'largest':
      return out.sort((a, b) => b.bytes - a.bytes || newest(a, b));
  }
}

/** Filter then sort, the order the grid shows. */
export function queryMedia<T extends MediaLike>(
  rows: readonly T[],
  opts: { query: string; tag: string | null; sort: MediaSort },
): T[] {
  return sortMedia(filterMedia(rows, opts.query, opts.tag), opts.sort);
}

/** Every tag with how many images carry it, most used first, then A to Z. */
export function allTags(rows: readonly MediaLike[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) for (const t of new Set(r.tags ?? [])) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

// ─── Upload checks ───────────────────────────────────────────────────────────

export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const UPLOAD_ACCEPT = UPLOAD_TYPES.join(',');
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Why a file cannot be uploaded, in words for the person; null when it can. */
export function uploadProblem(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith('image/')) return 'This file is not an image. Choose a JPEG, PNG, WebP or GIF.';
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type))
    return 'This image type is not supported. Choose a JPEG, PNG, WebP or GIF.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return 'This image is larger than 10 MB. Choose a smaller one.';
  return null;
}

/** Splits a drop or a file choice into files to upload and files refused with a reason. */
export function checkUploads<F extends { type: string; size: number }>(
  files: readonly F[],
): { accepted: F[]; rejected: { file: F; reason: string }[] } {
  const accepted: F[] = [];
  const rejected: { file: F; reason: string }[] = [];
  for (const file of files) {
    const reason = uploadProblem(file);
    if (reason) rejected.push({ file, reason });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

/**
 * Runs `worker` over `items` with at most `limit` running at once, in order of
 * start. Resolves when all are done; a worker that throws does not stop the rest.
 */
export async function runPool<T>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        await worker(items[i], i);
      } catch {
        // The worker reports its own failure; the pool keeps going.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
}

// ─── Crop geometry ───────────────────────────────────────────────────────────

/** A rectangle as fractions (0 to 1) of the picture's width and height. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Rotation = 0 | 90 | 180 | 270;
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

export interface Transform {
  rotate: Rotation;
  flipX: boolean;
  flipY: boolean;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };
/** The smallest crop side, as a fraction, so a handle can always be grabbed again. */
export const MIN_CROP = 0.05;

export const ASPECT_PRESETS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: 'square', label: '1:1 Square', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9 Wide', ratio: 16 / 9 },
  { id: 'share', label: 'Share image 1200 × 630', ratio: 1200 / 630 },
  { id: 'portrait', label: '3:4 Portrait', ratio: 3 / 4 },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Keeps the rectangle inside the picture and no smaller than MIN_CROP. */
export function clampCrop(rect: CropRect, min = MIN_CROP): CropRect {
  const width = clamp(Number.isFinite(rect.width) ? rect.width : 1, min, 1);
  const height = clamp(Number.isFinite(rect.height) ? rect.height : 1, min, 1);
  const x = clamp(Number.isFinite(rect.x) ? rect.x : 0, 0, 1 - width);
  const y = clamp(Number.isFinite(rect.y) ? rect.y : 0, 0, 1 - height);
  return { x, y, width, height };
}

/** True when the rectangle is the whole picture, give or take rounding. */
export function isFullCrop(rect: CropRect): boolean {
  const e = 0.002;
  return rect.x < e && rect.y < e && rect.width > 1 - e && rect.height > 1 - e;
}

/** A pixel aspect (width / height) as the same shape in fractions of this picture. */
function fractionAspect(aspect: number, imgW: number, imgH: number): number {
  return imgW > 0 && imgH > 0 ? (aspect * imgH) / imgW : aspect;
}

/**
 * The largest rectangle of `aspect` (pixel width / height) that fits the
 * picture, centred where the current crop is centred, then nudged inside.
 * A null aspect (Free) returns the crop unchanged.
 */
export function fitCropToAspect(rect: CropRect, aspect: number | null, imgW: number, imgH: number): CropRect {
  if (!aspect || aspect <= 0) return clampCrop(rect);
  const fa = fractionAspect(aspect, imgW, imgH);
  let width = 1;
  let height = 1;
  if (fa > 1) height = 1 / fa;
  else width = fa;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return clampCrop({ x: cx - width / 2, y: cy - height / 2, width, height }, 0);
}

/** Moves the crop by a fraction of the picture, stopping at the edges. */
export function moveCrop(rect: CropRect, dx: number, dy: number): CropRect {
  return clampCrop({ ...rect, x: rect.x + dx, y: rect.y + dy });
}

/**
 * Drags one corner by (dx, dy) fractions while the opposite corner stays put.
 * With an aspect, the larger of the two movements decides the size and the
 * other side follows, so a keyboard nudge in either direction works.
 */
export function resizeCrop(
  rect: CropRect,
  corner: Corner,
  dx: number,
  dy: number,
  aspect: number | null,
  imgW: number,
  imgH: number,
): CropRect {
  const sx = corner === 'ne' || corner === 'se' ? 1 : -1;
  const sy = corner === 'sw' || corner === 'se' ? 1 : -1;
  // The fixed corner, and how much room there is from it towards the dragged one.
  const ax = sx > 0 ? rect.x : rect.x + rect.width;
  const ay = sy > 0 ? rect.y : rect.y + rect.height;
  const roomW = sx > 0 ? 1 - ax : ax;
  const roomH = sy > 0 ? 1 - ay : ay;
  let width = rect.width + sx * dx;
  let height = rect.height + sy * dy;
  if (aspect && aspect > 0) {
    const fa = fractionAspect(aspect, imgW, imgH);
    const byX = sx * dx;
    const byY = sy * dy * fa;
    width = rect.width + (Math.abs(byX) >= Math.abs(byY) ? byX : byY);
    const minW = Math.max(MIN_CROP, MIN_CROP * fa);
    width = clamp(width, Math.min(minW, roomW, roomH * fa), Math.min(roomW, roomH * fa));
    height = width / fa;
  } else {
    width = clamp(width, Math.min(MIN_CROP, roomW), roomW);
    height = clamp(height, Math.min(MIN_CROP, roomH), roomH);
  }
  const x = sx > 0 ? ax : ax - width;
  const y = sy > 0 ? ay : ay - height;
  return { x, y, width, height };
}

/** The picture's size after a rotation. */
export function rotateSize(w: number, h: number, deg: number): { width: number; height: number } {
  const quarter = ((Math.round(deg / 90) % 4) + 4) % 4;
  return quarter % 2 === 1 ? { width: h, height: w } : { width: w, height: h };
}

export function rotateBy(current: Rotation, deg: 90 | -90): Rotation {
  return ((((current + deg) % 360) + 360) % 360) as Rotation;
}

/** A crop in whole pixels of a `w` by `h` picture, never outside it and never empty. */
export function cropToPixels(rect: CropRect, w: number, h: number): CropRect {
  const x = clamp(Math.round(rect.x * w), 0, Math.max(0, w - 1));
  const y = clamp(Math.round(rect.y * h), 0, Math.max(0, h - 1));
  const width = clamp(Math.round(rect.width * w), 1, w - x);
  const height = clamp(Math.round(rect.height * h), 1, h - y);
  return { x, y, width, height };
}

const round2 = (n: number) => Math.round(clamp(n, 0, 1) * 100) / 100;

/** The middle of the crop, as the focal point of the uncropped picture. */
export function focalFromCrop(rect: CropRect): { focusX: number; focusY: number } {
  return { focusX: round2(rect.x + rect.width / 2), focusY: round2(rect.y + rect.height / 2) };
}

/** A point of the uncropped picture as a point of the cropped one, kept inside it. */
export function pointInCrop(p: { x: number; y: number }, rect: CropRect): { x: number; y: number } {
  return {
    x: round2(rect.width > 0 ? (p.x - rect.x) / rect.width : 0.5),
    y: round2(rect.height > 0 ? (p.y - rect.y) / rect.height : 0.5),
  };
}

/** A point of the original picture where it shows after rotating clockwise and flipping. */
export function toDisplayPoint(p: { x: number; y: number }, t: Transform): { x: number; y: number } {
  let { x, y } = p;
  if (t.rotate === 90) [x, y] = [1 - y, x];
  else if (t.rotate === 180) [x, y] = [1 - x, 1 - y];
  else if (t.rotate === 270) [x, y] = [y, 1 - x];
  if (t.flipX) x = 1 - x;
  if (t.flipY) y = 1 - y;
  return { x, y };
}

/** The reverse of `toDisplayPoint`: where a point the person sees sits in the original. */
export function toOriginalPoint(p: { x: number; y: number }, t: Transform): { x: number; y: number } {
  let { x, y } = p;
  if (t.flipX) x = 1 - x;
  if (t.flipY) y = 1 - y;
  if (t.rotate === 90) [x, y] = [y, 1 - x];
  else if (t.rotate === 180) [x, y] = [1 - x, 1 - y];
  else if (t.rotate === 270) [x, y] = [1 - y, x];
  return { x, y };
}

function mapRect(rect: CropRect, map: (p: { x: number; y: number }) => { x: number; y: number }): CropRect {
  const a = map({ x: rect.x, y: rect.y });
  const b = map({ x: rect.x + rect.width, y: rect.y + rect.height });
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export function toDisplayRect(rect: CropRect, t: Transform): CropRect {
  return mapRect(rect, (p) => toDisplayPoint(p, t));
}

export function toOriginalRect(rect: CropRect, t: Transform): CropRect {
  return mapRect(rect, (p) => toOriginalPoint(p, t));
}
