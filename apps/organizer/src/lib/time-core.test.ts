import { describe, expect, it } from 'vitest';

import { clockOfInstant, dayOfInstant, stampOfInstant } from './time-core';

/**
 * The evening-scan case, pinned.
 *
 * Every one of these dates used to be produced by `iso.slice(0, 10)`, which is
 * right for two thirds of a New York day and wrong for the rest of it — so a
 * test written at any hour before 20:00 Eastern passes against the broken code.
 * The instants below are chosen to land on the wrong side of midnight UTC, in
 * both offsets, which is the only version of this test worth having.
 */
describe('dayOfInstant', () => {
  it('reads the New York date off an instant that is already tomorrow in UTC', () => {
    // 21:20 on 20 September in New York (EDT, UTC-4).
    expect(dayOfInstant('2026-09-21T01:20:00.000Z')).toBe('2026-09-20');
    expect(clockOfInstant('2026-09-21T01:20:00.000Z')).toBe('21:20');
  });

  it('does the same in standard time, where the offset is an hour wider', () => {
    // 20:30 on 5 January in New York (EST, UTC-5).
    expect(dayOfInstant('2026-01-06T01:30:00.000Z')).toBe('2026-01-05');
    expect(clockOfInstant('2026-01-06T01:30:00.000Z')).toBe('20:30');
  });

  it('agrees with the slice when the instant is safely inside the UTC day', () => {
    expect(dayOfInstant('2026-09-20T14:00:00.000Z')).toBe('2026-09-20');
    expect(clockOfInstant('2026-09-20T14:00:00.000Z')).toBe('10:00');
  });

  it('honours an explicit zone rather than the machine it runs on', () => {
    expect(dayOfInstant('2026-09-21T01:20:00.000Z', 'Europe/Dublin')).toBe('2026-09-21');
    expect(clockOfInstant('2026-09-21T01:20:00.000Z', 'Europe/Dublin')).toBe('02:20');
  });

  it('gives back nothing at all for a missing or unreadable value', () => {
    for (const bad of [undefined, null, '', 'not a date']) {
      expect(dayOfInstant(bad)).toBe('');
      expect(clockOfInstant(bad)).toBe('');
    }
  });
});

/**
 * The same evening-scan case for the joined form, because the joined form is
 * what the door tables print and `iso.slice(0, 16).replace('T', ' ')` is what
 * they printed before. That expression puts a 22:39 arrival at 02:39 the next
 * day, so the arrivals panel and the table under it disagreed about which day
 * somebody walked in.
 */
describe('stampOfInstant', () => {
  it('reads both halves off the venue clock, not off the UTC string', () => {
    expect(stampOfInstant('2026-09-22T02:39:00.000Z')).toBe('2026-09-21 22:39');
    expect('2026-09-22T02:39:00.000Z'.slice(0, 16).replace('T', ' ')).toBe('2026-09-22 02:39');
  });

  it('honours an explicit zone', () => {
    expect(stampOfInstant('2026-09-22T02:39:00.000Z', 'Europe/Dublin')).toBe('2026-09-22 03:39');
  });

  it('gives back nothing at all for a missing or unreadable value', () => {
    for (const bad of [undefined, null, '', 'not a date']) {
      expect(stampOfInstant(bad)).toBe('');
    }
  });
});
