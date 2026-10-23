import { describe, expect, it } from 'vitest';
import type { LearnBlock, LearnPageContent } from '@kgc/shared';
import { richToPlainText } from './learn-rich';
import { STARTER_TEXT, createBlock, searchBlockKinds, starterLines } from './learn-editor-core';
import { accessibilityIssues, issueCounts, issueSummary, type Issue } from './learn-tools-core';

/** T332: the picker ranks by name, the Image and text starter, and the checker's counts. */

const kinds = (q: string) => searchBlockKinds(q).map((k) => k.kind);

describe('searchBlockKinds ranking (D F10)', () => {
  it('puts the exact name first', () => {
    expect(kinds('Text')[0]).toBe('text');
    expect(kinds('text')).toContain('heading');
    expect(kinds('Columns')[0]).toBe('columns');
    expect(kinds('table')[0]).toBe('table');
    expect(kinds('  image  ')[0]).toBe('image');
  });

  it('then names that start with the words, then names that hold them, then the rest', () => {
    // "Image" exact, "Image and text" starts with it, Gallery only by its hint or keywords.
    const image = kinds('image');
    expect(image.slice(0, 2)).toEqual(['image', 'imageText']);
    expect(kinds('and text')[0]).toBe('imageText');
    // "Contents list" holds "list" but does not start with it; List is exact.
    expect(kinds('list').slice(0, 2)).toEqual(['list', 'toc']);
  });

  it('keeps catalogue order inside a rank and still filters on every word', () => {
    expect(kinds('media')).toEqual(searchBlockKinds('media').map((k) => k.kind));
    expect(kinds('faq')).toEqual(['accordion']);
    expect(kinds('zzz')).toEqual([]);
  });
});

describe('Image and text starter (D F11)', () => {
  it('is a rich doc with a real heading, not Markdown hashes', () => {
    const b = createBlock('imageText') as Extract<LearnBlock, { kind: 'imageText' }>;
    expect(typeof b.text).toBe('object');
    expect(JSON.stringify(b.text)).not.toContain('##');
    expect(b.text).toMatchObject({ type: 'doc', content: [{ type: 'heading', level: 2 }, { type: 'paragraph' }] });
    expect(richToPlainText(b.text)).not.toContain('#');
  });

  it('still counts as starter text, and so does a v1 Markdown copy', () => {
    expect(STARTER_TEXT.imageText.has('A short title')).toBe(true);
    expect(STARTER_TEXT.imageText.has('A sentence or two about the picture.')).toBe(true);
    const fresh = createBlock('imageText');
    expect(starterLines(fresh)).toEqual(['A short title', 'A sentence or two about the picture.']);
    const v1 = { ...fresh, text: '## A short title\n\nA sentence or two about the picture.' } as LearnBlock;
    expect(starterLines(v1)).toContain('A sentence or two about the picture.');
  });

  it('gives each new block its own doc', () => {
    const a = createBlock('imageText') as Extract<LearnBlock, { kind: 'imageText' }>;
    const b = createBlock('imageText') as Extract<LearnBlock, { kind: 'imageText' }>;
    expect(a.text).not.toBe(b.text);
  });
});

describe('checker counts (C N1)', () => {
  const issue = (severity: Issue['severity']): Issue => ({ id: severity, rule: 'alt', severity, message: '', fix: '', where: { field: 'x' } });

  it('never counts a warning as a thing to fix', () => {
    expect(issueCounts([issue('warning')])).toEqual({ fix: 0, look: 1 });
    expect(issueCounts([issue('error'), issue('warning'), issue('warning')])).toEqual({ fix: 1, look: 2 });
  });

  it('words the summary by severity', () => {
    expect(issueSummary({ fix: 0, look: 1 })).toBe('1 worth a look');
    expect(issueSummary({ fix: 1, look: 0 })).toBe('1 thing to fix');
    expect(issueSummary({ fix: 2, look: 3 })).toBe('2 things to fix, 3 worth a look');
  });

  it('files starter text under worth a look', () => {
    const content: LearnPageContent = {
      seoTitle: 'Learn',
      seoDescription: '',
      sections: [
        { id: 's1', label: 'Hero', background: 'plain', width: 'normal', paddingTop: 'large', paddingBottom: 'large', blocks: [createBlock('text')] },
      ],
    };
    const issues = accessibilityIssues(content).filter((i) => i.rule === 'starter-text');
    expect(issues).toHaveLength(1);
    expect(issueCounts(issues)).toEqual({ fix: 0, look: 1 });
  });
});
