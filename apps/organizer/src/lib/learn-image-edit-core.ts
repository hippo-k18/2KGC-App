import { LEARN_LIMITS } from './learn-page-core';

/**
 * The plan for editing a Learn page image (T316): crop, rotate, flip, resize
 * and convert to WebP.
 *
 * Pure, so the editor can check an edit before sending it and the server can
 * check it again on arrival with the same rules. `learn-image-edit.ts` runs the
 * plan with `sharp`; nothing here touches pixels.
 *
 * Every op is expressed in the pixels of the image as it is at that step, not
 * as it was uploaded. A crop after a 90 degree rotate is therefore measured on
 * the rotated picture, which is what the organizer was looking at when they
 * drew the rectangle.
 */

export type LearnImageOp =
  | { op: 'crop'; x: number; y: number; width: number; height: number }
  /** Clockwise. */
  | { op: 'rotate'; degrees: 90 | 180 | 270 }
  | { op: 'flip'; direction: 'horizontal' | 'vertical' }
  /** Keeps the aspect ratio. Never wider than the image already is. */
  | { op: 'resize'; width: number };

export interface LearnImageEdit {
  ops: LearnImageOp[];
  format: 'keep' | 'webp';
}

export type LearnImageEditPlan =
  | { ok: true; ops: LearnImageOp[]; format: LearnImageEdit['format']; width: number; height: number }
  | { ok: false; error: string };

export const LEARN_IMAGE_EDIT_MAX_OPS = 20;
export const LEARN_IMAGE_MIN_RESIZE = 16;

const ROTATIONS = [90, 180, 270] as const;
const DIRECTIONS = ['horizontal', 'vertical'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** Height after scaling to `width`, rounded the way `sharp` rounds it. */
function scaledHeight(width: number, height: number, toWidth: number): number {
  return Math.max(1, Math.round((height * toWidth) / width));
}

/**
 * Validate an edit sent by the browser and work out the size it produces.
 *
 * The input is untrusted: each op is rebuilt from the keys it should have, so
 * an unknown key never reaches `sharp`. `sourceWidth` and `sourceHeight` are
 * the size as displayed, after EXIF rotation, because that is the picture the
 * editor drew on.
 *
 * Two choices worth knowing:
 *
 * - A resize wider than the image is at that step is refused rather than
 *   clamped. Enlarging only makes a blurrier file, and quietly doing something
 *   other than what was asked hides the reason the result looks the same.
 * - A result wider than `LEARN_LIMITS.imageMaxWidth` gets a resize to that
 *   width added at the end, the same fit an upload gets. Refusing would leave
 *   an organizer unable to crop or rotate an image that was accepted as it is
 *   (an EXIF-rotated portrait can come out wider once turned).
 */
export function planLearnImageEdit(input: unknown, sourceWidth: number, sourceHeight: number): LearnImageEditPlan {
  const fail = (error: string): LearnImageEditPlan => ({ ok: false, error });
  if (!isInt(sourceWidth) || !isInt(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) {
    return fail('Could not read the size of that image.');
  }
  if (!isRecord(input)) return fail('The edit was not understood. Reload the page and try again.');

  const format = input.format ?? 'keep';
  if (format !== 'keep' && format !== 'webp') return fail('The format must be "keep" or "webp".');

  const rawOps = input.ops ?? [];
  if (!Array.isArray(rawOps)) return fail('The edit was not understood. Reload the page and try again.');
  if (rawOps.length > LEARN_IMAGE_EDIT_MAX_OPS) {
    return fail(`That is more than ${LEARN_IMAGE_EDIT_MAX_OPS} changes in one go. Save part of it first, then edit again.`);
  }
  if (rawOps.length === 0 && format === 'keep') return fail('Nothing to change. Crop, rotate, flip, resize or convert the image first.');

  const ops: LearnImageOp[] = [];
  let width = sourceWidth;
  let height = sourceHeight;

  for (let i = 0; i < rawOps.length; i++) {
    const raw: unknown = rawOps[i];
    const step = `Step ${i + 1}`;
    if (!isRecord(raw)) return fail(`${step} was not understood.`);

    switch (raw.op) {
      case 'crop': {
        const { x, y } = raw;
        const w = raw.width;
        const h = raw.height;
        if (!isInt(x) || !isInt(y) || !isInt(w) || !isInt(h)) {
          return fail(`${step}: the crop must be whole pixels.`);
        }
        if (w < 1 || h < 1) return fail(`${step}: the crop must be at least 1 pixel wide and tall.`);
        if (x < 0 || y < 0 || x + w > width || y + h > height) {
          return fail(`${step}: the crop goes outside the image, which is ${width} by ${height} pixels at that point.`);
        }
        ops.push({ op: 'crop', x, y, width: w, height: h });
        width = w;
        height = h;
        break;
      }
      case 'rotate': {
        const degrees = raw.degrees;
        if (!ROTATIONS.includes(degrees as (typeof ROTATIONS)[number])) {
          return fail(`${step}: rotate by 90, 180 or 270 degrees.`);
        }
        const d = degrees as (typeof ROTATIONS)[number];
        ops.push({ op: 'rotate', degrees: d });
        if (d !== 180) [width, height] = [height, width];
        break;
      }
      case 'flip': {
        const direction = raw.direction;
        if (!DIRECTIONS.includes(direction as (typeof DIRECTIONS)[number])) {
          return fail(`${step}: flip horizontally or vertically.`);
        }
        ops.push({ op: 'flip', direction: direction as (typeof DIRECTIONS)[number] });
        break;
      }
      case 'resize': {
        const w = raw.width;
        if (!isInt(w)) return fail(`${step}: the new width must be whole pixels.`);
        if (w < LEARN_IMAGE_MIN_RESIZE || w > LEARN_LIMITS.imageMaxWidth) {
          return fail(`${step}: the new width must be between ${LEARN_IMAGE_MIN_RESIZE} and ${LEARN_LIMITS.imageMaxWidth} pixels.`);
        }
        if (w > width) {
          return fail(`${step}: the image is ${width} pixels wide at that point. Resizing can make it smaller, not larger.`);
        }
        ops.push({ op: 'resize', width: w });
        height = scaledHeight(width, height, w);
        width = w;
        break;
      }
      default:
        return fail(`${step} is not a change this editor can make.`);
    }
  }

  if (width > LEARN_LIMITS.imageMaxWidth) {
    const w = LEARN_LIMITS.imageMaxWidth;
    ops.push({ op: 'resize', width: w });
    height = scaledHeight(width, height, w);
    width = w;
  }

  return { ok: true, ops, format, width, height };
}

const EDITED_SUFFIX = ' (edited)';
const MAX_BASE_NAME = 100;

/**
 * The library name for an edited copy: "team photo.jpg" becomes
 * "team photo (edited).webp". Editing a copy again does not stack the suffix.
 */
export function editedFileName(original: string | undefined, ext: string): string {
  const cleanExt = ext.replace(/^\.+/, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'img';
  let base = (original ?? '')
    .replace(/[\\/]/g, ' ')
    // A control character in a file name only ever shows up as a box.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .trim();
  while (base.endsWith(EDITED_SUFFIX)) base = base.slice(0, -EDITED_SUFFIX.length).trimEnd();
  if (base.length > MAX_BASE_NAME) base = base.slice(0, MAX_BASE_NAME).trimEnd();
  return `${base || 'image'}${EDITED_SUFFIX}.${cleanExt}`;
}
