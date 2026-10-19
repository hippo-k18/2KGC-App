/**
 * Tests for the sign outside a room door.
 *
 * The guarantee that matters most here is the one about blanks: a room with a
 * gap before the next talk and a room that is finished for the conference are
 * the same empty space on a screen and opposite facts to the person standing in
 * the corridor deciding whether to wait. `finished` is what keeps them apart,
 * and two of the tests below exist only to pin it.
 *
 * Run with: npm test  (or npm run test:programme)
 */
import { describe, expect, it } from 'vitest';
import {
  clockOf,
  minutesUntil,
  signageView,
  untilLabel,
  type SignageSession,
} from '../../apps/web/src/lib/room-signage-core';

function session(
  id: string,
  startsAtLocal: string,
  endsAtLocal: string,
  title = id,
): SignageSession {
  return {
    id,
    title,
    startsAtLocal,
    endsAtLocal,
    day: startsAtLocal.slice(0, 10),
    speakerNames: [],
  };
}

const morning = session('a', '2027-05-03T09:00', '2027-05-03T09:45', 'Opening');
const midday = session('b', '2027-05-03T11:00', '2027-05-03T11:45', 'Ontologies');
const afternoon = session('c', '2027-05-03T14:00', '2027-05-03T14:45', 'Reasoning');
const tomorrow = session('d', '2027-05-04T09:00', '2027-05-04T09:45', 'Day two');

describe('signageView', () => {
  it('puts the running session on the screen', () => {
    const v = signageView([morning, midday], '2027-05-03T09:20');
    expect(v.current?.id).toBe('a');
    expect(v.next?.id).toBe('b');
    expect(v.finished).toBe(false);
  });

  it('treats a session as over the minute it ends', () => {
    const v = signageView([morning, midday], '2027-05-03T09:45');
    expect(v.current).toBeNull();
    expect(v.next?.id).toBe('b');
  });

  it('shows nothing as current in the gap between two talks', () => {
    const v = signageView([morning, midday], '2027-05-03T10:15');
    expect(v.current).toBeNull();
    expect(v.next?.id).toBe('b');
    // The room is not finished: something is coming, and the corridor should
    // be told to wait rather than to leave.
    expect(v.finished).toBe(false);
  });

  it('says the room is finished only when nothing follows', () => {
    const v = signageView([morning, midday], '2027-05-03T18:00');
    expect(v.current).toBeNull();
    expect(v.next).toBeNull();
    expect(v.finished).toBe(true);
  });

  it('carries on to the next day rather than going blank overnight', () => {
    const v = signageView([morning, tomorrow], '2027-05-03T18:00');
    expect(v.next?.id).toBe('d');
    expect(v.finished).toBe(false);
  });

  it('lists what follows on the same day as the next session, and nothing beyond it', () => {
    const v = signageView([morning, midday, afternoon, tomorrow], '2027-05-03T08:00');
    expect(v.next?.id).toBe('a');
    expect(v.later.map((s) => s.id)).toEqual(['b', 'c']);
  });

  it('shows the overrunning session rather than the one double-booked on top of it', () => {
    // Two sessions in one room at once is a scheduling fault, reported by
    // Conflict Check. The screen still has to pick one, and the talk that is
    // already in the room is the one the corridor can see.
    const plenary = session('p', '2027-05-03T09:00', '2027-05-03T12:00', 'Plenary');
    const v = signageView([plenary, midday], '2027-05-03T11:10');
    expect(v.current?.id).toBe('p');
  });

  it('never makes a session with no end time the current one', () => {
    const noEnd = session('x', '2027-05-03T09:00', '', 'No end recorded');
    const v = signageView([noEnd], '2027-05-03T09:30');
    expect(v.current).toBeNull();
    expect(v.finished).toBe(true);
  });

  it('handles a room with nothing in it at all', () => {
    const v = signageView([], '2027-05-03T09:30');
    expect(v).toEqual({ current: null, next: null, later: [], finished: true });
  });
});

describe('clockOf', () => {
  it('reads the time out of a local stamp', () => {
    expect(clockOf('2027-05-03T14:05')).toBe('14:05');
    expect(clockOf('')).toBe('');
  });
});

describe('minutesUntil', () => {
  it('counts whole minutes forward', () => {
    expect(minutesUntil('2027-05-03T09:30', '2027-05-03T09:00')).toBe(30);
    expect(minutesUntil('2027-05-04T09:00', '2027-05-03T09:00')).toBe(1440);
  });

  it('returns null once the moment has passed', () => {
    expect(minutesUntil('2027-05-03T09:00', '2027-05-03T09:00')).toBeNull();
    expect(minutesUntil('2027-05-03T08:00', '2027-05-03T09:00')).toBeNull();
  });
});

describe('untilLabel', () => {
  it('counts down in minutes inside the hour', () => {
    expect(untilLabel('2027-05-03T09:25', '2027-05-03T09:00', 'Mon 3 May')).toBe('in 25 minutes');
    expect(untilLabel('2027-05-03T09:01', '2027-05-03T09:00', 'Mon 3 May')).toBe('in 1 minute');
  });

  it('rounds to hours further out on the same day', () => {
    expect(untilLabel('2027-05-03T12:00', '2027-05-03T09:00', 'Mon 3 May')).toBe('in 3 hours');
  });

  it('names the day rather than counting thousands of minutes', () => {
    expect(untilLabel('2027-05-05T09:00', '2027-05-03T09:00', 'Wed 5 May')).toBe('Wed 5 May');
  });
});
