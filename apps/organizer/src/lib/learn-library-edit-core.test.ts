import { describe, expect, it } from 'vitest';
import { expandReusableBlocks, type LearnBlock, type LearnPageContent, type LearnSection } from '@kgc/shared';
import { summarizeChanges } from './learn-editor-core';
import { publishBlockers, publishProblems, sameContent } from './learn-page-core';
import {
  canonicalContent,
  draftDiffersFromLive,
  draftPublishBlockers,
  expandForCompare,
  finishSavedSectionEdit,
  linkedHostBlock,
  savedSectionFromEdit,
  startEditFromBlock,
  startEditFromLibrary,
  takesSavedLook,
  unlinkReusable,
} from './learn-library-edit-core';

function section(id: string, blocks: LearnBlock[], extra: Partial<LearnSection> = {}): LearnSection {
  return { id, label: id.toUpperCase(), background: 'plain', width: 'normal', paddingTop: 'none', paddingBottom: 'none', blocks, ...extra };
}

const SAVED: LearnSection = section(
  'lib-src',
  [
    { id: 'h', kind: 'heading', text: 'Team', level: 2, anchor: 'team' },
    { id: 't', kind: 'text', text: 'We teach graphs.' },
  ],
  { label: 'Team band', background: 'blue', paddingTop: 'medium', paddingBottom: 'medium', layout: 'two-equal', blockColumn: { t: 1 } },
);

const LIB = new Map([['L1', SAVED]]);

function linkedPage(extra: Partial<LearnSection> = {}): LearnPageContent {
  return {
    seoTitle: 'Learn',
    seoDescription: '',
    sections: [
      section('s1', [{ id: 'intro', kind: 'text', text: 'Hello' }]),
      section('s2', [{ id: 'r1', kind: 'reusable', libraryId: 'L1' }], { label: 'Team here', ...extra }),
    ],
  };
}

function mixedPage(): LearnPageContent {
  return {
    seoTitle: 'Learn',
    seoDescription: '',
    sections: [
      section(
        's1',
        [
          { id: 'a', kind: 'text', text: 'Before' },
          { id: 'r1', kind: 'reusable', libraryId: 'L1' },
          { id: 'b', kind: 'text', text: 'After' },
        ],
        { layout: 'two-equal', blockColumn: { r1: 1, b: 1 } },
      ),
    ],
  };
}

describe('the draft against the live page (E F2)', () => {
  it('a published page with a linked section is not a change', () => {
    const draft = linkedPage();
    const live = expandReusableBlocks(draft, LIB);
    expect(draftDiffersFromLive(draft, live, LIB, true)).toBe(false);
    // Comparing the raw draft, as the chip used to, always said "Draft".
    expect(sameContent(draft, live)).toBe(false);
  });

  it('a change to the saved section is a change', () => {
    const draft = linkedPage();
    const live = expandReusableBlocks(draft, LIB);
    const edited = new Map([['L1', { ...SAVED, background: 'grey-wave' as const }]]);
    expect(draftDiffersFromLive(draft, live, edited, false)).toBe(true);
  });

  it("keeps the server's answer until the library has loaded", () => {
    const draft = linkedPage();
    expect(draftDiffersFromLive(draft, null, null, false)).toBe(false);
    expect(draftDiffersFromLive(draft, null, null, true)).toBe(true);
  });

  it('the change list compares like with like, whatever the key order', () => {
    const draft = linkedPage();
    const live = canonicalContent(JSON.parse(JSON.stringify(expandReusableBlocks(draft, LIB))) as LearnPageContent);
    // A library row whose keys come in another order.
    const shuffled = new Map([['L1', Object.fromEntries(Object.entries(SAVED).reverse()) as unknown as LearnSection]]);
    const s = summarizeChanges(live, canonicalContent(expandForCompare(draft, shuffled)));
    expect(s.total).toBe(0);
  });
});

describe('publish blockers on the expanded draft (C X2, E F7)', () => {
  it('names an empty Image block inside a linked section, at the Saved section block', () => {
    const lib = new Map([
      ['L1', section('x', [{ id: 'img', kind: 'image', image: { src: '', alt: '', width: 0, height: 0 }, width: 'medium', shape: 'original' }])],
    ]);
    const draft = linkedPage();
    expect(publishBlockers(draft)).toEqual([]);
    const blockers = draftPublishBlockers(draft, lib);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].message).toContain('The Image block in "Team here" has no image yet');
    expect(blockers[0]).toMatchObject({ sectionId: 's2', blockId: 'r1' });
  });

  it('names a Saved section block with nothing chosen, and one whose saved section was deleted', () => {
    const draft: LearnPageContent = {
      ...linkedPage(),
      sections: [
        section('s1', [{ id: 'r0', kind: 'reusable', libraryId: '' }], { label: 'Empty' }),
        section('s2', [{ id: 'r1', kind: 'reusable', libraryId: 'GONE' }], { label: 'Old' }),
      ],
    };
    const blockers = draftPublishBlockers(draft, LIB);
    expect(blockers.map((b) => b.blockId)).toEqual(['r0', 'r1']);
    expect(blockers[0].message).toContain('The Saved section block in "Empty"');
    expect(blockers[1].message).toContain('"Old"');
  });

  it('is the list the server refuses with, and says where each one is', () => {
    const draft: LearnPageContent = {
      seoTitle: '',
      seoDescription: '',
      sections: [section('s1', [{ id: 'v', kind: 'video', url: '' }, { id: 'v2', kind: 'video', url: ' ' }])],
    };
    const blockers = draftPublishBlockers(draft, LIB);
    expect(blockers.map((b) => b.message)).toEqual(publishProblems(draft, LIB, draft));
    expect(blockers.map((b) => b.blockId)).toEqual([undefined, 'v', 'v2']);
  });
});

describe('Unlink (E F3)', () => {
  it('a linked whole section becomes an editable copy drawn exactly as before', () => {
    const draft = linkedPage({ anchor: 'people' });
    const next = unlinkReusable(draft, 's2', 'r1', LIB)!;
    expect(next.sections[1].blocks.some((b) => b.kind === 'reusable')).toBe(false);
    expect(next.sections[1]).toMatchObject({ id: 's2', label: 'Team here', background: 'blue', paddingTop: 'medium', anchor: 'people' });
    // What Publish would have put live, so Unlink alone is not a change.
    expect(sameContent(next, expandReusableBlocks(draft, LIB))).toBe(true);
    // The library row is not touched.
    expect(SAVED.blocks[0].id).toBe('h');
  });

  it('a link among other blocks is replaced in place, in its column', () => {
    const draft = mixedPage();
    const next = unlinkReusable(draft, 's1', 'r1', LIB)!;
    const ids = next.sections[0].blocks.map((b) => b.id);
    expect(ids[0]).toBe('a');
    expect(ids[ids.length - 1]).toBe('b');
    expect(ids).toHaveLength(4);
    expect(next.sections[0].blockColumn).toEqual({ b: 1, [ids[1]]: 1, [ids[2]]: 1 });
    expect(sameContent(next, expandReusableBlocks(draft, LIB))).toBe(true);
  });

  it('gives nothing back when the saved section is gone', () => {
    expect(unlinkReusable(linkedPage(), 's2', 'r1', new Map())).toBeNull();
    expect(unlinkReusable(linkedPage(), 's2', 'nope', LIB)).toBeNull();
  });
});

describe('changing a saved section from the page (E F1)', () => {
  it('a whole linked section: edit, save to the library, and the link comes back', () => {
    const draft = linkedPage({ anchor: 'people' });
    const started = startEditFromBlock(draft, 's2', 'r1', LIB, 'Team band')!;
    expect(started.edit.restore.kind).toBe('whole');
    const editing = started.content.sections[1];
    expect(editing.background).toBe('blue');
    expect(editing.blocks.some((b) => b.kind === 'reusable')).toBe(false);

    // The course lead changes the background and the text, and adds a block.
    const changed: LearnPageContent = {
      ...started.content,
      sections: started.content.sections.map((s) =>
        s.id === editing.id
          ? {
              ...s,
              background: 'grey-wave' as const,
              label: 'Team (renamed here)',
              blocks: [
                ...s.blocks.map((b) => (b.kind === 'text' ? { ...b, text: 'We teach knowledge graphs.' } : b)),
                { id: 'new1', kind: 'divider' } as LearnBlock,
              ],
            }
          : s,
      ),
    };
    const stored = savedSectionFromEdit(changed, started.edit, SAVED)!;
    expect(stored).toMatchObject({ id: 'lib-src', label: 'Team band', background: 'grey-wave' });
    expect(stored.blocks.map((b) => b.id)).toEqual(['h', 't', 'new1']);
    expect(stored.blocks[0].anchor).toBe('team');
    expect(stored.blockColumn).toEqual({ t: 1 });
    expect(stored.anchor).toBeUndefined();

    const back = finishSavedSectionEdit(changed, started.edit);
    expect(back.sections[1].blocks).toEqual([{ id: 'r1', kind: 'reusable', libraryId: 'L1' }]);
    expect(back.sections[1]).toMatchObject({ id: 's2', label: 'Team (renamed here)', anchor: 'people' });
    // With the library updated, the page draws the change.
    const after = expandReusableBlocks(back, new Map([['L1', stored]]));
    expect(after.sections[1].background).toBe('grey-wave');
    expect(after.sections[1].blocks).toHaveLength(3);
  });

  it('Cancel puts the link back exactly', () => {
    const draft = linkedPage();
    const started = startEditFromBlock(draft, 's2', 'r1', LIB, 'Team band')!;
    expect(finishSavedSectionEdit(started.content, started.edit)).toEqual(draft);
  });

  it('a link among other blocks gets a section of its own while it is changed', () => {
    const draft = mixedPage();
    const started = startEditFromBlock(draft, 's1', 'r1', LIB, 'Team band')!;
    expect(started.content.sections).toHaveLength(2);
    expect(started.content.sections[0].blocks.map((b) => b.id)).toEqual(['a', 'b']);
    expect(started.content.sections[1]).toMatchObject({ label: 'Team band', background: 'blue' });
    const back = finishSavedSectionEdit(started.content, started.edit);
    expect(back).toEqual(draft);
  });

  it('from the library list: a copy goes in, and goes again afterwards', () => {
    const draft = linkedPage();
    const started = startEditFromLibrary(draft, 1, 'L1', SAVED, 'Team band');
    expect(started.content.sections).toHaveLength(3);
    expect(started.content.sections[1].label).toBe('Team band');
    expect(savedSectionFromEdit(started.content, started.edit, SAVED)?.blocks.map((b) => b.id)).toEqual(['h', 't']);
    expect(finishSavedSectionEdit(started.content, started.edit)).toEqual(draft);
  });

  it('keeps an anchor the page already uses off the copy, and puts it back in the library', () => {
    const draft: LearnPageContent = { ...linkedPage(), sections: [section('s0', [], { anchor: 'team' }), ...linkedPage().sections] };
    const started = startEditFromBlock(draft, 's2', 'r1', LIB, 'Team band')!;
    expect(started.content.sections[2].blocks[0].anchor).toBeUndefined();
    expect(savedSectionFromEdit(started.content, started.edit, SAVED)?.blocks[0].anchor).toBe('team');
  });
});

describe('which section takes the saved look (E F4)', () => {
  it('only a section whose one visible block is the link', () => {
    expect(takesSavedLook(linkedPage().sections[1], 'r1')).toBe(true);
    expect(linkedHostBlock(linkedPage().sections[1])?.id).toBe('r1');
    expect(takesSavedLook(mixedPage().sections[0], 'r1')).toBe(false);
    expect(linkedHostBlock(mixedPage().sections[0])).toBeNull();
  });
});
