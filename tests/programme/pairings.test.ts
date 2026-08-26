/**
 * Tests for the speed-networking round generator.
 *
 * Pure, which is why it was split out of the screen that renders it. The
 * guarantee under test is the one an organizer relies on without being able to
 * check it: across the rounds, nobody meets the same person twice while
 * somebody else meets nobody. Random pairing looks equivalent and is not — with
 * 20 people over 5 rounds it repeats roughly half the time.
 *
 * Run with: npm run test:programme
 */
import { describe, expect, it } from 'vitest';
import {
  buildSchedule,
  meetingCounts,
  repeatedPairs,
} from '../../apps/organizer/src/lib/pairings-core';

const NAMES = (n: number) => Array.from({ length: n }, (_, i) => `P${i + 1}`);

describe('nobody meets the same person twice', () => {
  it('never repeats a pair over a full even-sized schedule', () => {
    const s = buildSchedule(NAMES(8), 7);
    expect(s.complete).toBe(true);
    expect(repeatedPairs(s)).toEqual([]);
  });

  it('never repeats a pair over a full odd-sized schedule', () => {
    const s = buildSchedule(NAMES(9), 9);
    expect(repeatedPairs(s)).toEqual([]);
  });

  it('never repeats a pair over a partial schedule either', () => {
    // The realistic case: an organizer has time for four rounds, not nineteen.
    const s = buildSchedule(NAMES(20), 4);
    expect(s.complete).toBe(false);
    expect(repeatedPairs(s)).toEqual([]);
  });
});

describe('everybody meets everybody, exactly once, over a full schedule', () => {
  it('runs n-1 rounds for an even count', () => {
    const s = buildSchedule(NAMES(10), 99);
    expect(s.roundsForFullCover).toBe(9);
    expect(s.rounds).toHaveLength(9);
  });

  it('gives every person n-1 meetings', () => {
    const s = buildSchedule(NAMES(6), 5);
    for (const count of meetingCounts(s).values()) expect(count).toBe(5);
  });

  it('pairs everybody in every round when the count is even', () => {
    const s = buildSchedule(NAMES(8), 7);
    for (const round of s.rounds) {
      expect(round.pairs).toHaveLength(4);
      expect(round.resting).toBeUndefined();
    }
  });
});

describe('an odd count rests one person per round, and rotates who', () => {
  it('rests exactly one person each round', () => {
    const s = buildSchedule(NAMES(7), 7);
    for (const round of s.rounds) {
      expect(round.resting).toBeTruthy();
      // Three pairs plus one resting accounts for all seven.
      expect(round.pairs).toHaveLength(3);
    }
  });

  it('does not rest the same person twice before everybody has rested once', () => {
    const s = buildSchedule(NAMES(7), 7);
    const rested = s.rounds.map((r) => r.resting);
    expect(new Set(rested).size).toBe(7);
  });

  it('never puts three people in one group', () => {
    // A three-way is the tempting alternative to a bye and is worse: speed
    // networking runs on a timer, and a three-way conversation does not fit the
    // slot a two-way one does.
    const s = buildSchedule(NAMES(5), 4);
    for (const round of s.rounds) {
      for (const p of round.pairs) expect(p.b).toBeTruthy();
    }
  });
});

describe('the input is cleaned before anybody is paired', () => {
  it('drops a duplicate name rather than pairing somebody with themselves', () => {
    const s = buildSchedule(['Ada', 'ada ', 'Grace', 'Alan'], 3);
    expect(s.people).toBe(3);
    for (const round of s.rounds) {
      for (const p of round.pairs) expect(p.a).not.toBe(p.b);
    }
  });

  it('ignores blank lines', () => {
    expect(buildSchedule(['Ada', '', '   ', 'Grace'], 1).people).toBe(2);
  });

  it('produces nothing for fewer than two people', () => {
    expect(buildSchedule(['Ada'], 5).rounds).toEqual([]);
    expect(buildSchedule([], 5).rounds).toEqual([]);
  });
});

describe('the requested round count is a cap, not a promise', () => {
  it('never runs more rounds than full cover needs', () => {
    // Asking for twenty rounds among four people would otherwise repeat every
    // pair five times, which is the failure this cap exists to prevent.
    const s = buildSchedule(NAMES(4), 20);
    expect(s.rounds).toHaveLength(3);
    expect(repeatedPairs(s)).toEqual([]);
  });

  it('reports full cover even when fewer rounds were asked for', () => {
    const s = buildSchedule(NAMES(12), 3);
    expect(s.rounds).toHaveLength(3);
    expect(s.roundsForFullCover).toBe(11);
    expect(s.complete).toBe(false);
  });
});
