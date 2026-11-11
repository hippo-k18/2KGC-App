import { describe, expect, it } from 'vitest';
import type { LearnBlock, LearnPageContent, LearnSection } from '@kgc/shared';
import {
  BLOCK_KINDS,
  STARTER_TEXT,
  columnCountPatch,
  contentWarnings,
  createBlock,
  createSection,
  sectionPickLabels,
  starterLines,
  type BlockOf,
} from './learn-editor-core';
import { accessibilityIssues } from './learn-tools-core';

/** T328: starter text warnings, the embed title, Image and text, Columns count and the Move to list. */

function section(id: string, blocks: LearnBlock[], extra: Partial<LearnSection> = {}): LearnSection {
  return { id, label: 'Hero', background: 'plain', width: 'normal', paddingTop: 'large', paddingBottom: 'large', blocks, ...extra };
}

function pageWith(...blocks: LearnBlock[]): LearnPageContent {
  return { seoTitle: 'Learn', seoDescription: 'About', sections: [section('s1', blocks)] };
}

function block(kind: LearnBlock['kind'], patch: Record<string, unknown> = {}): LearnBlock {
  return { ...createBlock(kind), ...patch } as LearnBlock;
}

describe('starter text (T326 N3)', () => {
  it('comes from createBlock itself, for every kind', () => {
    expect(Object.keys(STARTER_TEXT).sort()).toEqual(BLOCK_KINDS.map((k) => k.kind).sort());
    expect([...STARTER_TEXT.heading]).toEqual(['New heading']);
    expect([...STARTER_TEXT.text]).toEqual(['Write something here.']);
    expect(STARTER_TEXT.cards.has('Second card')).toBe(true);
    expect(STARTER_TEXT.cards.has('A line about it.')).toBe(true);
    expect([...STARTER_TEXT.quote]).toEqual(expect.arrayContaining(['Name', 'Role']));
    expect(STARTER_TEXT.imageText.has('A short title')).toBe(true);
    expect(STARTER_TEXT.table.has('Cell')).toBe(true);
    // Fine as they are: the embed's screen-reader title, the contents title, the countdown labels.
    expect(STARTER_TEXT.embed.size).toBe(0);
    expect(STARTER_TEXT.toc.size).toBe(0);
    expect(STARTER_TEXT.countdown.size).toBe(0);
  });

  it('finds every starter line in each new block, so none can drift', () => {
    for (const { kind } of BLOCK_KINDS) {
      const b = createBlock(kind);
      expect(starterLines(b).sort()).toEqual([...STARTER_TEXT[kind]].sort());
    }
  });

  it('warns in the Publish list, naming the block, for a blank section left as it is', () => {
    const p: LearnPageContent = { seoTitle: 'Learn', seoDescription: 'About', sections: [createSection('Hero')] };
    const msgs = contentWarnings(p).map((w) => w.message);
    expect(msgs).toContain('The Heading block in "Hero" still has starter text: "New heading"');
    expect(msgs).toContain('The Text block in "Hero" still has starter text: "Write something here."');
  });

  it('names the first line and counts the rest, and points at the block', () => {
    const cards = block('cards');
    const ws = contentWarnings(pageWith(cards)).filter((w) => /starter/.test(w.message));
    expect(ws).toEqual([
      { sectionId: 's1', blockId: cards.id, message: 'The Cards block in "Hero" still has starter text: "First card" and 3 more' },
    ]);
  });

  it('compares after trimming, and only whole fields or paragraphs', () => {
    expect(starterLines(block('heading', { text: '  New heading  ' }))).toEqual(['New heading']);
    expect(starterLines(block('heading', { text: 'New heading for the spring cohort' }))).toEqual([]);
    expect(starterLines(block('text', { text: 'Write something here. Then more.' }))).toEqual([]);
    // A starter paragraph left under the course lead's own one is still starter text.
    expect(starterLines(block('text', { text: 'Our own words.\n\nWrite something here.' }))).toEqual(['Write something here.']);
    expect(starterLines(block('quote', { text: 'Great course.', name: 'Ada Lovelace', role: 'Role' }))).toEqual(['Role']);
  });

  it('only flags a starter in the kind it came from', () => {
    // "Name" is the Quote and People starter, not a Heading one.
    expect(starterLines(block('heading', { text: 'Name' }))).toEqual([]);
  });

  it('treats a figure and its label as one, so changing the figure is enough', () => {
    const stats = createBlock('stats') as BlockOf<'stats'>;
    const edited = { ...stats, items: stats.items.map((i, n) => (n === 0 ? { ...i, value: '800' } : i)) };
    expect(starterLines(edited)).toEqual(['4 Programmes', '2023 Founded']);
  });

  it('is a warning in the checks, naming the block, and not for hidden blocks', () => {
    const quote = block('quote', { text: 'It changed how I work.' });
    const issues = accessibilityIssues(pageWith(quote)).filter((i) => i.rule === 'starter-text');
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: 'The Quote block still has starter text: "Name" and 1 more.',
        where: { sectionId: 's1', blockId: quote.id, field: 'Quote' },
      }),
    ]);
    const hidden = { ...quote, hidden: true } as LearnBlock;
    expect(accessibilityIssues(pageWith(hidden)).filter((i) => i.rule === 'starter-text')).toEqual([]);
    expect(contentWarnings(pageWith(hidden)).filter((w) => /starter/.test(w.message))).toEqual([]);
  });
});

describe('embed title (T326 item 6)', () => {
  it('is not a problem in the checks when empty', () => {
    const embed = block('embed', { url: 'https://www.google.com/maps?q=Bryant+Park', title: '' });
    expect(accessibilityIssues(pageWith(embed))).toEqual([]);
    expect(contentWarnings(pageWith(embed))).toEqual([]);
  });
});

describe('Image and text with no picture', () => {
  it('says the text shows on its own, not that something is wrong', () => {
    const it2 = block('imageText', { text: 'Our own words.' });
    expect(contentWarnings(pageWith(it2)).map((w) => w.message)).toEqual(['No picture yet; the text shows on its own']);
  });
});

describe('columnCountPatch (T324 D10)', () => {
  const cols = createBlock('columns') as BlockOf<'columns'>;

  it('adds empty columns up to the number picked', () => {
    const p = columnCountPatch(cols, 3);
    expect(p.columns).toBe(3);
    expect(p.items).toHaveLength(3);
    expect(p.items.slice(0, 2)).toEqual(cols.items);
    expect(p.items[2]).toEqual({ id: expect.stringMatching(/^c/), title: '', text: '' });
    expect(columnCountPatch(cols, 4).items).toHaveLength(4);
  });

  it('picking fewer removes empty columns from the end but keeps filled ones', () => {
    const four = { ...cols, ...columnCountPatch(cols, 4) };
    const back = columnCountPatch(four, 2);
    expect(back).toEqual({ columns: 2, items: cols.items });
    // Filled columns stay and wrap onto the next row.
    expect(columnCountPatch(cols, 1)).toEqual({ columns: 1, items: cols.items });
    // An empty column before a filled one is left alone: only the end is trimmed.
    const gap = { ...cols, columns: 3 as const, items: [cols.items[0], { id: 'cx', title: '', text: '' }, cols.items[1]] };
    expect(columnCountPatch(gap, 2).items).toEqual(gap.items);
  });

  it('counts an image or a link as something in the column', () => {
    const img = { ...cols, columns: 3 as const, items: [...cols.items, { id: 'ci', title: '', text: '', image: { src: '/a.png', alt: 'A', width: 1, height: 1 } }] };
    expect(columnCountPatch(img, 2).items).toHaveLength(3);
  });
});

describe('sectionPickLabels (T324 D16)', () => {
  it('adds the position only to names used more than once', () => {
    expect(sectionPickLabels([{ label: 'Hero' }, { label: 'Team' }, { label: ' ' }, { label: 'Hero' }])).toEqual([
      'Hero (section 1)',
      'Team',
      'Untitled section',
      'Hero (section 4)',
    ]);
    expect(sectionPickLabels([{ label: '' }, { label: '' }])).toEqual(['Untitled section (section 1)', 'Untitled section (section 2)']);
  });
});
