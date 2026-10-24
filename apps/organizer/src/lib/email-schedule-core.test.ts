import { describe, expect, it } from 'vitest';

import {
  callSchedule,
  cronHealth,
  jobSchedule,
  nextReminderMs,
  nextRunAt,
  sortSchedule,
  type ScheduleCall,
  type ScheduleEnv,
  type ScheduleRow,
} from './email-schedule-core';

/**
 * The Scheduled tab (T274): what the hourly run and the bulk sends will do,
 * what waits on a button, and what cannot go because a setting is missing.
 */
const NY = 'America/New_York';
const DAY = 86_400_000;
const HOUR = 3_600_000;
// Tuesday 20 October 2026, 10:15 in New York.
const NOW = Date.parse('2026-10-20T14:15:00Z');

const OK: ScheduleEnv = { emailEnabled: true, cronSecretSet: true, lastCronRunMs: NOW - 20 * 60_000 };

const sub = (over: Partial<ScheduleRow> & { id: string }): ScheduleRow => ({
  status: 'submitted',
  title: `Talk ${over.id}`,
  name: `Author ${over.id}`,
  email: `${over.id}@example.com`,
  ...over,
});

const call = (over: Partial<ScheduleCall> = {}): ScheduleCall => ({
  id: 'call_1',
  title: 'KGC 2027',
  timeZone: NY,
  opensAtMs: Date.parse('2026-09-01T00:00:00Z'),
  closesAtMs: Date.parse('2026-12-15T05:00:00Z'),
  cfp: {
    closeDate: '2026-12-14',
    decisionDate: '2027-02-14',
    reviewerReminderEmail: 'francois@example.com',
    acceptNoticeEmail: 'min@example.com',
  },
  rows: [],
  ...over,
});

const keys = (c: ScheduleCall, env = OK, now = NOW) => callSchedule(c, env, now).map((i) => i.key);

describe('E3, five days after E2', () => {
  it('is scheduled for the first hourly run after the five days', () => {
    const e2 = NOW - 2 * DAY;
    const [item] = callSchedule(
      call({ rows: [sub({ id: 'a', status: 'accepted', acceptance: { e2SentAtMs: e2 } })] }),
      OK,
      NOW,
    ).filter((i) => i.key === 'e3:a');
    expect(item.whenMs).toBe(nextRunAt(e2 + 5 * DAY));
    expect(item.to).toBe('a@example.com');
    expect(item.blocked).toBeUndefined();
  });

  it('is due at the next run once the five days have passed', () => {
    const [item] = callSchedule(
      call({ rows: [sub({ id: 'a', status: 'accepted', acceptance: { e2SentAtMs: NOW - 9 * DAY } })] }),
      OK,
      NOW,
    ).filter((i) => i.key === 'e3:a');
    expect(item.whenMs).toBe(Date.parse('2026-10-20T15:00:00Z'));
  });

  it('is not scheduled for someone already nudged, or whose details arrived', () => {
    const rows = [
      sub({ id: 'n', status: 'accepted', acceptance: { e2SentAtMs: NOW - DAY, nudgedAtMs: NOW } }),
      sub({ id: 'd', status: 'accepted', acceptance: { e2SentAtMs: NOW - DAY }, detailsReceivedAtMs: NOW }),
      sub({ id: 'h', status: 'accepted', acceptance: { e2HeldForE4: true } }),
    ];
    expect(keys(call({ rows })).filter((k) => k.startsWith('e3:'))).toEqual([]);
  });
});

describe('owed E2', () => {
  it('goes on the next hourly run', () => {
    const rows = [sub({ id: 'o', status: 'accepted', acceptance: { e2Owed: true } })];
    const item = callSchedule(call({ rows }), OK, NOW).find((i) => i.key === 'e2:o')!;
    expect(item.whenMs).toBe(nextRunAt(NOW));
  });
});

describe('the Thursday reminder', () => {
  it('is next Thursday at 09:00 in New York', () => {
    const at = nextReminderMs(call({ rows: [sub({ id: 'x' })] }), NOW)!;
    expect(new Date(at).toISOString()).toBe('2026-10-22T13:00:00.000Z');
  });

  it('skips this week when it has already gone', () => {
    const thursdayNoon = Date.parse('2026-10-22T16:00:00Z');
    const c = call({ rows: [sub({ id: 'x' })], cfp: { ...call().cfp, lastReminderWeek: '2026-W43' } });
    expect(new Date(nextReminderMs(c, thursdayNoon)!).toISOString()).toBe('2026-10-29T13:00:00.000Z');
  });

  it('does not go before the call opens', () => {
    const c = call({ opensAtMs: Date.parse('2026-11-02T14:00:00Z'), rows: [sub({ id: 'x' })] });
    expect(new Date(nextReminderMs(c, NOW)!).toISOString()).toBe('2026-11-05T14:00:00.000Z');
  });

  it('stops after the close once nothing is left to review', () => {
    const after = Date.parse('2026-12-20T15:00:00Z');
    const c = call({ rows: [sub({ id: 'x', status: 'rejected' })] });
    expect(nextReminderMs(c, after)).toBeUndefined();
    expect(keys(c, OK, after)).not.toContain('reminder:call_1');
  });

  it('says plainly when the address is missing', () => {
    const c = call({ cfp: { ...call().cfp, reviewerReminderEmail: '' }, rows: [sub({ id: 'x' })] });
    const item = callSchedule(c, OK, NOW).find((i) => i.key === 'reminder:call_1')!;
    expect(item.to).toBe('No address set');
    expect(item.blocked).toMatch(/weekly reminder address is empty/i);
    expect(item.count).toBe(0);
  });
});

describe('what cannot go because a setting is missing', () => {
  const rows = [sub({ id: 'a', status: 'accepted', acceptance: { e2SentAtMs: NOW - DAY } })];

  it('everything timed is blocked without CRON_SECRET', () => {
    const item = callSchedule(call({ rows }), { ...OK, cronSecretSet: false }, NOW).find((i) => i.key === 'e3:a')!;
    expect(item.blocked).toMatch(/CRON_SECRET/);
  });

  it('and is marked as skipped without an email key', () => {
    const item = callSchedule(call({ rows }), { ...OK, emailEnabled: false }, NOW).find((i) => i.key === 'e3:a')!;
    expect(item.blocked).toMatch(/RESEND_API_KEY/);
  });

  it('reports a timer that has stopped calling in', () => {
    expect(cronHealth(OK, NOW)).toBeNull();
    expect(cronHealth({ ...OK, lastCronRunMs: NOW - 4 * HOUR }, NOW)).toMatch(/three hours/);
    expect(cronHealth({ ...OK, lastCronRunMs: undefined }, NOW)).toMatch(/not reported in/);
    expect(cronHealth({ ...OK, cronSecretSet: false }, NOW)).toMatch(/CRON_SECRET/);
  });
});

describe('waiting for someone to send', () => {
  const rows = [
    sub({ id: 'r1', status: 'rejected' }),
    sub({ id: 'r2', status: 'rejected' }),
    sub({ id: 'told', status: 'rejected', closeDecisionSent: true }),
    sub({ id: 'late', status: 'accepted', acceptance: { e2HeldForE4: true } }),
    sub({ id: 'open1' }),
    sub({ id: 'open2', stillOpenSentAtMs: NOW }),
  ];

  it('counts E4 both ways and E6, with the button to press', () => {
    const items = callSchedule(call({ rows }), OK, NOW);
    const e4d = items.find((i) => i.key === 'e4d:call_1')!;
    expect(e4d).toMatchObject({ kind: 'waiting', count: 2, to: '2 authors' });
    expect(e4d.where?.href).toBe('/content/call-for-speakers-abstracts/rolling-review');
    expect(items.find((i) => i.key === 'e4a:call_1')).toMatchObject({ count: 1, to: '1 author' });
    expect(items.find((i) => i.key === 'e6:call_1')).toMatchObject({ count: 1 });
  });

  /*
   * T280 (gate B#1): since T275 the E4 button sends whenever it is pressed.
   * The tab must never say it opens on a date or cannot open yet.
   */
  it('never blocks E4, before or after the close, with or without a close date', () => {
    const after = Date.parse('2026-12-29T15:00:00Z');
    const noClose = call({ rows, cfp: { reviewerReminderEmail: 'f@example.com' } });
    for (const [c, at] of [[call({ rows }), NOW], [call({ rows }), after], [noClose, NOW]] as const) {
      for (const key of ['e4d:call_1', 'e4a:call_1']) {
        const item = callSchedule(c, OK, at).find((i) => i.key === key)!;
        expect(item.kind).toBe('waiting');
        expect(item.blocked).toBeUndefined();
        expect(JSON.stringify(item)).not.toMatch(/opens on|cannot open/);
        // No planned date (T293): never timed, never a day to wait for.
        expect(item.whenMs).toBeUndefined();
        expect(JSON.stringify(item)).not.toMatch(/two weeks|due on/i);
      }
      expect(callSchedule(c, OK, at).find((i) => i.key === 'e4d:call_1')!.when).toBe(
        'Not scheduled. They go only when someone presses Send.',
      );
    }
  });

  it('while the call is open, says it can go now behind a second tick', () => {
    const e4d = callSchedule(call({ rows }), OK, NOW).find((i) => i.key === 'e4d:call_1')!;
    expect(e4d.note).toMatch(/send this now/);
    expect(e4d.note).toMatch(/second box/);
    const after = Date.parse('2026-12-29T15:00:00Z');
    expect(callSchedule(call({ rows }), OK, after).find((i) => i.key === 'e4d:call_1')!.note).toBeUndefined();
  });

  it('leaves out anyone with no address', () => {
    const c = call({ rows: [sub({ id: 'r', status: 'rejected', email: undefined })] });
    expect(keys(c)).not.toContain('e4d:call_1');
  });
});

describe('bulk sends', () => {
  const job = { campaignId: 'c1', kind: 'campaign' as const, audience: 'list_1', label: 'the list', subject: 'Tickets', total: 100, reached: 40, failed: 0 };

  it('shows a running send with how many are left', () => {
    const [item] = jobSchedule([{ ...job, view: 'running' }], OK);
    expect(item).toMatchObject({ kind: 'sending', count: 60 });
    expect(item.when).toContain('40 of 100');
  });

  it('shows a stopped send as waiting for Send again, on the right screen', () => {
    const [item] = jobSchedule([{ ...job, view: 'interrupted' }], OK);
    expect(item.kind).toBe('waiting');
    expect(item.where?.href).toBe('/tickets/ticket-marketing/email-campaign');
    const [msg] = jobSchedule([{ ...job, kind: 'message', audience: 'sponsors', view: 'stopped' }], OK);
    expect(msg.where?.href).toBe('/content/sponsor-center/message-sponsors');
  });

  it('leaves out a finished send that reached everyone', () => {
    expect(jobSchedule([{ ...job, view: 'done', reached: 100 }], OK)).toEqual([]);
  });
});

describe('order', () => {
  it('lists sending, then timed by time, then waiting', () => {
    const items = sortSchedule([
      { key: 'w', email: 'W', template: '', kind: 'waiting', when: '', to: '', count: 1 },
      { key: 't2', email: 'T', template: '', kind: 'timed', whenMs: 2, when: '', to: '', count: 1 },
      { key: 't1', email: 'T', template: '', kind: 'timed', whenMs: 1, when: '', to: '', count: 1 },
      { key: 's', email: 'S', template: '', kind: 'sending', when: '', to: '', count: 1 },
    ]);
    expect(items.map((i) => i.key)).toEqual(['s', 't1', 't2', 'w']);
  });
});
