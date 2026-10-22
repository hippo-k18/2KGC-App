import { describe, expect, it } from 'vitest';
import type { LearnBlock, LearnPageContent, LearnSection } from '@kgc/shared';
import { expandForView, readOnlyViewNote, VERSION_LIBRARY_NOTE } from './learn-version-view-core';

function section(id: string, blocks: LearnBlock[]): LearnSection {
  return { id, label: id, background: 'plain', width: 'normal', paddingTop: 'none', paddingBottom: 'none', blocks };
}

const SAVED = section('lib', [{ id: 'h', kind: 'heading', text: 'Thomas Deely', level: 2 }]);
const LIB = new Map([['L1', SAVED]]);

function page(...linked: LearnBlock[]): LearnPageContent {
  return {
    seoTitle: 'Learn',
    seoDescription: '',
    sections: [section('s1', [{ id: 'intro', kind: 'text', text: 'Hello' }]), section('s2', linked)],
  };
}

const kinds = (c: LearnPageContent) => c.sections.flatMap((s) => s.blocks.map((b) => b.kind));

describe('Compare and History draw a linked section (T324 E F11)', () => {
  it('fills a linked section in from the library', () => {
    const view = expandForView(page({ id: 'r1', kind: 'reusable', libraryId: 'L1' }), LIB);
    expect(kinds(view.content)).toEqual(['text', 'heading']);
    expect(JSON.stringify(view.content)).toContain('Thomas Deely');
    expect(view.missing).toBe(0);
  });

  it('leaves out one whose saved section was deleted, and says so', () => {
    const view = expandForView(page({ id: 'r1', kind: 'reusable', libraryId: 'gone' }), LIB);
    expect(kinds(view.content)).toEqual(['text']);
    expect(view.missing).toBe(1);
    expect(readOnlyViewNote(view, 'version')).toBe('A saved section in this version was deleted from the library, so it is not shown here.');
  });

  it('says a version uses the library as it is now', () => {
    const view = expandForView(page({ id: 'r1', kind: 'reusable', libraryId: 'L1' }), LIB);
    expect(readOnlyViewNote(view, 'version')).toBe(VERSION_LIBRARY_NOTE);
    expect(readOnlyViewNote(view, 'draft')).toBeNull();
  });

  it('keeps the placeholders while the library loads', () => {
    const p = page({ id: 'r1', kind: 'reusable', libraryId: 'L1' });
    const view = expandForView(p, null);
    expect(view.content).toBe(p);
    expect(view.waiting).toBe(true);
    expect(readOnlyViewNote(view, 'version')).toBeNull();
  });

  it('returns a page with no linked sections as it is', () => {
    const p = page();
    expect(expandForView(p, LIB)).toEqual({ content: p, linked: 0, missing: 0, waiting: false });
  });
});
