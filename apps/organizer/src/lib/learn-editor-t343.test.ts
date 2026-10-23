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
