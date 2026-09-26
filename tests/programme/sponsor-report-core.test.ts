/**
 * Which tracked links belong to which sponsor.
 *
 * The match is on `CampaignLinkDoc.owner`, which is free text an organizer types
 * on the Link Tracking screen. That is the weakest join in this report and the
 * only one it has, so the rules around it are pinned here: case and spacing must
 * not matter, an empty owner must match nobody, and a link owned by somebody who
 * is not a sponsor has to remain findable rather than silently vanish.
 *
 * Lives in `tests/programme` for the reason the others here do: it is pure logic
 * needing no emulator, and `sponsor-report.ts` carries `server-only` so Vitest
 * cannot load it at all.
 *
 * Run with: npm run test:programme
 */
import { describe, expect, it } from 'vitest';

import {
  linksForSponsor,
  ownerKey,
  totalsForSponsor,
  unmatchedLinks,
  type TrackedLink,
} from '../../apps/organizer/src/lib/sponsor-report-core';

const link = (over: Partial<TrackedLink> & { code: string }): TrackedLink => ({
  label: over.code,
  owner: '',
  clicks: 0,
  orders: 0,
  ...over,
});

const acme = { id: 'sp1', name: 'Acme Corp' };
const globex = { id: 'sp2', name: 'Globex' };

describe('linksForSponsor', () => {
  it('matches however the owner was capitalised or spaced', () => {
    const links = [
      link({ code: 'a', owner: 'acme corp' }),
      link({ code: 'b', owner: '  ACME Corp ' }),
      link({ code: 'c', owner: 'Globex' }),
    ];

    expect(linksForSponsor(acme, links).map((l) => l.code).sort()).toEqual(['a', 'b']);
  });

  it('gives the busiest link first', () => {
    const links = [
      link({ code: 'quiet', owner: 'Acme Corp', clicks: 2 }),
      link({ code: 'busy', owner: 'Acme Corp', clicks: 40 }),
    ];

    expect(linksForSponsor(acme, links)[0].code).toBe('busy');
  });

  it('claims no link when the owner box was left empty', () => {
    // Otherwise every unowned campaign link would land on a sponsor with a
    // blank name, which is how a report comes to show somebody else's clicks.
    const links = [link({ code: 'a', owner: '' }), link({ code: 'b', owner: '   ' })];

    expect(linksForSponsor({ id: 'x', name: '  ' }, links)).toEqual([]);
  });

  it('gives a sponsor with no links an empty list, not every link', () => {
    expect(linksForSponsor(globex, [link({ code: 'a', owner: 'Acme Corp' })])).toEqual([]);
  });
});

describe('totalsForSponsor', () => {
  it('adds up clicks and purchases across their links', () => {
    const totals = totalsForSponsor([
      link({ code: 'a', clicks: 12, orders: 1 }),
      link({ code: 'b', clicks: 30, orders: 2 }),
    ]);

    expect(totals.clicks).toBe(42);
    expect(totals.orders).toBe(3);
  });

  it('reports the newest click across every link', () => {
    const totals = totalsForSponsor([
      link({ code: 'a', lastClickedAt: '2027-01-04T10:00:00.000Z' }),
      link({ code: 'b', lastClickedAt: '2027-03-19T08:30:00.000Z' }),
    ]);

    expect(totals.lastClickAt).toBe('2027-03-19T08:30:00.000Z');
  });

  it('leaves the last click absent when nothing has ever been clicked', () => {
    // Absent, not a date and not a zero: "never" is a different fact from "long
    // ago", and only one of them is true here.
    expect(totalsForSponsor([link({ code: 'a' })]).lastClickAt).toBeUndefined();
    expect(totalsForSponsor([]).clicks).toBe(0);
  });
});

describe('unmatchedLinks', () => {
  it('lists links owned by somebody who is not a sponsor', () => {
    const links = [
      link({ code: 'a', owner: 'Acme Corp' }),
      link({ code: 'ref', owner: 'Ada Lovelace' }),
    ];

    expect(unmatchedLinks([acme], links).map((l) => l.code)).toEqual(['ref']);
  });

  it('ignores links with no owner at all', () => {
    // A plain campaign link is not a mis-attributed sponsor link, and listing it
    // as one would bury the sponsor name somebody actually misspelled.
    const links = [link({ code: 'spring-mail', owner: '' })];

    expect(unmatchedLinks([acme], links)).toEqual([]);
  });
});

describe('ownerKey', () => {
  it('folds case and trims, and treats nothing as nothing', () => {
    expect(ownerKey('  Acme Corp ')).toBe('acme corp');
    expect(ownerKey(undefined)).toBe('');
  });
});
