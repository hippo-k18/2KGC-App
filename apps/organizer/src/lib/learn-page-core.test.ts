import { describe, expect, it } from 'vitest';
import type { LearnBlock, LearnPageContent, LearnPageDoc, LearnSection, RichDoc } from '@kgc/shared';

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
  isRefusedHref,
  isUnfinishedHref,
  planPublish,
  publishBlockers,
  publishProblems,
  readStoredDoc,
  planReplaceDraft,
  planSave,
  revertTarget,
  sameContent,
  validateLearnContent,
  validateLearnSection,
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

  it('saves a video link that is not https yet and refuses it at publish (T325)', () => {
    const p = page();
    (p.sections[0].blocks[7] as { url: string }).url = 'http://youtube.com/x';
    expect(problemsOf(p)).toEqual([]);
    expect(publishBlockers(p)).toEqual([
      'The Video block in "Hero" has a link that is not finished: "http://youtube.com/x". Use a YouTube or Vimeo link that starts with https://.',
    ]);
    (p.sections[0].blocks[7] as { url: string }).url = 'javascript:alert(1)';
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

  it('stores a string over its limit and refuses it at publish, however far over (T331, T343)', () => {
    const p = page();
    (p.sections[0].blocks[0] as { text: string }).text = 'x'.repeat(LEARN_LIMITS.heading + 1);
    expect(problemsOf(p)).toEqual([]);
    expect(publishBlockers(p)).toEqual([
      `The Heading block in "Hero" has a heading of ${LEARN_LIMITS.heading + 1} characters; the limit is ${LEARN_LIMITS.heading}.`,
    ]);
    // Far over it (a 2,470-character paste) is stored too: one long field never stops the page saving (T343).
    (p.sections[0].blocks[0] as { text: string }).text = 'x'.repeat(2470);
    expect(problemsOf(p)).toEqual([]);
    expect(publishBlockers(p)).toEqual([`The Heading block in "Hero" has a heading of 2470 characters; the limit is ${LEARN_LIMITS.heading}.`]);
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
    expect(problemsOf({ seoTitle: '', sections: 'x' })).toEqual(['sections must be a list.']);
  });
});

const IMG = { src: TOKEN_URL, alt: 'Pic', width: 800, height: 600 };
const YT_URL = 'https://youtu.be/dQw4w9WgXcQ';

function richText(text: string, marks?: unknown[]): RichDoc {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] }] } as RichDoc;
}

const TABLE_DOC: RichDoc = {
  type: 'doc',
  content: [
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Course' }] }] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Explorer' }] }] }] },
      ],
    },
  ],
};

/** Every v2 block kind and every v2 optional field, in two sections. */
function kitchenSink(): LearnPageContent {
  const blocks: LearnBlock[] = [
    {
      id: 'k1',
      kind: 'heading',
      level: 4,
      text: richText('Learn', [{ type: 'bold' }]),
      visibleOn: 'desktop',
      anchor: 'top',
      maxWidth: 'medium',
      boxed: true,
      textColor: '#1a2b3c',
      note: 'Check with Maru',
    },
    {
      id: 'k2',
      kind: 'text',
      text: {
        type: 'doc',
        content: [
          { type: 'paragraph', align: 'center', content: [{ type: 'text', text: 'Read ', marks: [{ type: 'link', href: '#top' }] }] },
          { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] },
        ],
      },
      visibleOn: 'all',
      textColor: 'navy',
    },
    {
      id: 'k3',
      kind: 'imageText',
      image: IMG,
      imageSide: 'right',
      imageWidth: 'third',
      shape: 'rounded',
      text: richText('Side by side'),
      buttons: [{ label: 'Go', href: '/tickets', style: 'primary' }],
    },
    {
      id: 'k4',
      kind: 'gallery',
      layout: 'masonry',
      columns: 3,
      images: [{ ...IMG, id: 'g1', caption: 'One' }, { ...IMG, id: 'g2', focusX: 0.3 }],
      lightbox: true,
    },
    { id: 'k5', kind: 'quote', text: richText('So good'), name: 'Ada', role: 'Student', photo: IMG, style: 'card' },
    { id: 'k6', kind: 'callout', tone: 'warning', title: 'Note', text: 'Plain *markdown* still works' },
    {
      id: 'k7',
      kind: 'accordion',
      items: [
        { id: 'a1', title: 'Q1', text: richText('A1'), open: true },
        { id: 'a2', title: 'Q2', text: 'A2' },
      ],
      allowMany: true,
    },
    { id: 'k8', kind: 'tabs', items: [{ id: 't1', title: 'Tab', text: richText('Body') }] },
    { id: 'k9', kind: 'stats', columns: 3, items: [{ id: 's1', value: '1,200', label: 'Learners' }] },
    {
      id: 'k10',
      kind: 'cards',
      columns: 2,
      items: [
        { id: 'c1', image: IMG, title: 'Explorer', text: richText('Online'), link: { label: 'More', href: '/x', style: 'text' }, badge: 'New' },
        { id: 'c2', title: 'Builder', text: 'Hybrid' },
      ],
    },
    { id: 'k11', kind: 'logos', grayscale: true, items: [{ ...IMG, id: 'l1', href: 'https://example.com' }, { ...IMG, id: 'l2' }] },
    { id: 'k12', kind: 'embed', provider: 'youtube', url: YT_URL, aspect: '16:9', height: 480, title: 'Intro video' },
    { id: 'k13', kind: 'countdown', until: Date.UTC(2027, 4, 1), label: 'Starts in', doneText: 'Live now' },
    { id: 'k14', kind: 'table', doc: TABLE_DOC, striped: true, caption: 'Courses' },
    { id: 'k15', kind: 'toc', title: 'On this page' },
    { id: 'k16', kind: 'reusable', libraryId: 'footer-cta' },
  ];
  return {
    seoTitle: 'KGC | Learn',
    seoDescription: 'Courses',
    ogImage: IMG,
    noindex: true,
    sections: [
      {
        id: 'sec1',
        label: 'Everything',
        background: 'plain',
        width: 'wide',
        paddingTop: 'large',
        paddingBottom: 'large',
        backgroundColor: '#ffeedd',
        backgroundImage: IMG,
        overlay: 0.8,
        anchor: 'everything',
        visibleOn: 'mobile',
        layout: 'two-wide-left',
        blockColumn: { k2: 1, k3: 0 },
        note: 'Main band',
        blocks,
      },
      {
        id: 'sec2',
        label: 'Three',
        background: 'blue',
        width: 'normal',
        paddingTop: 'none',
        paddingBottom: 'none',
        layout: 'three',
        blockColumn: { z1: 2 },
        blocks: [{ id: 'z1', kind: 'divider' }],
      },
    ],
  };
}

function sinkWith(edit: (p: LearnPageContent, blocks: LearnBlock[], s: LearnSection) => void): LearnPageContent {
  const p = kitchenSink();
  edit(p, p.sections[0].blocks, p.sections[0]);
  return p;
}

function block<K extends LearnBlock['kind']>(p: LearnPageContent, kind: K): Extract<LearnBlock, { kind: K }> {
  return p.sections[0].blocks.find((b) => b.kind === kind) as Extract<LearnBlock, { kind: K }>;
}

describe('validateLearnContent, v2 (T315)', () => {
  it('accepts every v2 block kind and field and returns an equal copy', () => {
    const r = validateLearnContent(kitchenSink());
    expect(r.ok ? [] : r.problems).toEqual([]);
    if (r.ok) expect(r.content).toEqual(kitchenSink());
  });

  it('keeps v1 pages valid, the default page included', () => {
    expect(validateLearnContent(LEARN_PAGE_DEFAULT).ok).toBe(true);
    const r = validateLearnContent(page());
    expect(r.ok && r.content).toEqual(page());
  });

  it('drops unknown fields on v2 blocks, items, sections and rich text', () => {
    const input = JSON.parse(JSON.stringify(kitchenSink())) as Record<string, unknown> & {
      sections: (Record<string, unknown> & { blocks: Record<string, unknown>[] })[];
    };
    input.script = 'x';
    input.sections[0].onclick = 'x';
    const embed = input.sections[0].blocks.find((b) => b.kind === 'embed')!;
    embed.srcdoc = '<script>';
    const acc = input.sections[0].blocks.find((b) => b.kind === 'accordion') as { items: Record<string, unknown>[] };
    acc.items[0].html = '<b>';
    const heading = input.sections[0].blocks[0] as { text: { content: Record<string, unknown>[] } };
    heading.text.content[0].style = 'color:red';
    const r = validateLearnContent(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toEqual(kitchenSink());
  });

  it('lowercases a hex colour and leaves absent fields absent', () => {
    const r = validateLearnContent(sinkWith((_, b) => ((b[0] as { textColor: string }).textColor = '#ABCDEF')));
    expect(r.ok && r.content.sections[0].blocks[0].textColor).toBe('#abcdef');
    if (!r.ok) return;
    expect(Object.keys(r.content.sections[1]).sort()).toEqual(
      ['background', 'blockColumn', 'blocks', 'id', 'label', 'layout', 'paddingBottom', 'paddingTop', 'width'].sort(),
    );
    expect(Object.values(r.content.sections[0].blocks[3]).some((v) => v === undefined)).toBe(false);
  });

  it('saves an embed link that is not an accepted form of its provider and refuses it at publish (T325)', () => {
    const bad: [string, string][] = [
      ['youtube', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'],
      ['youtube', 'https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ'],
      ['youtube', 'https://youtube.com@evil.example/watch?v=dQw4w9WgXcQ'],
      ['youtube', 'http://youtu.be/dQw4w9WgXcQ'],
      ['vimeo', YT_URL],
      ['google-maps', 'https://maps.app.goo.gl/AbC123'],
      ['google-forms', 'https://forms.gle/abc123'],
      ['google-docs', 'https://docs.google.com/document/d/abcdefghijklmnop/edit'],
      ['google-slides', 'https://docs.google.com/presentation/d/abcdefghijklmnop/edit'],
      ['calendly', 'https://calendly.com.evil.example/kgc'],
      ['typeform', 'https://typeform.com/to/abcd'],
      ['loom', 'https://www.loom.com/share/nothex'],
      ['spotify', 'https://open.spotify.com/user/abc'],
    ];
    for (const [provider, url] of bad) {
      const p = sinkWith((p) => Object.assign(block(p, 'embed'), { provider, url }));
      expect(problemsOf(p), `${provider} ${url}`).toEqual([]);
      expect(publishBlockers(p), `${provider} ${url}`).toEqual([
        expect.stringMatching(/^The Map, form or video block in "Everything" has a link that can't be shown\. ./),
      ]);
    }
    // A dangerous scheme is still refused at save.
    expect(problemsOf(sinkWith((p) => (block(p, 'embed').url = 'javascript:alert(1)')))).toEqual([
      'Section 1, block 12: Embed link is not a link the site can open.',
    ]);
  });

  it('saves a normal Google Maps link, and a short one with a plain message at publish (T324 D2)', () => {
    const place = 'https://www.google.com/maps/place/Bryant+Park/@40.75,-73.98,17z';
    const ok = sinkWith((p) => Object.assign(block(p, 'embed'), { provider: 'google-maps', url: place }));
    expect(problemsOf(ok)).toEqual([]);
    expect(publishBlockers(ok)).toEqual([]);
    const short = sinkWith((p) => Object.assign(block(p, 'embed'), { provider: 'google-maps', url: 'https://maps.app.goo.gl/AbC123' }));
    expect(problemsOf(short)).toEqual([]);
    expect(publishBlockers(short)).toEqual([
      'The Map, form or video block in "Everything" has a link that can\'t be shown. ' +
        "Short Google Maps links can't be shown. Open the link, then copy the address from the browser's address bar.",
    ]);
  });

  it('stores an accepted embed link as typed, trimmed, not rewritten', () => {
    const r = validateLearnContent(
      sinkWith((p) => Object.assign(block(p, 'embed'), { url: '  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ', provider: 'youtube' })),
    );
    expect(r.ok && block(r.content, 'embed').url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('refuses a bad embed provider or aspect, and a height that is not a whole number', () => {
    const problems = problemsOf(
      sinkWith((p) => Object.assign(block(p, 'embed'), { provider: 'iframe', aspect: '21:9', height: 'tall' })),
    );
    expect(problems.some((x) => x.includes('Embed type must be one of'))).toBe(true);
    expect(problems.some((x) => x.includes('Aspect must be one of'))).toBe(true);
    expect(problems.some((x) => x.includes('Embed height must be a whole number of pixels.'))).toBe(true);
  });

  it('saves an empty embed title and a height being typed, and refuses the height at publish (T324 E F6)', () => {
    const p = sinkWith((p) => Object.assign(block(p, 'embed'), { title: '', height: 6 }));
    const r = validateLearnContent(p);
    expect(r.ok ? [] : r.problems).toEqual([]);
    expect(r.ok && block(r.content, 'embed')).toMatchObject({ title: '', height: 6 });
    expect(publishBlockers(p)).toEqual([
      'The Map, form or video block in "Everything" is set to 6 pixels tall. Use a height from 100 to 2000.',
    ]);
    // A missing title is stored as empty, not refused.
    const missing = sinkWith((p) => delete (block(p, 'embed') as { title?: string }).title);
    expect(validateLearnContent(missing).ok && block((validateLearnContent(missing) as { content: LearnPageContent }).content, 'embed').title).toBe('');
  });

  it('refuses a countdown that is not a date at all', () => {
    for (const until of [1.5e12 + 0.5, '2027-05-01', 9e15, Number.NaN]) {
      const problems = problemsOf(sinkWith((p) => Object.assign(block(p, 'countdown'), { until })));
      expect(problems, String(until)).toEqual(['Section 1, block 13: Countdown date must be a real date between 2020 and 2099.']);
    }
  });

  it('saves a countdown date outside 2020 to 2099 (a year being typed) and refuses it at publish (T325)', () => {
    for (const until of [Date.UTC(2019, 11, 31), Date.UTC(2100, 0, 1), Date.UTC(2, 0, 1), 5]) {
      const p = sinkWith((p) => Object.assign(block(p, 'countdown'), { until }));
      expect(problemsOf(p), String(until)).toEqual([]);
      expect(publishBlockers(p), String(until)).toEqual([
        'The Countdown block in "Everything" has a date outside 2020 to 2099. Choose another date.',
      ]);
    }
  });

  it('refuses an overlay above 0.8', () => {
    expect(problemsOf(sinkWith((_, __, s) => (s.overlay = 0.9)))).toEqual(['Section 1: Overlay must be between 0 and 0.8.']);
    expect(problemsOf(sinkWith((_, __, s) => (s.overlay = -0.1)))).toHaveLength(1);
  });

  it('saves an anchor used twice across a section and a block, and refuses it at publish (T325)', () => {
    const p = sinkWith((_, b) => (b[1].anchor = 'everything'));
    expect(problemsOf(p)).toEqual([]);
    expect(publishBlockers(p)).toEqual(['The link name "everything" is used 2 times on the page. Each link name must be different.']);
    const s2 = sinkWith((p) => (p.sections[1].anchor = 'top'));
    expect(problemsOf(s2)).toEqual([]);
    expect(publishBlockers(s2)).toEqual(['The link name "top" is used 2 times on the page. Each link name must be different.']);
  });

  it('saves an anchor being typed and refuses it at publish; refuses one too long or not text (T325)', () => {
    for (const anchor of ['Top', 'a--b', '-a', 'our-', 'a b']) {
      const p = sinkWith((_, b) => (b[0].anchor = anchor));
      expect(problemsOf(p), anchor).toEqual([]);
      expect(publishBlockers(p), anchor).toEqual([
        `The link name "${anchor}" in "Everything" can only use lower-case letters, numbers and single dashes, like our-team.`,
      ]);
    }
    // Over its limit, however far, it is stored and refused at publish (T331, T343).
    const long = sinkWith((_, b) => (b[0].anchor = 'x'.repeat(65)));
    expect(problemsOf(long)).toEqual([]);
    expect(publishBlockers(long)).toEqual([`The link name "${'x'.repeat(57)}..." in "Everything" is 65 characters; the limit is 64.`]);
    expect(problemsOf(sinkWith((_, b) => (b[0].anchor = 'x'.repeat(1065))))).toEqual([]);
    expect(problemsOf(sinkWith((_, b) => ((b[0] as { anchor: unknown }).anchor = 5)))).toEqual(['Section 1, block 1: Anchor must be text.']);
  });

  it('drops block columns when the section goes back to one column, rather than refusing the save (T325)', () => {
    const r = validateLearnContent(sinkWith((_, __, s) => (s.layout = 'single')));
    expect(r.ok ? [] : r.problems).toEqual([]);
    expect(r.ok && r.content.sections[0]).not.toHaveProperty('blockColumn');
    const absent = validateLearnContent(sinkWith((_, __, s) => delete s.layout));
    expect(absent.ok && absent.content.sections[0]).not.toHaveProperty('blockColumn');
  });

  it('drops an empty block column map', () => {
    const r = validateLearnContent(
      sinkWith((_, __, s) => {
        s.layout = 'single';
        s.blockColumn = {};
      }),
    );
    expect(r.ok && r.content.sections[0]).not.toHaveProperty('blockColumn');
  });

  it('drops a block column naming a block not in the section', () => {
    const r = validateLearnContent(sinkWith((_, __, s) => (s.blockColumn = { z1: 1, k2: 1 })));
    expect(r.ok && r.content.sections[0].blockColumn).toEqual({ k2: 1 });
  });

  it('moves a column index past the layout into its last column; refuses one that is not a column number', () => {
    const r = validateLearnContent(sinkWith((_, __, s) => (s.blockColumn = { k2: 2 })));
    expect(r.ok && r.content.sections[0].blockColumn).toEqual({ k2: 1 });
    const three = validateLearnContent(sinkWith((p) => (p.sections[1].blockColumn = { z1: 3 })));
    expect(three.ok && three.content.sections[1].blockColumn).toEqual({ z1: 2 });
    expect(problemsOf(sinkWith((_, __, s) => (s.blockColumn = { k2: 0.5 })))).toHaveLength(1);
    expect(problemsOf(sinkWith((_, __, s) => (s.blockColumn = { k2: -1 })))).toHaveLength(1);
  });

  it('refuses a colour that is not a brand colour or #rrggbb', () => {
    expect(problemsOf(sinkWith((_, b) => ((b[0] as { textColor: string }).textColor = 'red')))).toEqual([
      'Section 1, block 1: Text colour must be a brand colour or #rrggbb.',
    ]);
    expect(problemsOf(sinkWith((_, __, s) => ((s as { backgroundColor: string }).backgroundColor = '#fff')))).toEqual([
      'Section 1: Background colour must be a brand colour or #rrggbb.',
    ]);
  });

  it('refuses a visibleOn it does not know, on blocks and sections', () => {
    const p = sinkWith((_, b, s) => {
      (b[0] as { visibleOn: string }).visibleOn = 'tablet';
      (s as { visibleOn: string }).visibleOn = 'print';
    });
    expect(problemsOf(p)).toEqual([
      'Section 1: Show on must be one of all, desktop, mobile.',
      'Section 1, block 1: Show on must be one of all, desktop, mobile.',
    ]);
  });

  it('refuses a javascript: link inside a rich text block', () => {
    const p = sinkWith((_, b) => {
      (b[1] as { text: RichDoc }).text = richText('click', [{ type: 'link', href: 'javascript:alert(1)' }]);
    });
    const problems = problemsOf(p);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^Section 1, block 2: .*link "javascript:alert\(1\)" the site cannot open\.$/);
  });

  it('refuses a list inside a heading block (inline only)', () => {
    const p = sinkWith((_, b) => {
      (b[0] as { text: RichDoc }).text = {
        type: 'doc',
        content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }],
      };
    });
    const problems = problemsOf(p);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^Section 1, block 1: .*cannot hold "bulletList"\.$/);
  });

  it('caps a rich text doc at the same length as the string: stored over it, however far, and named at publish (T331, T343)', () => {
    const p = sinkWith((_, b) => ((b[0] as { text: RichDoc }).text = richText('x'.repeat(LEARN_LIMITS.heading + 1))));
    expect(problemsOf(p)).toEqual([]);
    expect(publishBlockers(p)).toEqual([
      `The Heading block in "Everything" has a heading of ${LEARN_LIMITS.heading + 1} characters; the limit is ${LEARN_LIMITS.heading}.`,
    ]);
    const far = sinkWith((_, b) => ((b[0] as { text: RichDoc }).text = richText('x'.repeat(2470))));
    expect(problemsOf(far)).toEqual([]);
    expect(publishBlockers(far)).toEqual([
      `The Heading block in "Everything" has a heading of 2470 characters; the limit is ${LEARN_LIMITS.heading}.`,
    ]);
  });

  it('accepts a rich doc in a person bio and list and column items', () => {
    const p = page();
    const blocks = p.sections[0].blocks;
    (blocks[4] as Extract<LearnBlock, { kind: 'people' }>).people[0].bio = richText('Bio');
    (blocks[5] as Extract<LearnBlock, { kind: 'list' }>).items[0].text = richText('Item');
    (blocks[6] as Extract<LearnBlock, { kind: 'columns' }>).items[0].text = richText('Col');
    const r = validateLearnContent(p);
    expect(r.ok && r.content).toEqual(p);
  });

  it('saves a reusable block pointing at a saved section that is gone, and refuses it at publish (T324 E F7)', () => {
    expect(problemsOf(kitchenSink())).toEqual([]);
    const gone = new Map<string, LearnSection>([['other', kitchenSink().sections[1]]]);
    expect(publishBlockers(kitchenSink(), gone)).toEqual([
      'The Saved section block in "Everything" shows a saved section that was deleted. Remove the block or choose another saved section.',
    ]);
    // Without the library the check cannot know, and says nothing.
    expect(publishBlockers(kitchenSink())).toEqual([]);
    const bad = validateLearnContent(sinkWith((p) => (block(p, 'reusable').libraryId = 'no spaces')));
    expect(bad.ok ? [] : bad.problems).toEqual(['Section 1, block 16: Saved section id is missing or malformed.']);
  });

  it('refuses an unknown block kind', () => {
    const p = sinkWith((_, b) => (b as unknown[]).push({ id: 'zz', kind: 'iframe', src: 'https://evil.example' }));
    expect(problemsOf(p)).toEqual(['Section 1, block 17: has an unknown kind "iframe".']);
  });

  it('refuses duplicate item ids within a v2 block, but not across blocks', () => {
    const p = sinkWith((p) => {
      block(p, 'accordion').items[1].id = 'a1';
      block(p, 'tabs').items[0].id = 'a2';
    });
    expect(problemsOf(p)).toEqual(['Section 1, block 7, item 2: uses the id "a1" twice.']);
  });

  it('refuses gallery images and logos from outside this page’s uploads', () => {
    const p = sinkWith((p) => {
      block(p, 'gallery').images[0].src = 'https://evil.example/a.png';
      block(p, 'logos').items[0].href = 'javascript:alert(1)';
    });
    expect(problemsOf(p)).toEqual([
      'Section 1, block 4, image 1: image must be uploaded here or be a /kgc/ site image.',
      'Section 1, block 11, logo 1: Logo link "javascript:alert(1)" is not a link the site can open.',
    ]);
  });

  it('caps v2 item lists', () => {
    const p = sinkWith((p) => {
      block(p, 'stats').items = Array.from({ length: LEARN_LIMITS.stats + 1 }, (_, i) => ({ id: `s${i}`, value: '1', label: 'x' }));
    });
    expect(problemsOf(p)).toEqual([`Section 1, block 9: has ${LEARN_LIMITS.stats + 1} figures; the limit is ${LEARN_LIMITS.stats}.`]);
  });

  it('saves a table block with no rows and refuses it at publish; refuses one without a doc', () => {
    const empty = sinkWith((p) => (block(p, 'table').doc = richText('no table')));
    expect(problemsOf(empty)).toEqual([]);
    expect(publishBlockers(empty)).toEqual(['The Table block in "Everything" has no rows yet. Add a row or remove the block.']);
    expect(problemsOf(sinkWith((p) => ((block(p, 'table') as { doc: unknown }).doc = 'a|b')))).toEqual([
      'Section 1, block 14: Table is missing.',
    ]);
  });

  it('refuses missing required fields on v2 kinds', () => {
    const p = sinkWith((p) => {
      delete (block(p, 'quote') as Partial<Extract<LearnBlock, { kind: 'quote' }>>).style;
      delete (block(p, 'cards').items[0] as { title?: string }).title;
      delete (block(p, 'imageText') as { image?: unknown }).image;
    });
    expect(problemsOf(p)).toEqual([
      'Section 1, block 3: image is missing.',
      'Section 1, block 5: Quote style is missing.',
      'Section 1, block 10, card 1: Title is missing.',
    ]);
  });

  it('checks the sharing image and keeps noindex only when true', () => {
    expect(problemsOf(sinkWith((p) => (p.ogImage = { ...IMG, src: 'https://evil.example/a.png' })))).toEqual([
      'Sharing image: image must be uploaded here or be a /kgc/ site image.',
    ]);
    const r = validateLearnContent(sinkWith((p) => ((p as { noindex: unknown }).noindex = 'yes')));
    expect(r.ok && r.content).not.toHaveProperty('noindex');
  });
});

describe('validateLearnSection', () => {
  const sec = (): LearnSection => {
    const s = kitchenSink().sections[0];
    s.blocks = s.blocks.filter((b) => b.kind !== 'reusable');
    return s;
  };

  it('accepts a section on its own and returns an equal copy', () => {
    const r = validateLearnSection(sec(), { forLibrary: true });
    expect(r.ok ? [] : r.problems).toEqual([]);
    if (r.ok) expect(r.section).toEqual(sec());
  });

  it('refuses a reusable block inside a section going into the library', () => {
    const s = sec();
    s.blocks.push({ id: 'r1', kind: 'reusable', libraryId: 'footer-cta' });
    const r = validateLearnSection(s, { forLibrary: true });
    expect(r.ok ? [] : r.problems).toEqual([`Section, block ${s.blocks.length}: A saved section cannot hold another saved section.`]);
    expect(validateLearnSection(s).ok).toBe(true);
  });

  it('checks ids within the section only; a repeated anchor is a publish check', () => {
    const s = sec();
    s.blocks[1].anchor = 'everything';
    expect(validateLearnSection(s).ok).toBe(true);
    s.blocks[1].id = s.blocks[0].id;
    const r = validateLearnSection(s);
    expect(r.ok ? [] : r.problems).toEqual([`Section, block 2: uses the id "${s.blocks[0].id}" twice.`]);
  });

  it('refuses something that is not a section', () => {
    expect(validateLearnSection('x')).toEqual({ ok: false, problems: ['The section is missing or malformed.'] });
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

  it('keeps a Saved section block with none chosen yet in the draft, and refuses it at publish (T323)', () => {
    const p = sinkWith((q) => (block(q, 'reusable').libraryId = ''));
    expect(problemsOf(p)).toEqual([]);
    expect(publishBlockers(p)).toEqual([
      expect.stringMatching(/^The Saved section block in ".*" has no saved section chosen yet\. Choose one or remove the block\.$/),
    ]);
    // Still refused inside a section on its way into the library.
    const lib = validateLearnSection(
      { id: 's', label: 'x', background: 'plain', width: 'normal', paddingTop: 'none', paddingBottom: 'none', blocks: [{ id: 'r', kind: 'reusable', libraryId: '' }] },
      { forLibrary: true },
    );
    expect(lib.ok).toBe(false);
  });

  it('keeps a new Countdown with no date and a new Embed with no link, and refuses them at publish (T323)', () => {
    const p = sinkWith((q) => {
      block(q, 'countdown').until = 0;
      block(q, 'embed').url = '';
    });
    expect(problemsOf(p)).toEqual([]);
    expect(publishBlockers(p)).toEqual([
      expect.stringMatching(/^The Map, form or video block in ".*" has no link yet\./),
      expect.stringMatching(/^The Countdown block in ".*" has no date yet\./),
    ]);
    // Since T325 a wrong link or a date out of range saves too, and publish names it.
    expect(problemsOf(sinkWith((q) => (block(q, 'embed').url = 'https://evil.example/x')))).toEqual([]);
    expect(publishBlockers(sinkWith((q) => (block(q, 'embed').url = 'https://evil.example/x')))).toHaveLength(1);
    expect(problemsOf(sinkWith((q) => (block(q, 'countdown').until = 5)))).toEqual([]);
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

describe('unfinished values save and refuse publish, by name (T325, T324 D1)', () => {
  /** Every link field on the page, set to `href`. */
  function withLinks(href: string): LearnPageContent {
    return sinkWith((p, b) => {
      const pg = page().sections[0];
      (pg.blocks[2] as { href?: string }).href = href; // image
      (pg.blocks[3] as Extract<LearnBlock, { kind: 'buttons' }>).buttons[0].href = href;
      (pg.blocks[4] as Extract<LearnBlock, { kind: 'people' }>).people[0].linkedin = href;
      (pg.blocks[5] as Extract<LearnBlock, { kind: 'list' }>).items[0].link!.href = href;
      (pg.blocks[6] as Extract<LearnBlock, { kind: 'columns' }>).items[0].link = { label: 'Go', href, style: 'text' };
      p.sections.push({ ...pg, id: 'v1', label: 'Team', blocks: pg.blocks.filter((x) => x.kind !== 'video') });
      block(p, 'imageText').buttons![0].href = href;
      block(p, 'cards').items[0].link!.href = href;
      block(p, 'logos').items[0].href = href;
      void b;
    });
  }

  it('saves an empty or half-typed address in every link field, stored trimmed', () => {
    for (const href of ['example', 'linkedin.com/in/x', 'https:/', 'www.example.com:8080/x', 'mailto', ' https://exa ']) {
      const r = validateLearnContent(withLinks(href));
      expect(r.ok ? [] : r.problems, href).toEqual([]);
      if (r.ok) expect(block(r.content, 'logos').items[0].href, href).toBe(href.trim());
    }
    // A new button or list link starts with no address: required links keep '' too.
    const r = validateLearnContent(withLinks(''));
    expect(r.ok ? [] : r.problems).toEqual([]);
    if (r.ok) {
      expect(block(r.content, 'cards').items[0].link!.href).toBe('');
      expect(r.content.sections[2].blocks.find((x) => x.kind === 'buttons')).toMatchObject({ buttons: [{ href: '' }] });
      // An empty optional link (image, logo, LinkedIn) is simply absent.
      expect(block(r.content, 'logos').items[0]).not.toHaveProperty('href');
    }
  });

  it('refuses publish for each unfinished link, naming the block, its section and what was typed', () => {
    const blockers = publishBlockers(withLinks('linkedin.com/in/x'));
    const tail = 'that is not finished: "linkedin.com/in/x". Use a full address, like https://example.com.';
    expect(blockers).toEqual([
      `The Image and text block in "Everything" has a link ${tail}`,
      `The Cards block in "Everything" has a link ${tail}`,
      `The Logos block in "Everything" has a link ${tail}`,
      `The Image block in "Team" has a link ${tail}`,
      `The Buttons block in "Team" has a link ${tail}`,
      `The People block in "Team" has a LinkedIn link ${tail}`,
      `The List block in "Team" has a link ${tail}`,
      `The Columns block in "Team" has a link ${tail}`,
    ]);
    const empty = publishBlockers(withLinks(''));
    expect(empty).toContain('The Buttons block in "Team" has a link with no address yet. Add one or remove the link.');
    expect(empty).toContain('The Cards block in "Everything" has a link with no address yet. Add one or remove the link.');
    expect(publishBlockers(withLinks('https://example.com/x'))).toEqual([]);
    expect(publishBlockers(withLinks('/tickets'))).toEqual([]);
  });

  it('still refuses a dangerous scheme or a scheme-relative link at save, in every link field', () => {
    for (const href of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example', '\\\\evil.example', '/\\evil.example']) {
      const problems = problemsOf(withLinks(href));
      expect(problems.length, href).toBe(8);
      expect(problems.every((x) => x.includes('is not a link the site can open')), href).toBe(true);
    }
  });

  it('isRefusedHref and isUnfinishedHref split links three ways', () => {
    for (const h of ['javascript:x', 'JAVASCRIPT:x', ' java script:x', 'data:x', 'file:///etc', '//x', '\\\\x']) expect(isRefusedHref(h), h).toBe(true);
    for (const h of ['', 'example', 'https:/', 'linkedin.com/in/x', 'http://x.example', '/x', '#top']) expect(isRefusedHref(h), h).toBe(false);
    for (const h of ['', ' ', 'example', 'https:/', 'linkedin.com/in/x']) expect(isUnfinishedHref(h), h).toBe(true);
    for (const h of ['https://example.com', 'http://example.com', '/tickets', '#top', 'mailto:a@b.c', 'tel:+1212']) expect(isUnfinishedHref(h), h).toBe(false);
  });

  it('drops a half-typed rich text link (keeping its words) rather than refusing the save', () => {
    const p = sinkWith((_, b) => {
      (b[1] as { text: RichDoc }).text = richText('our site', [{ type: 'link', href: 'page.html' }, { type: 'bold' }]);
    });
    const r = validateLearnContent(p);
    expect(r.ok ? [] : r.problems).toEqual([]);
    expect(r.ok && block(r.content, 'text').text).toEqual(richText('our site', [{ type: 'bold' }]));
    // A finished one is kept.
    const fine = validateLearnContent(sinkWith((_, b) => ((b[1] as { text: RichDoc }).text = richText('x', [{ type: 'link', href: 'https://a.example' }]))));
    expect(fine.ok && block(fine.content, 'text').text).toEqual(richText('x', [{ type: 'link', href: 'https://a.example' }]));
  });

  it('saves an empty page title and refuses it at publish', () => {
    const p = page({ seoTitle: '  ' });
    expect(problemsOf(p)).toEqual([]);
    expect(publishBlockers(p)).toEqual(['The page title in Search settings is empty. Add one before publishing.']);
  });

  it('checks the blocks inside each saved section a page uses, under the host section name', () => {
    const saved: LearnSection = {
      id: 'lib',
      label: 'Library copy',
      background: 'plain',
      width: 'normal',
      paddingTop: 'none',
      paddingBottom: 'none',
      blocks: [
        { id: 'x1', kind: 'image', image: { src: '', alt: '', width: 0, height: 0 }, width: 'full', shape: 'original' },
        { id: 'x2', kind: 'buttons', buttons: [{ label: 'Go', href: 'example', style: 'primary' }], anchor: 'Bad' },
      ],
    };
    const lib = new Map([['footer-cta', saved]]);
    expect(publishBlockers(kitchenSink(), lib)).toEqual([
      'The Image block in "Everything" has no image yet. Choose one or remove the block.',
      'The Buttons block in "Everything" has a link that is not finished: "example". Use a full address, like https://example.com.',
      'The link name "Bad" in "Everything" can only use lower-case letters, numbers and single dashes, like our-team.',
    ]);
    // A hidden Saved section block puts nothing on the page, so nothing inside it is checked.
    const hidden = sinkWith((p) => (block(p, 'reusable').hidden = true));
    expect(publishBlockers(hidden, lib)).toEqual([]);
    // A library entry of the wrong shape does not throw.
    expect(() => publishBlockers(kitchenSink(), new Map([['footer-cta', { blocks: 'x' } as unknown as LearnSection]]))).not.toThrow();
  });

  it('publishProblems names an empty Saved section block alongside the other blockers (T324 N1)', () => {
    const draft = sinkWith((p) => {
      block(p, 'reusable').libraryId = '';
      block(p, 'countdown').until = 0;
    });
    // The expanded page has no reusable block left, which is how it went missing.
    const expanded = { ...draft, sections: draft.sections.map((s) => ({ ...s, blocks: s.blocks.filter((b) => b.kind !== 'reusable') })) };
    expect(publishBlockers(expanded)).toEqual(['The Countdown block in "Everything" has no date yet. Choose one or remove the block.']);
    expect(publishProblems(draft, new Map(), expanded)).toEqual([
      'The Countdown block in "Everything" has no date yet. Choose one or remove the block.',
      'The Saved section block in "Everything" has no saved section chosen yet. Choose one or remove the block.',
    ]);
  });
});

describe('a saved section being changed is stored with the draft (T326 R1)', () => {
  const sec = (id: string, blocks: LearnBlock[], extra: Partial<LearnSection> = {}): LearnSection => ({
    id,
    label: id,
    background: 'plain',
    width: 'normal',
    paddingTop: 'none',
    paddingBottom: 'none',
    blocks,
    ...extra,
  });
  const link: LearnBlock = { id: 'r1', kind: 'reusable', libraryId: 'L1' };
  const copy = (libraryEdit: unknown, id = 'sc'): LearnSection =>
    ({ ...sec(id, [{ id: `${id}-h`, kind: 'heading', text: 'Team', level: 2 }]), libraryEdit }) as LearnSection;
  const inPlace = {
    libraryId: 'L1',
    name: 'Team band',
    sectionId: 'sc',
    ids: { 'r1--h': 'h' },
    anchors: {},
    restore: { kind: 'inPlace', hostSectionId: 's1', index: 0, column: 1, block: link },
  };
  const withCopy = (...sections: LearnSection[]): LearnPageContent => ({ seoTitle: 'T', seoDescription: '', sections });

  it('keeps each kind of edit as it was', () => {
    const whole = { ...inPlace, sectionId: 's2', restore: { kind: 'whole', host: sec('s2', [link], { anchor: 'team' }) } };
    const none = { ...inPlace, restore: { kind: 'none' } };
    for (const [edit, id] of [
      [inPlace, 'sc'],
      [whole, 's2'],
      [none, 'sc'],
    ] as const) {
      const v = validateLearnContent(withCopy(sec('s1', []), copy(edit, id)));
      if (!v.ok) throw new Error(v.problems.join('; '));
      expect(v.content.sections[1].libraryEdit).toEqual(edit);
    }
  });

  it('drops a marker naming another section (a duplicate) and any after the first', () => {
    const v = validateLearnContent(withCopy(copy(inPlace), copy(inPlace, 'sdup'), copy({ ...inPlace, sectionId: 'sx' }, 'sx')));
    if (!v.ok) throw new Error(v.problems.join('; '));
    expect(v.content.sections.map((s) => s.libraryEdit?.sectionId)).toEqual(['sc', undefined, undefined]);
  });

  it('refuses a marker no editing step makes, and checks the block it would put back', () => {
    const bad = [
      { ...inPlace, libraryId: 'a/b' },
      { ...inPlace, ids: { 'r1--h': 'no good' } },
      { ...inPlace, restore: { kind: 'other' } },
      { ...inPlace, restore: { ...inPlace.restore, block: { id: 'x', kind: 'text', text: 'hi' } } },
      { ...inPlace, restore: { ...inPlace.restore, block: { id: 'x', kind: 'reusable', libraryId: '../x' } } },
      { ...inPlace, restore: { ...inPlace.restore, index: -1 } },
      { ...inPlace, sectionId: 's2', restore: { kind: 'whole', host: sec('s9', [link]) } },
      { ...inPlace, sectionId: 's2', restore: { kind: 'whole', host: { ...sec('s2', [link]), background: 'neon' } } },
    ];
    for (const edit of bad) {
      expect(validateLearnContent(withCopy(copy(edit, edit.sectionId))).ok, JSON.stringify(edit)).toBe(false);
    }
  });

  it('never goes into the library', () => {
    const v = validateLearnSection(copy(inPlace), { forLibrary: true });
    if (!v.ok) throw new Error(v.problems.join('; '));
    expect(v.section.libraryEdit).toBeUndefined();
  });
});

describe('a field over its length limit saves as typed and refuses publish, by name (T331)', () => {
  const buttons = (p: LearnPageContent) => p.sections[0].blocks[3] as Extract<LearnBlock, { kind: 'buttons' }>;

  it('saves a 91-character button label as typed, and publish names it', () => {
    const p = page();
    const label = 'Programmes for teams, researchers and anyone curious about knowledge graphs and their uses.';
    expect(label).toHaveLength(91);
    buttons(p).buttons[0].label = label;
    const r = validateLearnContent(p);
    expect(r.ok ? [] : r.problems).toEqual([]);
    if (r.ok) expect((r.content.sections[0].blocks[3] as Extract<LearnBlock, { kind: 'buttons' }>).buttons[0].label).toBe(label);
    expect(publishBlockers(p)).toEqual(['The Buttons block in "Hero" has a button label of 91 characters; the limit is 80.']);
    expect(() => planPublish({ ...effectiveDoc(null), draft: p }, 'a', 1)).toThrow(LearnNotReady);
  });

  it('refuses a save on length only when the page is over its size cap, never for one field (T343)', () => {
    const p = page();
    buttons(p).buttons[0].label = 'x'.repeat(LEARN_LIMITS.label + 1001);
    expect(problemsOf(p)).toEqual([]);
    expect(publishBlockers(p)).toEqual(['The Buttons block in "Hero" has a button label of 1081 characters; the limit is 80.']);
    // 44,400 characters in a text block, as a rich doc and as a string: stored, named at publish.
    for (const text of [richText('x'.repeat(44_400)), 'x'.repeat(44_400)]) {
      const t = page();
      (t.sections[0].blocks[1] as { text: unknown }).text = text;
      expect(problemsOf(t)).toEqual([]);
      expect(publishBlockers(t)).toEqual([`The Text block in "Hero" has text of 44400 characters; the limit is ${LEARN_LIMITS.richText}.`]);
    }
    // A field longer than the whole page may be: the page cap refuses it, and the field is named with its own limit.
    const huge = page();
    (huge.sections[0].blocks[0] as { text: unknown }).text = richText('x'.repeat(LEARN_LIMITS.contentBytes + 1));
    expect(problemsOf(huge)).toEqual([
      `Section 1, block 1: Heading is ${LEARN_LIMITS.contentBytes + 1} characters; the limit is ${LEARN_LIMITS.heading}.`,
      expect.stringMatching(/^The page is \d+ KB of text; the limit is 400 KB\.$/),
    ]);
  });

  it('refuses to publish a person with no name, whom the website would leave out (T343, H F3)', () => {
    const p = page();
    const people = p.sections[0].blocks.find((b) => b.kind === 'people') as Extract<LearnBlock, { kind: 'people' }>;
    people.people[0] = { ...people.people[0], name: '  ', role: 'Programme chair', bio: richText('Runs the programme.') };
    expect(problemsOf(p)).toEqual([]);
    expect(publishBlockers(p)).toEqual(['The People block in "Hero" has a person with no name. Add a name or remove them.']);
    expect(() => planPublish({ ...effectiveDoc(null), draft: p }, 'a', 1)).toThrow(LearnNotReady);
    people.people.push({ id: 'p-two', name: '', role: 'Speaker' });
    expect(publishBlockers(p)).toEqual(['The People block in "Hero" has 2 people with no name. Add their names or remove them.']);
  });

  it('refuses to publish a list item with no words but with sub-items, which the website would leave out (T348, H N2)', () => {
    const p = page();
    const list = p.sections[0].blocks.find((b) => b.kind === 'list') as Extract<LearnBlock, { kind: 'list' }>;
    list.items.push({ id: 'li-empty', text: '', children: ['Kept only under the item', ''] });
    expect(problemsOf(p)).toEqual([]);
    expect(publishBlockers(p)).toEqual(['The List block in "Hero" has an item with no words. Add words or remove it.']);
    expect(() => planPublish({ ...effectiveDoc(null), draft: p }, 'a', 1)).toThrow(LearnNotReady);
    list.items.push({ id: 'li-empty2', text: { type: 'doc', content: [{ type: 'paragraph' }] }, children: ['Another'] });
    expect(publishBlockers(p)).toEqual(['The List block in "Hero" has 2 items with no words. Add words or remove them.']);
    // A title is words of its own, and an empty item with no sub-items loses nothing.
    list.items.splice(-2, 2, { id: 'li-t', title: 'Title', text: '', children: ['Sub'] }, { id: 'li-blank', text: '', children: ['  '] });
    expect(publishBlockers(p)).toEqual([]);
    // A button is not words of its own either: www drops the item and its button (T351, B F1).
    list.items.push({ id: 'li-btn', text: '', link: { label: 'Read more', href: 'https://example.org', style: 'primary' } });
    expect(problemsOf(p)).toEqual([]);
    expect(publishBlockers(p)).toEqual(['The List block in "Hero" has an item with no words. Add words or remove it.']);
  });

  it('refuses to publish a number with a label but no figure, which the website would leave out (T348)', () => {
    const p = sinkWith((q) => {
      block(q, 'stats').items.push({ id: 'st-bare', value: ' ', label: 'Kept only in the draft' }, { id: 'st-empty', value: '', label: '' });
    });
    expect(problemsOf(p)).toEqual([]);
    expect(publishBlockers(p)).toEqual([expect.stringMatching(/^The Numbers block in ".+" has a number with a label but no figure\. Add the figure or remove it\.$/)]);
    block(p, 'stats').items.push({ id: 'st-bare2', value: '', label: 'Another' });
    expect(publishBlockers(p)).toEqual([expect.stringMatching(/has 2 numbers with a label but no figure\. Add their figures or remove them\.$/)]);
  });

  it('names the field in a rich text problem, not "Text" (T343)', () => {
    // 2,600 paragraphs of one word each: more parts than a rich doc may hold.
    const many = { type: 'doc', content: Array.from({ length: 2600 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: 'x' }] })) };
    const p = page();
    (p.sections[0].blocks[0] as { text: unknown }).text = many;
    expect(problemsOf(p)).toContain('Section 1, block 1: Heading has more than 5000 parts.');
    const t = page();
    (t.sections[0].blocks[1] as { text: unknown }).text = many;
    expect(problemsOf(t)).toContain('Section 1, block 2: Text has more than 5000 parts.');
  });

  it('names a figure, a figure label and a card badge over their limits', () => {
    const p = sinkWith((q) => {
      block(q, 'stats').items[0].value = 'x'.repeat(LEARN_LIMITS.statValue + 1);
      block(q, 'stats').items[0].label = 'y'.repeat(LEARN_LIMITS.shortText + 5);
      block(q, 'cards').items[0].badge = 'z'.repeat(LEARN_LIMITS.badge + 2);
    });
    expect(problemsOf(p)).toEqual([]);
    expect(publishBlockers(p)).toEqual([
      'The Numbers block in "Everything" has a figure of 41 characters; the limit is 40.',
      'The Numbers block in "Everything" has a label of 305 characters; the limit is 300.',
      'The Cards block in "Everything" has a badge of 42 characters; the limit is 40.',
    ]);
    const far = sinkWith((q) => (block(q, 'stats').items[0].value = 'x'.repeat(LEARN_LIMITS.statValue + 1001)));
    expect(problemsOf(far)).toEqual([]);
    expect(publishBlockers(far)).toContain('The Numbers block in "Everything" has a figure of 1041 characters; the limit is 40.');
  });

  it('names image descriptions, captions, table text and the page and section fields', () => {
    const p = sinkWith((q, _, s) => {
      q.seoTitle = 't'.repeat(LEARN_LIMITS.seoTitle + 1);
      s.label = 'L'.repeat(LEARN_LIMITS.label + 1);
      block(q, 'gallery').images[0].alt = 'a'.repeat(LEARN_LIMITS.alt + 1);
      block(q, 'table').caption = 'c'.repeat(LEARN_LIMITS.caption + 1);
      const cell = { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(LEARN_LIMITS.tableChars + 1) }] }] };
      block(q, 'table').doc = { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [cell] }] }] } as RichDoc;
    });
    expect(problemsOf(p)).toEqual([]);
    const name = 'L'.repeat(LEARN_LIMITS.label + 1);
    expect(publishBlockers(p)).toEqual([
      `The page title in Search settings is ${LEARN_LIMITS.seoTitle + 1} characters; the limit is ${LEARN_LIMITS.seoTitle}.`,
      `The section name in "${'L'.repeat(57)}..." is ${LEARN_LIMITS.label + 1} characters; the limit is ${LEARN_LIMITS.label}.`,
      `The Gallery block in "${name}" has an image description of ${LEARN_LIMITS.alt + 1} characters; the limit is ${LEARN_LIMITS.alt}.`,
      `The Table block in "${name}" has table text of ${LEARN_LIMITS.tableChars + 1} characters; the limit is ${LEARN_LIMITS.tableChars}.`,
      `The Table block in "${name}" has a caption of ${LEARN_LIMITS.caption + 1} characters; the limit is ${LEARN_LIMITS.caption}.`,
    ]);
  });

  it('keeps refusing what no typing produces, whatever the length', () => {
    const scheme = page();
    buttons(scheme).buttons[0] = { label: 'x'.repeat(90), href: 'javascript:alert(1)', style: 'primary' };
    expect(problemsOf(scheme)).toEqual(['Section 1, block 4, button 1: Button link "javascript:alert(1)" is not a link the site can open.']);
    const wrongType = page();
    (buttons(wrongType).buttons[0] as unknown as { label: unknown }).label = 91;
    expect(problemsOf(wrongType)).toEqual(['Section 1, block 4, button 1: Button label must be text.']);
    const foreign = page();
    (foreign.sections[0].blocks[2] as Extract<LearnBlock, { kind: 'image' }>).image.src = `https://evil.example/${'x'.repeat(2100)}.png`;
    expect(problemsOf(foreign)).toEqual(['Section 1, block 3: image must be uploaded here or be a /kgc/ site image.']);
  });

  it('stores a saved section with a long field, and a page using it is refused at publish', () => {
    const s = kitchenSink().sections[0];
    s.blocks = [{ id: 'x1', kind: 'buttons', buttons: [{ label: 'x'.repeat(91), href: '/tickets', style: 'primary' }] }];
    const r = validateLearnSection(s, { forLibrary: true });
    expect(r.ok ? [] : r.problems).toEqual([]);
    if (!r.ok) return;
    const lib = new Map([['footer-cta', r.section]]);
    expect(publishBlockers(kitchenSink(), lib)).toEqual([
      'The Buttons block in "Everything" has a button label of 91 characters; the limit is 80.',
    ]);
    // The expanded page says the same once, not twice.
    const expanded = sinkWith((q) => {
      const blocks = q.sections[0].blocks;
      blocks.splice(blocks.findIndex((b) => b.kind === 'reusable'), 1, ...r.section.blocks);
    });
    expect(publishProblems(kitchenSink(), lib, expanded)).toEqual([
      'The Buttons block in "Everything" has a button label of 91 characters; the limit is 80.',
    ]);
  });
});
