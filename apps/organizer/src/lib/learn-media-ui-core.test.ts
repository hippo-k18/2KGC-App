import { describe, expect, it } from 'vitest';
import {
  ASPECT_PRESETS,
  FULL_CROP,
  MIN_CROP,
  addTag,
  allTags,
  checkUploads,
  clampCrop,
  cropToPixels,
  filterMedia,
  fitCropToAspect,
  focalFromCrop,
  formatBytes,
  imageEditOps,
  isFullCrop,
  matchesSearch,
  moveCrop,
  normalizeTag,
  pointInCrop,
  queryMedia,
  removeTag,
  resizeCrop,
  rotateBy,
  rotateSize,
  runPool,
  sortMedia,
  toDisplayPoint,
  toDisplayRect,
  toOriginalPoint,
  toOriginalRect,
  uploadProblem,
  type CropRect,
  type MediaLike,
  type Transform,
} from './learn-media-ui-core';

const row = (fileName: string, over: Partial<MediaLike> = {}): MediaLike => ({
  fileName,
  bytes: 1000,
  uploadedAt: 1,
  image: { src: `https://x/${fileName}`, alt: '' },
  ...over,
});

const rows: MediaLike[] = [
  row('team-photo.jpg', { uploadedAt: 3, bytes: 500, tags: ['team', 'people'], image: { src: 'a', alt: 'Three founders' } }),
  row('Venue.png', { uploadedAt: 1, bytes: 9000, tags: ['venue'], image: { src: 'b', alt: 'Bryant Park at night' } }),
  row('logo 10.webp', { uploadedAt: 2, bytes: 9000, tags: ['logos', 'team'] }),
  row('logo 2.webp', { uploadedAt: 4, bytes: 10 }),
];

const near = (a: CropRect, b: CropRect) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  expect(a.width).toBeCloseTo(b.width, 6);
  expect(a.height).toBeCloseTo(b.height, 6);
};

describe('search and filter', () => {
  it('matches every word across file name, alt and tags, ignoring case', () => {
    expect(matchesSearch(rows[0], 'TEAM founders')).toBe(true);
    expect(matchesSearch(rows[0], 'team venue')).toBe(false);
    expect(matchesSearch(rows[1], 'bryant  png')).toBe(true);
    expect(matchesSearch(rows[1], '   ')).toBe(true);
  });

  it('filters by tag and search together', () => {
    expect(filterMedia(rows, '', 'team').map((r) => r.fileName)).toEqual(['team-photo.jpg', 'logo 10.webp']);
    expect(filterMedia(rows, 'logo', 'team').map((r) => r.fileName)).toEqual(['logo 10.webp']);
    expect(filterMedia(rows, '', null)).toHaveLength(4);
    expect(filterMedia(rows, 'nothing', null)).toHaveLength(0);
  });
});

describe('sort', () => {
  const names = (s: Parameters<typeof sortMedia>[1]) => sortMedia(rows, s).map((r) => r.fileName);
  it('orders newest and oldest by upload time', () => {
    expect(names('newest')).toEqual(['logo 2.webp', 'team-photo.jpg', 'logo 10.webp', 'Venue.png']);
    expect(names('oldest')).toEqual(['Venue.png', 'logo 10.webp', 'team-photo.jpg', 'logo 2.webp']);
  });
  it('orders names A to Z with numbers read as numbers and case ignored', () => {
    expect(names('name')).toEqual(['logo 2.webp', 'logo 10.webp', 'team-photo.jpg', 'Venue.png']);
  });
  it('orders largest first, newest first on a tie', () => {
    expect(names('largest')).toEqual(['logo 10.webp', 'Venue.png', 'team-photo.jpg', 'logo 2.webp']);
  });
  it('orders smallest first, newest first on a tie (the sort T315 added)', () => {
    expect(names('smallest')).toEqual(['logo 2.webp', 'team-photo.jpg', 'logo 10.webp', 'Venue.png']);
  });
  it('does not change the input', () => {
    const copy = [...rows];
    sortMedia(rows, 'name');
    expect(rows).toEqual(copy);
  });
  it('queryMedia filters then sorts', () => {
    expect(queryMedia(rows, { query: 'logo', tag: null, sort: 'name' }).map((r) => r.fileName)).toEqual([
      'logo 2.webp',
      'logo 10.webp',
    ]);
  });
});

describe('tags', () => {
  it('counts every tag, most used first then A to Z, a repeat on one image once', () => {
    expect(allTags([...rows, row('x', { tags: ['venue', 'venue'] })])).toEqual([
      { tag: 'team', count: 2 },
      { tag: 'venue', count: 2 },
      { tag: 'logos', count: 1 },
      { tag: 'people', count: 1 },
    ]);
    expect(allTags([])).toEqual([]);
  });
  it('normalizes like the server', () => {
    expect(normalizeTag('  Big   Hall ')).toBe('big hall');
    expect(normalizeTag('x'.repeat(40))).toHaveLength(30);
  });
  it('adds once and removes', () => {
    expect(addTag(['a'], ' B ')).toEqual(['a', 'b']);
    expect(addTag(['a'], 'A')).toEqual(['a']);
    expect(addTag(undefined, '   ')).toEqual([]);
    expect(addTag(Array.from({ length: 20 }, (_, i) => `t${i}`), 'more')).toHaveLength(20);
    expect(removeTag(['a', 'b'], 'a')).toEqual(['b']);
    expect(removeTag(undefined, 'a')).toEqual([]);
  });
});

describe('formatBytes', () => {
  it('reads as people expect', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB');
  });
});

describe('upload checks', () => {
  it('names the problem in plain words', () => {
    expect(uploadProblem({ type: 'image/png', size: 100 })).toBeNull();
    expect(uploadProblem({ type: 'image/gif', size: 10 * 1024 * 1024 })).toBeNull();
    expect(uploadProblem({ type: 'application/pdf', size: 100 })).toMatch(/not an image/);
    expect(uploadProblem({ type: 'image/svg+xml', size: 100 })).toMatch(/not supported/);
    expect(uploadProblem({ type: 'image/jpeg', size: 0 })).toMatch(/empty/);
    expect(uploadProblem({ type: 'image/webp', size: 10 * 1024 * 1024 + 1 })).toMatch(/10 MB/);
  });
  it('splits a batch into accepted and refused, keeping order', () => {
    const a = { name: 'a', type: 'image/png', size: 1 };
    const b = { name: 'b', type: 'text/plain', size: 1 };
    const c = { name: 'c', type: 'image/jpeg', size: 1 };
    const out = checkUploads([a, b, c]);
    expect(out.accepted).toEqual([a, c]);
    expect(out.rejected).toEqual([{ file: b, reason: expect.stringMatching(/not an image/) }]);
  });
});

describe('runPool', () => {
  it('never runs more than the limit at once and finishes everything, even after a failure', async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5 + (n % 3)));
      running--;
      if (n === 2) throw new Error('boom');
      done.push(n);
    });
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([1, 3, 4, 5, 6, 7]);
  });
  it('handles an empty list', async () => {
    await expect(runPool([], 3, async () => {})).resolves.toBeUndefined();
  });
});

describe('aspect presets', () => {
  it('has the seven presets with Free first and the share image near 1.91', () => {
    expect(ASPECT_PRESETS.map((p) => p.label)).toEqual([
      'Free',
      '1:1 Square',
      '4:3',
      '3:2',
      '16:9 Wide',
      'Share image 1200 × 630',
      '3:4 Portrait',
    ]);
    expect(ASPECT_PRESETS[0].ratio).toBeNull();
    expect(ASPECT_PRESETS.find((p) => p.id === 'share')!.ratio).toBeCloseTo(1.905, 3);
  });
});

describe('clampCrop', () => {
  it('keeps the crop inside the picture and above the minimum', () => {
    near(clampCrop({ x: 0.8, y: -0.2, width: 0.5, height: 0.5 }), { x: 0.5, y: 0, width: 0.5, height: 0.5 });
    near(clampCrop({ x: 0, y: 0, width: 2, height: 0.001 }), { x: 0, y: 0, width: 1, height: MIN_CROP });
    near(clampCrop({ x: NaN, y: 0, width: NaN, height: 1 }), FULL_CROP);
  });
  it('isFullCrop allows rounding', () => {
    expect(isFullCrop(FULL_CROP)).toBe(true);
    expect(isFullCrop({ x: 0.001, y: 0, width: 0.999, height: 1 })).toBe(true);
    expect(isFullCrop({ x: 0.1, y: 0, width: 0.9, height: 1 })).toBe(false);
  });
});

describe('fitCropToAspect', () => {
  it('square on a 2000 x 1000 picture uses the full height, centred', () => {
    const r = fitCropToAspect(FULL_CROP, 1, 2000, 1000);
    near(r, { x: 0.25, y: 0, width: 0.5, height: 1 });
    expect(cropToPixels(r, 2000, 1000)).toEqual({ x: 500, y: 0, width: 1000, height: 1000 });
  });
  it('16:9 on a square picture uses the full width', () => {
    const r = fitCropToAspect(FULL_CROP, 16 / 9, 1000, 1000);
    near(r, { x: 0, y: (1 - 0.5625) / 2, width: 1, height: 0.5625 });
  });
  it('keeps the centre of the current crop, nudged inside', () => {
    const r = fitCropToAspect({ x: 0, y: 0, width: 0.2, height: 0.2 }, 1, 2000, 1000);
    near(r, { x: 0, y: 0, width: 0.5, height: 1 });
  });
  it('Free leaves the crop alone', () => {
    const c = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    near(fitCropToAspect(c, null, 100, 100), c);
  });
  it('the share preset gives 1200 x 630 proportions', () => {
    const r = cropToPixels(fitCropToAspect(FULL_CROP, 1200 / 630, 2400, 2400), 2400, 2400);
    expect(r.width / r.height).toBeCloseTo(1200 / 630, 2);
  });
});

describe('moveCrop and resizeCrop', () => {
  const start = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };
  it('moves and stops at the edges', () => {
    near(moveCrop(start, 0.1, -0.1), { x: 0.3, y: 0.1, width: 0.4, height: 0.4 });
    near(moveCrop(start, 1, 1), { x: 0.6, y: 0.6, width: 0.4, height: 0.4 });
  });
  it('free resize from the bottom right keeps the top left', () => {
    near(resizeCrop(start, 'se', 0.1, 0.2, null, 100, 100), { x: 0.2, y: 0.2, width: 0.5, height: 0.6 });
  });
  it('free resize from the top left keeps the bottom right and stops at the edge', () => {
    near(resizeCrop(start, 'nw', -0.5, 0.1, null, 100, 100), { x: 0, y: 0.3, width: 0.6, height: 0.3 });
  });
  it('never goes below the minimum size', () => {
    const r = resizeCrop(start, 'ne', -1, 1, null, 100, 100);
    expect(r.width).toBeCloseTo(MIN_CROP, 6);
    expect(r.height).toBeCloseTo(MIN_CROP, 6);
    expect(r.x).toBeCloseTo(0.2, 6);
    expect(r.y + r.height).toBeCloseTo(0.6, 6);
  });
  it('with an aspect the larger movement wins and the shape is kept', () => {
    const r = resizeCrop({ x: 0.2, y: 0.2, width: 0.2, height: 0.4 }, 'se', 0, 0.1, 1, 200, 100);
    // Square in pixels on a 2:1 picture is half as wide in fractions.
    expect((r.width * 200) / (r.height * 100)).toBeCloseTo(1, 6);
    expect(r.height).toBeCloseTo(0.5, 6);
    const s = resizeCrop(start, 'sw', -0.1, 0, 1, 100, 100);
    near(s, { x: 0.1, y: 0.2, width: 0.5, height: 0.5 });
  });
  it('with an aspect it stops where either side meets the edge', () => {
    const r = resizeCrop(start, 'se', 1, 0, 1, 100, 100);
    near(r, { x: 0.2, y: 0.2, width: 0.8, height: 0.8 });
  });
});

describe('rotate and pixels', () => {
  it('swaps sides on a quarter turn', () => {
    expect(rotateSize(400, 300, 90)).toEqual({ width: 300, height: 400 });
    expect(rotateSize(400, 300, 180)).toEqual({ width: 400, height: 300 });
    expect(rotateSize(400, 300, 270)).toEqual({ width: 300, height: 400 });
    expect(rotateSize(400, 300, -90)).toEqual({ width: 300, height: 400 });
  });
  it('rotates in quarter turns both ways', () => {
    expect(rotateBy(0, 90)).toBe(90);
    expect(rotateBy(270, 90)).toBe(0);
    expect(rotateBy(0, -90)).toBe(270);
  });
  it('turns fractions into whole pixels inside the picture', () => {
    expect(cropToPixels({ x: 0.333, y: 0.5, width: 0.333, height: 0.5 }, 1000, 501)).toEqual({
      x: 333,
      y: 251,
      width: 333,
      height: 250,
    });
    expect(cropToPixels({ x: 0.999, y: 0, width: 0.0001, height: 1 }, 100, 100)).toEqual({
      x: 99,
      y: 0,
      width: 1,
      height: 100,
    });
    expect(cropToPixels(FULL_CROP, 640, 480)).toEqual({ x: 0, y: 0, width: 640, height: 480 });
  });
});

describe('focal point', () => {
  it('is the centre of the crop, rounded to hundredths', () => {
    expect(focalFromCrop({ x: 0.1, y: 0.2, width: 0.333, height: 0.4 })).toEqual({ focusX: 0.27, focusY: 0.4 });
    expect(focalFromCrop(FULL_CROP)).toEqual({ focusX: 0.5, focusY: 0.5 });
  });
  it('a point of the whole picture becomes a point of the crop, kept inside', () => {
    expect(pointInCrop({ x: 0.5, y: 0.5 }, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 })).toEqual({ x: 0.5, y: 0.5 });
    expect(pointInCrop({ x: 0.1, y: 0.9 }, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 })).toEqual({ x: 0, y: 1 });
  });
});

describe('display and original coordinates', () => {
  const all: Transform[] = [];
  for (const rotate of [0, 90, 180, 270] as const)
    for (const flipX of [false, true]) for (const flipY of [false, true]) all.push({ rotate, flipX, flipY });

  it('a quarter turn clockwise moves the top left corner to the top right', () => {
    expect(toDisplayPoint({ x: 0, y: 0 }, { rotate: 90, flipX: false, flipY: false })).toEqual({ x: 1, y: 0 });
    expect(toDisplayPoint({ x: 1, y: 0 }, { rotate: 90, flipX: false, flipY: false })).toEqual({ x: 1, y: 1 });
    expect(toDisplayPoint({ x: 0, y: 0 }, { rotate: 270, flipX: false, flipY: false })).toEqual({ x: 0, y: 1 });
  });
  it('a flip mirrors what is shown, after the turn', () => {
    expect(toDisplayPoint({ x: 0, y: 0 }, { rotate: 90, flipX: true, flipY: false })).toEqual({ x: 0, y: 0 });
    expect(toDisplayPoint({ x: 0.2, y: 0.3 }, { rotate: 0, flipX: false, flipY: true })).toEqual({ x: 0.2, y: 0.7 });
  });
  it('points and rectangles survive the round trip for all 16 combinations', () => {
    const p = { x: 0.2, y: 0.7 };
    const r = { x: 0.1, y: 0.2, width: 0.3, height: 0.5 };
    for (const t of all) {
      const q = toOriginalPoint(toDisplayPoint(p, t), t);
      expect(q.x).toBeCloseTo(p.x, 9);
      expect(q.y).toBeCloseTo(p.y, 9);
      near(toOriginalRect(toDisplayRect(r, t), t), r);
    }
  });
  it('a rectangle swaps its sides on a quarter turn', () => {
    near(toDisplayRect({ x: 0, y: 0, width: 0.5, height: 0.25 }, { rotate: 90, flipX: false, flipY: false }), {
      x: 0.75,
      y: 0,
      width: 0.25,
      height: 0.5,
    });
  });
});

describe('imageEditOps', () => {
  const none = { rotate: 0, flipX: false, flipY: false } as const;

  it('sends nothing for an edit that changes nothing', () => {
    expect(imageEditOps(FULL_CROP, none, 800, 600)).toEqual([]);
    // Flipped both ways and turned half way is the original picture.
    expect(imageEditOps(FULL_CROP, { rotate: 180, flipX: true, flipY: true }, 800, 600)).toEqual([]);
  });

  it('crops in pixels of the original, then rotates, then flips', () => {
    expect(imageEditOps({ x: 0.25, y: 0.5, width: 0.5, height: 0.5 }, { rotate: 90, flipX: true, flipY: false }, 800, 600)).toEqual([
      { op: 'crop', x: 200, y: 300, width: 400, height: 300 },
      { op: 'rotate', degrees: 90 },
      { op: 'flip', direction: 'horizontal' },
    ]);
  });

  it('sends a flip both ways as a half turn', () => {
    expect(imageEditOps(FULL_CROP, { rotate: 0, flipX: true, flipY: true }, 800, 600)).toEqual([{ op: 'rotate', degrees: 180 }]);
    expect(imageEditOps(FULL_CROP, { rotate: 90, flipX: true, flipY: true }, 800, 600)).toEqual([{ op: 'rotate', degrees: 270 }]);
  });

  it('leaves out a crop that rounds to the whole picture', () => {
    expect(imageEditOps({ x: 0.0001, y: 0, width: 0.9995, height: 1 }, { ...none, flipY: true }, 800, 600)).toEqual([
      { op: 'flip', direction: 'vertical' },
    ]);
  });
});
