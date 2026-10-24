import { describe, expect, it } from 'vitest';
import type { LearnBlock, LearnPageContent } from '@kgc/shared';
import { ISSUE_RULE_LABEL, accessibilityIssues } from './learn-tools-core';

/** T343: the checker names a person with no name, whom the website would leave out (H F3). */

function pageWith(block: LearnBlock): LearnPageContent {
  return { seoTitle: 'Learn', seoDescription: '', sections: [{ id: 's1', label: 'Team', background: 'white', blocks: [block] }] } as unknown as LearnPageContent;
}

const people = (list: { name: string; role: string }[], hidden = false): LearnBlock =>
  ({ id: 'pb', kind: 'people', style: 'cards', columns: 3, people: list.map((p, i) => ({ id: `p${i}`, ...p })), ...(hidden ? { hidden } : {}) }) as LearnBlock;

describe('checker: a person with no name (T343)', () => {
  it('flags a person with a role but no name, as something to fix', () => {
    const issues = accessibilityIssues(pageWith(people([{ name: 'Ada', role: 'Chair' }, { name: '  ', role: 'Speaker' }]))).filter(
      (i) => i.rule === 'no-name',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'error',
      message: 'Person 2 has no name, so the website would leave them out.',
      fix: 'Type their name, or remove them.',
      where: { sectionId: 's1', blockId: 'pb', field: 'Person 2 name' },
    });
    expect(ISSUE_RULE_LABEL['no-name']).toBe('Person with no name');
  });

  it('finds nothing when everyone has a name, or the block is hidden', () => {
    expect(accessibilityIssues(pageWith(people([{ name: 'Ada', role: '' }]))).filter((i) => i.rule === 'no-name')).toEqual([]);
    expect(accessibilityIssues(pageWith(people([{ name: '', role: 'Chair' }], true))).filter((i) => i.rule === 'no-name')).toEqual([]);
  });
});

describe('checker: a list item with no words but with sub-items (T348)', () => {
  const list = (items: { text: string; title?: string; children?: string[] }[]): LearnBlock =>
    ({ id: 'lb', kind: 'list', ordered: false, items: items.map((it, i) => ({ id: `i${i}`, ...it })) }) as LearnBlock;

  it('flags it as something to fix, and lets a titled or childless item be', () => {
    const issues = accessibilityIssues(pageWith(list([{ text: 'One' }, { text: ' ', children: ['Sub'] }, { text: '', title: 'T', children: ['Sub'] }, { text: '' }]))).filter(
      (i) => i.rule === 'no-words',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'error',
      message: 'Item 2 has no words, so the website would leave it out with its sub-items.',
      fix: 'Type its words, or remove it.',
      where: { sectionId: 's1', blockId: 'lb', field: 'Item 2' },
    });
    expect(ISSUE_RULE_LABEL['no-words']).toBe('List item with no words');
  });

  it('flags an item with only a button, which the website leaves out with it (T351, B F1)', () => {
    const link = { label: 'Read more', href: 'https://example.org', style: 'primary' };
    const issues = accessibilityIssues(
      pageWith({ id: 'lb', kind: 'list', ordered: false, items: [{ id: 'i0', text: 'One' }, { id: 'i1', text: '', link }, { id: 'i2', text: '', children: ['S'], link }] } as unknown as LearnBlock),
    ).filter((i) => i.rule === 'no-words');
    expect(issues.map((i) => i.message)).toEqual([
      'Item 2 has no words, so the website would leave it out with its button.',
      'Item 3 has no words, so the website would leave it out with its sub-items and button.',
    ]);
  });
});

describe('checker: a number with a label but no figure (T348)', () => {
  const stats = (items: { value: string; label: string }[]): LearnBlock =>
    ({ id: 'sb', kind: 'stats', columns: 3, items: items.map((it, i) => ({ id: `s${i}`, ...it })) }) as LearnBlock;

  it('flags it as something to fix, and lets an empty or complete number be', () => {
    const issues = accessibilityIssues(pageWith(stats([{ value: '40', label: 'Instructors' }, { value: ' ', label: 'Programmes' }, { value: '', label: '' }]))).filter(
      (i) => i.rule === 'no-figure',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'error',
      message: 'Number 2 has a label but no figure, so the website would leave it out.',
      fix: 'Type its figure, or remove it.',
      where: { sectionId: 's1', blockId: 'sb', field: 'Number 2' },
    });
    expect(ISSUE_RULE_LABEL['no-figure']).toBe('Number with no figure');
  });
});
