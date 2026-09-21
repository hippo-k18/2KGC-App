/**
 * Tests for the live door dashboard's two breakdowns.
 *
 * Each test is named after the guarantee it protects. Three of them are about
 * the same class of mistake: a chart that is arithmetically right and still
 * tells an organizer something false. An hourly chart that omits the quiet
 * hours draws a busy morning out of two arrivals; one that fills eight months
 * of them draws an axis nobody can read; and a check-in with no timestamp that
 * quietly vanishes makes two charts of the same people disagree.
 *
 * Run with: npm test  (or npm run test:programme)
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_EMPTY_HOURS,
  NO_TICKET_LABEL,
  doorDashboard,
  type DoorCheckIn,
} from '../../apps/organizer/src/lib/door-dashboard-core';

/** The venue's zone. Every expectation below is in New York wall time. */
const TZ = 'America/New_York';

function at(iso: string, ticketType?: string): DoorCheckIn {
  return { checkedInAt: iso, ticketType };
}

describe('doorDashboard', () => {
  it('counts nothing without inventing a chart to put it on', () => {
    const d = doorDashboard([], TZ);
    expect(d.total).toBe(0);
    expect(d.byTicket).toEqual([]);
    expect(d.byHour).toEqual([]);
    expect(d.busiestHour).toBeNull();
  });

  it('splits by ticket type, busiest first', () => {
    const d = doorDashboard(
      [
        at('2027-05-03T13:05:00Z', 'Workshops'),
        at('2027-05-03T13:10:00Z', 'All Access (VIP)'),
        at('2027-05-03T13:20:00Z', 'Workshops'),
        at('2027-05-03T13:30:00Z', 'Workshops'),
      ],
      TZ,
    );
    expect(d.byTicket.map((b) => [b.label, b.count])).toEqual([
      ['Workshops', 3],
      ['All Access (VIP)', 1],
    ]);
  });

  it('gives bars a width relative to the busiest bar in their own chart', () => {
    const d = doorDashboard(
      [
        at('2027-05-03T13:05:00Z', 'A'),
        at('2027-05-03T13:06:00Z', 'A'),
        at('2027-05-03T13:07:00Z', 'A'),
        at('2027-05-03T13:08:00Z', 'A'),
        at('2027-05-03T13:09:00Z', 'B'),
      ],
      TZ,
    );
    expect(d.byTicket[0].pct).toBe(100);
    expect(d.byTicket[1].pct).toBe(25);
  });

  it('keeps two ticket types on the same count in a stable order', () => {
    const first = doorDashboard([at('2027-05-03T13:00:00Z', 'Zebra'), at('2027-05-03T13:01:00Z', 'Apple')], TZ);
    const second = doorDashboard([at('2027-05-03T13:01:00Z', 'Apple'), at('2027-05-03T13:00:00Z', 'Zebra')], TZ);
    expect(first.byTicket.map((b) => b.label)).toEqual(['Apple', 'Zebra']);
    expect(second.byTicket.map((b) => b.label)).toEqual(first.byTicket.map((b) => b.label));
  });

  it('names a registration with no ticket rather than dropping it', () => {
    const d = doorDashboard([at('2027-05-03T13:00:00Z'), at('2027-05-03T13:01:00Z', '  ')], TZ);
    expect(d.byTicket).toEqual([{ label: NO_TICKET_LABEL, count: 2, pct: 100 }]);
    expect(d.total).toBe(2);
  });

  it('buckets by the hour in the venue zone, not in UTC', () => {
    // 13:05Z is 09:05 in New York, and 03:30Z the next day is 23:30 the
    // evening before. A UTC bucketing would file these on two different days
    // and call the second one the morning.
    const d = doorDashboard([at('2027-05-03T13:05:00Z'), at('2027-05-04T03:30:00Z')], TZ);
    expect(d.byHour[0].label).toBe('09:00');
    expect(d.byHour[d.byHour.length - 1].label).toBe('23:00');
  });

  it('draws the quiet hours between two arrivals', () => {
    const d = doorDashboard(
      [at('2027-05-03T13:00:00Z'), at('2027-05-03T13:30:00Z'), at('2027-05-03T16:00:00Z')],
      TZ,
    );
    expect(d.byHour.map((b) => [b.label, b.count])).toEqual([
      ['09:00', 2],
      ['10:00', 0],
      ['11:00', 0],
      ['12:00', 1],
    ]);
  });

  it('labels the hours with their day once the chart spans more than one', () => {
    const d = doorDashboard([at('2027-05-03T13:00:00Z'), at('2027-05-04T13:00:00Z')], TZ);
    expect(d.byHour[0].label).toBe('Mon 09:00');
    expect(d.byHour[d.byHour.length - 1].label).toBe('Tue 09:00');
    expect(d.skippedGaps).toBe(0);
  });

  it('leaves out a gap too long to draw, and says it did', () => {
    // A test scan in September and the real door in May. Filling that gap is
    // five thousand empty bars; filling part of it is an axis that lies.
    const d = doorDashboard([at('2026-09-20T13:00:00Z'), at('2027-05-03T13:00:00Z')], TZ);
    expect(d.skippedGaps).toBe(1);
    expect(d.byHour).toHaveLength(2);
    expect(d.byHour.map((b) => b.count)).toEqual([1, 1]);
  });

  it('draws a gap that is exactly as long as it is allowed to be', () => {
    const start = Date.parse('2027-05-03T13:00:00Z');
    const later = new Date(start + (MAX_EMPTY_HOURS + 1) * 3_600_000).toISOString();
    const d = doorDashboard([at('2027-05-03T13:00:00Z'), at(later)], TZ);
    expect(d.skippedGaps).toBe(0);
    expect(d.byHour).toHaveLength(MAX_EMPTY_HOURS + 2);
  });

  it('counts a check-in with no timestamp on the ticket chart and reports it', () => {
    const d = doorDashboard(
      [at('2027-05-03T13:00:00Z', 'Workshops'), { checkedInAt: null, ticketType: 'Workshops' }],
      TZ,
    );
    expect(d.total).toBe(2);
    expect(d.undated).toBe(1);
    expect(d.byTicket[0].count).toBe(2);
    expect(d.byHour.reduce((n, b) => n + b.count, 0)).toBe(1);
  });

  it('reports the busiest hour, and none at all when nobody has a time on them', () => {
    const busy = doorDashboard(
      [at('2027-05-03T13:00:00Z'), at('2027-05-03T13:10:00Z'), at('2027-05-03T14:00:00Z')],
      TZ,
    );
    expect(busy.busiestHour).toMatchObject({ label: '09:00', count: 2 });

    const undated = doorDashboard([{ checkedInAt: null }], TZ);
    expect(undated.busiestHour).toBeNull();
  });

  it('reports the first and last arrival as instants', () => {
    const d = doorDashboard(
      [at('2027-05-03T14:00:00Z'), at('2027-05-03T13:00:00Z'), at('2027-05-03T16:30:00Z')],
      TZ,
    );
    expect(d.firstAt).toBe('2027-05-03T13:00:00Z');
    expect(d.lastAt).toBe('2027-05-03T16:30:00Z');
  });
});
