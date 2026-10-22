import { describe, expect, it } from 'vitest';
import { LEARN_COLORS, type LearnBlock, type LearnPageContent, type LearnSection, type RichDoc } from '@kgc/shared';
import {
  BLOCK_CATEGORIES,
  BLOCK_KINDS,
  applyEdit,
  blockColumnOf,
  blockSummary,
  cloneBlockWithNewIds,
  cloneSectionWithNewIds,
  coalesceKey,
  contentWarnings,
  createBlock,
  embedLinkPatch,
  embedProviderFromUrl,
  embedProviderPatch,
  embedSrc,
  embedStatus,
  hasUnfinishedLink,
  layoutColumns,
  searchBlockKinds,
  summarizeChanges,
  type BlockKind,
} from './learn-editor-core';
import {
  accessibilityIssues,
  anchorProblem,
  blockRange,
  blocksInPageOrder,
  BRAND_COLORS,
  contrastRatio,
  expandForPreview,
  findInPage,
  sectionBgHex,
  imageUsage,
  isVagueLinkText,
  outlineMatches,
  pageLinks,
  parseClip,
  replaceInPage,
  scheduleProblem,
  serializeClip,
  slugifyAnchor,
  statusChips,
} from './learn-tools-core';
import { mapRichText, markdownToRichDoc, richLinks, richToPlainText, richWordCount } from './learn-rich';

const IMG = { src: '/kgc/a.png', alt: 'A', width: 10, height: 10 };

function section(id: string, blocks: LearnBlock[], extra: Partial<LearnSection> = {}): LearnSection {
  return { id, label: id.toUpperCase(), background: 'plain', width: 'normal', paddingTop: 'large', paddingBottom: 'large', blocks, ...extra };
}

function page(): LearnPageContent {
  return {
    seoTitle: 'Learn graphs',
    seoDescription: 'About the course',
    sections: [
      section('s1', [
        { id: 'h1', kind: 'heading', text: 'Hello **world**', level: 2 },
        { id: 't1', kind: 'text', text: 'Read the [brochure](https://example.com/graph) about graph work.' },
      ]),
      section(
        's2',
        [
          { id: 'a', kind: 'text', text: 'Left' },
          { id: 'b', kind: 'text', text: 'Right' },
          { id: 'c', kind: 'divider' },
        ],
        { layout: 'two-equal', blockColumn: { a: 0, b: 1 } },
      ),
    ],
  };
}

const ALL_KINDS = BLOCK_KINDS.map((k) => k.kind);

describe('block kinds', () => {
  it('lists every kind of the contract once, each in a known category', () => {
    const expected: BlockKind[] = [
      'heading', 'text', 'image', 'buttons', 'people', 'list', 'columns', 'video', 'divider', 'spacer',
      'imageText', 'gallery', 'quote', 'callout', 'accordion', 'tabs', 'stats', 'cards', 'logos', 'embed',
      'countdown', 'table', 'toc', 'reusable',
    ];
    expect(new Set(ALL_KINDS)).toEqual(new Set(expected));
    expect(ALL_KINDS).toHaveLength(expected.length);
    for (const k of BLOCK_KINDS) expect(BLOCK_CATEGORIES).toContain(k.category);
  });

  it('creates every kind with a fresh id and a summary', () => {
    for (const kind of ALL_KINDS) {
      const a = createBlock(kind);
      const b = createBlock(kind);
      expect(a.kind).toBe(kind);
      expect(a.id).not.toBe(b.id);
      expect(blockSummary(a).length).toBeGreaterThan(0);
    }
  });

  it('searches by label, keyword and category, every word', () => {
    expect(searchBlockKinds('faq').map((k) => k.kind)).toEqual(['accordion']);
    expect(searchBlockKinds('google maps').map((k) => k.kind)).toEqual(['embed']);
    expect(searchBlockKinds('media').map((k) => k.kind)).toContain('gallery');
    expect(searchBlockKinds('')).toHaveLength(BLOCK_KINDS.length);
    expect(searchBlockKinds('zzz')).toHaveLength(0);
  });

  it('gives nested items new ids on a copy and drops the anchor', () => {
    for (const kind of ['gallery', 'accordion', 'tabs', 'stats', 'cards'] as const) {
      const block = { ...createBlock(kind), anchor: 'here' } as LearnBlock;
      if (block.kind === 'gallery') block.images = [{ ...IMG, id: 'g1' }];
      const copy = cloneBlockWithNewIds(block);
      expect(copy.id).not.toBe(block.id);
      expect(copy.anchor).toBeUndefined();
      const ids = (b: LearnBlock) => JSON.stringify(b).match(/"id":"[^"]+"/g) ?? [];
      const before = new Set(ids(block));
      for (const id of ids(copy)) expect(before.has(id)).toBe(false);
    }
  });

  it('moves the column map along with a section copy', () => {
    const s = page().sections[1];
    const copy = cloneSectionWithNewIds(s);
    expect(Object.keys(copy.blockColumn ?? {})).toHaveLength(2);
    const right = copy.blocks[1].id;
    expect(copy.blockColumn?.[right]).toBe(1);
    expect(copy.blockColumn?.b).toBeUndefined();
  });
});

describe('v2 edit actions', () => {
  it('inserts several blocks at once, into a column', () => {
    const blocks = [createBlock('text'), createBlock('quote')];
    const next = applyEdit(page(), { type: 'insertBlocks', sectionId: 's2', index: 1, blocks, column: 1 });
    expect(next.sections[1].blocks.map((b) => b.id)).toEqual(['a', blocks[0].id, blocks[1].id, 'b', 'c']);
    expect(next.sections[1].blockColumn?.[blocks[0].id]).toBe(1);
  });

  it('removes several blocks across sections and prunes the column map', () => {
    const next = applyEdit(page(), { type: 'removeBlocks', blockIds: ['t1', 'b'] });
    expect(next.sections[0].blocks.map((b) => b.id)).toEqual(['h1']);
    expect(next.sections[1].blocks.map((b) => b.id)).toEqual(['a', 'c']);
    expect(next.sections[1].blockColumn).toEqual({ a: 0 });
  });

  it('hides and shows several, leaving no hidden:false behind', () => {
    const hidden = applyEdit(page(), { type: 'setBlocksHidden', blockIds: ['h1', 'a'], hidden: true });
    expect(hidden.sections[0].blocks[0].hidden).toBe(true);
    const shown = applyEdit(hidden, { type: 'setBlocksHidden', blockIds: ['h1', 'a'], hidden: false });
    expect('hidden' in shown.sections[0].blocks[0]).toBe(false);
    expect(applyEdit(shown, { type: 'setBlocksHidden', blockIds: ['h1'], hidden: false })).toBe(shown);
  });

  it('moves several blocks in page order to one place', () => {
    const next = applyEdit(page(), { type: 'moveBlocks', blockIds: ['c', 'h1'], toSectionId: 's2', toIndex: 1, toColumn: 1 });
    expect(next.sections[0].blocks.map((b) => b.id)).toEqual(['t1']);
    expect(next.sections[1].blocks.map((b) => b.id)).toEqual(['a', 'h1', 'c', 'b']);
    expect(next.sections[1].blockColumn).toMatchObject({ h1: 1, c: 1 });
  });

  it('counts the landing index without the moving blocks', () => {
    const next = applyEdit(page(), { type: 'moveBlocks', blockIds: ['a'], toSectionId: 's2', toIndex: 3 });
    expect(next.sections[1].blocks.map((b) => b.id)).toEqual(['b', 'c', 'a']);
  });

  it('sets and clamps a block column, and a move to another section drops the old entry', () => {
    let next = applyEdit(page(), { type: 'setBlockColumn', sectionId: 's2', blockId: 'c', column: 9 });
    expect(next.sections[1].blockColumn?.c).toBe(1);
    next = applyEdit(next, { type: 'moveBlock', sectionId: 's2', blockId: 'b', toSectionId: 's1', toIndex: 0 });
    expect(next.sections[1].blockColumn?.b).toBeUndefined();
    expect(blockColumnOf(next.sections[1], 'zzz')).toBe(0);
  });

  it('keeps the column on a duplicate', () => {
    const next = applyEdit(page(), { type: 'duplicateBlock', sectionId: 's2', blockId: 'b' });
    const copy = next.sections[1].blocks[2];
    expect(next.sections[1].blockColumn?.[copy.id]).toBe(1);
  });

  it('knows each layout width', () => {
    expect(layoutColumns(undefined)).toBe(1);
    expect(layoutColumns('two-wide-left')).toBe(2);
    expect(layoutColumns('three')).toBe(3);
  });

  it('treats share image and noindex as page edits', () => {
    const before = page();
    const after = applyEdit(before, { type: 'setPage', patch: { noindex: true } });
    expect(summarizeChanges(before, after).pageEdited).toBe(true);
  });

  it('coalesces typing in a section note but not a layout change', () => {
    expect(coalesceKey({ type: 'updateSection', sectionId: 's', patch: { note: 'x' } })).toBeDefined();
    expect(coalesceKey({ type: 'updateSection', sectionId: 's', patch: { layout: 'three' } })).toBeUndefined();
    expect(coalesceKey({ type: 'updateBlock', sectionId: 's', blockId: 'b', patch: { title: 'x' } })).toBeDefined();
  });
});

describe('embeds', () => {
  it('recognises providers from a pasted link', () => {
    expect(embedProviderFromUrl('https://www.google.com/maps/embed?pb=123')).toBe('google-maps');
    expect(embedProviderFromUrl('https://docs.google.com/forms/d/e/abc/viewform')).toBe('google-forms');
    expect(embedProviderFromUrl('https://docs.google.com/presentation/d/abc/pub')).toBe('google-slides');
    expect(embedProviderFromUrl('https://calendly.com/me/30min')).toBe('calendly');
    expect(embedProviderFromUrl('https://acme.typeform.com/to/x')).toBe('typeform');
    expect(embedProviderFromUrl('https://youtu.be/abcdefgh')).toBe('youtube');
    expect(embedProviderFromUrl('not a link')).toBeNull();
  });

  it('refuses a link for the wrong provider or over http', () => {
    expect(embedSrc('calendly', 'https://calendly.com/me')).toBe('https://calendly.com/me');
    expect(embedSrc('calendly', 'https://example.com/me')).toBeNull();
    expect(embedSrc('loom', 'http://www.loom.com/share/x')).toBeNull();
  });

  it('warns about an embed with the wrong link and no title', () => {
    const p = page();
    p.sections[0].blocks.push({ id: 'e', kind: 'embed', provider: 'spotify', url: 'https://example.com', aspect: '16:9', title: '' });
    const msgs = contentWarnings(p).map((w) => w.message);
    expect(msgs).toContain('That is not a Spotify link this page can show.');
    expect(msgs).toContain('Embed needs a title for screen readers');
  });

  it('only says a link works when the website would show it (T324 D2)', () => {
    const place = 'https://www.google.com/maps/place/Bryant+Park/@40.75,-73.98,17z';
    expect(embedSrc('google-maps', place)).toBe('https://www.google.com/maps?q=Bryant%20Park&z=17&output=embed');
    expect(embedStatus('google-maps', place)).toEqual({ state: 'ok', message: 'This map will show on the page.' });
    expect(embedStatus('google-maps', '')).toEqual({ state: 'empty', message: 'Paste a Google Maps link' });
    expect(embedStatus('google-maps', 'https://maps.app.goo.gl/AbC123')).toEqual({
      state: 'bad',
      message: "Short Google Maps links can't be shown. Open the link, then copy the address from the browser's address bar.",
    });
    // Before T325 this was "found" and the preview framed a page Google refuses to frame.
    expect(embedSrc('google-maps', 'https://www.google.com/maps/dir/A/B')).toBeNull();
    expect(embedStatus('google-maps', 'https://www.google.com/maps/dir/A/B').state).toBe('bad');
    expect(embedStatus('youtube', 'https://youtu.be/dQw4w9WgXcQ')).toEqual({ state: 'ok', message: 'This YouTube link will show on the page.' });
    expect(embedProviderFromUrl('https://maps.app.goo.gl/AbC123')).toBe('google-maps');
  });

  it('lets the default title follow the service, and keeps one somebody wrote', () => {
    const fresh = createBlock('embed') as Extract<LearnBlock, { kind: 'embed' }>;
    expect(fresh.title).toBe('Map');
    expect(embedLinkPatch(fresh, 'https://youtu.be/dQw4w9WgXcQ')).toEqual({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      provider: 'youtube',
      title: 'Video',
    });
    expect(embedLinkPatch({ ...fresh, title: 'Our venue' }, 'https://youtu.be/dQw4w9WgXcQ')).toEqual({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      provider: 'youtube',
    });
    expect(embedLinkPatch(fresh, 'https://www.google.com/maps/place/X')).toEqual({ url: 'https://www.google.com/maps/place/X' });
    expect(embedProviderPatch({ provider: 'youtube', title: '' }, 'calendly')).toEqual({ provider: 'calendly', title: 'Calendar' });
  });
});

describe('unfinished links (T325)', () => {
  it('finds a link with no address or one still being typed, in every kind that has links', () => {
    const btn = (href: string) => ({ label: 'Go', href, style: 'primary' as const });
    const cases: [LearnBlock, boolean][] = [
      [{ id: 'a', kind: 'buttons', buttons: [btn('')] }, true],
      [{ id: 'a', kind: 'buttons', buttons: [btn('https://x.example')] }, false],
      [{ id: 'a', kind: 'image', image: { src: '/kgc/a.png', alt: 'a', width: 1, height: 1 }, width: 'full', shape: 'original', href: 'example' }, true],
      [{ id: 'a', kind: 'people', style: 'cards', columns: 3, people: [{ id: 'p', name: 'A', role: '', linkedin: 'linkedin.com/in/x' }] }, true],
      [{ id: 'a', kind: 'list', ordered: false, items: [{ id: 'i', text: 'x', link: btn('https:/') }] }, true],
      [{ id: 'a', kind: 'cards', columns: 2, items: [{ id: 'c', title: 't', text: 'x', link: btn('/tickets') }] }, false],
      [{ id: 'a', kind: 'logos', grayscale: false, items: [{ id: 'l', src: '/kgc/a.png', alt: 'a', width: 1, height: 1, href: 'acme' }] }, true],
      [{ id: 'a', kind: 'divider' }, false],
    ];
    for (const [b, want] of cases) expect(hasUnfinishedLink(b), JSON.stringify(b)).toBe(want);
  });

  it('warns in the editor before publish refuses', () => {
    const p = page();
    p.sections[0].blocks.push({ id: 'bb', kind: 'buttons', buttons: [{ label: 'Go', href: '', style: 'primary' }] });
    expect(contentWarnings(p).map((w) => w.message)).toContain('A link is not finished yet');
  });
});

describe('rich content', () => {
  const doc: RichDoc = {
    type: 'doc',
    content: [
      { type: 'heading', level: 3, content: [{ type: 'text', text: 'Title' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Go ' },
          { type: 'text', text: 'here', marks: [{ type: 'link', href: 'https://a.example' }, { type: 'bold' }] },
          { type: 'text', text: ' now', marks: [{ type: 'link', href: 'https://a.example' }] },
        ],
      },
    ],
  };

  it('reads plain text and words from Markdown and from a doc', () => {
    expect(richToPlainText('**Bold** and [link](https://x.example)')).toBe('Bold and link');
    expect(richToPlainText(doc)).toBe('Title\nGo here now');
    expect(richWordCount(doc)).toBe(4);
  });

  it('joins adjacent runs of one link', () => {
    expect(richLinks(doc)).toEqual([{ href: 'https://a.example', text: 'here now' }]);
  });

  it('maps text runs and keeps the same object when nothing changes', () => {
    expect(mapRichText(doc, (t) => t)).toBe(doc);
    const up = mapRichText(doc, (t) => t.toUpperCase());
    expect(richToPlainText(up)).toBe('TITLE\nGO HERE NOW');
  });

  it('turns the v1 subset into a doc', () => {
    const d = markdownToRichDoc('One **two**\nthree\n\nFour');
    expect(d.content).toHaveLength(2);
    expect(richToPlainText(d)).toBe('One two\nthree\nFour');
  });
});

describe('find and replace', () => {
  it('finds across headings, text and the page title, case-insensitive by default', () => {
    const hits = findInPage(page(), 'graph');
    expect(hits.map((h) => h.where.field)).toEqual(['Page title', 'Text']);
    expect(findInPage(page(), 'Graph', { matchCase: true })).toHaveLength(0);
  });

  it('never matches inside a link address', () => {
    const hits = findInPage(page(), 'example');
    expect(hits).toHaveLength(0);
  });

  it('honours whole words', () => {
    expect(findInPage(page(), 'graph', { wholeWord: true }).map((h) => h.where.field)).toEqual(['Text']);
  });

  it('replaces all, leaving link addresses alone, and reports the count', () => {
    const { content, count } = replaceInPage(page(), 'graph', 'network');
    expect(count).toBe(2);
    expect(content.seoTitle).toBe('Learn networks');
    expect(content.sections[0].blocks[1]).toMatchObject({ text: 'Read the [brochure](https://example.com/graph) about network work.' });
  });

  it('replaces one match by id and leaves the rest', () => {
    const p = page();
    const [first] = findInPage(p, 'graph');
    const { content, count } = replaceInPage(p, 'graph', 'X', {}, first.id);
    expect(count).toBe(1);
    expect(content.seoTitle).toBe('Learn Xs');
    expect(findInPage(content, 'graph')).toHaveLength(1);
  });

  it('replaces inside a RichDoc and returns the same content when nothing matched', () => {
    const p = page();
    p.sections[0].blocks[0] = { id: 'h1', kind: 'heading', level: 2, text: markdownToRichDoc('Hello world') };
    const { content } = replaceInPage(p, 'world', 'there');
    expect(richToPlainText((content.sections[0].blocks[0] as { text: RichDoc }).text)).toBe('Hello there');
    expect(replaceInPage(p, 'nothing here', 'x').content).toBe(p);
  });
});

describe('accessibility checks', () => {
  it('flags a missing description, a jump in headings, a vague link and low contrast', () => {
    const p = page();
    p.sections[0].blocks.push(
      { id: 'i', kind: 'image', image: { ...IMG, alt: '' }, width: 'medium', shape: 'original' },
      { id: 'h4', kind: 'heading', text: 'Deep', level: 4 },
      { id: 'btn', kind: 'buttons', buttons: [{ label: 'Click here', href: 'https://x.example', style: 'primary' }] },
      { id: 'pale', kind: 'text', text: 'Pale', textColor: 'light-blue' },
    );
    const rules = accessibilityIssues(p).map((i) => i.rule);
    expect(rules).toContain('alt');
    expect(rules).toContain('heading-order');
    expect(rules).toContain('vague-link');
    expect(rules).toContain('contrast');
  });

  it('skips hidden blocks and finds nothing on a clean page', () => {
    const p = page();
    p.sections[0].blocks.push({ id: 'i', kind: 'image', image: { ...IMG, alt: '' }, width: 'medium', shape: 'original', hidden: true });
    expect(accessibilityIssues(p)).toEqual([]);
  });

  it('flags an empty button and a table without headers', () => {
    const p = page();
    const table = createBlock('table');
    if (table.kind === 'table') {
      const doc = structuredClone(table.doc);
      const t = doc.content[0] as { content: { content: { type: string }[] }[] };
      t.content[0].content = t.content[0].content.map((c) => ({ ...c, type: 'tableCell' }));
      table.doc = doc;
    }
    p.sections[0].blocks.push({ id: 'b', kind: 'buttons', buttons: [{ label: '', href: '', style: 'primary' }] }, table);
    const rules = accessibilityIssues(p).map((i) => i.rule);
    expect(rules).toContain('empty-link');
    expect(rules).toContain('table-header');
  });

  it('knows vague link words', () => {
    expect(isVagueLinkText('Read more.')).toBe(true);
    expect(isVagueLinkText('Learn more and download the brochure.')).toBe(false);
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
  });
});

describe('link checker', () => {
  it('checks anchors, email, phone, http and unknown schemes', () => {
    const p = page();
    p.sections[1].anchor = 'team';
    p.sections[0].blocks.push({
      id: 'bt',
      kind: 'buttons',
      buttons: [
        { label: 'Team', href: '#team', style: 'text' },
        { label: 'Missing', href: '#nope', style: 'text' },
        { label: 'Mail', href: 'mailto:contact@knowledgegraph.tech', style: 'text' },
        { label: 'Bad mail', href: 'mailto:nobody', style: 'text' },
        { label: 'Call', href: 'tel:+1 212 555 0100', style: 'text' },
        { label: 'Old', href: 'http://example.com', style: 'text' },
        { label: 'Home', href: '/tickets', style: 'text' },
        { label: 'Odd', href: 'ftp://x', style: 'text' },
      ],
    });
    const byLabel = Object.fromEntries(pageLinks(p).map((l) => [l.text, l]));
    expect(byLabel.Team.status).toBe('ok');
    expect(byLabel.Missing.status).toBe('error');
    expect(byLabel.Mail).toMatchObject({ status: 'ok', type: 'email' });
    expect(byLabel['Bad mail'].status).toBe('error');
    expect(byLabel.Call).toMatchObject({ status: 'ok', type: 'phone' });
    expect(byLabel.Old.status).toBe('warning');
    expect(byLabel.Home.type).toBe('internal');
    expect(byLabel.Odd.status).toBe('error');
    expect(byLabel.brochure).toMatchObject({ type: 'external', status: 'ok' });
  });
});

describe('anchors', () => {
  it('slugifies and checks uniqueness', () => {
    expect(slugifyAnchor('Our Team, 2027!')).toBe('our-team-2027');
    expect(slugifyAnchor('Équipe')).toBe('equipe');
    const p = page();
    p.sections[0].anchor = 'team';
    expect(anchorProblem(p, 'team', 's1')).toBeNull();
    expect(anchorProblem(p, 'team', 'a')).toMatch(/already uses #team/);
    expect(anchorProblem(p, 'Team', 'a')).toMatch(/lower-case/);
  });
});

describe('clipboard', () => {
  it('round-trips blocks with fresh ids', () => {
    const blocks = blocksInPageOrder(page(), ['t1', 'h1']);
    expect(blocks.map((b) => b.id)).toEqual(['h1', 't1']);
    const clip = parseClip(serializeClip({ kind: 'blocks', blocks }));
    expect(clip?.kind).toBe('blocks');
    if (clip?.kind !== 'blocks') return;
    expect(clip.blocks.map((b) => b.kind)).toEqual(['heading', 'text']);
    expect(clip.blocks[0].id).not.toBe('h1');
  });

  it('round-trips sections, keeping the name', () => {
    const clip = parseClip(serializeClip({ kind: 'sections', sections: [page().sections[1]] }));
    expect(clip?.kind === 'sections' && clip.sections[0].label).toBe('S2');
    expect(clip?.kind === 'sections' && clip.sections[0].id).not.toBe('s2');
  });

  it('ignores anything that is not ours', () => {
    expect(parseClip('hello')).toBeNull();
    expect(parseClip('{"kgc-learn-clipboard":2,"kind":"blocks","blocks":[]}')).toBeNull();
    expect(parseClip('{"kgc-learn-clipboard":1,"kind":"blocks","blocks":[{"x":1}]}')).toBeNull();
    expect(parseClip('{"kgc-learn-clipboard":1, nope')).toBeNull();
  });
});

describe('selection, outline, status, usage', () => {
  it('selects a range across sections in page order', () => {
    expect(blockRange(page(), 'b', 't1')).toEqual(['t1', 'a', 'b']);
    expect(blockRange(page(), 'gone', 'a')).toEqual(['a']);
  });

  it('filters the outline by any word on the block', () => {
    const m = outlineMatches(page(), 'brochure');
    expect([...(m?.blocks ?? [])]).toEqual(['t1']);
    expect([...(m?.sections ?? [])]).toEqual(['s1']);
    expect(outlineMatches(page(), '  ')).toBeNull();
  });

  it('shows Scheduled over Draft, and Live when nothing is pending', () => {
    const fmt = () => 'tomorrow';
    expect(statusChips({ saveState: 'unsaved', unpublished: true, live: true }, fmt).map((c) => c.label)).toEqual(['Unsaved', 'Draft']);
    expect(statusChips({ saveState: 'saved', unpublished: true, live: true, scheduledAt: 1 }, fmt)[1].label).toBe('Scheduled');
    expect(statusChips({ saveState: 'saved', unpublished: false, live: true }, fmt)[1].label).toBe('Live');
  });

  it('refuses a schedule in the past or too far ahead', () => {
    const now = 1_000_000_000_000;
    expect(scheduleProblem(now, now)).not.toBeNull();
    expect(scheduleProblem(now + 3600_000, now)).toBeNull();
    expect(scheduleProblem(now + 400 * 24 * 3600_000, now)).not.toBeNull();
  });

  it('says where an image is used', () => {
    const p = page();
    p.ogImage = IMG;
    p.sections[1].backgroundImage = IMG;
    p.sections[0].blocks.push({ id: 'g', kind: 'gallery', layout: 'grid', columns: 3, lightbox: true, images: [{ ...IMG, id: 'x' }] });
    expect(imageUsage(p, IMG.src, 'Draft: ')).toEqual(['Draft: Page share image', 'Draft: S1 › Gallery: 1 photo', 'Draft: S2 › background']);
  });
});

describe('saved sections in the preview', () => {
  const text = (id: string, t: string): LearnBlock => ({ id, kind: 'text', text: t, size: 'normal' }) as LearnBlock;
  const linked = (id: string, libraryId: string, extra: Partial<LearnBlock> = {}): LearnBlock =>
    ({ id, kind: 'reusable', libraryId, ...extra }) as LearnBlock;
  const library = new Map([['lib1', section('saved', [text('t1', 'Saved one'), text('t2', 'Saved two')], { background: 'blue' })]]);
  const draft = (blocks: LearnBlock[]): LearnPageContent => ({ seoTitle: 'T', seoDescription: '', sections: [section('a', [text('x', 'Own')]), section('b', blocks)] });

  it('expands a linked section and names each copy\'s host', () => {
    const { content, hosts } = expandForPreview(draft([linked('r1', 'lib1')]), library);
    expect(content.sections[1].blocks.map((b) => b.id)).toEqual(['r1--t1', 'r1--t2']);
    // A section holding only the linked block takes the saved section's look, and keeps its own id.
    expect(content.sections[1]).toMatchObject({ id: 'b', background: 'blue' });
    expect([...hosts]).toEqual([
      ['r1--t1', 'r1'],
      ['r1--t2', 'r1'],
    ]);
  });

  it('leaves sections without linked blocks as the same objects', () => {
    const d = draft([linked('r1', 'lib1')]);
    expect(expandForPreview(d, library).content.sections[0]).toBe(d.sections[0]);
    const plain = draft([text('y', 'No link')]);
    expect(expandForPreview(plain, library).content).toBe(plain);
  });

  it('keeps the placeholder while loading, for a missing saved section and for a hidden link', () => {
    const d = draft([linked('r1', 'lib1')]);
    expect(expandForPreview(d, null).content).toBe(d);
    expect(expandForPreview(draft([linked('r1', 'gone')]), library).content.sections[1].blocks.map((b) => b.id)).toEqual(['r1']);
    const hidden = draft([text('y', 'Own'), linked('r1', 'lib1', { hidden: true })]);
    expect(expandForPreview(hidden, library).content.sections[1].blocks.map((b) => b.id)).toEqual(['y', 'r1']);
  });
});

describe('brand colours', () => {
  const text = (id: string, t: string): LearnBlock => ({ id, kind: 'text', text: t, size: 'normal' }) as LearnBlock;

  it('are the website tokens', () => {
    for (const [name, { hex }] of Object.entries(BRAND_COLORS)) expect(hex).toBe(LEARN_COLORS[name as keyof typeof LEARN_COLORS]);
  });

  it('still warn about light text on a light band', () => {
    const issues = accessibilityIssues({
      seoTitle: 'T',
      seoDescription: '',
      sections: [section('a', [{ ...text('x', 'Pale'), textColor: 'grey' } as LearnBlock], { background: 'grey-wave' })],
    });
    expect(issues.map((i) => i.rule)).toContain('contrast');
    expect(sectionBgHex(section('a', [], { backgroundImage: IMG, overlay: 0.3 }))).toBe(LEARN_COLORS.dark);
  });
});
