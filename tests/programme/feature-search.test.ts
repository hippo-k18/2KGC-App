/**
 * Tests for the header feature search's matcher.
 *
 * Run against the real navigation tree rather than a fixture, because every
 * bug this has had was a property of Whova's actual titles — an ampersand in
 * `Session Q&A Manager`, a hyphen in `Ticket Add-ons`, a slash in `Call For
 * Speakers/Abstracts` — and a fixture is exactly the shape of tree that would
 * have passed while the live one failed.
 *
 * The guarantee under test is the one an organizer relies on: type the noun you
 * are thinking of and the section it names is the first thing you see.
 *
 * Run with: npm run test:programme
 */
import { describe, expect, it } from 'vitest';

import { ALIASES } from '../../apps/organizer/src/lib/feature-search-aliases';
import {
  MIN_QUERY,
  RESULT_LIMIT,
  highlight,
  normalise,
  searchFeatures,
  squash,
} from '../../apps/organizer/src/lib/feature-search-core';
import { searchIndex } from '../../apps/organizer/src/lib/nav';

const ENTRIES = searchIndex();
const find = (q: string, limit?: number) => searchFeatures(ENTRIES, q, limit);
const titles = (q: string, limit?: number) => find(q, limit).hits.map((h) => h.title);

describe('the index itself', () => {
  it('covers the whole nav tree', () => {
    expect(ENTRIES.length).toBe(215);
  });

  it('gives every entry a path that the catch-all can resolve', () => {
    expect(ENTRIES.every((e) => e.path.length > 0 && !e.path.startsWith('/'))).toBe(true);
  });
});

describe('the section you named comes first', () => {
  it('puts Tickets above every screen inside it', () => {
    // The regression this file exists for: built-first ordering used to bury
    // `Tickets` under `Ticket Add-ons`, `Payout` and `Summary`.
    expect(titles('ticket')[0]).toBe('Tickets');
  });

  it('ranks the section, then its groups, then their screens', () => {
    expect(titles('ticket').slice(0, 3)).toEqual([
      'Tickets',
      'Ticket Setup',
      'Ticket Marketing',
    ]);
  });

  it('does the same for a section that is fully built', () => {
    expect(titles('attendee')[0]).toBe('Attendees');
    expect(titles('marketing')[0]).toBe('Marketing');
  });

  it('prefers an exact title over a longer one that merely starts with it', () => {
    const hits = titles('speaker center');
    expect(hits[0]).toBe('Speaker Center');
  });
});

describe('everything under the section is offered too', () => {
  it('returns every page beneath Tickets, not just the first handful', () => {
    const { total } = find('ticket');
    // 61 nodes carry "ticket" in their own title or an ancestor's.
    expect(total).toBe(61);
  });

  it('caps the rendered rows but reports the true total', () => {
    const r = find('ticket');
    expect(r.hits.length).toBe(RESULT_LIMIT);
    expect(r.total).toBeGreaterThan(r.hits.length);
  });

  it('honours a caller-supplied limit', () => {
    expect(find('ticket', 3).hits.length).toBe(3);
  });
});

describe('punctuation in Whova titles does not hide a screen', () => {
  it('finds Session Q&A Manager from "qa"', () => {
    // The old component's docblock claimed this worked. It never did.
    expect(titles('qa')).toContain('Session Q&A Manager');
  });

  it('finds it from "q&a" as well', () => {
    expect(titles('q&a')).toContain('Session Q&A Manager');
  });

  it('finds Ticket Add-ons from "addons", "add ons" and "add-ons"', () => {
    for (const q of ['addons', 'add ons', 'add-ons']) {
      expect(titles(q)).toContain('Ticket Add-ons');
    }
  });

  it('finds Call For Speakers/Abstracts from "abstracts"', () => {
    expect(titles('abstracts')).toContain('Call For Speakers/Abstracts');
  });
});

describe('multi-word queries match across the ancestor trail', () => {
  it('finds Name Badges from "attendee badges"', () => {
    expect(titles('attendee badges')).toContain('Name Badges');
  });

  it('requires every word, so an unrelated pair matches nothing', () => {
    expect(find('badges payout').total).toBe(0);
  });
});

describe('queries that should return nothing', () => {
  it('ignores anything shorter than the minimum', () => {
    expect(find('t').hits).toEqual([]);
    expect(MIN_QUERY).toBe(2);
  });

  it('ignores whitespace and punctuation-only input', () => {
    expect(find('   ').hits).toEqual([]);
    expect(find('&&').hits).toEqual([]);
  });

  it('returns nothing for a word that is not in the tree', () => {
    expect(find('zzzz').total).toBe(0);
  });
});

describe('normalisation', () => {
  it('drops ampersands rather than spacing them', () => {
    expect(normalise('Session Q&A Manager')).toBe('session qa manager');
  });

  it('reduces every other separator run to a single space', () => {
    expect(normalise('Call For Speakers/Abstracts')).toBe('call for speakers abstracts');
    expect(normalise('  Ticket   Add-ons  ')).toBe('ticket add ons');
  });

  it('squashes separators away entirely for the run-together form', () => {
    expect(squash('Ticket Add-ons')).toBe('ticketaddons');
  });
});

/**
 * The demo cases.
 *
 * Each row is a phrase an organizer would actually type during an event, and
 * the screen they meant. These are written from intent, not recorded from
 * output — the point is to fail when a ranking change makes a real question
 * unanswerable, which is precisely what "export csv" and "gold sponsor" did
 * before the alias words were matched collectively rather than one string at a
 * time.
 */
const DEMO: [query: string, expected: string][] = [
  // Money
  ['refund', 'tickets/orders-and-transactions/attendee-orders'],
  ['promo code', 'tickets/ticket-setup/discount-codes'],
  ['coupon', 'tickets/ticket-setup/discount-codes'],
  ['revenue', 'tickets/orders-and-transactions/summary'],
  ['how much have we sold', 'tickets/orders-and-transactions/summary'],
  ['invoice', 'tickets/orders-and-transactions/transaction-history'],
  ['early bird', 'tickets/ticket-setup/1-1-create-tickets'],

  // The door
  ['scan', 'attendees/check-in-and-checkout/check-in'],
  ['name tag', 'attendees/name-badges'],
  ['lanyard', 'attendees/name-badges'],
  ['certificate', 'attendees/certificates'],

  // People
  ['roster', 'attendees/manage-attendees/attendees'],
  ['who is coming', 'attendees/manage-attendees/attendees'],
  ['export csv', 'attendees/manage-attendees/analytics-and-exports'],

  // Programme
  ['schedule', 'content/agenda-center/session-manager'],
  ['timetable', 'content/agenda-center/session-manager'],
  ['clash', 'content/agenda-center/conflict-check'],
  ['cfp', 'content/call-for-speakers-abstracts'],
  ['handouts', 'content/documents-and-videos/documents'],
  ['recording', 'content/documents-and-videos/video-hosting'],
  ['shuttle', 'content/logistics-center'],

  // Partners
  ['vendor', 'content/exhibitor-center/exhibitor-manager'],
  ['booth', 'content/exhibitor-center/exhibitor-manager'],
  ['gold sponsor', 'content/sponsor-center/sponsor-tiering'],

  // In the room
  ['push notification', 'engagement/announcements'],
  ['floor plan', 'engagement/floormap'],
  ['leaderboard', 'engagement/gamification'],
  ['livestream', 'virtual-and-hybrid/online-session-manager/streaming-setup'],
  ['zoom', 'virtual-and-hybrid/adv-stream-integration/zoom'],
  ['emergency', 'virtual-and-hybrid/logistics-management/emergency-manager'],

  // Running it
  ['logo', 'content/branding-center/app-branding'],
  ['dietary', 'tickets/ticket-setup/1-2-question-forms'],
  ['stats', 'tools/report'],
  ['access code', 'tools/admin-control/code-access-control'],
  ['zapier', 'attendees/integrations/crm-integration-via-zapier'],
  ['mailchimp', 'attendees/integrations/mailchimp'],

  // Plain section names still win over any alias
  ['ticket', 'tickets'],
  ['attendee', 'attendees'],
  ['agenda', 'content/agenda-center'],
  ['qa', 'content/agenda-center/session-qanda-manager'],
];

describe('demo cases: what an organizer types, mid-event', () => {
  it.each(DEMO)('"%s" leads with %s', (query, expected) => {
    expect(find(query).hits[0]?.path).toBe(expected);
  });

  it('answers every demo query with something', () => {
    const dead = DEMO.filter(([q]) => find(q).total === 0).map(([q]) => q);
    expect(dead).toEqual([]);
  });
});

describe('the alias table stays honest', () => {
  const paths = new Set(ENTRIES.map((e) => e.path));

  it('points every alias at a path that still exists', () => {
    const orphans = Object.keys(ALIASES).filter((p) => !paths.has(p));
    expect(orphans).toEqual([]);
  });

  it('never lets an alias outrank a screen the organizer named directly', () => {
    // "report" is aliased onto Tools › Report, whose title is also "Report".
    // The exact title match must win, or a section could be shadowed by a word
    // someone added to this table months later.
    expect(find('report').hits[0]?.title).toBe('Report');
  });

  it('says which word found a hit that no title matched', () => {
    const hit = find('refund').hits[0];
    expect(hit?.via).toBe('refund');
  });

  it('leaves via unset when the title matched on its own', () => {
    expect(find('ticket').hits[0]?.via).toBeUndefined();
  });
});

describe('highlighting the matched text', () => {
  it('marks the matched run and leaves the rest alone', () => {
    expect(highlight('Ticket Setup', 'setup')).toEqual([
      { text: 'Ticket ', hit: false },
      { text: 'Setup', hit: true },
    ]);
  });

  it('marks every word of a multi-word query', () => {
    expect(highlight('Ticket Setup', 'ticket setup')).toEqual([
      { text: 'Ticket', hit: true },
      { text: ' ', hit: false },
      { text: 'Setup', hit: true },
    ]);
  });

  it('returns the title untouched when the match came from an alias', () => {
    expect(highlight('Attendee Orders', 'refund')).toEqual([
      { text: 'Attendee Orders', hit: false },
    ]);
  });

  it('rebuilds the original string exactly, punctuation included', () => {
    for (const title of ['Session Q&A Manager', 'Call For Speakers/Abstracts', 'Ticket Add-ons']) {
      for (const q of ['session', 'a', 'ticket', 'zz']) {
        expect(highlight(title, q).map((r) => r.text).join('')).toBe(title);
      }
    }
  });
});
