/**
 * The KGC | Learn page editor's server half (T309), against the emulators:
 * the draft, the revision check that stops two editors overwriting each other,
 * publish and its version history, revert and restore, and image uploads into
 * the Storage emulator.
 *
 * Run with: npm run test:learn-page
 */
import { createRequire } from 'node:module';
import path from 'node:path';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COLLECTIONS, type LearnPageContent, type LearnPageDoc, type LearnPageVersion } from '@kgc/shared';
import { db } from '@/lib/firestore';
import {
  LearnVersionMissing,
  loadLearnEditor,
  publishLearnPage,
  restoreLearnVersion,
  revertLearnDraft,
  saveLearnDraft,
  uploadLearnImage,
} from '@/lib/learn-page';
import {
  LEARN_PAGE_DEFAULT,
  LEARN_VERSIONS_KEPT,
  LearnConflict,
  isAllowedLearnImageSrc,
} from '@/lib/learn-page-core';
import { UploadRejected } from '@/lib/uploads';

// `sharp` is installed for the dashboard only, so load it from there.
const organizerRequire = createRequire(path.resolve(import.meta.dirname, '../../apps/organizer/package.json'));
const sharp = organizerRequire('sharp') as typeof import('sharp');

const ACTOR = 'editor@kgc.test';

const docRef = () => db().collection(COLLECTIONS.pageLayouts).doc('learn');
const versionsRef = () => docRef().collection('versions');

/** A valid page that differs from the default by its title. */
function page(n: number | string): LearnPageContent {
  return { ...structuredClone(LEARN_PAGE_DEFAULT), seoTitle: `Learn page ${n}` };
}

async function stored(): Promise<LearnPageDoc | undefined> {
  return (await docRef().get()).data() as LearnPageDoc | undefined;
}

async function versionCount(): Promise<number> {
  return (await versionsRef().count().get()).data().count;
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run with: npm run test:learn-page');
  if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('Run with: npm run test:learn-page');
});

beforeEach(async () => {
  await db().recursiveDelete(docRef());
});

describe('loading the editor', () => {
  it('shows the default page when nothing is stored', async () => {
    const state = await loadLearnEditor();
    expect(state.exists).toBe(false);
    expect(state.doc.revision).toBe(0);
    expect(state.doc.draft).toEqual(LEARN_PAGE_DEFAULT);
    expect(state.doc.published).toBeNull();
    expect(state.versions).toEqual([]);
    expect(state.hasUnpublishedChanges).toBe(false);
  });
});

describe('saving the draft', () => {
  it('creates the doc, bumps the revision, and refuses a stale base', async () => {
    const first = await saveLearnDraft(page(1), 0, ACTOR);
    expect(first.revision).toBe(1);
    expect((await stored())?.revision).toBe(1);
    expect((await stored())?.draft).toEqual(page(1));
    expect((await stored())?.draftUpdatedBy).toBe(ACTOR);

    const second = await saveLearnDraft(page(2), 1, ACTOR);
    expect(second.revision).toBe(2);

    const err = await saveLearnDraft(page(3), 1, ACTOR).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LearnConflict);
    expect((err as LearnConflict).currentRevision).toBe(2);

    const after = await stored();
    expect(after?.revision).toBe(2);
    expect(after?.draft).toEqual(page(2));

    const state = await loadLearnEditor();
    expect(state.exists).toBe(true);
    expect(state.hasUnpublishedChanges).toBe(true);
  });

  it('lets exactly one of two concurrent saves from the same revision through', async () => {
    await saveLearnDraft(page('base'), 0, ACTOR);
    const results = await Promise.allSettled([
      saveLearnDraft(page('a'), 1, 'a@kgc.test'),
      saveLearnDraft(page('b'), 1, 'b@kgc.test'),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(LearnConflict);
    expect((failed[0].reason as LearnConflict).currentRevision).toBe(2);

    const winner = (ok[0] as PromiseFulfilledResult<LearnPageDoc>).value;
    const after = await stored();
    expect(after?.revision).toBe(2);
    expect(after?.draft).toEqual(winner.draft);
    expect(after?.draftUpdatedBy).toBe(winner.draftUpdatedBy);
  });
});

describe('publishing', () => {
  it('copies the draft to published and records a version with its note', async () => {
    await saveLearnDraft(page(1), 0, ACTOR);
    const before = Date.now();
    const { doc, versionId } = await publishLearnPage({ baseRevision: 1, actor: 'pub@kgc.test', note: '  First  ' });
    expect(doc.published).toEqual(page(1));

    const after = await stored();
    expect(after?.published).toEqual(page(1));
    expect(after?.draft).toEqual(page(1));
    expect(after?.publishedBy).toBe('pub@kgc.test');
    expect(after?.publishedAt).toBeGreaterThanOrEqual(before);
    // Publishing without content does not bump the revision.
    expect(after?.revision).toBe(1);

    const version = (await versionsRef().doc(versionId).get()).data() as LearnPageVersion;
    expect(version.content).toEqual(page(1));
    expect(version.note).toBe('First');
    expect(version.publishedBy).toBe('pub@kgc.test');
    expect(version.publishedAt).toBe(after?.publishedAt);

    const state = await loadLearnEditor();
    expect(state.versions).toEqual([
      { id: versionId, publishedAt: after?.publishedAt, publishedBy: 'pub@kgc.test', note: 'First' },
    ]);
    expect(state.hasUnpublishedChanges).toBe(false);
  });

  it('saves and publishes in one step when given content', async () => {
    await saveLearnDraft(page(1), 0, ACTOR);
    const { versionId } = await publishLearnPage({ baseRevision: 1, content: page(2), actor: ACTOR });
    const after = await stored();
    expect(after?.revision).toBe(2);
    expect(after?.draft).toEqual(page(2));
    expect(after?.published).toEqual(page(2));
    const version = (await versionsRef().doc(versionId).get()).data() as LearnPageVersion;
    expect(version.content).toEqual(page(2));
    expect(version).not.toHaveProperty('note');
  });

  it('publishes content onto an empty store from revision 0', async () => {
    await publishLearnPage({ baseRevision: 0, content: page(1), actor: ACTOR });
    const after = await stored();
    expect(after?.revision).toBe(1);
    expect(after?.published).toEqual(page(1));
  });

  it('refuses a stale revision and writes no version, with or without content', async () => {
    await saveLearnDraft(page(1), 0, ACTOR);
    await saveLearnDraft(page(2), 1, ACTOR);

    const plain = await publishLearnPage({ baseRevision: 1, actor: ACTOR }).catch((e: unknown) => e);
    expect(plain).toBeInstanceOf(LearnConflict);
    expect((plain as LearnConflict).currentRevision).toBe(2);

    const withContent = await publishLearnPage({ baseRevision: 1, content: page(3), actor: ACTOR }).catch(
      (e: unknown) => e,
    );
    expect(withContent).toBeInstanceOf(LearnConflict);

    expect(await versionCount()).toBe(0);
    const after = await stored();
    expect(after?.published).toBeNull();
    expect(after?.draft).toEqual(page(2));
    expect(after?.revision).toBe(2);
  });

  it(`keeps only the newest ${LEARN_VERSIONS_KEPT} versions`, async () => {
    const ids: string[] = [];
    let revision = 0;
    for (let i = 0; i < LEARN_VERSIONS_KEPT + 2; i++) {
      const { doc, versionId } = await publishLearnPage({ baseRevision: revision, content: page(i), actor: ACTOR });
      revision = doc.revision;
      ids.push(versionId);
    }
    expect(await versionCount()).toBe(LEARN_VERSIONS_KEPT);
    const remaining = new Set((await versionsRef().select().get()).docs.map((d) => d.id));
    expect(remaining.has(ids[0])).toBe(false);
    expect(remaining.has(ids[1])).toBe(false);
    for (const id of ids.slice(2)) expect(remaining.has(id)).toBe(true);

    const state = await loadLearnEditor();
    expect(state.versions).toHaveLength(LEARN_VERSIONS_KEPT);
    expect(state.versions[0].id).toBe(ids[ids.length - 1]);
  }, 180_000);
});

describe('revert', () => {
  it('puts the published copy back into the draft', async () => {
    await publishLearnPage({ baseRevision: 0, content: page('live'), actor: ACTOR });
    await saveLearnDraft(page('scratch'), 1, ACTOR);
    const doc = await revertLearnDraft('reverter@kgc.test');
    expect(doc.revision).toBe(3);
    const after = await stored();
    expect(after?.draft).toEqual(page('live'));
    expect(after?.published).toEqual(page('live'));
    expect(after?.revision).toBe(3);
    expect(after?.draftUpdatedBy).toBe('reverter@kgc.test');
  });

  it('falls back to the default page when nothing is published', async () => {
    await saveLearnDraft(page('scratch'), 0, ACTOR);
    const doc = await revertLearnDraft(ACTOR);
    expect(doc.revision).toBe(2);
    const after = await stored();
    expect(after?.draft).toEqual(LEARN_PAGE_DEFAULT);
    expect(after?.published).toBeNull();
  });

  it('leaves exactly the contract fields on the stored doc', async () => {
    await publishLearnPage({ baseRevision: 0, content: page('live'), actor: ACTOR, note: 'n' });
    await saveLearnDraft(page('scratch'), 1, ACTOR);
    await revertLearnDraft(ACTOR);
    const after = await stored();
    expect(Object.keys(after ?? {}).sort()).toEqual(
      ['draft', 'draftUpdatedAt', 'draftUpdatedBy', 'published', 'publishedAt', 'publishedBy', 'revision'].sort(),
    );
    for (const v of Object.values(after ?? {})) expect(v).not.toBeUndefined();
  });
});

describe('restoring a version', () => {
  it('copies the version into the draft and leaves published alone', async () => {
    const { versionId: v1 } = await publishLearnPage({ baseRevision: 0, content: page('one'), actor: ACTOR });
    await publishLearnPage({ baseRevision: 1, content: page('two'), actor: ACTOR });
    const doc = await restoreLearnVersion(v1, 'restorer@kgc.test');
    expect(doc.revision).toBe(3);
    const after = await stored();
    expect(after?.draft).toEqual(page('one'));
    expect(after?.published).toEqual(page('two'));
    expect(after?.draftUpdatedBy).toBe('restorer@kgc.test');
    expect(await versionCount()).toBe(2);
  });

  it('refuses an unknown or malformed id', async () => {
    await publishLearnPage({ baseRevision: 0, content: page('one'), actor: ACTOR });
    await expect(restoreLearnVersion('doesNotExist123', ACTOR)).rejects.toBeInstanceOf(LearnVersionMissing);
    await expect(restoreLearnVersion('../x', ACTOR)).rejects.toBeInstanceOf(LearnVersionMissing);
    await expect(restoreLearnVersion('', ACTOR)).rejects.toBeInstanceOf(LearnVersionMissing);
    expect((await stored())?.revision).toBe(1);
  });
});

describe('image uploads', () => {
  async function jpeg(width: number, height: number, orientation?: number): Promise<Buffer> {
    let img = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg();
    if (orientation) img = img.withMetadata({ orientation });
    return img.toBuffer();
  }

  function file(bytes: Buffer | string, name: string, type: string): File {
    return new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], name, { type });
  }

  async function fetchStored(src: string): Promise<{ type: string | null; bytes: Buffer }> {
    const res = await fetch(src);
    expect(res.status).toBe(200);
    return { type: res.headers.get('content-type'), bytes: Buffer.from(await res.arrayBuffer()) };
  }

  it('resizes a wide JPEG to a 2400 px WebP', async () => {
    const out = await uploadLearnImage(file(await jpeg(3000, 1000), 'wide.jpg', 'image/jpeg'));
    expect(out.resized).toBe(true);
    expect(out.path).toMatch(/^pageLayouts\/learn\/[0-9a-f-]+\.webp$/);
    expect(out.image).toMatchObject({ width: 2400, height: 800, alt: '' });
    expect(isAllowedLearnImageSrc(out.image.src, { allowEmulator: true })).toBe(true);

    const got = await fetchStored(out.image.src);
    expect(got.type).toBe('image/webp');
    expect(got.bytes.length).toBe(out.bytes);
    const meta = await sharp(got.bytes).metadata();
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([2400, 800]);
    expect(meta.exif).toBeUndefined();
  });

  it('rotates by EXIF and reports the displayed size, without resizing a portrait under 2400 px', async () => {
    // 3000x1500 stored, orientation 6: displayed 1500x3000, under the width cap.
    const out = await uploadLearnImage(file(await jpeg(3000, 1500, 6), 'phone.jpg', 'image/jpeg'));
    expect(out.resized).toBe(false);
    expect(out.path).toMatch(/\.jpg$/);
    expect([out.image.width, out.image.height]).toEqual([1500, 3000]);

    const got = await fetchStored(out.image.src);
    expect(got.type).toBe('image/jpeg');
    const meta = await sharp(got.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([1500, 3000]);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it('rotates by EXIF before resizing a rotated photo wider than 2400 px', async () => {
    // 1500x4000 stored, orientation 6: displayed 4000x1500, so resized to 2400x900.
    const out = await uploadLearnImage(file(await jpeg(1500, 4000, 6), 'pano.jpg', 'image/jpeg'));
    expect(out.resized).toBe(true);
    expect([out.image.width, out.image.height]).toEqual([2400, 900]);
    const meta = await sharp((await fetchStored(out.image.src)).bytes).metadata();
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([2400, 900]);
    expect(meta.exif).toBeUndefined();
  });

  it('keeps a small PNG as a PNG', async () => {
    const png = await sharp({ create: { width: 1200, height: 800, channels: 4, background: '#123456' } })
      .png()
      .toBuffer();
    const out = await uploadLearnImage(file(png, 'small.png', 'image/png'));
    expect(out.resized).toBe(false);
    expect(out.path).toMatch(/\.png$/);
    expect([out.image.width, out.image.height]).toEqual([1200, 800]);
    const got = await fetchStored(out.image.src);
    expect(got.type).toBe('image/png');
    expect((await sharp(got.bytes).metadata()).format).toBe('png');
  });

  it('stores a GIF as it is', async () => {
    const gif = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#00ff00' } })
      .gif()
      .toBuffer();
    const out = await uploadLearnImage(file(gif, 'anim.gif', 'image/gif'));
    expect(out.resized).toBe(false);
    expect(out.path).toMatch(/\.gif$/);
    expect([out.image.width, out.image.height]).toEqual([64, 32]);
    const got = await fetchStored(out.image.src);
    expect(got.type).toBe('image/gif');
    expect(got.bytes.equals(gif)).toBe(true);
  });

  it('refuses SVG, text, an empty file and anything over 10 MB', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>';
    await expect(uploadLearnImage(file(svg, 'x.svg', 'image/svg+xml'))).rejects.toBeInstanceOf(UploadRejected);
    await expect(uploadLearnImage(file('just some words', 'x.png', 'image/png'))).rejects.toBeInstanceOf(
      UploadRejected,
    );
    await expect(uploadLearnImage(file('', 'x.png', 'image/png'))).rejects.toBeInstanceOf(UploadRejected);
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0xff);
    await expect(uploadLearnImage(file(big, 'big.jpg', 'image/jpeg'))).rejects.toBeInstanceOf(UploadRejected);
  });
});

describe('clearing a setting (AGENTS gotcha 9, T313)', () => {
  it('replaces the draft whole, so a setting sent as an absent key is gone after reload', async () => {
    const withAlign = page('aligned');
    const block = withAlign.sections[0].blocks[0];
    block.align = 'center';
    block.spaceAbove = 'large';
    await saveLearnDraft(withAlign, 0, ACTOR);
    expect((await stored())?.draft.sections[0].blocks[0]).toMatchObject({ align: 'center', spaceAbove: 'large' });

    // The editor strips `undefined` keys before sending, so "back to default" arrives as no key at all.
    const cleared = structuredClone(withAlign);
    delete cleared.sections[0].blocks[0].align;
    delete cleared.sections[0].blocks[0].spaceAbove;
    await saveLearnDraft(cleared, 1, ACTOR);

    const reloaded = (await loadLearnEditor()).doc.draft.sections[0].blocks[0];
    expect(reloaded).not.toHaveProperty('align');
    expect(reloaded).not.toHaveProperty('spaceAbove');
    expect(reloaded).toEqual(cleared.sections[0].blocks[0]);
  });
});
