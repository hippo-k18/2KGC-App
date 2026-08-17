import { describe, expect, it } from 'vitest';

import { filterSessions, formatDayTab, formatTime, isSearching, type Session } from '@/lib/data/sessions';

/**
 * `filterSessions` is the whole agenda filter bar, and it is pure, so it is the
 * one part of that screen that can be pinned without a renderer.
 *
 * The fixture is a trimmed copy of the seeded KGC programme rather than an
 * invented one, because the bug this file exists to prevent only shows up in
 * real shapes: the same title runs on three different days, one speaker appears
 * on exactly one day, and one room is used on three of the five. A fixture with
 * one session per day would have passed while the screen was broken.
 */
function session(fields: Partial<Session> & Pick<Session, 'id' | 'day' | 'title'>): Session {
  return {
    trackIds: [],
    speakerIds: [],
    tags: [],
    format: 'talk',
    status: 'published',
    timeZone: 'America/New_York',
    startsAtLocal: `${fields.day}T09:00`,
    endsAtLocal: `${fields.day}T10:00`,
    sequence: 0,
    stableGuid: fields.id,
    qaEnabled: false,
    pollsEnabled: false,
    ...fields,
  } as Session;
}

const DAY1 = '2027-05-03';
const DAY3 = '2027-05-05';
const DAY5 = '2027-05-07';

/** Five sessions off the seeded programme, spread over three of its five days. */
const AGENDA: Session[] = [
  session({
    id: 'graphrag-day1',
    day: DAY1,
    startsAtLocal: `${DAY1}T13:00`,
    title: 'GraphRAG: What Actually Improved Retrieval',
    roomName: 'VEEC Classroom 3',
    speakerNames: ['Ingrid Lindqvist'],
    trackIds: ['business-use-cases'],
  }),
  session({
    id: 'graphrag-day3',
    day: DAY3,
    startsAtLocal: `${DAY3}T11:00`,
    title: 'GraphRAG: What Actually Improved Retrieval',
    roomName: 'VEEC Classroom 2',
    speakerNames: ['Emeka Vasquez'],
    trackIds: ['open-knowledge-networks'],
    description: 'A candid account of what a hybrid retriever bought us.',
  }),
  session({
    id: 'governance-day3',
    day: DAY3,
    startsAtLocal: `${DAY3}T11:00`,
    title: 'Ontology Governance When Nobody Wants to Govern',
    roomName: 'Bloomberg 165',
    speakerNames: ['Amara Okonkwo'],
    trackIds: ['eu-projects'],
  }),
  session({
    id: 'uris-day3',
    day: DAY3,
    startsAtLocal: `${DAY3}T15:15`,
    title: 'The Cost of Getting URIs Wrong',
    roomName: 'Bloomberg 165',
    speakerNames: ['Nadia Nakamura'],
    trackIds: ['graph-data-science'],
  }),
  session({
    id: 'keynote-day5',
    day: DAY5,
    startsAtLocal: `${DAY5}T08:30`,
    title: 'Keynote: GraphRAG: What Actually Improved Retrieval',
    roomName: 'VEEC Banquet Hall',
    speakerNames: ['Rune Nakamura'],
    trackIds: ['ontologies-taxonomies'],
  }),
];

const ids = (s: Session[]) => s.map((x) => x.id).sort();

describe('filterSessions — the day filter', () => {
  it('narrows to the selected day when there is no query', () => {
    const day3 = filterSessions(AGENDA, { day: DAY3, trackId: null, search: '' });
    expect(ids(day3)).toEqual(['governance-day3', 'graphrag-day3', 'uris-day3']);
  });

  it('treats a whitespace-only box as no query, so the day still applies', () => {
    expect(isSearching('   ')).toBe(false);
    const day1 = filterSessions(AGENDA, { day: DAY1, trackId: null, search: '   ' });
    expect(ids(day1)).toEqual(['graphrag-day1']);
  });
});

describe('filterSessions — a query searches every day', () => {
  /**
   * The bug. A five-day programme meant a speaker search from Monday returned
   * nothing four days out of five, and an empty list reads as "that person is not
   * speaking here" — so the attendee stops looking. Standing on day one and
   * searching a day-three-only speaker has to find them.
   */
  it('finds a day-three-only speaker while day one is selected', () => {
    expect(isSearching('Emeka Vasquez')).toBe(true);
    const hits = filterSessions(AGENDA, { day: DAY1, trackId: null, search: 'Emeka Vasquez' });
    expect(ids(hits)).toEqual(['graphrag-day3']);
  });

  it('returns the same results whichever day is selected', () => {
    const fromEachDay = [DAY1, DAY3, DAY5, null].map((day) =>
      ids(filterSessions(AGENDA, { day, trackId: null, search: 'graphrag' })),
    );
    for (const hits of fromEachDay) {
      expect(hits).toEqual(['graphrag-day1', 'graphrag-day3', 'keynote-day5']);
    }
  });

  it('keeps results in start order, so grouping by day comes out chronological', () => {
    const hits = filterSessions(AGENDA, { day: DAY1, trackId: null, search: 'graphrag' });
    expect(hits.map((s) => s.day)).toEqual([DAY1, DAY3, DAY5]);
  });
});

describe('filterSessions — search combined with a track', () => {
  /**
   * The track filter deliberately persists across day changes, which is only
   * safe because the header always names the active track. It has to keep
   * narrowing during a search for the same reason — a filter the user can see is
   * not the invisible kind — but it must narrow across all days, not collapse
   * back to the selected one.
   */
  it('applies the track to every day, not just the selected one', () => {
    const hits = filterSessions(AGENDA, {
      day: DAY1,
      trackId: 'open-knowledge-networks',
      search: 'graphrag',
    });
    expect(ids(hits)).toEqual(['graphrag-day3']);
  });

  it('can return nothing because of the track alone, which the empty state has to say', () => {
    const withTrack = filterSessions(AGENDA, {
      day: DAY1,
      trackId: 'health-care',
      search: 'graphrag',
    });
    const withoutTrack = filterSessions(AGENDA, {
      day: DAY1,
      trackId: null,
      search: 'graphrag',
    });
    expect(withTrack).toHaveLength(0);
    expect(withoutTrack).toHaveLength(3);
  });

  it('still respects the track when there is no query', () => {
    const hits = filterSessions(AGENDA, { day: DAY3, trackId: 'eu-projects', search: '' });
    expect(ids(hits)).toEqual(['governance-day3']);
  });
});

describe('filterSessions — what a query matches', () => {
  it('matches a session title', () => {
    const hits = filterSessions(AGENDA, { day: DAY1, trackId: null, search: 'URIs' });
    expect(ids(hits)).toEqual(['uris-day3']);
  });

  it('matches a room, across the days that room is used', () => {
    const hits = filterSessions(AGENDA, { day: DAY1, trackId: null, search: 'bloomberg 165' });
    expect(ids(hits)).toEqual(['governance-day3', 'uris-day3']);
  });

  it('matches part of a speaker name, case-insensitively', () => {
    const hits = filterSessions(AGENDA, { day: DAY5, trackId: null, search: 'okonkwo' });
    expect(ids(hits)).toEqual(['governance-day3']);
  });

  /**
   * Pinned deliberately. Whova's documented scope is "session name, location or
   * speaker name" and the header placeholder promises exactly those three, so the
   * description is *not* searched. If that changes, this test and that placeholder
   * change together — the app's recurring defect is copy describing a capability
   * the code does not have.
   */
  it('does not match the description', () => {
    const hits = filterSessions(AGENDA, {
      day: DAY3,
      trackId: null,
      search: 'hybrid retriever',
    });
    expect(hits).toHaveLength(0);
  });

  /** Same reasoning: the track is a filter, not a search term. */
  it('does not match a track name', () => {
    const hits = filterSessions(AGENDA, {
      day: DAY3,
      trackId: null,
      search: 'open knowledge networks',
    });
    expect(hits).toHaveLength(0);
  });

  it('survives a session with no room and no speakers', () => {
    const bare = [session({ id: 'bare', day: DAY3, title: 'Registration opens' })];
    expect(filterSessions(bare, { day: null, trackId: null, search: 'bloomberg' })).toHaveLength(0);
    expect(filterSessions(bare, { day: null, trackId: null, search: 'registration' })).toHaveLength(1);
  });
});

describe('the formatters the day headers use', () => {
  it('labels a day key without shifting it into the device zone', () => {
    expect(formatDayTab('2027-05-05')).toBe('Wed 5 May');
  });

  it('returns an empty label rather than throwing on a malformed key', () => {
    expect(formatDayTab('not-a-day')).toBe('');
    expect(formatTime('2027-05-05')).toBe('');
  });

  it('formats a wall clock', () => {
    expect(formatTime('2027-05-05T15:15')).toBe('3:15 PM');
  });
});
