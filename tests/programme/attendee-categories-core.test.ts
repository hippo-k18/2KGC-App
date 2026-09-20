/**
 * Tests for what the dashboard does with attendee categories: filter a list,
 * count it, and decide who a saved ticket rule relabels.
 *
 * The list, the rule lookup and the edits are pinned in
 * `packages/shared/src/attendee-categories.test.ts`, beside the code
 * `ensureRegistration` shares.
 *
 * Run with: npm test  (or npm run test:programme)
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ATTENDEE_CATEGORIES } from '@kgc/shared';
import {
  UNCATEGORISED,
  categoryCounts,
  categoryLabel,
  holdersToRelabel,
  holdersToUnlabel,
  inCategory,
} from '../../apps/organizer/src/lib/attendee-categories-core';
import { mergeAttendees } from '../../apps/organizer/src/lib/attendees-core';

const cats = DEFAULT_ATTENDEE_CATEGORIES;

describe('the category on an attendee row', () => {
  it('comes from the registration, for a holder with a profile and one without', () => {
    const rows = mergeAttendees(
      [{ id: 'u1', data: { name: 'Ada', email: 'ada@example.org', roles: ['attendee'] } }],
      [
        { id: 'reg_1', data: { email: 'ada@example.org', status: 'active', categoryId: 'vip', category: 'VIP' } },
        { id: 'reg_2', data: { email: 'bob@example.org', name: 'Bob', status: 'active', categoryId: 'press', category: 'Press' } },
      ],
    );
    expect(rows.map((r) => [r.name, r.categoryId, r.category])).toEqual([
      ['Ada', 'vip', 'VIP'],
      ['Bob', 'press', 'Press'],
    ]);
  });
});

describe('filtering and counting', () => {
  const rows = [{ categoryId: 'vip' }, { categoryId: 'vip' }, { categoryId: 'press' }, {}, { categoryId: 'deleted' }];

  it('matches one category, the people with none, or everyone', () => {
    expect(rows.filter((r) => inCategory(r, 'vip'))).toHaveLength(2);
    expect(rows.filter((r) => inCategory(r, UNCATEGORISED))).toHaveLength(1);
    expect(rows.filter((r) => inCategory(r, undefined))).toHaveLength(5);
  });

  it('counts a category nobody holds as zero and a deleted one as uncategorised', () => {
    const { counts, uncategorised } = categoryCounts(cats, rows);
    expect(counts).toMatchObject({ vip: 2, press: 1, speaker: 0 });
    expect(uncategorised).toBe(2);
  });

  it('prints the current name, so a rename shows before the copy is rewritten', () => {
    const renamed = cats.map((c) => (c.id === 'vip' ? { ...c, name: 'Guest' } : c));
    expect(categoryLabel(renamed, { categoryId: 'vip', category: 'VIP' })).toBe('Guest');
    expect(categoryLabel(renamed, { categoryId: 'gone', category: 'Old name' })).toBe('Old name');
    expect(categoryLabel(renamed, {})).toBe('');
  });
});

describe('who a saved ticket rule relabels', () => {
  const regs = [
    { id: 'a', ticketType: 'All Access (VIP)', status: 'active' },
    { id: 'b', ticketType: 'all access (vip) ', status: 'active', categoryId: 'speaker', categorySource: 'ticket' },
    { id: 'c', ticketType: 'All Access (VIP)', status: 'active', categoryId: 'press', categorySource: 'manual' },
    { id: 'd', ticketType: 'All Access (VIP)', status: 'active', categoryId: 'vip', categorySource: 'ticket' },
    { id: 'e', ticketType: 'All Access (VIP)', status: 'cancelled' },
    { id: 'f', ticketType: 'Main Conference', status: 'active' },
  ];

  it('takes active holders of that ticket, and never a hand assignment', () => {
    expect(holdersToRelabel(regs, 'All Access (VIP)', 'vip')).toEqual(['a', 'b']);
  });

  it('clears only the people the rule labelled', () => {
    const labelled = [...regs, { id: 'g', ticketType: 'All Access (VIP)', status: 'active', categoryId: 'vip', categorySource: 'manual' }];
    expect(holdersToUnlabel(labelled, 'All Access (VIP)', 'vip')).toEqual(['d']);
  });
});
