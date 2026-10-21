import { describe, expect, it } from 'vitest';
import type { LearnPageContent } from '@kgc/shared';
import {
  COALESCE_MS,
  HISTORY_LIMIT,
  applyEdit,
  contentWarnings,
  createBlock,
  docToMarkdown,
  markdownToDoc,
  pushEdit,
  redo,
  repairSelection,
  startHistory,
  summarizeChanges,
  undo,
  videoEmbedUrl,
} from './learn-editor-core';

function page(): LearnPageContent {
  return {
    seoTitle: 'Learn',
    seoDescription: 'About',
    sections: [
      {
        id: 's1',
        label: 'Hero',
        background: 'grey-wave',
        width: 'wide',
        paddingTop: 'none',
        paddingBottom: 'large',
        blocks: [
          { id: 'h1', kind: 'heading', text: 'Hello', level: 1 },
          { id: 't1', kind: 'text', text: 'Body' },
        ],
      },
      {
        id: 's2',
        label: 'Team',
        background: 'white-wave',
        width: 'normal',
        paddingTop: 'large',
        paddingBottom: 'large',
        blocks: [
          {
            id: 'pp',
            kind: 'people',
            style: 'cards',
            columns: 3,
            people: [{ id: 'p1', name: 'Ada', role: 'Lead' }],
          },
        ],
      },
    ],
  };
}

const ids = (c: LearnPageContent, s: number) => c.sections[s].blocks.map((b) => b.id);

describe('applyEdit', () => {
  it('updates one block and leaves the input untouched', () => {
    const before = page();
    const after = applyEdit(before, { type: 'updateBlock', sectionId: 's1', blockId: 'h1', patch: { text: 'Hi' } });
    expect(after.sections[0].blocks[0]).toMatchObject({ text: 'Hi', level: 1 });
    expect(before.sections[0].blocks[0]).toMatchObject({ text: 'Hello' });
    expect(after.sections[1]).toBe(before.sections[1]);
  });

  it('returns the same object for an edit naming nothing', () => {
    const before = page();
    expect(applyEdit(before, { type: 'updateBlock', sectionId: 'nope', blockId: 'h1', patch: { text: 'x' } })).toBe(before);
    expect(applyEdit(before, { type: 'moveBlock', sectionId: 's1', blockId: 'zz', toSectionId: 's2', toIndex: 0 })).toBe(before);
  });

  it('moves a block within a section and across sections', () => {
    const within = applyEdit(page(), { type: 'moveBlock', sectionId: 's1', blockId: 'h1', toSectionId: 's1', toIndex: 1 });
    expect(ids(within, 0)).toEqual(['t1', 'h1']);
    const across = applyEdit(page(), { type: 'moveBlock', sectionId: 's1', blockId: 't1', toSectionId: 's2', toIndex: 0 });
    expect(ids(across, 0)).toEqual(['h1']);
    expect(ids(across, 1)).toEqual(['t1', 'pp']);
  });

  it('moves sections and clamps the target index', () => {
    const moved = applyEdit(page(), { type: 'moveSection', sectionId: 's1', toIndex: 99 });
    expect(moved.sections.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it('duplicates with fresh ids all the way down', () => {
    const dup = applyEdit(page(), { type: 'duplicateSection', sectionId: 's2' });
    expect(dup.sections).toHaveLength(3);
    const copy = dup.sections[2];
    expect(copy.id).not.toBe('s2');
    expect(copy.label).toBe('Team copy');
    const people = copy.blocks[0];
    expect(people.id).not.toBe('pp');
    if (people.kind !== 'people') throw new Error('kind');
    expect(people.people[0].id).not.toBe('p1');
    expect(people.people[0].name).toBe('Ada');
    const all = dup.sections.flatMap((s) => [s.id, ...s.blocks.map((b) => b.id)]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('inserts, removes and hides', () => {
    const block = createBlock('divider');
    let c = applyEdit(page(), { type: 'insertBlock', sectionId: 's1', index: 1, block });
    expect(ids(c, 0)).toEqual(['h1', block.id, 't1']);
    c = applyEdit(c, { type: 'updateBlock', sectionId: 's1', blockId: block.id, patch: { hidden: true } });
    expect(c.sections[0].blocks[1].hidden).toBe(true);
    c = applyEdit(c, { type: 'removeBlock', sectionId: 's1', blockId: block.id });
    expect(ids(c, 0)).toEqual(['h1', 't1']);
    c = applyEdit(c, { type: 'removeSection', sectionId: 's1' });
    expect(c.sections.map((s) => s.id)).toEqual(['s2']);
  });

  it('creates every kind with an id the server accepts', () => {
    for (const kind of ['heading', 'text', 'image', 'buttons', 'people', 'list', 'columns', 'video', 'divider', 'spacer'] as const) {
      const b = createBlock(kind);
      expect(b.kind).toBe(kind);
      expect(b.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    }
  });
});

describe('repairSelection', () => {
  it('follows a block that moved and falls back when it is gone', () => {
    const moved = applyEdit(page(), { type: 'moveBlock', sectionId: 's1', blockId: 't1', toSectionId: 's2', toIndex: 0 });
    expect(repairSelection(moved, { kind: 'block', sectionId: 's1', blockId: 't1' })).toEqual({
      kind: 'block',
      sectionId: 's2',
      blockId: 't1',
    });
    const gone = applyEdit(page(), { type: 'removeBlock', sectionId: 's1', blockId: 't1' });
    expect(repairSelection(gone, { kind: 'block', sectionId: 's1', blockId: 't1' })).toEqual({ kind: 'section', sectionId: 's1' });
    const noSection = applyEdit(page(), { type: 'removeSection', sectionId: 's1' });
    expect(repairSelection(noSection, { kind: 'section', sectionId: 's1' })).toEqual({ kind: 'page' });
  });
});

describe('undo stack', () => {
  const type = (text: string) => ({ type: 'updateBlock' as const, sectionId: 's1', blockId: 'h1', patch: { text } });

  it('undoes and redoes', () => {
    let h = startHistory(page());
    h = pushEdit(h, { type: 'removeSection', sectionId: 's2' }, 0);
    h = pushEdit(h, { type: 'updateSection', sectionId: 's1', patch: { width: 'narrow' } }, 10_000);
    expect(h.present.sections).toHaveLength(1);
    h = undo(h);
    expect(h.present.sections[0].width).toBe('wide');
    h = undo(h);
    expect(h.present.sections).toHaveLength(2);
    expect(undo(h)).toBe(h);
    h = redo(redo(h));
    expect(h.present.sections[0].width).toBe('narrow');
    expect(redo(h)).toBe(h);
  });

  it('merges quick typing in one field into one step', () => {
    let h = startHistory(page());
    h = pushEdit(h, type('H'), 1000);
    h = pushEdit(h, type('He'), 1100);
    h = pushEdit(h, type('Hey'), 1200);
    expect(h.past).toHaveLength(1);
    h = pushEdit(h, type('Hey!'), 1200 + COALESCE_MS + 1);
    expect(h.past).toHaveLength(2);
    expect(undo(h).present.sections[0].blocks[0]).toMatchObject({ text: 'Hey' });
    expect(undo(undo(h)).present.sections[0].blocks[0]).toMatchObject({ text: 'Hello' });
  });

  it('never merges toggles, and a new edit clears redo', () => {
    let h = startHistory(page());
    const hide = (hidden: boolean) => ({ type: 'updateBlock' as const, sectionId: 's1', blockId: 'h1', patch: { hidden } });
    h = pushEdit(h, hide(true), 0);
    h = pushEdit(h, hide(false), 10);
    expect(h.past).toHaveLength(2);
    h = undo(h);
    expect(h.future).toHaveLength(1);
    h = pushEdit(h, type('x'), 20);
    expect(h.future).toHaveLength(0);
  });

  it('ignores no-op edits and caps its length', () => {
    let h = startHistory(page());
    expect(pushEdit(h, { type: 'removeSection', sectionId: 'nope' }, 0)).toBe(h);
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      h = pushEdit(h, { type: 'updateSection', sectionId: 's1', patch: { paddingTop: i % 2 ? 'small' : 'large' } }, i);
    }
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe('summarizeChanges', () => {
  it('is empty for identical content', () => {
    expect(summarizeChanges(page(), page()).total).toBe(0);
  });

  it('treats everything as added when nothing is published', () => {
    const s = summarizeChanges(null, page());
    expect(s.sectionsAdded).toEqual(['Hero', 'Team']);
    expect(s.blocksAdded).toHaveLength(3);
  });

  it('names added, removed, edited and moved things', () => {
    let after = applyEdit(page(), { type: 'updateBlock', sectionId: 's1', blockId: 'h1', patch: { text: 'Welcome' } });
    after = applyEdit(after, { type: 'removeBlock', sectionId: 's1', blockId: 't1' });
    const added = createBlock('divider');
    after = applyEdit(after, { type: 'insertBlock', sectionId: 's2', index: 0, block: added });
    after = applyEdit(after, { type: 'updateSection', sectionId: 's2', patch: { background: 'blue' } });
    after = applyEdit(after, { type: 'moveSection', sectionId: 's2', toIndex: 0 });
    after = applyEdit(after, { type: 'setPage', patch: { seoTitle: 'New' } });
    const s = summarizeChanges(page(), after);
    expect(s.blocksEdited).toEqual(['Heading: Welcome (Hero)']);
    expect(s.blocksRemoved).toEqual(['Text: Body (Hero)']);
    expect(s.blocksAdded).toEqual(['Divider (Team)']);
    expect(s.sectionsEdited).toEqual(['Team']);
    expect(s.sectionsMoved.sort()).toEqual(['Hero', 'Team']);
    expect(s.pageEdited).toBe(true);
    // An insertion above a block does not count as moving it.
    expect(s.blocksMoved).toEqual([]);
  });

  it('counts a block that changed section as moved, not removed and added', () => {
    const after = applyEdit(page(), { type: 'moveBlock', sectionId: 's1', blockId: 't1', toSectionId: 's2', toIndex: 1 });
    const s = summarizeChanges(page(), after);
    expect(s.blocksMoved).toEqual(['Text: Body (Team)']);
    expect(s.blocksAdded).toEqual([]);
    expect(s.blocksRemoved).toEqual([]);
  });
});

describe('warnings', () => {
  it('flags images without alt text and odd video links', () => {
    const c = page();
    c.sections[0].blocks.push(
      { id: 'im', kind: 'image', image: { src: '/kgc/x.png', alt: ' ', width: 1, height: 1 }, width: 'small', shape: 'original' },
      { id: 'vd', kind: 'video', url: 'https://example.com/v' },
    );
    expect(contentWarnings(c).map((w) => w.blockId)).toEqual(['im', 'vd']);
  });
});

describe('videoEmbedUrl', () => {
  it('accepts YouTube and Vimeo only', () => {
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbedUrl('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871');
    expect(videoEmbedUrl('http://youtu.be/dQw4w9WgXcQ')).toBeNull();
    expect(videoEmbedUrl('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(videoEmbedUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('rich text round trip', () => {
  const cases = [
    'Plain words.',
    'Some **bold** and *italic* and a [link](https://kgc.example/x).',
    'Line one\nLine two',
    'Para one.\n\nPara two with **bold**.',
    '**[Bold link](mailto:a@b.c)** after',
  ];
  for (const md of cases) {
    it(`keeps ${JSON.stringify(md)}`, () => {
      expect(docToMarkdown(markdownToDoc(md))).toBe(md);
    });
  }

  it('keeps spaces outside the markers', () => {
    expect(
      docToMarkdown({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: ' bold ', marks: [{ type: 'bold' }] },
              { type: 'text', text: 'b' },
            ],
          },
        ],
      }),
    ).toBe('a **bold** b');
  });

  it('reads underscores as italic and writes them back as stars', () => {
    expect(docToMarkdown(markdownToDoc('_soft_'))).toBe('*soft*');
  });
});
