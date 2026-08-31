/**
 * Tests for the per-session attendance joins.
 *
 * Pure, and fast, for the same reason `conflicts-core` is: the arithmetic that
 * turns three collections into the numbers four screens print takes plain
 * arrays, and the Firestore reads around it are a separate module.
 *
 * Each test is named after the guarantee it protects, and the guarantees are
 * not arbitrary. Two of them are about a distinction this dashboard has got
 * wrong before in other places: **a session nobody counted is not a session
 * nobody attended.** They render as the same integer and they are opposite
 * facts, and a programme committee cutting a track on the strength of a zero it
 * never measured is the failure this code is shaped to prevent.
 *
 * Run with: npm test  (or npm run test:programme)
 */
import { describe, expect, it } from 'vitest';
import {
  dayListId,
  formatHours,
  joinAttendeeHours,
  joinSessionAttendance,
  scheduledMinutes,
  sessionListId,
  sessionListsBySession,
  type ListLike,
  type SessionLike,
} from '../../apps/organizer/src/lib/checkin-core';

const DAY = '2027-05-05';

function session(over: Partial<SessionLike> & { id: string }): SessionLike {
  return {
    title: `Session ${over.id}`,
    day: DAY,
    startsAtLocal: `${DAY}T09:00`,
    endsAtLocal: `${DAY}T10:00`,
    ...over,
  };
}

function sessionList(sessionId: string): ListLike {
  return { id: sessionListId(sessionId), kind: 'session', sessionId };
}

describe('derived list ids', () => {
  it('maps a session to exactly one id, so two Start presses cannot open two doors', () => {
    expect(sessionListId('abc')).toBe('session-abc');
    expect(sessionListId('abc')).toBe(sessionListId('abc'));
  });

  it('keeps day and session ids in separate namespaces', () => {
    expect(dayListId(DAY)).toBe(`day-${DAY}`);
    expect(dayListId(DAY)).not.toBe(sessionListId(DAY));
  });
});

describe('scheduledMinutes', () => {
  it('reads the wall clocks rather than the machine timezone', () => {
    // Parsed as UTC on both ends deliberately: the answer must not change with
    // the timezone of whatever laptop the dashboard is running on.
    expect(scheduledMinutes({ startsAtLocal: `${DAY}T09:00`, endsAtLocal: `${DAY}T10:30` })).toBe(90);
  });

  it('returns 0 rather than a negative for an end before its start', () => {
    expect(scheduledMinutes({ startsAtLocal: `${DAY}T10:00`, endsAtLocal: `${DAY}T09:00` })).toBe(0);
  });

  it('returns 0 for an unparseable clock instead of NaN reaching a total', () => {
    expect(scheduledMinutes({ startsAtLocal: 'not a time', endsAtLocal: `${DAY}T10:00` })).toBe(0);
  });
});

describe('formatHours', () => {
  it('reads as a duration a certificate could quote', () => {
    expect(formatHours(0)).toBe('0h');
    expect(formatHours(45)).toBe('45m');
    expect(formatHours(60)).toBe('1h');
    expect(formatHours(150)).toBe('2h 30m');
  });
});

describe('sessionListsBySession', () => {
  it('ignores lists that are not session scope', () => {
    const map = sessionListsBySession([
      { id: 'event-door', kind: 'event' },
      sessionList('s1'),
      { id: 'dinner', kind: 'meal' },
    ]);
    expect([...map.keys()]).toEqual(['s1']);
  });

  it('ignores a session-kind list with no sessionId, which cannot be joined to anything', () => {
    // The hand-named list form can produce one of these. It is a valid list to
    // scan into and it is not session attendance, and conflating the two would
    // credit hours to whichever session happened to share its name.
    const map = sessionListsBySession([{ id: 'abc123', kind: 'session' }]);
    expect(map.size).toBe(0);
  });
});

describe('joinSessionAttendance', () => {
  const sessions = [session({ id: 's1' }), session({ id: 's2' })];

  it('counts a session that has a door', () => {
    const rows = joinSessionAttendance(sessions, [sessionList('s1')], new Map([['session-s1', 12]]));
    expect(rows.find((r) => r.session.id === 's1')).toMatchObject({ tracked: true, countedIn: 12 });
  });

  it('marks a session with no door untracked, so a zero is never mistaken for a measurement', () => {
    const rows = joinSessionAttendance(sessions, [sessionList('s1')], new Map([['session-s1', 12]]));
    const s2 = rows.find((r) => r.session.id === 's2')!;
    expect(s2.tracked).toBe(false);
    expect(s2.countedIn).toBe(0);
  });

  it('reports 0 for a door that was opened and never scanned into — which is a measurement', () => {
    const rows = joinSessionAttendance(sessions, [sessionList('s1')], new Map());
    expect(rows.find((r) => r.session.id === 's1')).toMatchObject({ tracked: true, countedIn: 0 });
  });

  it('carries the id the door would have, so a screen can link to a list that does not exist yet', () => {
    const rows = joinSessionAttendance(sessions, [], new Map());
    expect(rows[0].listId).toBe('session-s1');
  });
});

describe('joinAttendeeHours', () => {
  const morning = session({ id: 's1', startsAtLocal: `${DAY}T09:00`, endsAtLocal: `${DAY}T10:30` });
  const afternoon = session({ id: 's2', startsAtLocal: `${DAY}T14:00`, endsAtLocal: `${DAY}T15:00` });

  const checkIns = new Map([
    ['session-s1', [{ registrationId: 'reg_a', checkedInAt: null }, { registrationId: 'reg_b', checkedInAt: null }]],
    ['session-s2', [{ registrationId: 'reg_a', checkedInAt: null }]],
  ]);

  it('adds up the scheduled lengths of every session somebody was counted into', () => {
    const rows = joinAttendeeHours([morning, afternoon], [sessionList('s1'), sessionList('s2')], checkIns);
    expect(rows.find((r) => r.registrationId === 'reg_a')!.minutes).toBe(150);
    expect(rows.find((r) => r.registrationId === 'reg_b')!.minutes).toBe(90);
  });

  it('lists the sessions in the order they were scheduled, not the order they were read', () => {
    const rows = joinAttendeeHours([afternoon, morning], [sessionList('s2'), sessionList('s1')], checkIns);
    expect(rows.find((r) => r.registrationId === 'reg_a')!.sessions.map((s) => s.sessionId)).toEqual([
      's1',
      's2',
    ]);
  });

  it('omits a cancelled session entirely rather than crediting its hours', () => {
    // The caller filters cancelled sessions out of the array it passes; this
    // asserts the join does not resurrect them from the list side, which is
    // where a door document outlives the session it was opened for.
    const rows = joinAttendeeHours([morning], [sessionList('s1'), sessionList('s2')], checkIns);
    expect(rows.find((r) => r.registrationId === 'reg_a')!.minutes).toBe(90);
  });

  it('returns nobody when no session door has been opened', () => {
    expect(joinAttendeeHours([morning, afternoon], [], checkIns)).toEqual([]);
  });
});
