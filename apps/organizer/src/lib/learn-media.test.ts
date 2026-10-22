import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEARN_PAGE_MEDIA } from '@kgc/shared';

/**
 * `learn-media.ts` against an in-memory Firestore and bucket (T325): a media
 * row of the wrong shape costs only itself, Rescan never adds a second row for
 * an edited copy, a delete leaves no row pointing at a missing file, and
 * "Edit image" on a copy finds the original.
 */

type Data = Record<string, unknown>;
const store = new Map<string, Data>();
const files = new Map<string, { size: number; token: string }>();
let autoId = 0;

function snap(path: string) {
  const data = store.get(path);
  return { id: path.split('/').pop()!, exists: data !== undefined, data: () => (data === undefined ? undefined : structuredClone(data)) };
}

function docRef(path: string) {
  return {
    id: path.split('/').pop()!,
    path,
    get: async () => snap(path),
    set: async (d: Data) => void store.set(path, structuredClone(d)),
    create: async (d: Data) => {
      if (store.has(path)) throw Object.assign(new Error('exists'), { code: 6 });
      store.set(path, structuredClone(d));
    },
    delete: async () => void store.delete(path),
    collection: (name: string) => colRef(`${path}/${name}`),
  };
}

function colRef(path: string) {
  const children = () =>
    [...store.keys()].filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(snap);
  const query = (filter: (d: ReturnType<typeof snap>) => boolean, n = Infinity) => ({
    limit: (m: number) => query(filter, m),
    get: async () => {
      const docs = children().filter(filter).slice(0, n);
      return { docs, empty: docs.length === 0 };
    },
  });
  const all = query(() => true);
  return {
    ...all,
    select: () => all,
    doc: (id?: string) => docRef(`${path}/${id ?? `auto${++autoId}`}`),
    where: (field: string, _op: string, value: unknown) =>
      query((d) => field.split('.').reduce<unknown>((o, k) => (o as Data | undefined)?.[k], d.data()) === value),
  };
}

const fakeDb = {
  collection: colRef,
  doc: docRef,
  batch: () => {
    const ops: (() => void)[] = [];
    return {
      delete: (ref: { path: string }) => void ops.push(() => store.delete(ref.path)),
      commit: async () => ops.forEach((op) => op()),
    };
  },
  runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>) =>
    fn({
      get: (ref: { get: () => Promise<unknown> }) => ref.get(),
      set: (ref: { path: string }, d: Data) => void store.set(ref.path, structuredClone(d)),
    }),
};

vi.mock('./firestore', () => ({ db: () => fakeDb }));
vi.mock('./uploads', () => ({ storageBucketName: () => 'kgc.test' }));
vi.mock('./learn-page', () => ({
  learnImageUrl: (path: string, token: string) =>
    `https://firebasestorage.googleapis.com/v0/b/kgc.test/o/${encodeURIComponent(path)}?alt=media&token=${token}`,
  learnValidateOptions: () => ({}),
  // Reads the "image" as 40 by 30.
  loadSharp: async () => () => ({ metadata: async () => ({ width: 40, height: 30 }) }),
}));
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      getFiles: async ({ prefix }: { prefix: string }) => [
        [...files.keys()]
          .filter((name) => name.startsWith(prefix))
          .map((name) => ({
            name,
            getMetadata: async () => [{ size: files.get(name)!.size, timeCreated: '2026-10-01T00:00:00Z', metadata: { firebaseStorageDownloadTokens: files.get(name)!.token } }],
            setMetadata: async () => undefined,
            download: async () => [Buffer.from('img')],
          })),
      ],
      file: (name: string) => ({
        delete: async () => {
          if (!files.delete(name)) throw Object.assign(new Error('gone'), { code: 404 });
        },
        exists: async () => [files.has(name)],
      }),
    }),
  }),
}));

const {
  backfillLearnMedia,
  deleteLearnMedia,
  learnImageEditStart,
  learnMediaUses,
  listLearnLibrary,
  listLearnMedia,
  updateLearnMedia,
  LearnMediaRefused,
} = await import('./learn-media');

const ORIG = '11111111-1111-4111-8111-111111111111';
const COPY = '22222222-2222-4222-8222-222222222222';
const path = (id: string, ext = 'jpg') => `pageLayouts/learn/${id}.${ext}`;
const url = (id: string, ext = 'jpg', token = 't') =>
  `https://firebasestorage.googleapis.com/v0/b/kgc.test/o/${encodeURIComponent(path(id, ext))}?alt=media&token=${token}`;
const row = (id: string, extra: Data = {}): Data => ({
  image: { src: url(id), alt: '', width: 40, height: 30 },
  fileName: `${id.slice(0, 4)}.jpg`,
  bytes: 10,
  uploadedAt: 1,
  uploadedBy: 'u',
  ...extra,
});
const media = (id: string) => `${LEARN_PAGE_MEDIA}/${id}`;

beforeEach(() => {
  store.clear();
  files.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('a media row of the wrong shape', () => {
  it('is skipped and logged, and the rest of the library still lists', async () => {
    store.set(media(ORIG), row(ORIG));
    store.set(media('empty'), {});
    store.set(media('nullimage'), { image: null, fileName: 'x' });
    store.set(media('numbersrc'), { image: { src: 5, alt: '', width: 1, height: 1 }, fileName: 'x' });
    store.set(media('noname'), { image: { src: url(COPY), alt: '', width: 40, height: 30 } });
    for (const sort of ['newest', 'oldest', 'name', 'largest', 'smallest'] as const) {
      const out = await listLearnMedia({ sort, search: 'x' });
      expect(out.total).toBe(2);
    }
    const out = await listLearnMedia({ sort: 'name' });
    expect(out.items.map((r) => r.id).sort()).toEqual(['noname', ORIG].sort());
    // A missing name falls back to the stored file's name.
    expect(out.items.find((r) => r.id === 'noname')?.fileName).toBe(`${COPY}.jpg`);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('/empty'));
  });

  it('is refused cleanly by where-used, update and delete', async () => {
    store.set(media('empty'), {});
    await expect(learnMediaUses('empty')).rejects.toBeInstanceOf(LearnMediaRefused);
    await expect(updateLearnMedia('empty', { fileName: 'a' })).rejects.toBeInstanceOf(LearnMediaRefused);
    await expect(deleteLearnMedia('empty')).rejects.toBeInstanceOf(LearnMediaRefused);
  });

  it('does not break where-used when a kept version or the page is the wrong shape', async () => {
    store.set(media(ORIG), row(ORIG));
    store.set('pageLayouts/learn', { draft: { sections: 'nope' }, published: null });
    store.set('pageLayouts/learn/versions/v1', { publishedAt: 'x', content: { sections: [{ blocks: [null, { kind: 'image' }] }] } });
    store.set('pageLayouts/learn/versions/v2', {
      publishedAt: Date.UTC(2026, 9, 22, 5, 43),
      content: { sections: [{ label: 'Programmes', blocks: [{ kind: 'image', image: { src: url(ORIG) } }] }] },
    });
    store.set('pageLayouts/learn/library/bad', { name: 5 });
    expect(await learnMediaUses(ORIG)).toEqual(['Old version from Oct 22, 2026: Programmes, image']);
    expect(await listLearnLibrary()).toEqual([]);
  });

  it('refuses a reserved id such as __proto__ before reading anything', async () => {
    await expect(learnMediaUses('__proto__')).rejects.toBeInstanceOf(LearnMediaRefused);
    await expect(deleteLearnMedia('__name__')).rejects.toBeInstanceOf(LearnMediaRefused);
  });
});

describe('Rescan and edited copies (M3)', () => {
  it('skips a file an older edited copy row (auto id) already points at', async () => {
    files.set(path(ORIG), { size: 10, token: 't' });
    files.set(path(COPY), { size: 10, token: 't' });
    store.set(media(ORIG), row(ORIG));
    store.set(media('autoid'), row(COPY));
    expect(await backfillLearnMedia()).toEqual({ added: 0, skipped: 2 });
    expect([...store.keys()].filter((k) => k.startsWith(LEARN_PAGE_MEDIA)).length).toBe(2);
  });

  it('lists one row per file and deletes every row for the file', async () => {
    files.set(path(COPY), { size: 10, token: 't' });
    store.set(media('autoid'), row(COPY, { uploadedAt: 5 }));
    store.set(media(COPY), row(COPY, { uploadedAt: 9 }));
    const out = await listLearnMedia();
    expect(out.items.map((r) => r.id)).toEqual([COPY]);
    await deleteLearnMedia(COPY);
    expect(files.has(path(COPY))).toBe(false);
    expect(store.has(media('autoid'))).toBe(false);
    expect(store.has(media(COPY))).toBe(false);
  });
});

describe('editing a copy starts from the original (D8)', () => {
  const editedFrom = {
    image: { src: url(ORIG), width: 1599, height: 899 },
    crop: { x: 0.1, y: 0, width: 0.5, height: 1 },
    rotate: 0,
    flipX: false,
    flipY: false,
  };

  it('returns the original and the settings that made the copy', async () => {
    store.set(media(ORIG), row(ORIG, { image: { src: url(ORIG, 'jpg', 'fresh'), alt: 'a', width: 1599, height: 899 } }));
    store.set(media(COPY), row(COPY, { editedFrom }));
    expect(await learnImageEditStart(url(COPY, 'jpg', 'any-token'))).toEqual({
      image: { src: url(ORIG, 'jpg', 'fresh'), alt: '', width: 1599, height: 899 },
      state: { crop: editedFrom.crop, rotate: 0, flipX: false, flipY: false },
    });
  });

  it('uses the stored file when the original has no row, and gives up when it is gone', async () => {
    store.set(media(COPY), row(COPY, { editedFrom }));
    files.set(path(ORIG), { size: 10, token: 't' });
    expect((await learnImageEditStart(url(COPY)))?.image.src).toBe(url(ORIG));
    files.clear();
    expect(await learnImageEditStart(url(COPY))).toBeNull();
  });

  it('is null for an image that is not an edited copy, or a bad link', async () => {
    store.set(media(ORIG), row(ORIG));
    expect(await learnImageEditStart(url(ORIG))).toBeNull();
    expect(await learnImageEditStart('/kgc/logo.png')).toBeNull();
    expect(await learnImageEditStart(5)).toBeNull();
    store.set(media(COPY), row(COPY, { editedFrom: { ...editedFrom, rotate: 45 } }));
    expect(await learnImageEditStart(url(COPY))).toBeNull();
  });

  it('keeps the link when the copy is renamed', async () => {
    store.set(media(COPY), row(COPY, { editedFrom }));
    await updateLearnMedia(COPY, { fileName: 'Hero' });
    expect(store.get(media(COPY))?.editedFrom).toEqual(editedFrom);
  });
});
