/**
 * The Learn page's media library, saved sections and the role gate on every
 * editor action (T315), against the Firestore and Storage emulators.
 *
 * Run with: npm run test:learn-page
 *
 * ── How the role gate is exercised ───────────────────────────────────────────
 *
 * In the dashboard, `requireOrganizer()` refuses a server action unless a
 * screen the caller may open imports it (`canRunAction`, from Next's action
 * manifest). Next's manifest does not exist under Vitest, so `@/lib/auth` is
 * replaced by the same decision made from the real `team-core.ts` with the one
 * bundle that imports these files (`learn-page-gate.test.ts` pins that no other
 * screen does). What this proves is that every action asks the gate before it
 * reads or writes anything: as an agenda-only member, each one is refused and
 * nothing changes.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const who = vi.hoisted(() => ({ roles: ['owner'] as string[], email: 'editor@kgc.test' }));

vi.mock('@/lib/auth', async () => {
  const { canRunAction } = await import('../../apps/organizer/src/lib/team-core');
  return {
    requireOrganizer: async () => {
      if (!canRunAction(who.roles as never, ['app/(dash)/content/learn-page/page'])) throw new Error('NEXT_REDIRECT');
      return who.email;
    },
  };
});
vi.mock('../../apps/organizer/node_modules/next/cache.js', () => ({ revalidatePath: () => {} }));

import {
  COLLECTIONS,
  LEARN_PAGE_DEFAULT,
  LEARN_PAGE_LIBRARY,
  LEARN_PAGE_MEDIA,
  type LearnBlock,
  type LearnLibraryItem,
  type LearnMediaItem,
  type LearnPageContent,
  type LearnPageDoc,
  type LearnSection,
  type PageImage,
} from '@kgc/shared';
import { db } from '@/lib/firestore';
import { loadLearnEditor, publishLearnPage, saveLearnDraft, uploadLearnImage } from '@/lib/learn-page';
import { storageBucketName } from '@/lib/uploads';
import * as pageActions from '@/app/(dash)/content/learn-page/actions';
import * as mediaActions from '@/app/(dash)/content/learn-page/media-actions';
import * as versionActions from '@/app/(dash)/content/learn-page/version-actions';

const organizerRequire = createRequire(path.resolve(import.meta.dirname, '../../apps/organizer/package.json'));
const sharp = organizerRequire('sharp') as typeof import('sharp');
// The dashboard's own firebase-admin, whose default app `db()` initialises (AGENTS.md gotcha 8).
const { getStorage } = organizerRequire('firebase-admin/storage') as typeof import('firebase-admin/storage');

const docRef = () => db().collection(COLLECTIONS.pageLayouts).doc('learn');
// `db()` initialises the Admin app that Storage hangs off.
const bucket = () => (db(), getStorage().bucket(storageBucketName()));

async function pngFile(name = 'Team photo.png', w = 40, h = 30): Promise<File> {
  const bytes = await sharp({ create: { width: w, height: h, channels: 3, background: '#336699' } }).png().toBuffer();
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

async function upload(name?: string): Promise<{ image: PageImage; mediaId: string }> {
  const fd = new FormData();
  fd.set('file', await pngFile(name));
  const r = await pageActions.uploadLearnImageAction(fd);
  if (!r.ok || !r.mediaId) throw new Error(`upload failed: ${JSON.stringify(r)}`);
  return { image: r.image, mediaId: r.mediaId };
}

const imageBlock = (id: string, image: PageImage): LearnBlock => ({ id, kind: 'image', image, width: 'full', shape: 'original' });

function sectionOf(id: string, blocks: LearnBlock[], extra: Partial<LearnSection> = {}): LearnSection {
  return { id, label: id, background: 'plain', width: 'normal', paddingTop: 'medium', paddingBottom: 'medium', blocks, ...extra };
}

function pageWith(...extra: LearnSection[]): LearnPageContent {
  const p = structuredClone(LEARN_PAGE_DEFAULT);
  p.sections.push(...extra);
  return p;
}

async function revision(): Promise<number> {
  return ((await docRef().get()).data() as LearnPageDoc | undefined)?.revision ?? 0;
}

async function snapshotCounts(): Promise<string> {
  const [page, versions, media, library, audit] = await Promise.all([
    docRef().get(),
    docRef().collection('versions').count().get(),
    db().collection(LEARN_PAGE_MEDIA).count().get(),
    db().collection(LEARN_PAGE_LIBRARY).count().get(),
    db().collection(COLLECTIONS.auditLog).count().get(),
  ]);
  const [files] = await bucket().getFiles({ prefix: 'pageLayouts/learn/' });
  return JSON.stringify({
    page: page.exists ? (page.data() as LearnPageDoc).revision : null,
    versions: versions.data().count,
    media: media.data().count,
    library: library.data().count,
    audit: audit.data().count,
    files: files.length,
  });
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    throw new Error('Run with: npm run test:learn-page');
  }
});

beforeEach(async () => {
  who.roles = ['owner'];
  await db().recursiveDelete(docRef());
  const [files] = await bucket().getFiles({ prefix: 'pageLayouts/learn/' });
  await Promise.all(files.map((f) => f.delete()));
});

describe('media library', () => {
  it('writes a row on upload, and lists, searches, tags and sorts', async () => {
    const a = await upload('Team photo.png');
    const b = await upload('hero.png');
    const row = (await db().collection(LEARN_PAGE_MEDIA).doc(a.mediaId).get()).data() as LearnMediaItem;
    expect(row).toMatchObject({ fileName: 'Team photo.png', uploadedBy: who.email, image: a.image });
    expect(row.bytes).toBeGreaterThan(0);

    const tagged = await mediaActions.updateLearnMediaAction(a.mediaId, { tags: ['Team', 'people'], fileName: 'Founders', alt: 'The founders' });
    expect(tagged).toMatchObject({ ok: true, item: { fileName: 'Founders', tags: ['team', 'people'], image: { alt: 'The founders' } } });

    const all = await mediaActions.listLearnMediaAction({ sort: 'name' });
    if (!all.ok) throw new Error(all.error);
    expect(all.media.items.map((i) => i.fileName)).toEqual(['Founders', 'hero.png']);
    expect(all.media.tags).toEqual(['people', 'team']);
    expect(all.media.items.every((i) => i.uses.length === 0)).toBe(true);

    const found = await mediaActions.listLearnMediaAction({ search: 'founders' });
    expect(found.ok && found.media.items.map((i) => i.id)).toEqual([a.mediaId]);
    const byTag = await mediaActions.listLearnMediaAction({ tag: 'team' });
    expect(byTag.ok && byTag.media.items.map((i) => i.id)).toEqual([a.mediaId]);
    expect(b.mediaId).not.toBe(a.mediaId);
  });

  it('clears tags for real, and refuses a bad name or tag', async () => {
    const a = await upload();
    await mediaActions.updateLearnMediaAction(a.mediaId, { tags: ['x'] });
    await mediaActions.updateLearnMediaAction(a.mediaId, { tags: [] });
    const row = (await db().collection(LEARN_PAGE_MEDIA).doc(a.mediaId).get()).data() as LearnMediaItem;
    expect(row.tags).toBeUndefined();
    expect(await mediaActions.updateLearnMediaAction(a.mediaId, { fileName: '  ' })).toMatchObject({ ok: false });
    expect(await mediaActions.updateLearnMediaAction(a.mediaId, { tags: ['<script>'] })).toMatchObject({ ok: false });
    expect(await mediaActions.updateLearnMediaAction('nope', { fileName: 'x' })).toMatchObject({
      ok: false,
      error: 'That image is not in the library any more.',
    });
  });

  it('refuses to delete an image used in the draft, the live page, a kept version or a saved section, and says where', async () => {
    const a = await upload();
    // In the draft, then published (live + version), then removed from the draft.
    await saveLearnDraft(pageWith(sectionOf('pics', [imageBlock('pic', a.image)])), 0, who.email);
    const where = await mediaActions.learnMediaUsesAction(a.mediaId);
    expect(where).toEqual({ ok: true, uses: ['Draft: section 5 "pics", block 1 (image)'] });

    await publishLearnPage({ baseRevision: 1, actor: who.email });
    await saveLearnDraft(pageWith(), 1, who.email);
    const refused = await mediaActions.deleteLearnMediaAction(a.mediaId);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toMatch(/is still used, so it was not deleted/);
      expect(refused.error).toMatch(/Live page: section 5 "pics", block 1 \(image\)/);
      expect(refused.error).toMatch(/Version of .* UTC: section 5/);
    }

    // Only a kept version left: still refused (Restore could bring it back).
    await db().runTransaction(async (tx) => {
      const d = (await tx.get(docRef())).data() as LearnPageDoc;
      tx.set(docRef(), { ...d, published: d.draft });
    });
    const versionOnly = await mediaActions.learnMediaUsesAction(a.mediaId);
    expect(versionOnly.ok && versionOnly.uses.length).toBe(1);

    // And a saved section holding it.
    await db().recursiveDelete(docRef().collection('versions'));
    const saved = await mediaActions.saveLearnLibraryItemAction({ name: 'Pics', section: sectionOf('lib', [imageBlock('pic', a.image)]) });
    expect(saved.ok).toBe(true);
    const libOnly = await mediaActions.learnMediaUsesAction(a.mediaId);
    expect(libOnly).toEqual({ ok: true, uses: ['Saved section "Pics": section, block 1 (image)'] });
    expect((await mediaActions.deleteLearnMediaAction(a.mediaId)).ok).toBe(false);
  });

  it('deletes an unused image: the file, the row, and an audit entry', async () => {
    const a = await upload();
    const filePath = decodeURIComponent(new URL(a.image.src).pathname.split('/o/')[1]);
    expect((await bucket().file(filePath).exists())[0]).toBe(true);
    expect(await mediaActions.deleteLearnMediaAction(a.mediaId)).toEqual({ ok: true });
    expect((await bucket().file(filePath).exists())[0]).toBe(false);
    expect((await db().collection(LEARN_PAGE_MEDIA).doc(a.mediaId).get()).exists).toBe(false);
    const audit = await db().collection(COLLECTIONS.auditLog).where('action', '==', 'learnMedia.remove').where('targetId', '==', a.mediaId).get();
    expect(audit.size).toBe(1);
  });

  it('backfills rows for images uploaded before the library, keeping their URLs, and only once', async () => {
    const old = await uploadLearnImage(await pngFile('old.png', 50, 20));
    const [noToken] = await bucket().upload(path.resolve(import.meta.dirname, '../../apps/web/public/kgc/learn-wordmark.png'), {
      destination: 'pageLayouts/learn/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png',
    });
    await bucket().file('pageLayouts/learn/not-an-image.txt').save('hello');

    // The first list of an empty library backfills by itself.
    const listed = await mediaActions.listLearnMediaAction();
    if (!listed.ok) throw new Error(listed.error);
    expect(listed.media.backfilled).toBe(2);
    const oldRow = listed.media.items.find((i) => i.image.src === old.image.src);
    expect(oldRow).toMatchObject({ image: { width: 50, height: 20 }, uploadedBy: '' });
    const fresh = listed.media.items.find((i) => i.id === 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(fresh?.image.src).toMatch(/token=/);
    expect(fresh?.image.width).toBeGreaterThan(0);
    expect((await noToken.getMetadata())[0].metadata?.firebaseStorageDownloadTokens).toBeTruthy();

    const again = await mediaActions.backfillLearnMediaAction();
    expect(again).toEqual({ ok: true, added: 0, skipped: 3 });
  });
});

describe('saved sections', () => {
  const cta = () =>
    sectionOf('cta', [{ id: 'cta-text', kind: 'text', text: 'Apply now' }], { background: 'blue', width: 'wide', label: 'CTA' });

  it('saves, lists, renames, replaces and deletes', async () => {
    const saved = await mediaActions.saveLearnLibraryItemAction({ name: ' Call to action ', section: cta() });
    if (!saved.ok) throw new Error(saved.error);
    const list = await mediaActions.listLearnLibraryAction();
    expect(list.ok && list.items.map((i) => [i.name, i.createdBy, i.uses])).toEqual([['Call to action', who.email, []]]);

    expect(await mediaActions.renameLearnLibraryItemAction(saved.id, 'Apply')).toEqual({ ok: true, name: 'Apply' });
    const replaced = await mediaActions.saveLearnLibraryItemAction({
      name: 'Apply',
      replaceId: saved.id,
      section: sectionOf('cta', [{ id: 'x', kind: 'divider' }]),
    });
    expect(replaced).toEqual({ ok: true, id: saved.id });
    const stored = (await db().collection(LEARN_PAGE_LIBRARY).doc(saved.id).get()).data() as LearnLibraryItem;
    expect(stored.section.blocks).toEqual([{ id: 'x', kind: 'divider' }]);

    expect(await mediaActions.deleteLearnLibraryItemAction(saved.id)).toEqual({ ok: true });
    expect((await db().collection(LEARN_PAGE_LIBRARY).doc(saved.id).get()).exists).toBe(false);
  });

  it('refuses a section holding a reusable block, an empty name and an invalid section', async () => {
    const nested = await mediaActions.saveLearnLibraryItemAction({
      name: 'Nested',
      section: sectionOf('n', [{ id: 'r', kind: 'reusable', libraryId: 'abc' }]),
    });
    expect(nested.ok).toBe(false);
    expect((await mediaActions.saveLearnLibraryItemAction({ name: '', section: cta() })).ok).toBe(false);
    expect((await mediaActions.saveLearnLibraryItemAction({ name: 'Bad', section: { id: 'x' } })).ok).toBe(false);
    expect((await mediaActions.renameLearnLibraryItemAction('missing', 'x')).ok).toBe(false);
  });

  it('refuses a draft pointing at a saved section that does not exist', async () => {
    const r = await pageActions.saveLearnDraftAction(pageWith(sectionOf('s', [{ id: 'r', kind: 'reusable', libraryId: 'gone' }])), 0);
    expect(r.ok).toBe(false);
    expect(await revision()).toBe(0);
  });

  it('expands reusable blocks into the live copy and the kept version, and refuses deleting one in use', async () => {
    const saved = await mediaActions.saveLearnLibraryItemAction({ name: 'CTA', section: cta() });
    if (!saved.ok) throw new Error(saved.error);
    const draft = pageWith(sectionOf('host', [{ id: 'r', kind: 'reusable', libraryId: saved.id }]));
    const s = await pageActions.saveLearnDraftAction(draft, 0);
    expect(s).toMatchObject({ ok: true, revision: 1 });

    const p = await pageActions.publishLearnPageAction({ baseRevision: 1 });
    if (!p.ok) throw new Error(p.error);
    const doc = (await docRef().get()).data() as LearnPageDoc;
    const host = doc.published!.sections.at(-1)!;
    expect(host).toMatchObject({ id: 'host', label: 'host', background: 'blue', width: 'wide', blocks: [{ id: 'r--cta-text', kind: 'text', text: 'Apply now' }] });
    expect(JSON.stringify(doc.published)).not.toContain('"reusable"');
    expect(doc.draft.sections.at(-1)!.blocks[0]).toEqual({ id: 'r', kind: 'reusable', libraryId: saved.id });
    const version = (await docRef().collection('versions').doc(p.versionId).get()).data()!;
    expect(version.content).toEqual(doc.published);

    // A reusable block is not an unpublished change; editing its saved section is.
    expect((await loadLearnEditor()).hasUnpublishedChanges).toBe(false);
    await mediaActions.saveLearnLibraryItemAction({ name: 'CTA', replaceId: saved.id, section: sectionOf('cta', [{ id: 'd', kind: 'divider' }]) });
    expect((await loadLearnEditor()).hasUnpublishedChanges).toBe(true);

    const refused = await mediaActions.deleteLearnLibraryItemAction(saved.id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/Draft: section 5 "host", block 1/);
  });
});

describe('role gate on every Learn page action', () => {
  /** Arguments that would make each action do real work if the gate let it through. */
  async function argsFor(name: string): Promise<unknown[]> {
    switch (name) {
      case 'saveLearnDraftAction':
        return [pageWith(), 0];
      case 'publishLearnPageAction':
        return [{ baseRevision: 0, content: pageWith() }];
      case 'restoreLearnVersionAction':
      case 'loadLearnVersionAction':
      case 'learnMediaUsesAction':
      case 'deleteLearnMediaAction':
      case 'deleteLearnLibraryItemAction':
        return ['abc'];
      case 'uploadLearnImageAction': {
        const fd = new FormData();
        fd.set('file', await pngFile());
        return [fd];
      }
      case 'updateLearnMediaAction':
        return ['abc', { fileName: 'x' }];
      case 'saveLearnLibraryItemAction':
        return [{ name: 'X', section: sectionOf('s', [{ id: 'd', kind: 'divider' }]) }];
      case 'renameLearnLibraryItemAction':
        return ['abc', 'Y'];
      default:
        return [];
    }
  }

  const actions = Object.entries({ ...pageActions, ...versionActions, ...mediaActions }).filter(
    ([, fn]) => typeof fn === 'function',
  ) as [string, (...a: unknown[]) => Promise<unknown>][];

  it('covers every exported action of the three action files', () => {
    expect(actions.map(([n]) => n).sort()).toEqual(
      [
        'backfillLearnMediaAction',
        'deleteLearnLibraryItemAction',
        'deleteLearnMediaAction',
        'learnMediaUsesAction',
        'listLearnLibraryAction',
        'listLearnMediaAction',
        'loadLearnEditorAction',
        'loadLearnVersionAction',
        'publishLearnPageAction',
        'renameLearnLibraryItemAction',
        'restoreLearnVersionAction',
        'revertLearnDraftAction',
        'saveLearnDraftAction',
        'saveLearnLibraryItemAction',
        'updateLearnMediaAction',
        'uploadLearnImageAction',
      ].sort(),
    );
  });

  it.each([['agenda'], ['sponsors'], ['checkin'], ['finance'], ['reviews']])('refuses an %s-only member on each, and nothing changes', async (role) => {
    await upload();
    const before = await snapshotCounts();
    who.roles = [role];
    for (const [name, fn] of actions) {
      await expect(fn(...(await argsFor(name))), name).rejects.toThrow('NEXT_REDIRECT');
    }
    expect(await snapshotCounts()).toBe(before);
  });

  it('lets a learn member and an owner through on each', async () => {
    for (const roles of [['learn'], ['owner'], ['agenda', 'learn']]) {
      who.roles = roles;
      for (const [name, fn] of actions) {
        await expect(fn(...(await argsFor(name))), `${roles} ${name}`).resolves.toBeDefined();
      }
    }
  });
});
