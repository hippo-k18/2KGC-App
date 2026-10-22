import { describe, expect, it } from 'vitest';
import type { LearnPageContent, LearnPageDoc } from '@kgc/shared';

import {
  LEARN_LIMITS,
  LEARN_PAGE_DEFAULT,
  LearnConflict,
  LearnNotReady,
  effectiveDoc,
  fitWidth,
  hasUnpublishedChanges,
  isAllowedLearnImageSrc,
  isEmptyLearnImage,
  isLearnVersionId,
  planPublish,
  publishBlockers,
  readStoredDoc,
  planReplaceDraft,
  planSave,
  revertTarget,
  sameContent,
  validateLearnContent,
  versionsToPrune,
} from './learn-page-core';

const TOKEN_URL =
  'https://firebasestorage.googleapis.com/v0/b/kgc.firebasestorage.app/o/pageLayouts%2Flearn%2Fabc.webp?alt=media&token=t1';

function page(overrides: Partial<LearnPageContent> = {}): LearnPageContent {
  return {
    seoTitle: 'KGC | Learn',
    seoDescription: 'Courses',
    sections: [
      {
        id: 's1',
        label: 'Hero',
        background: 'plain',
        width: 'normal',
        paddingTop: 'large',
        paddingBottom: 'medium',
        blocks: [
          { id: 'b1', kind: 'heading', text: 'Learn', level: 1, size: 'x-large', align: 'center' },
          { id: 'b2', kind: 'text', text: 'Hello **world** [site](/tickets)' },
          {
            id: 'b3',
            kind: 'image',
            image: { src: TOKEN_URL, alt: 'A room', width: 2400, height: 1200, focusX: 0.5, focusY: 0.2 },
            width: 'full',
            shape: 'rounded',
            caption: 'Room',
            href: 'https://example.com',
          },
          { id: 'b4', kind: 'buttons', buttons: [{ label: 'Apply', href: 'mailto:a@b.c', style: 'primary' }] },
          {
            id: 'b5',
            kind: 'people',
            style: 'cards',
            columns: 4,
            people: [
              {
                id: 'p1',
                name: 'Ada',
                role: 'Teacher',
                photo: { src: '/kgc/team/ada.jpg', alt: 'Ada', width: 300, height: 300 },
                linkedin: 'https://www.linkedin.com/in/ada',
              },
            ],
          },
          {
            id: 'b6',
            kind: 'list',
            ordered: true,
            items: [{ id: 'i1', title: 'One', text: 'First', children: ['a', 'b'], link: { label: 'More', href: '/x', style: 'text' } }],
          },
          { id: 'b7', kind: 'columns', columns: 2, items: [{ id: 'c1', text: 'Left' }, { id: 'c2', text: 'Right', title: 'R' }] },
          { id: 'b8', kind: 'video', url: 'https://www.youtube.com/watch?v=abc', caption: 'Talk' },
          { id: 'b9', kind: 'divider' },
          { id: 'b10', kind: 'spacer', size: 'small', hidden: true },
        ],
      },
    ],
    ...overrides,
  };
}

function problemsOf(input: unknown): string[] {
  const r = validateLearnContent(input);
  return r.ok ? [] : r.problems;
}

describe('validateLearnContent', () => {
  it('accepts every block kind and returns an equal copy', () => {
    const r = validateLearnContent(page());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toEqual(page());
  });

  it('accepts the default page', () => {
    expect(validateLearnContent(LEARN_PAGE_DEFAULT).ok).toBe(true);
  });

  it('drops fields the contract does not name, at every level', () => {
    const input = page() as unknown as { sections: { blocks: Record<string, unknown>[] }[] } & Record<string, unknown>;
    input.evil = '<script>';
    input.sections[0].blocks[0].style = 'color:red';
    (input.sections[0] as Record<string, unknown>).css = 'x';
    const r = validateLearnContent(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).not.toHaveProperty('evil');
    expect(r.content.sections[0]).not.toHaveProperty('css');
    expect(r.content.sections[0].blocks[0]).not.toHaveProperty('style');
  });

  it('refuses unknown kinds and enum values it does not know', () => {
    const p = page();
    (p.sections[0].blocks as unknown[]).push({ id: 'z', kind: 'html', html: '<b>' });
    (p.sections[0] as { background: string }).background = 'red';
    const problems = problemsOf(p);
    expect(problems.some((x) => x.includes('unknown kind "html"'))).toBe(true);
    expect(problems.some((x) => x.startsWith('Section 1: Background must be one of'))).toBe(true);
  });

  it('refuses unsafe links in buttons, images, people and list items', () => {
    const p = page();
    const blocks = p.sections[0].blocks as Extract<LearnPageContent['sections'][0]['blocks'][0], object>[];
    (blocks[3] as { buttons: { href: string }[] }).buttons[0].href = 'javascript:alert(1)';
    (blocks[2] as { href?: string }).href = '//evil.example';
    (blocks[4] as { people: { linkedin?: string }[] }).people[0].linkedin = 'data:text/html,x';
    const problems = problemsOf(p);
    expect(problems).toHaveLength(3);
    expect(problems.every((x) => x.includes('is not a link the site can open'))).toBe(true);
  });

  it('refuses a video that is not https', () => {
    const p = page();
    (p.sections[0].blocks[7] as { url: string }).url = 'http://youtube.com/x';
    expect(problemsOf(p)).toEqual(['Section 1, block 8: Video link must start with https://.']);
  });

  it('refuses images from anywhere but this page’s uploads or /kgc/', () => {
    for (const src of [
      'https://evil.example/a.png',
      'https://firebasestorage.googleapis.com/v0/b/kgc/o/speakers%2Fa.png?alt=media&token=t',
      'https://firebasestorage.googleapis.com/v0/b/kgc/o/pageLayouts%2Flearn%2F..%2Fx.png?alt=media&token=t',
      'https://firebasestorage.googleapis.com/v0/b/kgc/o/pageLayouts%2Flearn%2Fa.png?alt=media',
      'http://localhost:9199/v0/b/kgc/o/pageLayouts%2Flearn%2Fa.png?alt=media&token=t',
      '/kgc/../secret',
      '/other/a.png',
      'javascript:alert(1)',
    ]) {
      expect(isAllowedLearnImageSrc(src), src).toBe(false);
    }
    expect(isAllowedLearnImageSrc(TOKEN_URL)).toBe(true);
    expect(isAllowedLearnImageSrc('/kgc/learn-wordmark.png')).toBe(true);
    expect(
      isAllowedLearnImageSrc('http://127.0.0.1:9187/v0/b/kgc/o/pageLayouts%2Flearn%2Fa.png?alt=media&token=t', {
        allowEmulator: true,
      }),
    ).toBe(true);
  });

  it('caps string lengths with a message that names the place', () => {
    const p = page();
    (p.sections[0].blocks[0] as { text: string }).text = 'x'.repeat(LEARN_LIMITS.heading + 1);
    expect(problemsOf(p)).toEqual([
      `Section 1, block 1: Heading is ${LEARN_LIMITS.heading + 1} characters; the limit is ${LEARN_LIMITS.heading}.`,
    ]);
  });

  it('caps sections and blocks', () => {
    const many = page({
      sections: Array.from({ length: LEARN_LIMITS.sections + 1 }, (_, i) => ({
        ...page().sections[0],
        id: `s${i}`,
        blocks: [],
      })),
    });
    expect(problemsOf(many)).toContain(`has ${LEARN_LIMITS.sections + 1} sections; the limit is ${LEARN_LIMITS.sections}.`);

    const p = page();
    p.sections[0].blocks = Array.from({ length: LEARN_LIMITS.blocksPerSection + 1 }, (_, i) => ({
      id: `d${i}`,
      kind: 'divider' as const,
    }));
    expect(problemsOf(p)).toContain(
      `Section 1: has ${LEARN_LIMITS.blocksPerSection + 1} blocks; the limit is ${LEARN_LIMITS.blocksPerSection}.`,
    );
  });

  it('refuses duplicate and malformed ids', () => {
    const p = page();
    p.sections[0].blocks[1].id = 'b1';
    p.sections.push({ ...p.sections[0], id: 's1', blocks: [{ id: 'bad id!', kind: 'divider' }] });
    const problems = problemsOf(p);
    expect(problems).toContain('Section 1, block 2: uses the id "b1" twice.');
    expect(problems).toContain('Section 2: uses the id "s1" twice.');
    expect(problems).toContain('Section 2, block 1: has a missing or malformed id.');
  });

  it('refuses bad image sizes and focal points', () => {
    const p = page();
    const img = (p.sections[0].blocks[2] as unknown as { image: Record<string, unknown> }).image;
    img.width = 0;
    img.height = 1.5;
    img.focusX = 2;
    expect(problemsOf(p)).toHaveLength(3);
  });

  it('refuses something that is not a page at all', () => {
    expect(problemsOf(null)).toEqual(['The page content is missing or malformed.']);
    expect(problemsOf({ seoTitle: '', sections: 'x' })).toEqual([
      'sections must be a list.',
      'Search settings: Page title is empty.',
    ]);
  });
});

describe('the draft and publish cycle', () => {
  const content = page();

  it('starts from the default page at revision 0', () => {
    const d = effectiveDoc(null);
    expect(d).toMatchObject({ draft: LEARN_PAGE_DEFAULT, published: null, revision: 0 });
    expect(hasUnpublishedChanges(d, false)).toBe(false);
  });

  it('saves on the current revision and refuses a stale one', () => {
    const first = planSave(null, content, 0, 'a@x', 1);
    expect(first).toEqual({ draft: content, published: null, draftUpdatedAt: 1, draftUpdatedBy: 'a@x', revision: 1 });
    const second = planSave(first, content, 1, 'b@x', 2);
    expect(second.revision).toBe(2);
    expect(() => planSave(second, content, 1, 'c@x', 3)).toThrow(LearnConflict);
    try {
      planSave(second, content, 1, 'c@x', 3);
    } catch (e) {
      expect((e as LearnConflict).currentRevision).toBe(2);
    }
  });

  it('publishes the draft and records a version with a trimmed note', () => {
    const saved = planSave(null, content, 0, 'a@x', 1);
    const { doc, version } = planPublish(saved, 'b@x', 5, '  first  ');
    expect(doc.published).toBe(content);
    expect(doc).toMatchObject({ publishedAt: 5, publishedBy: 'b@x', revision: 1 });
    expect(version).toEqual({ content, publishedAt: 5, publishedBy: 'b@x', note: 'first' });
    expect(planPublish(saved, 'b@x', 5, '   ').version).not.toHaveProperty('note');
    expect(hasUnpublishedChanges(doc, true)).toBe(false);
  });

  it('reverts to published, or to the default page when nothing is published', () => {
    const saved = planSave(null, content, 0, 'a@x', 1);
    expect(revertTarget(saved)).toBe(LEARN_PAGE_DEFAULT);
    const { doc } = planPublish(saved, 'a@x', 2);
    const edited = planSave(doc, page({ seoTitle: 'Changed' }), 1, 'a@x', 3);
    expect(hasUnpublishedChanges(edited, true)).toBe(true);
    const reverted = planReplaceDraft(edited, revertTarget(edited), 'b@x', 4);
    // The validator's rebuilt copy (T320), equal to what was published.
    expect(reverted.draft).toEqual(content);
    expect(reverted.revision).toBe(3);
    expect(reverted.publishedAt).toBe(2);
  });

  it('never writes an undefined key', () => {
    const d = planSave(null, content, 0, 'a@x', 1);
    expect(Object.values(d).some((v) => v === undefined)).toBe(false);
    expect(Object.keys(d).sort()).toEqual(['draft', 'draftUpdatedAt', 'draftUpdatedBy', 'published', 'revision']);
  });

  it('keeps the newest 50 versions', () => {
    const ids = Array.from({ length: 53 }, (_, i) => ({ id: `v${i}` }));
    expect(versionsToPrune(ids)).toEqual(['v50', 'v51', 'v52']);
    expect(versionsToPrune(ids.slice(0, 50))).toEqual([]);
  });

  it('compares contents regardless of key order', () => {
    const a = page();
    const b = JSON.parse(JSON.stringify(a)) as LearnPageContent;
    const reordered = { sections: b.sections, seoDescription: b.seoDescription, seoTitle: b.seoTitle };
    expect(sameContent(a, reordered)).toBe(true);
    expect(sameContent(a, page({ seoTitle: 'x' }))).toBe(false);
    const doc: LearnPageDoc = { ...effectiveDoc(null), draft: a, published: reordered };
    expect(hasUnpublishedChanges(doc, true)).toBe(false);
  });
});

describe('fitWidth', () => {
  it('scales down past the limit and keeps the ratio', () => {
    expect(fitWidth(4800, 3200, 2400)).toEqual({ width: 2400, height: 1600 });
    expect(fitWidth(1200, 800, 2400)).toEqual({ width: 1200, height: 800 });
  });
});

// ─── T320: unfinished blocks, the bucket, unreadable stored content ──────────

const EMPTY = { src: '', alt: '', width: 0, height: 0 };

/** The page with an empty Image block and an empty Video block added to section 1. */
function unfinished(): LearnPageContent {
  const p = page();
  p.sections[0].blocks.push(
    { id: 'e1', kind: 'image', image: { ...EMPTY }, width: 'medium', shape: 'original', align: 'center' },
    { id: 'e2', kind: 'video', url: '', align: 'center' },
  );
  return p;
}

describe('validateLearnContent: blocks not filled in yet (T314 F1)', () => {
  it('accepts a new Image block and a new Video block and stores them as they are', () => {
    const r = validateLearnContent(unfinished());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const blocks = r.content.sections[0].blocks;
    expect(blocks.find((b) => b.id === 'e1')).toEqual({
      id: 'e1',
      kind: 'image',
      image: EMPTY,
      width: 'medium',
      shape: 'original',
      align: 'center',
    });
    expect(blocks.find((b) => b.id === 'e2')).toEqual({ id: 'e2', kind: 'video', url: '', align: 'center' });
  });

  it('accepts an empty image with alt text, and a whitespace-only video link as empty', () => {
    const p = unfinished();
    (p.sections[0].blocks[10] as { image: typeof EMPTY }).image = { ...EMPTY, alt: 'Still to come' };
    (p.sections[0].blocks[11] as { url: string }).url = '   ';
    const r = validateLearnContent(p);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.content.sections[0].blocks[10] as { image: unknown }).image).toEqual({ ...EMPTY, alt: 'Still to come' });
    expect((r.content.sections[0].blocks[11] as { url: string }).url).toBe('');
  });

  it('drops an empty optional image (a person photo, a column image) rather than storing it', () => {
    const p = page();
    (p.sections[0].blocks[4] as { people: { photo?: unknown }[] }).people[0].photo = { ...EMPTY };
    (p.sections[0].blocks[6] as { items: { image?: unknown }[] }).items[0].image = { ...EMPTY };
    const r = validateLearnContent(p);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.content.sections[0].blocks[4] as { people: object[] }).people[0]).not.toHaveProperty('photo');
    expect((r.content.sections[0].blocks[6] as { items: object[] }).items[0]).not.toHaveProperty('image');
  });

  it('still refuses a chosen image with a bad source or no size, and a bad video link', () => {
    const bad = (mutate: (p: LearnPageContent) => void) => {
      const p = unfinished();
      mutate(p);
      return problemsOf(p);
    };
    const img = (p: LearnPageContent) => p.sections[0].blocks[10] as unknown as { image: Record<string, unknown> };
    expect(bad((p) => (img(p).image = { ...EMPTY, src: 'https://evil.example/a.png', width: 10, height: 10 }))).toEqual([
      'Section 1, block 11: image must be uploaded here or be a /kgc/ site image.',
    ]);
    expect(bad((p) => (img(p).image = { ...EMPTY, src: '/kgc/a.png' }))).toEqual([
      'Section 1, block 11: image width must be a whole number of pixels.',
      'Section 1, block 11: image height must be a whole number of pixels.',
    ]);
    expect(bad((p) => (img(p).image = { alt: '', width: 0, height: 0 }))).toContain('Section 1, block 11: Image is missing.');
    expect(bad((p) => (img(p).image = { ...EMPTY, src: 42 }))).toContain('Section 1, block 11: Image must be text.');
    expect(bad((p) => ((p.sections[0].blocks[11] as { url: string }).url = 'javascript:alert(1)'))).toEqual([
      'Section 1, block 12: Video link must start with https://.',
    ]);
    expect(bad((p) => delete (p.sections[0].blocks[11] as { url?: string }).url)).toContain(
      'Section 1, block 12: Video link is missing.',
    );
  });

  it('treats only an image whose src is exactly empty as not chosen', () => {
    expect(isEmptyLearnImage(EMPTY)).toBe(true);
    expect(isEmptyLearnImage({ src: '', alt: 'x', width: 5, height: 5 })).toBe(true);
    expect(isEmptyLearnImage({ src: ' ', width: 0, height: 0 })).toBe(false);
    expect(isEmptyLearnImage({ width: 0, height: 0 })).toBe(false);
    expect(isEmptyLearnImage(null)).toBe(false);
  });
});

describe('publish refuses unfinished blocks (T314 F1)', () => {
  it('names each empty Image and Video block and its section', () => {
    expect(publishBlockers(unfinished())).toEqual([
      'The Image block in "Hero" has no image yet. Choose one or remove the block.',
      'The Video block in "Hero" has no video link yet. Add one or remove the block.',
    ]);
    expect(publishBlockers(page())).toEqual([]);
  });

  it('names an unlabelled section by its position', () => {
    const p = unfinished();
    p.sections[0].label = '  ';
    expect(publishBlockers(p)[0]).toBe('The Image block in "Section 1" has no image yet. Choose one or remove the block.');
  });

  it('planPublish throws LearnNotReady with those messages and plans nothing', () => {
    const doc: LearnPageDoc = { ...effectiveDoc(null), draft: unfinished(), revision: 3 };
    let err: unknown;
    try {
      planPublish(doc, 'a@x', 1);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LearnNotReady);
    expect((err as LearnNotReady).problems).toHaveLength(2);
    expect((err as LearnNotReady).message).toContain('The Image block in "Hero" has no image yet.');
    expect(() => planPublish({ ...doc, draft: page() }, 'a@x', 1)).not.toThrow();
  });
});

describe('isAllowedLearnImageSrc: the project bucket (T314 security 1)', () => {
  const at = (bucket: string) =>
    `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/pageLayouts%2Flearn%2Fa.png?alt=media&token=t`;

  it('accepts only the bucket it is given', () => {
    expect(isAllowedLearnImageSrc(at('kgc.firebasestorage.app'), { bucket: 'kgc.firebasestorage.app' })).toBe(true);
    expect(isAllowedLearnImageSrc(at('someone-else.appspot.com'), { bucket: 'kgc.firebasestorage.app' })).toBe(false);
    expect(isAllowedLearnImageSrc(at('kgc.firebasestorage.app.evil'), { bucket: 'kgc.firebasestorage.app' })).toBe(false);
    expect(isAllowedLearnImageSrc('/kgc/learn-wordmark.png', { bucket: 'kgc.firebasestorage.app' })).toBe(true);
  });

  it('applies the bucket through the validator, emulator URLs included', () => {
    const p = page();
    (p.sections[0].blocks[2] as { image: { src: string } }).image.src = at('other-bucket');
    expect(validateLearnContent(p, { bucket: 'kgc.firebasestorage.app' }).ok).toBe(false);
    expect(validateLearnContent(page(), { bucket: 'kgc.firebasestorage.app' }).ok).toBe(true);
    const emu = (b: string) => `http://127.0.0.1:9187/v0/b/${b}/o/pageLayouts%2Flearn%2Fa.png?alt=media&token=t`;
    expect(isAllowedLearnImageSrc(emu('demo.appspot.com'), { allowEmulator: true, bucket: 'demo.appspot.com' })).toBe(true);
    expect(isAllowedLearnImageSrc(emu('other'), { allowEmulator: true, bucket: 'demo.appspot.com' })).toBe(false);
  });
});

describe('version ids (T314 security 5)', () => {
  it('accepts Firestore auto ids and refuses everything odd', () => {
    expect(isLearnVersionId('Ab3dEf6hIj9kLm2nOp5q')).toBe(true);
    for (const v of ['', '__proto__', 'a/b', '../x', 'a b', 'x'.repeat(65), 'é', null, undefined, 42, {}, ['a']]) {
      expect(isLearnVersionId(v), String(v)).toBe(false);
    }
  });
});

describe('unreadable stored content (T314 security 4 and 5)', () => {
  it('reads a good stored doc as its validated copy', () => {
    const stored: LearnPageDoc = { ...effectiveDoc(null), draft: page(), published: page(), revision: 4, draftUpdatedAt: 9, draftUpdatedBy: 'a' };
    const r = readStoredDoc(stored);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc).toEqual(stored);
    expect(readStoredDoc(null)).toEqual({ ok: true, doc: effectiveDoc(null) });
  });

  it('refuses a wrong-shaped draft with the problems instead of throwing', () => {
    for (const draft of [null, 'x', { seoTitle: 'T', sections: 'nope' }, { seoTitle: 'T', sections: [{ id: 's', blocks: [{ kind: 'people', columns: 'url(//evil)' }] }] }]) {
      const r = readStoredDoc({ draft, published: null, revision: 1 });
      expect(r.ok, JSON.stringify(draft)).toBe(false);
      if (!r.ok) expect(r.problems.length).toBeGreaterThan(0);
    }
    expect(readStoredDoc('not a doc').ok).toBe(false);
  });

  it('keeps the editor open when only the published copy is unreadable', () => {
    const r = readStoredDoc({ draft: page(), published: { seoTitle: 7 }, revision: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.published).toEqual(LEARN_PAGE_DEFAULT);
  });

  it('counts a revision that is not a whole number as 0', () => {
    expect(effectiveDoc({ ...effectiveDoc(null), revision: 'x' as unknown as number }).revision).toBe(0);
    expect(effectiveDoc({ ...effectiveDoc(null), revision: -1 }).revision).toBe(0);
    expect(effectiveDoc({ ...effectiveDoc(null), revision: 5 }).revision).toBe(5);
  });

  it('reverts to the default page when the published copy is unreadable', () => {
    const doc = { ...effectiveDoc(null), published: { seoTitle: 'x', sections: 'nope' } as unknown as LearnPageContent };
    expect(revertTarget(doc)).toBe(LEARN_PAGE_DEFAULT);
    const good = { ...effectiveDoc(null), published: page() };
    expect(revertTarget(good)).toEqual(page());
    // Validated against the bucket too: an image from another bucket is not put back.
    expect(revertTarget(good, { bucket: 'other' })).toBe(LEARN_PAGE_DEFAULT);
  });
});
