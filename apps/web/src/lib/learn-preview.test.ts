import { describe, expect, it } from 'vitest';
import { expandReusableBlocks, readLearnPage, type LearnBlock, type LearnPageContent, type LearnSection } from '@kgc/shared';

import { learnPreviewDraft } from './learn-preview';

function section(id: string, blocks: LearnBlock[], extra: Partial<LearnSection> = {}): LearnSection {
  return { id, label: id, background: 'plain', width: 'normal', paddingTop: 'none', paddingBottom: 'none', blocks, ...extra };
}

const SAVED = section('lib', [{ id: 'h', kind: 'heading', text: 'Team', level: 2 }]);
const LIB = new Map([['L1', SAVED]]);
const LINK: LearnBlock = { id: 'r1', kind: 'reusable', libraryId: 'L1' };
const intro = section('s1', [{ id: 'i', kind: 'text', text: 'Hello' }]);
const linked = section('s2', [LINK]);
const page = (...sections: LearnSection[]): LearnPageContent => ({ seoTitle: 'Learn', seoDescription: '', sections });
const copy = (id: string, edit: LearnSection['libraryEdit']): LearnSection =>
  section(id, [{ id: `${id}--h`, kind: 'heading', text: 'UNSAVED', level: 2 }], { libraryEdit: edit });
const base = { libraryId: 'L1', name: 'Team band', ids: {}, anchors: {} };

/** What the preview page renders: the draft read, then saved sections filled in. */
function shown(draft: LearnPageContent): string {
  const read = learnPreviewDraft(JSON.parse(JSON.stringify(draft)));
  return JSON.stringify(expandReusableBlocks(read!, LIB));
}

describe('the preview link during Edit saved section (T326 R1)', () => {
  it('opened from the library list: the copy is not shown, so the section is not on the page twice', () => {
    const draft = page(intro, linked, copy('sc', { ...base, sectionId: 'sc', restore: { kind: 'none' } }));
    expect(shown(draft)).toBe(shown(page(intro, linked)));
    expect(shown(draft)).not.toContain('UNSAVED');
  });

  it('opened from the block: the link is shown, not the unsaved copy', () => {
    const draft = page(intro, copy('s2', { ...base, sectionId: 's2', restore: { kind: 'whole', host: linked } }));
    expect(shown(draft)).toBe(shown(page(intro, linked)));
  });

  it('a link among other blocks goes back in its place', () => {
    const host = section('s1', [{ id: 'a', kind: 'text', text: 'A' }, LINK]);
    const draft = page(
      section('s1', [{ id: 'a', kind: 'text', text: 'A' }]),
      copy('sc', { ...base, sectionId: 'sc', restore: { kind: 'inPlace', hostSectionId: 's1', index: 1, block: LINK } }),
    );
    expect(shown(draft)).toBe(shown(page(host)));
  });

  it('a page with no edit, or a value that is not a page, reads as before', () => {
    const plain = page(intro, linked);
    expect(learnPreviewDraft(plain)).toEqual(readLearnPage(plain));
    expect(learnPreviewDraft(null)).toBeNull();
    expect(learnPreviewDraft({ sections: 'x' })).toEqual(readLearnPage({ sections: 'x' }));
  });
});
