import { describe, expect, it } from 'vitest';

import { strandedHolders, ticketAudienceRows } from './ticket-audience-core';

/**
 * ── Screens verify, problems 3 and 4 ────────────────────────────────────────
 *
 * The screen asked "who would get access" and answered with orders placed
 * through this system, so tiers held by twelve, five and six people read
 * "Sold 0", "Sold 0" and "Sold 2". And three people holding a tier that is not
 * in the catalogue appeared nowhere at all, which means they are locked out of
 * anything restricted with no control that could let them in.
 */
describe('ticketAudienceRows', () => {
  const catalogue = [
    { name: 'All Access (VIP)', videoLibrary: true },
    { name: 'Main Conference', videoLibrary: true },
    { name: 'Startup Table', videoLibrary: false },
  ];

  it('counts the people holding a tier, not the orders placed for it', () => {
    const rows = ticketAudienceRows(catalogue, {
      'All Access (VIP)': 12,
      'Main Conference': 6,
      'Startup Table': 5,
    });
    expect(rows.map((r) => [r.name, r.holders])).toEqual([
      ['All Access (VIP)', 12],
      ['Main Conference', 6],
      ['Startup Table', 5],
    ]);
  });

  it('shows a tier nobody holds as zero rather than dropping it', () => {
    const rows = ticketAudienceRows(catalogue, { 'All Access (VIP)': 1 });
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ name: 'Startup Table', holders: 0, inCatalogue: true });
  });

  it('surfaces a tier somebody holds that no checkbox can offer', () => {
    const rows = ticketAudienceRows(catalogue, { Standard: 2, 'Added by organizer': 1 });
    const strays = rows.filter((r) => !r.inCatalogue);
    expect(strays.map((r) => r.name)).toEqual(['Standard', 'Added by organizer']);
    expect(strandedHolders(rows)).toBe(3);
  });

  it('reports nobody stranded when every held tier is in the catalogue', () => {
    expect(strandedHolders(ticketAudienceRows(catalogue, { 'Main Conference': 4 }))).toBe(0);
  });

  it('matches a stored name whose spacing or case drifted, without renaming it', () => {
    const rows = ticketAudienceRows(catalogue, { 'main  conference': 3 });
    expect(rows[1]).toMatchObject({ name: 'Main Conference', holders: 3, inCatalogue: true });
    expect(rows.some((r) => !r.inCatalogue)).toBe(false);
  });

  it('keeps the video library flag with the tier that sells it', () => {
    const rows = ticketAudienceRows(catalogue, { Standard: 1 });
    expect(rows.filter((r) => r.videoLibrary).map((r) => r.name)).toEqual([
      'All Access (VIP)',
      'Main Conference',
    ]);
    // A tier nobody offers cannot be claiming to include anything.
    expect(rows.find((r) => r.name === 'Standard')?.videoLibrary).toBe(false);
  });

  it('ignores an empty name and a count that is not a positive number', () => {
    const rows = ticketAudienceRows(catalogue, { '   ': 4, Ghost: 0, Broken: Number.NaN });
    expect(rows.some((r) => !r.inCatalogue)).toBe(false);
  });
});
