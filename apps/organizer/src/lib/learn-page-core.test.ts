import { describe, expect, it } from 'vitest';
import type { LearnBlock, LearnPageContent, LearnPageDoc, LearnSection, RichDoc } from '@kgc/shared';

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
    const r = validateLearnContent(kitchenSink(), { libraryIds: new Set(['footer-cta']) });
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

  it('refuses an embed link that is not an accepted form of its provider', () => {
    const bad: [string, string][] = [
      ['youtube', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'],
      ['youtube', 'https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ'],
      ['youtube', 'https://youtube.com@evil.example/watch?v=dQw4w9WgXcQ'],
      ['youtube', 'http://youtu.be/dQw4w9WgXcQ'],
      ['vimeo', YT_URL],
      ['google-maps', 'https://www.google.com/maps/place/Bryant+Park'],
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
      const problems = problemsOf(p);
      expect(problems, `${provider} ${url}`).toHaveLength(1);
      expect(problems[0]).toMatch(/^Section 1, block 12: Embed link is not a .* link this page can show\.$/);
    }
  });

  it('stores an accepted embed link as typed, trimmed, not rewritten', () => {
    const r = validateLearnContent(
      sinkWith((p) => Object.assign(block(p, 'embed'), { url: '  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ', provider: 'youtube' })),
    );
    expect(r.ok && block(r.content, 'embed').url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('refuses a bad embed provider, aspect, height or empty title', () => {
    const problems = problemsOf(
      sinkWith((p) => Object.assign(block(p, 'embed'), { provider: 'iframe', aspect: '21:9', height: 50, title: ' ' })),
    );
    expect(problems.some((x) => x.includes('Embed type must be one of'))).toBe(true);
    expect(problems.some((x) => x.includes('Aspect must be one of'))).toBe(true);
    expect(problems.some((x) => x.includes('Embed height must be a whole number of pixels from 100 to 2000.'))).toBe(true);
    expect(problems.some((x) => x.includes('Embed title is empty'))).toBe(true);
  });

  it('refuses a countdown outside 2020 to 2099 or not a whole number', () => {
    for (const until of [Date.UTC(2019, 11, 31), Date.UTC(2100, 0, 1), 1.5e12 + 0.5, '2027-05-01']) {
      const problems = problemsOf(sinkWith((p) => Object.assign(block(p, 'countdown'), { until })));
      expect(problems, String(until)).toEqual(['Section 1, block 13: Countdown date must be a real date between 2020 and 2099.']);
    }
  });

  it('refuses an overlay above 0.8', () => {
    expect(problemsOf(sinkWith((_, __, s) => (s.overlay = 0.9)))).toEqual(['Section 1: Overlay must be between 0 and 0.8.']);
    expect(problemsOf(sinkWith((_, __, s) => (s.overlay = -0.1)))).toHaveLength(1);
  });

  it('refuses an anchor used twice across a section and a block', () => {
    const problems = problemsOf(sinkWith((_, b) => (b[1].anchor = 'everything')));
    expect(problems).toEqual(['Section 1, block 2: uses the anchor "everything" twice.']);
    const s2 = sinkWith((p) => (p.sections[1].anchor = 'top'));
    expect(problemsOf(s2)).toEqual(['Section 2: uses the anchor "top" twice.']);
  });

  it('refuses a malformed anchor', () => {
    for (const anchor of ['Top', 'a--b', '-a', 'a b', 'x'.repeat(65)]) {
      expect(problemsOf(sinkWith((_, b) => (b[0].anchor = anchor))), anchor).toHaveLength(1);
    }
  });

  it('refuses block columns on a single-column section', () => {
    const p = sinkWith((_, __, s) => (s.layout = 'single'));
    expect(problemsOf(p)).toEqual([
      'Section 1: places blocks in columns but the section has one column. Choose a column layout first.',
    ]);
    const absent = sinkWith((_, __, s) => delete s.layout);
    expect(problemsOf(absent)).toHaveLength(1);
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

  it('refuses a block column naming a block not in the section', () => {
    expect(problemsOf(sinkWith((_, __, s) => (s.blockColumn = { z1: 1 })))).toEqual([
      'Section 1: places "z1" in a column but no block in this section has that id.',
    ]);
  });

  it('refuses a column index the layout does not have', () => {
    expect(problemsOf(sinkWith((_, __, s) => (s.blockColumn = { k2: 2 })))).toEqual([
      'Section 1: places "k2" in column 2; this layout has columns 0 to 1.',
    ]);
    expect(problemsOf(sinkWith((p) => (p.sections[1].blockColumn = { z1: 3 })))).toHaveLength(1);
    expect(problemsOf(sinkWith((_, __, s) => (s.blockColumn = { k2: 0.5 })))).toHaveLength(1);
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

  it('caps a rich text doc at the same length as the string', () => {
    const p = sinkWith((_, b) => ((b[0] as { text: RichDoc }).text = richText('x'.repeat(LEARN_LIMITS.heading + 1))));
    expect(problemsOf(p)).toEqual([`Section 1, block 1: Text is longer than ${LEARN_LIMITS.heading} characters.`]);
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

  it('refuses a reusable block pointing at a saved section that is gone', () => {
    expect(problemsOf(kitchenSink())).toEqual([]);
    const r = validateLearnContent(kitchenSink(), { libraryIds: new Set(['other']) });
    expect(r.ok ? [] : r.problems).toEqual(['Section 1, block 16: points to a saved section that no longer exists.']);
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

  it('refuses a table block without a table, or without a doc', () => {
    expect(problemsOf(sinkWith((p) => (block(p, 'table').doc = richText('no table'))))).toEqual([
      'Section 1, block 14: Table has no rows.',
    ]);
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
    const r = validateLearnContent(sinkWith((p) => ((p as { noindex: unknown }).noindex = 'yes')), { libraryIds: new Set(['footer-cta']) });
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
    expect(validateLearnSection(s, { libraryIds: new Set() }).ok).toBe(false);
  });

  it('checks anchors and ids within the section only', () => {
    const s = sec();
    s.blocks[1].anchor = 'everything';
    const r = validateLearnSection(s);
    expect(r.ok ? [] : r.problems).toEqual(['Section, block 2: uses the anchor "everything" twice.']);
    expect(validateLearnSection(sec()).ok).toBe(true);
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
