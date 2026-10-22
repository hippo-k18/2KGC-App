import { describe, expect, it } from 'vitest';

import {
  LEARN_IMAGE_EDIT_MAX_OPS,
  editedFileName,
  editedFromFor,
  parseLearnImageEditState,
  parseLearnImageEditedFrom,
  planLearnImageEdit,
} from './learn-image-edit-core';
import { imageEditOps } from './learn-media-ui-core';
import { LEARN_LIMITS } from './learn-page-core';

function ok(input: unknown, w: number, h: number) {
  const plan = planLearnImageEdit(input, w, h);
  if (!plan.ok) throw new Error(`expected ok, got: ${plan.error}`);
  return plan;
}

function err(input: unknown, w: number, h: number): string {
  const plan = planLearnImageEdit(input, w, h);
  if (plan.ok) throw new Error('expected a refusal');
  return plan.error;
}

describe('planLearnImageEdit: sizes', () => {
  it('swaps width and height for 90 and 270, not for 180', () => {
    expect(ok({ ops: [{ op: 'rotate', degrees: 90 }] }, 400, 200)).toMatchObject({ width: 200, height: 400 });
    expect(ok({ ops: [{ op: 'rotate', degrees: 270 }] }, 400, 200)).toMatchObject({ width: 200, height: 400 });
    expect(ok({ ops: [{ op: 'rotate', degrees: 180 }] }, 400, 200)).toMatchObject({ width: 400, height: 200 });
  });

  it('leaves the size alone on a flip', () => {
    expect(ok({ ops: [{ op: 'flip', direction: 'horizontal' }] }, 300, 100)).toMatchObject({ width: 300, height: 100 });
  });

  it('tracks a crop, then a rotate, then a resize', () => {
    const plan = ok(
      {
        ops: [
          { op: 'crop', x: 10, y: 20, width: 300, height: 100 },
          { op: 'rotate', degrees: 90 },
          { op: 'resize', width: 50 },
        ],
      },
      400,
      200,
    );
    expect(plan).toMatchObject({ width: 50, height: 150, format: 'keep' });
    expect(plan.ops).toHaveLength(3);
  });

  it('accepts a format change with no ops', () => {
    expect(ok({ ops: [], format: 'webp' }, 100, 100)).toMatchObject({ ops: [], format: 'webp', width: 100, height: 100 });
    expect(ok({ format: 'webp' }, 100, 100).ops).toEqual([]);
  });

  it('rounds the resized height and never lets it reach zero', () => {
    expect(ok({ ops: [{ op: 'resize', width: 100 }] }, 300, 200)).toMatchObject({ width: 100, height: 67 });
    expect(ok({ ops: [{ op: 'resize', width: 16 }] }, 2000, 10)).toMatchObject({ width: 16, height: 1 });
  });

  it('fits a result wider than the page limit by adding a resize at the end', () => {
    const max = LEARN_LIMITS.imageMaxWidth;
    // A 1500 x 3000 portrait turned on its side is 3000 wide.
    const plan = ok({ ops: [{ op: 'rotate', degrees: 90 }] }, 1500, 3000);
    expect(plan).toMatchObject({ width: max, height: 1200 });
    expect(plan.ops.at(-1)).toEqual({ op: 'resize', width: max });
  });
});

describe('planLearnImageEdit: crop bounds', () => {
  it('measures a crop on the image as it is after a rotate', () => {
    // 400 x 200 rotated is 200 x 400: a 150 x 350 crop fits, a 350 x 150 one does not.
    expect(
      ok({ ops: [{ op: 'rotate', degrees: 90 }, { op: 'crop', x: 0, y: 0, width: 150, height: 350 }] }, 400, 200),
    ).toMatchObject({ width: 150, height: 350 });
    expect(
      err({ ops: [{ op: 'rotate', degrees: 90 }, { op: 'crop', x: 0, y: 0, width: 350, height: 150 }] }, 400, 200),
    ).toMatch(/Step 2.*200 by 400/);
  });

  it('measures a second crop on the first', () => {
    expect(
      err(
        {
          ops: [
            { op: 'crop', x: 0, y: 0, width: 100, height: 100 },
            { op: 'crop', x: 50, y: 0, width: 60, height: 10 },
          ],
        },
        400,
        200,
      ),
    ).toMatch(/Step 2: the crop goes outside the image, which is 100 by 100/);
  });

  it('allows a crop of the whole image and of one pixel', () => {
    expect(ok({ ops: [{ op: 'crop', x: 0, y: 0, width: 400, height: 200 }] }, 400, 200)).toMatchObject({ width: 400 });
    expect(ok({ ops: [{ op: 'crop', x: 399, y: 199, width: 1, height: 1 }] }, 400, 200)).toMatchObject({
      width: 1,
      height: 1,
    });
  });

  it('refuses negative, empty, fractional and overflowing crops', () => {
    const crop = (c: object) => ({ ops: [{ op: 'crop', x: 0, y: 0, width: 10, height: 10, ...c }] });
    expect(err(crop({ x: -1 }), 400, 200)).toMatch(/outside/);
    expect(err(crop({ width: 0 }), 400, 200)).toMatch(/at least 1 pixel/);
    expect(err(crop({ height: 2.5 }), 400, 200)).toMatch(/whole pixels/);
    expect(err(crop({ x: '5' }), 400, 200)).toMatch(/whole pixels/);
    expect(err(crop({ x: 391 }), 400, 200)).toMatch(/outside/);
    expect(err(crop({ y: 1, height: 200 }), 400, 200)).toMatch(/outside/);
  });
});

describe('planLearnImageEdit: refusals', () => {
  it('refuses an edit that changes nothing', () => {
    expect(err({ ops: [], format: 'keep' }, 100, 100)).toMatch(/Nothing to change/);
    expect(err({}, 100, 100)).toMatch(/Nothing to change/);
  });

  it('refuses input that is not an edit', () => {
    expect(err(null, 100, 100)).toMatch(/not understood/);
    expect(err([], 100, 100)).toMatch(/not understood/);
    expect(err({ ops: 'rotate' }, 100, 100)).toMatch(/not understood/);
    expect(err({ ops: [null] }, 100, 100)).toMatch(/Step 1 was not understood/);
    expect(err({ ops: [{ op: 'blur' }] }, 100, 100)).toMatch(/Step 1 is not a change/);
    expect(err({ ops: [], format: 'avif' }, 100, 100)).toMatch(/format/);
  });

  it('refuses rotations other than quarter turns and unknown flips', () => {
    expect(err({ ops: [{ op: 'rotate', degrees: 45 }] }, 100, 100)).toMatch(/90, 180 or 270/);
    expect(err({ ops: [{ op: 'rotate', degrees: '90' }] }, 100, 100)).toMatch(/90, 180 or 270/);
    expect(err({ ops: [{ op: 'flip', direction: 'diagonal' }] }, 100, 100)).toMatch(/horizontally or vertically/);
  });

  it('refuses a resize out of range or larger than the image', () => {
    expect(err({ ops: [{ op: 'resize', width: 15 }] }, 100, 100)).toMatch(/between 16 and 2400/);
    expect(err({ ops: [{ op: 'resize', width: 2401 }] }, 3000, 100)).toMatch(/between 16 and 2400/);
    expect(err({ ops: [{ op: 'resize', width: 101 }] }, 100, 100)).toMatch(/smaller, not larger/);
    expect(err({ ops: [{ op: 'resize', width: 50.5 }] }, 100, 100)).toMatch(/whole pixels/);
    // Larger than the image after a crop, though not larger than the original.
    expect(
      err({ ops: [{ op: 'crop', x: 0, y: 0, width: 50, height: 50 }, { op: 'resize', width: 80 }] }, 100, 100),
    ).toMatch(/Step 2: the image is 50 pixels wide/);
  });

  it(`refuses more than ${LEARN_IMAGE_EDIT_MAX_OPS} ops`, () => {
    const flips = (n: number) => ({ ops: Array.from({ length: n }, () => ({ op: 'flip', direction: 'vertical' })) });
    expect(ok(flips(LEARN_IMAGE_EDIT_MAX_OPS), 10, 10).ops).toHaveLength(LEARN_IMAGE_EDIT_MAX_OPS);
    expect(err(flips(LEARN_IMAGE_EDIT_MAX_OPS + 1), 10, 10)).toMatch(/more than 20/);
  });

  it('refuses an unreadable source size', () => {
    expect(err({ format: 'webp' }, 0, 100)).toMatch(/size/);
  });
});

describe('planLearnImageEdit: rebuilds ops', () => {
  it('drops unknown keys', () => {
    const plan = ok(
      {
        ops: [
          { op: 'crop', x: 0, y: 0, width: 50, height: 50, evil: 'x' },
          { op: 'rotate', degrees: 90, background: 'red' },
          { op: 'flip', direction: 'vertical', extra: 1 },
          { op: 'resize', width: 16, kernel: 'nearest' },
        ],
        format: 'webp',
        quality: 1,
      },
      100,
      100,
    );
    expect(plan.ops).toEqual([
      { op: 'crop', x: 0, y: 0, width: 50, height: 50 },
      { op: 'rotate', degrees: 90 },
      { op: 'flip', direction: 'vertical' },
      { op: 'resize', width: 16 },
    ]);
    expect(Object.keys(plan)).toEqual(['ok', 'ops', 'format', 'width', 'height']);
  });
});

describe('editedFileName', () => {
  it('swaps the extension and adds the suffix', () => {
    expect(editedFileName('team photo.jpg', 'webp')).toBe('team photo (edited).webp');
    expect(editedFileName('logo.PNG', 'png')).toBe('logo (edited).png');
    expect(editedFileName('archive.tar.gz', '.png')).toBe('archive.tar (edited).png');
  });

  it('does not stack the suffix on a second edit', () => {
    expect(editedFileName('team photo (edited).webp', 'jpg')).toBe('team photo (edited).jpg');
  });

  it('falls back to "image" when there is no usable name', () => {
    expect(editedFileName(undefined, 'webp')).toBe('image (edited).webp');
    expect(editedFileName('', 'jpg')).toBe('image (edited).jpg');
    expect(editedFileName('.png', 'jpg')).toBe('image (edited).jpg');
    expect(editedFileName('   ', '')).toBe('image (edited).img');
  });

  it('strips path separators and control characters, and caps the length', () => {
    expect(editedFileName('a/b\\c.jpg', 'jpg')).toBe('a b c (edited).jpg');
    expect(editedFileName('bad\u0000name.jpg', 'jpg')).toBe('badname (edited).jpg');
    const long = editedFileName(`${'x'.repeat(500)}.jpg`, 'webp');
    expect(long).toBe(`${'x'.repeat(100)} (edited).webp`);
  });
});

describe('where an edited copy came from (T325, D8)', () => {
  const state = { crop: { x: 0.25, y: 0, width: 0.5, height: 1 }, rotate: 90 as const, flipX: true, flipY: false };
  const t = { rotate: state.rotate, flipX: state.flipX, flipY: state.flipY };
  const SRC = 'https://firebasestorage.googleapis.com/v0/b/b/o/pageLayouts%2Flearn%2Fa.jpg?alt=media&token=t';

  it('reads well-formed editor settings and refuses anything else', () => {
    expect(parseLearnImageEditState(state)).toEqual(state);
    expect(parseLearnImageEditState({ ...state, rotate: 0 })?.rotate).toBe(0);
    for (const bad of [
      null,
      {},
      { ...state, rotate: 45 },
      { ...state, flipX: 'yes' },
      { ...state, crop: { x: 0.6, y: 0, width: 0.5, height: 1 } },
      { ...state, crop: { x: -0.1, y: 0, width: 0.5, height: 1 } },
      { ...state, crop: { x: 0, y: 0, width: 0, height: 1 } },
      { ...state, crop: { x: 0, y: 0, width: NaN, height: 1 } },
    ]) {
      expect(parseLearnImageEditState(bad)).toBeNull();
    }
  });

  it('reads a stored editedFrom only with a source and a whole-pixel size', () => {
    const from = { image: { src: SRC, width: 1599, height: 899 }, ...state };
    expect(parseLearnImageEditedFrom(from)).toEqual(from);
    expect(parseLearnImageEditedFrom({ ...from, image: { src: SRC, width: 1.5, height: 899 } })).toBeNull();
    expect(parseLearnImageEditedFrom({ ...from, image: null })).toBeNull();
    expect(parseLearnImageEditedFrom(undefined)).toBeNull();
  });

  it('keeps the settings only when they give exactly the ops that were run', () => {
    const ops = imageEditOps(state.crop, t, 1599, 899);
    expect(editedFromFor({ ops, format: 'keep', state }, SRC, 1599, 899)).toEqual({ image: { src: SRC, width: 1599, height: 899 }, ...state });
    // Measured on a different size, the same settings make different ops.
    expect(editedFromFor({ ops, state }, SRC, 800, 600)).toBeNull();
    expect(editedFromFor({ ops: [{ op: 'rotate', degrees: 180 }], state }, SRC, 1599, 899)).toBeNull();
    expect(editedFromFor({ ops }, SRC, 1599, 899)).toBeNull();
    expect(editedFromFor(null, SRC, 1599, 899)).toBeNull();
  });
});
