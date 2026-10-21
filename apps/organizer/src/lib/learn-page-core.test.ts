import { describe, expect, it } from 'vitest';
import type { LearnPageContent, LearnPageDoc } from '@kgc/shared';

import {
  LEARN_LIMITS,
  LEARN_PAGE_DEFAULT,
  LearnConflict,
  effectiveDoc,
  fitWidth,
  hasUnpublishedChanges,
  isAllowedLearnImageSrc,
  planPublish,
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
    expect(reverted.draft).toBe(content);
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
