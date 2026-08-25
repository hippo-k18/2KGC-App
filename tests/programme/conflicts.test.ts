/**
 * Tests for Conflict Check — the screen that answers "is the programme
 * actually possible?".
 *
 * Pure, and fast: `detectConflicts` takes plain arrays, which is exactly why it
 * was split out of the module that fetches them. Each test is named after the
 * guarantee it protects.
 *
 * The boundary cases are the point. A conference agenda is wall-to-wall
 * back-to-back sessions, so an off-by-one in the overlap predicate does not
 * produce a few odd results — it reports *every* adjacent pair as a clash, and
 * a screen crying wolf on all seventy-two rows is worse than no screen.
 *
 * Run with: npm run test:programme
 */
import { describe, expect, it } from 'vitest';
import type { RoomDoc, SessionDoc, SpeakerDoc } from '@kgc/shared';
import { detectConflicts } from '../../apps/organizer/src/lib/conflicts-core';

const DAY = '2027-05-05';

function session(over: Partial<SessionDoc> & { id?: string } = {}) {
  const { id = 's1', ...rest } = over;
  const doc = {
    eventId: 'kgc-2027',
    title: 'A talk',
    timeZone: 'America/New_York',
    startsAtLocal: `${DAY}T09:00`,
    endsAtLocal: `${DAY}T10:00`,
    day: DAY,
    trackIds: [],
    format: 'talk',
    speakerIds: ['sp1'],
    tags: [],
    status: 'published',
    sequence: 0,
    stableGuid: 'g',
    qaEnabled: false,
    pollsEnabled: false,
    roomId: 'r1',
    ...rest,
  } as unknown as SessionDoc;
  return { id, doc };
}

const speakers = [
  { id: 'sp1', doc: { name: 'Ada Nakamura' } as SpeakerDoc },
  { id: 'sp2', doc: { name: 'Bo Chen' } as SpeakerDoc },
];
const rooms = [
  { id: 'r1', doc: { name: 'Auditorium', capacity: 200 } as RoomDoc },
  { id: 'r2', doc: { name: 'Room 2', capacity: 40 } as RoomDoc },
];

const run = (s: ReturnType<typeof session>[]) => detectConflicts(s, speakers, rooms);
const kinds = (s: ReturnType<typeof session>[]) => run(s).conflicts.map((c) => c.kind);

describe('overlap', () => {
  it('does not flag back-to-back sessions in the same room', () => {
    // The case that matters most: an agenda is almost entirely back-to-back, so
    // treating the boundary as an overlap would flag the whole programme.
    const rows = [
      session({ id: 'a', startsAtLocal: `${DAY}T09:00`, endsAtLocal: `${DAY}T10:00` }),
      session({ id: 'b', startsAtLocal: `${DAY}T10:00`, endsAtLocal: `${DAY}T11:00`, speakerIds: ['sp2'] }),
    ];
    expect(kinds(rows)).toEqual([]);
  });

  it('flags a room booked by two sessions that genuinely overlap', () => {
    const rows = [
      session({ id: 'a', endsAtLocal: `${DAY}T10:00` }),
      session({ id: 'b', startsAtLocal: `${DAY}T09:30`, endsAtLocal: `${DAY}T10:30`, speakerIds: ['sp2'] }),
    ];
    expect(kinds(rows)).toContain('room-double-booked');
  });

  it('flags a speaker in two places at once', () => {
    const rows = [
      session({ id: 'a' }),
      session({ id: 'b', roomId: 'r2', startsAtLocal: `${DAY}T09:30`, endsAtLocal: `${DAY}T10:30` }),
    ];
    const report = run(rows);
    expect(report.conflicts.map((c) => c.kind)).toContain('speaker-double-booked');
    expect(report.conflicts[0].summary).toContain('Ada Nakamura');
  });

  it('matches speakers by id, so two people with one name are not confused', () => {
    // `speakerNames` is a denormalised display cache the model says is never
    // decided from. Keying on it would invent a clash between namesakes.
    const twins = [
      { id: 'sp1', doc: { name: 'Ada Nakamura' } as SpeakerDoc },
      { id: 'sp9', doc: { name: 'Ada Nakamura' } as SpeakerDoc },
    ];
    const rows = [
      session({ id: 'a', speakerIds: ['sp1'] }),
      session({ id: 'b', speakerIds: ['sp9'], roomId: 'r2', startsAtLocal: `${DAY}T09:30` }),
    ];
    const report = detectConflicts(rows, twins, rooms);
    expect(report.conflicts.map((c) => c.kind)).not.toContain('speaker-double-booked');
  });

  it('does not compare sessions on different days', () => {
    const rows = [
      session({ id: 'a' }),
      session({ id: 'b', day: '2027-05-06', startsAtLocal: '2027-05-06T09:00', endsAtLocal: '2027-05-06T10:00' }),
    ];
    expect(kinds(rows)).toEqual([]);
  });
});

describe('what is excluded', () => {
  it('ignores cancelled sessions, which do not occupy their room', () => {
    const rows = [
      session({ id: 'a' }),
      session({ id: 'b', status: 'cancelled', startsAtLocal: `${DAY}T09:30`, speakerIds: ['sp2'] }),
    ];
    expect(kinds(rows)).toEqual([]);
    expect(run(rows).sessionsChecked).toBe(1);
  });

  it('ignores soft-deleted sessions', () => {
    const rows = [
      session({ id: 'a' }),
      session({
        id: 'b',
        deletedAt: { toDate: () => new Date() } as never,
        startsAtLocal: `${DAY}T09:30`,
        speakerIds: ['sp2'],
      }),
    ];
    expect(kinds(rows)).toEqual([]);
  });

  it('does not nag about a draft with no room, because drafts are half-written', () => {
    expect(kinds([session({ status: 'draft', roomId: undefined })])).toEqual([]);
  });

  it('does not ask a social event to name a speaker', () => {
    expect(kinds([session({ format: 'social', speakerIds: [] })])).toEqual([]);
  });
});

describe('completeness', () => {
  it('flags a published session with no room as an error', () => {
    const report = run([session({ roomId: undefined })]);
    expect(report.conflicts[0].kind).toBe('no-room');
    expect(report.errors).toBe(1);
  });

  it('flags a published talk with nobody assigned as a warning, not an error', () => {
    const report = run([session({ speakerIds: [] })]);
    expect(report.conflicts[0].kind).toBe('no-speaker');
    expect(report.warnings).toBe(1);
    expect(report.errors).toBe(0);
  });

  it('flags a session capped above what the room holds', () => {
    const report = run([session({ roomId: 'r2', capacity: 100 })]);
    expect(report.conflicts.map((c) => c.kind)).toContain('over-capacity');
    // A warning: an organizer may deliberately oversell a room knowing half
    // the audience never turns up.
    expect(report.conflicts.find((c) => c.kind === 'over-capacity')!.severity).toBe('warning');
  });

  it('says nothing at all about a well-formed programme', () => {
    const rows = [
      session({ id: 'a' }),
      session({ id: 'b', startsAtLocal: `${DAY}T10:00`, endsAtLocal: `${DAY}T11:00`, speakerIds: ['sp2'] }),
    ];
    const report = run(rows);
    expect(report.conflicts).toEqual([]);
    expect(report.sessionsChecked).toBe(2);
  });
});

describe('ordering', () => {
  it('puts errors before warnings, so the list is read top-down', () => {
    const rows = [
      session({ id: 'warn', startsAtLocal: `${DAY}T14:00`, endsAtLocal: `${DAY}T15:00`, speakerIds: [], roomId: 'r2' }),
      session({ id: 'err', roomId: undefined, speakerIds: ['sp2'] }),
    ];
    const report = run(rows);
    expect(report.conflicts[0].severity).toBe('error');
    expect(report.conflicts[report.conflicts.length - 1].severity).toBe('warning');
  });
});
