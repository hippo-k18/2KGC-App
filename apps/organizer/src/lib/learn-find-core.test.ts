import { describe, expect, it } from 'vitest';
import type { LearnBlock, LearnPageContent, LearnSection, RichDoc } from '@kgc/shared';
import { findOnPage, LOCKED_LINKED, LOCKED_SPLIT, lockedSummary } from './learn-find-core';
import { replaceInPage } from './learn-tools-core';

function section(id: string, blocks: LearnBlock[], label = id): LearnSection {
  return { id, label, background: 'plain', width: 'normal', paddingTop: 'none', paddingBottom: 'none', blocks };
}

const doc = (...runs: { text: string; bold?: boolean }[]): RichDoc => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: runs.map((r) => ({ type: 'text' as const, text: r.text, ...(r.bold ? { marks: [{ type: 'bold' as const }] } : {}) })),
    },
  ],
});

const SAVED = section('lib', [{ id: 'h', kind: 'heading', text: 'Thomas Deely leads', level: 2 }], 'Team band');
const LIB = new Map([['L1', SAVED]]);
const NAMES = new Map([['L1', 'Team band']]);

const PAGE: LearnPageContent = {
  seoTitle: 'Learn',
  seoDescription: '',
  sections: [
    section('s1', [{ id: 't1', kind: 'text', text: doc({ text: 'Meet Thomas Deely here' }) }], 'Team'),
    section('s2', [{ id: 'r1', kind: 'reusable', libraryId: 'L1' }], 'Linked team'),
    section('s3', [{ id: 't3', kind: 'text', text: doc({ text: 'Thomas Deely again' }) }], 'More'),
  ],
};

describe('Find lists matches in linked sections (T324 E F12)', () => {
  it('finds the text of a linked section, in page order, with Replace off', () => {
    const hits = findOnPage(PAGE, 'Thomas Deely', {}, LIB, NAMES);
    expect(hits.map((h) => h.where.blockId)).toEqual(['t1', 'r1', 't3']);
    const linked = hits[1];
    expect(linked.where).toEqual({ sectionId: 's2', blockId: 'r1', field: 'Heading' });
    expect(linked.locked).toBe(LOCKED_LINKED);
    expect(linked.savedSection).toBe('Team band');
    expect(hits[0].locked).toBeUndefined();
  });

  it('Replace all changes the page text and leaves the linked one, and says so', () => {
    const hits = findOnPage(PAGE, 'Thomas Deely', {}, LIB, NAMES);
    const res = replaceInPage(PAGE, 'Thomas Deely', 'T. D.', {});
    expect(res.count).toBe(hits.filter((h) => !h.locked).length);
    expect(lockedSummary(hits)).toBe('1 in a saved section stays as it is.');
  });

  it('finds nothing extra while the library loads, or for a deleted saved section', () => {
    expect(findOnPage(PAGE, 'Thomas Deely', {}, null)).toHaveLength(2);
    expect(findOnPage(PAGE, 'Thomas Deely', {}, new Map())).toHaveLength(2);
  });

  it('a single replace by id still lands on the right match', () => {
    const hits = findOnPage(PAGE, 'Thomas Deely', {}, LIB, NAMES);
    const res = replaceInPage(PAGE, 'Thomas Deely', 'X', {}, hits[2].id);
    expect(res.count).toBe(1);
    expect(JSON.stringify(res.content.sections[2])).toContain('X again');
  });
});

describe('a word split by formatting (T324 E F12)', () => {
  const page: LearnPageContent = {
    seoTitle: '',
    seoDescription: '',
    sections: [
      section('s1', [
        { id: 'a', kind: 'text', text: doc({ text: 'One ' }, { text: 'Giz', bold: true }, { text: 'mo and a Gizmo' }) },
      ]),
    ],
  };

  it('finds "**Giz**mo" as Gizmo, in order, with Replace off', () => {
    const hits = findOnPage(page, 'gizmo');
    expect(hits.map((h) => [h.before, h.match, h.locked ?? null])).toEqual([
      ['One ', 'Gizmo', LOCKED_SPLIT],
      ['mo and a ', 'Gizmo', null],
    ]);
    expect(lockedSummary(hits)).toBe('1 with mixed formatting stays as it is.');
  });

  it('respects whole word on the joined text', () => {
    // "Giz" + "mo and a Gizmo": the split "Gizmo" is whole, "Gizmo a" is not.
    expect(findOnPage(page, 'Gizmo', { wholeWord: true }).map((h) => h.locked ?? null)).toEqual([LOCKED_SPLIT, null]);
    expect(findOnPage(page, 'Gizmo a', { wholeWord: true })).toHaveLength(0);
    expect(findOnPage(page, 'zmo', { wholeWord: true })).toHaveLength(0);
  });

  it('does not join across a line break', () => {
    const broken: LearnPageContent = {
      ...page,
      sections: [
        section('s1', [
          {
            id: 'a',
            kind: 'text',
            text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Giz' }, { type: 'hardBreak' }, { type: 'text', text: 'mo' }] }] },
          },
        ]),
      ],
    };
    expect(findOnPage(broken, 'Gizmo')).toHaveLength(0);
  });
});
