import { describe, expect, it } from 'vitest';
import { LEARN_PAGE_DEFAULT, type LearnPageContent, type LearnSection, type PageImage } from '@kgc/shared';
import {
  MEDIA_LIMITS,
  allTags,
  cleanName,
  cleanTags,
  contentImages,
  dedupeMediaRows,
  imageUseMap,
  inUseMessage,
  isRowId,
  learnImageObjectPath,
  mediaIdForPath,
  mediaSources,
  parseMediaRow,
  queryMedia,
  savedSectionUses,
  uploadName,
  versionLabel,
  type MediaRow,
} from './learn-media-core';

const ID = '0f8e2c1a-1111-4222-8333-444455556666';
const url = (id = ID, token = 'tok') =>
  `https://firebasestorage.googleapis.com/v0/b/kgc.firebasestorage.app/o/${encodeURIComponent(`pageLayouts/learn/${id}.webp`)}?alt=media&token=${token}`;
const img = (src: string): PageImage => ({ src, alt: '', width: 10, height: 10 });

const section = (blocks: LearnSection['blocks'], extra: Partial<LearnSection> = {}): LearnSection => ({
  id: 's',
  label: 'Team',
  background: 'plain',
  width: 'normal',
  paddingTop: 'none',
  paddingBottom: 'none',
  blocks,
  ...extra,
});

describe('object paths and ids', () => {
  it('reads the object path from a token URL, emulator or live', () => {
    expect(learnImageObjectPath(url())).toBe(`pageLayouts/learn/${ID}.webp`);
    expect(learnImageObjectPath(`http://127.0.0.1:9187/v0/b/demo/o/pageLayouts%2Flearn%2Fx.png?alt=media&token=t`)).toBe(
      'pageLayouts/learn/x.png',
    );
  });

  it('refuses site assets, other folders and traversal', () => {
    expect(learnImageObjectPath('/kgc/learn-wordmark.png')).toBeNull();
    expect(learnImageObjectPath(url().replace('pageLayouts%2Flearn', 'speakers'))).toBeNull();
    expect(learnImageObjectPath(`https://x/v0/b/b/o/${encodeURIComponent('pageLayouts/learn/../speakers/a.png')}`)).toBeNull();
    expect(learnImageObjectPath('not a url')).toBeNull();
  });

  it('turns an upload path into a row id', () => {
    expect(mediaIdForPath(`pageLayouts/learn/${ID}.webp`)).toBe(ID);
    expect(mediaIdForPath('pageLayouts/learn/versions/x.webp')).toBeNull();
    expect(mediaIdForPath('pageLayouts/learn/a b.png')).toBeNull();
    expect(isRowId(ID)).toBe(true);
    expect(isRowId('../x')).toBe(false);
    expect(isRowId(5)).toBe(false);
  });

  it('refuses ids Firestore reserves, such as __proto__ (U5)', () => {
    expect(isRowId('__proto__')).toBe(false);
    expect(isRowId('__name__')).toBe(false);
    expect(isRowId('__x__')).toBe(false);
    expect(isRowId('constructor')).toBe(true);
    expect(isRowId('__half')).toBe(true);
  });
});

describe('where an image is used', () => {
  const page: LearnPageContent = {
    seoTitle: 'T',
    seoDescription: '',
    ogImage: img(url('og')),
    sections: [
      section(
        [
          { id: 'i', kind: 'image', image: img(url()), width: 'full', shape: 'original' },
          { id: 'p', kind: 'people', style: 'cards', columns: 3, people: [{ id: 'm', name: 'Maru', role: '', photo: img(url()) }] },
          { id: 'g', kind: 'gallery', layout: 'grid', columns: 3, lightbox: true, images: [{ ...img(url('g1')), id: 'g1' }] },
          { id: 'l', kind: 'logos', grayscale: true, items: [{ ...img(url('l1')), id: 'l1' }] },
          { id: 'q', kind: 'quote', text: 'x', style: 'plain', photo: img(url('q')) },
          { id: 'c', kind: 'cards', columns: 2, items: [{ id: 'c1', title: 't', text: 'x', image: img(url('c1')) }] },
          { id: 'it', kind: 'imageText', image: img(url('it')), imageSide: 'left', imageWidth: 'half', shape: 'rounded', text: 'x' },
          { id: 'co', kind: 'columns', columns: 2, items: [{ id: 'co1', text: 'x', image: img(url('co1')) }] },
        ],
        { backgroundImage: img(url('bg')) },
      ),
    ],
  };

  it('finds every image slot in the contract', () => {
    const paths = contentImages(page).map((x) => learnImageObjectPath(x.image.src)?.split('/').pop());
    expect(paths).toEqual(['og.webp', 'bg.webp', `${ID}.webp`, `${ID}.webp`, 'g1.webp', 'l1.webp', 'q.webp', 'c1.webp', 'it.webp', 'co1.webp']);
    expect(contentImages(null)).toEqual([]);
  });

  it('names each place across the draft, live page, versions and saved sections', () => {
    const map = imageUseMap(
      mediaSources({
        draft: page,
        published: LEARN_PAGE_DEFAULT,
        versions: [{ id: 'v1', publishedAt: Date.UTC(2026, 9, 20, 14, 5), content: page }],
        library: [{ id: 'lib', item: { name: 'Hero', section: section([{ id: 'i', kind: 'image', image: img(url(ID, 'other-token')), width: 'full', shape: 'original' }]), createdAt: 0, createdBy: '' } }],
      }),
    );
    expect(map.get(`pageLayouts/learn/${ID}.webp`)).toEqual([
      'Draft: Team, image',
      'Draft: Team, photo of Maru',
      'Old version from Oct 20, 2026: Team, image',
      'Old version from Oct 20, 2026: Team, photo of Maru',
      'Saved section "Hero": image',
    ]);
    expect(map.get('pageLayouts/learn/bg.webp')).toEqual(['Draft: Team, background image', 'Old version from Oct 20, 2026: Team, background image']);
    expect(map.get('pageLayouts/learn/c1.webp')?.[0]).toBe('Draft: Team, card 1');
    // The default page uses only /kgc/ assets, which are not in the library.
    expect([...map.values()].flat().some((w) => w.startsWith('Live page'))).toBe(false);
  });

  it('names a section with no label by its place, in plain words (D13)', () => {
    const p: LearnPageContent = {
      ...page,
      ogImage: undefined,
      sections: [section([], { label: '' }), section([{ id: 'i', kind: 'image', image: img(url()), width: 'full', shape: 'original' }], { label: '' })],
    };
    expect(contentImages(p).map((x) => x.where)).toEqual(['Section 2, image']);
    expect(versionLabel(Date.UTC(2026, 9, 22, 5, 43))).toBe('Old version from Oct 22, 2026');
    expect(versionLabel('x')).toBe('Old version');
  });

  it('reads a page, version or saved section of the wrong shape without throwing', () => {
    const bad = [
      { sections: 'nope' },
      { sections: [null, 5, { blocks: 'x' }, { blocks: [null, { kind: 'people', people: 'x' }, { kind: 'gallery', images: [null] }, { kind: 'image', image: { src: 5 } }] }] },
    ] as unknown as LearnPageContent[];
    for (const c of bad) expect(contentImages(c)).toEqual([]);
    expect(() =>
      imageUseMap(
        mediaSources({
          versions: [{ id: 'v', publishedAt: NaN, content: null as unknown as LearnPageContent }],
          library: [{ id: 'l', item: { name: 5, section: null } as unknown as never }],
        }),
      ),
    ).not.toThrow();
  });

  it('names where a saved section is used, in the same words', () => {
    const p = { sections: [{ label: 'Programmes', blocks: [{ kind: 'reusable', libraryId: 'lib1' }, { kind: 'reusable', libraryId: 'x' }] }, { blocks: [{ kind: 'reusable', libraryId: 'lib1' }] }] };
    expect(savedSectionUses(p, 'lib1')).toEqual(['Programmes, saved section', 'Section 2, saved section']);
    expect(savedSectionUses({ sections: 7 }, 'lib1')).toEqual([]);
    expect(savedSectionUses(null, 'lib1')).toEqual([]);
  });

  it('writes a refusal that lists five places and counts the rest', () => {
    const msg = inUseMessage('"a.png"', ['1', '2', '3', '4', '5', '6', '7']);
    expect(msg).toBe('"a.png" is still used, so it was not deleted. Remove it from these places first: 1; 2; 3; 4; 5; and 2 more.');
    expect(msg).not.toMatch(/\u2014/);
  });
});

describe('names, tags and search', () => {
  it('cleans names and refuses empty or over-long ones', () => {
    expect(cleanName('  Team\nphoto\t2027 ', 80)).toBe('Team photo 2027');
    expect(cleanName('   ', 80)).toBeNull();
    expect(cleanName('x'.repeat(81), 80)).toBeNull();
    expect(cleanName(5, 80)).toBeNull();
    expect(uploadName('C:\\Users\\me\\IMG_0001.JPG')).toBe('IMG_0001.JPG');
    expect(uploadName('')).toBe('image');
    expect(uploadName('x'.repeat(500)).length).toBe(MEDIA_LIMITS.fileName);
  });

  it('normalises tags and refuses bad ones rather than dropping them', () => {
    expect(cleanTags([' Team ', 'team', 'Hero  Shot', '', 'café'])).toEqual(['team', 'hero shot', 'café']);
    expect(cleanTags(['<b>'])).toBeNull();
    expect(cleanTags(['x'.repeat(33)])).toBeNull();
    expect(cleanTags(Array.from({ length: 13 }, (_, i) => `t${i}`))).toBeNull();
    expect(cleanTags('team')).toBeNull();
    expect(cleanTags([])).toEqual([]);
  });

  const rows: MediaRow[] = [
    { id: 'a', fileName: 'Team photo.jpg', bytes: 300, uploadedAt: 1, uploadedBy: '', image: img('a'), tags: ['team'] },
    { id: 'b', fileName: 'hero.png', bytes: 100, uploadedAt: 3, uploadedBy: '', image: { ...img('b'), alt: 'Bryant Park at dusk' } },
    { id: 'c', fileName: 'Équipe 10.webp', bytes: 200, uploadedAt: 2, uploadedBy: '', image: img('c'), tags: ['team', 'paris'] },
    { id: 'd', fileName: 'Équipe 9.webp', bytes: 200, uploadedAt: 2, uploadedBy: '', image: img('d') },
  ];

  it('searches name, alt and tags, ignoring case and accents, every word must match', () => {
    expect(queryMedia(rows, { search: 'TEAM' }).map((r) => r.id)).toEqual(['c', 'a']);
    expect(queryMedia(rows, { search: 'bryant dusk' }).map((r) => r.id)).toEqual(['b']);
    expect(queryMedia(rows, { search: 'equipe' }).map((r) => r.id)).toEqual(['d', 'c']);
    expect(queryMedia(rows, { search: 'team nope' })).toEqual([]);
  });

  it('filters by tag and sorts five ways, newest by default', () => {
    expect(queryMedia(rows, { tag: 'Team' }).map((r) => r.id)).toEqual(['c', 'a']);
    expect(queryMedia(rows).map((r) => r.id)).toEqual(['b', 'd', 'c', 'a']);
    expect(queryMedia(rows, { sort: 'oldest' }).map((r) => r.id)).toEqual(['a', 'd', 'c', 'b']);
    expect(queryMedia(rows, { sort: 'name' }).map((r) => r.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(queryMedia(rows, { sort: 'largest' }).map((r) => r.id)).toEqual(['a', 'd', 'c', 'b']);
    expect(queryMedia(rows, { sort: 'smallest' }).map((r) => r.id)).toEqual(['b', 'd', 'c', 'a']);
    expect(queryMedia(rows, { sort: 'bogus' as never }).map((r) => r.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('lists every tag once, alphabetically', () => {
    expect(allTags(rows)).toEqual(['paris', 'team']);
  });
});

describe('stored rows of the wrong shape', () => {
  const good = { image: { src: url(), alt: 'a', width: 40, height: 30 }, fileName: 'a.jpg', bytes: 5, uploadedAt: 2, uploadedBy: 'u' };

  it('keeps a good row as it is', () => {
    expect(parseMediaRow('a', good)).toEqual({ ok: true, row: { id: 'a', ...good } });
  });

  it('refuses a row with no usable image, so the caller can skip it', () => {
    for (const bad of [null, 5, {}, { image: null }, { image: { src: 5, width: 1, height: 1 } }, { image: { src: '', width: 1, height: 1 } }, { image: { src: url() } }, { image: { src: url(), width: 0, height: 4 } }]) {
      expect(parseMediaRow('x', bad).ok).toBe(false);
    }
  });

  it('fills in a missing name, size, date or tags rather than dropping the image', () => {
    const r = parseMediaRow('x', { image: { src: url(), width: 4, height: 3 }, fileName: 7, bytes: 'big', tags: ['a', 5] });
    expect(r).toEqual({
      ok: true,
      row: { id: 'x', image: { src: url(), alt: '', width: 4, height: 3 }, fileName: `${ID}.webp`, bytes: 0, uploadedAt: 0, uploadedBy: '', tags: ['a'] },
    });
  });

  it('sorts and searches parsed rows whatever was stored', () => {
    const rows = [good, { image: { src: url('b'), width: 4, height: 3 } }, { image: { src: 'x', width: 4, height: 3 }, fileName: '' }].flatMap((d, i) => {
      const p = parseMediaRow(`r${i}`, d);
      return p.ok ? [p.row] : [];
    });
    for (const sort of ['newest', 'oldest', 'name', 'largest', 'smallest'] as const) {
      expect(() => queryMedia(rows, { sort, search: 'a', tag: 't' })).not.toThrow();
      expect(queryMedia(rows, { sort })).toHaveLength(3);
    }
  });

  it('keeps an edited copy\'s link to its original only when it is well formed', () => {
    const editedFrom = { image: { src: url('o'), width: 100, height: 50 }, crop: { x: 0, y: 0, width: 0.5, height: 1 }, rotate: 90, flipX: false, flipY: true };
    const r = parseMediaRow('c', { ...good, editedFrom });
    expect(r.ok && r.row.editedFrom).toEqual(editedFrom);
    const bad = parseMediaRow('c', { ...good, editedFrom: { ...editedFrom, crop: { x: 0.8, y: 0, width: 0.5, height: 1 } } });
    expect(bad.ok && bad.row.editedFrom).toBeUndefined();
  });
});

describe('one row per stored file (M3)', () => {
  const r = (id: string, file: string, uploadedAt: number): MediaRow => ({ id, fileName: id, bytes: 1, uploadedAt, uploadedBy: '', image: img(url(file)) });

  it('keeps the row named after the file, then the older one', () => {
    const rows = [r('auto1', ID, 1), r(ID, ID, 9), r('other', 'zz', 3), r('dupe', 'zz', 2)];
    const out = dedupeMediaRows(rows);
    expect(out.rows.map((x) => x.id)).toEqual([ID, 'dupe']);
    expect(out.duplicates.map((x) => x.id).sort()).toEqual(['auto1', 'other']);
  });

  it('never merges rows that are not stored files', () => {
    const a = { ...r('a', ID, 1), image: img('/kgc/a.png') };
    const b = { ...r('b', ID, 1), image: img('/kgc/a.png') };
    expect(dedupeMediaRows([a, b]).rows).toHaveLength(2);
  });
});
