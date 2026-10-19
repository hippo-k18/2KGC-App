import { describe, expect, it } from 'vitest';
import {
  OTHER_TRACK,
  TRACK_OTHER_MAX,
  joinWords,
  sessionTypeQuestion,
  trackChoice,
  trackLabel,
  typeLabel,
  abstractProblem,
  cfpStatus,
  closeDecisionPlan,
  dayAfter,
  fieldsForSessionType,
  fillPlaceholders,
  formatDay,
  holdE2ForClose,
  isoWeek,
  missingSettings,
  nudgesDue,
  pageValues,
  reminderDue,
  reviewCounts,
  reviewQueue,
  sessionTypeLine,
  stillOpenRecipients,
  wordCount,
  type CfpRow,
} from './cfp-core';

const NY = 'America/New_York';
const DAY = 24 * 60 * 60 * 1000;
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

describe('abstract length', () => {
  it('counts words across line breaks and runs of space', () => {
    expect(wordCount('  one two\n\nthree   four ')).toBe(4);
    expect(wordCount('')).toBe(0);
  });

  it('takes 150 to 300 words and names the count otherwise', () => {
    const limits = { min: 150, max: 300 };
    expect(abstractProblem(words(150), limits)).toBeNull();
    expect(abstractProblem(words(300), limits)).toBeNull();
    expect(abstractProblem(words(149), limits)).toMatch(/149 words\. It needs 150 to 300/);
    expect(abstractProblem(words(301), limits)).toMatch(/301 words\. Cut it to 300/);
  });
});

describe('questions by session type', () => {
  const fields = [
    { id: 'everyone' },
    { id: 'outline', sessionTypes: ['workshop' as const] },
    { id: 'slides', sessionTypes: ['talk' as const] },
  ];

  it('asks a workshop the workshop questions and not the talk ones', () => {
    expect(fieldsForSessionType(fields, 'workshop').map((f) => f.id)).toEqual(['everyone', 'outline']);
    expect(fieldsForSessionType(fields, 'talk').map((f) => f.id)).toEqual(['everyone', 'slides']);
  });

  it('asks only the shared questions before a type is chosen', () => {
    expect(fieldsForSessionType(fields, undefined).map((f) => f.id)).toEqual(['everyone']);
  });

  it('writes the type line E2 prints', () => {
    expect(sessionTypeLine('talk', 25)).toBe('Talk, 25 minutes');
    expect(sessionTypeLine('workshop', 45)).toBe('Workshop');
  });
});

describe('dates', () => {
  it('reads a calendar date the way Min writes them', () => {
    expect(formatDay('2026-11-01')).toBe('Sunday 1 November 2026');
    expect(formatDay('2027-02-30')).toBeUndefined();
    expect(formatDay(undefined)).toBeUndefined();
  });

  it('puts the seven-day deadline on the right day in New York, not UTC', () => {
    // 23:30 in New York on 2 November is already 3 November in UTC.
    const at = Date.parse('2026-11-03T04:30:00Z');
    expect(dayAfter(at, 7, NY)).toBe('Monday 9 November 2026');
  });
});

describe('placeholders on the page', () => {
  const copy = [
    'How we review. We read every week.',
    '- Not hearing from us is not a no. Every submission gets a decision, yes or no, by [DECISION DATE] at the latest.',
    'Submissions close [CLOSE DATE].',
  ].join('\n\n');

  it('fills both dates when they are set', () => {
    const out = fillPlaceholders(copy, pageValues({ closeDate: '2027-01-31', decisionDate: '2027-02-14' }));
    expect(out).toContain('by Sunday 14 February 2027 at the latest.');
    expect(out).toContain('Submissions close Sunday 31 January 2027.');
    expect(out).not.toMatch(/\[/);
  });

  it('leaves out the sentence, and an emptied paragraph, when a date is unset', () => {
    const out = fillPlaceholders(copy, pageValues({}));
    expect(out).not.toMatch(/\[|DATE/);
    expect(out).toContain('- Not hearing from us is not a no.');
    expect(out).not.toContain('Submissions close');
    expect(out.split('\n\n')).toHaveLength(2);
  });

  it('keeps Windows line breaks from the live document working', () => {
    expect(fillPlaceholders('One.\r\n\r\nClose [CLOSE DATE].', {})).toBe('One.');
  });
});

const row = (over: Partial<CfpRow> & { id: string }): CfpRow => ({ status: 'submitted', ...over });

describe('status for the inbox', () => {
  it('names the five states the inbox sees', () => {
    expect(cfpStatus({ status: 'submitted' })).toBe('open');
    expect(cfpStatus({ status: 'under-review' })).toBe('open');
    expect(cfpStatus({ status: 'accepted' })).toBe('accepted');
    expect(cfpStatus({ status: 'accepted', detailsReceivedAtMs: 1 })).toBe('details-received');
    expect(cfpStatus({ status: 'rejected' })).toBe('rejected');
  });
});

describe('the weekly review', () => {
  const rows = [
    row({ id: 'old', submittedAtMs: 100 }),
    row({ id: 'older', submittedAtMs: 50 }),
    row({ id: 'new', submittedAtMs: 300 }),
    row({ id: 'newer', submittedAtMs: 400 }),
    row({ id: 'yes', status: 'accepted', submittedAtMs: 10 }),
    row({ id: 'no', status: 'rejected', submittedAtMs: 10 }),
    row({ id: 'draft', status: 'draft' }),
  ];

  it('puts what arrived since the last pass first, then the oldest left over', () => {
    const q = reviewQueue(rows, 200);
    expect(q.map((x) => x.row.id)).toEqual(['newer', 'new', 'older', 'old']);
    expect(q.map((x) => x.isNew)).toEqual([true, true, false, false]);
  });

  it('counts open, accepted and rejected', () => {
    expect(reviewCounts(rows)).toEqual({ open: 4, accepted: 1, rejected: 1 });
  });
});

describe('E3, the nudge', () => {
  const sent = Date.parse('2026-11-10T15:00:00Z');
  const rows = [
    row({ id: 'due', status: 'accepted', acceptance: { e2SentAtMs: sent } }),
    row({ id: 'in', status: 'accepted', acceptance: { e2SentAtMs: sent }, detailsReceivedAtMs: sent + DAY }),
    row({ id: 'done', status: 'accepted', acceptance: { e2SentAtMs: sent, nudgedAtMs: sent + 5 * DAY } }),
    row({ id: 'held', status: 'accepted', acceptance: { e2HeldForE4: true } }),
  ];

  it('is not due four days after E2', () => {
    expect(nudgesDue(rows, sent + 4 * DAY)).toEqual([]);
  });

  it('is due five days after E2, only for those who sent nothing and were not nudged', () => {
    expect(nudgesDue(rows, sent + 5 * DAY).map((r) => r.id)).toEqual(['due']);
  });
});

describe('the Thursday reminder', () => {
  it('fires on Thursday from 09:00 New York, once a week', () => {
    const thu8 = Date.parse('2026-11-12T13:00:00Z'); // 08:00 EST
    const thu9 = Date.parse('2026-11-12T14:00:00Z'); // 09:00 EST
    const wed = Date.parse('2026-11-11T15:00:00Z');
    expect(reminderDue(thu8, NY, undefined)).toBe(false);
    expect(reminderDue(wed, NY, undefined)).toBe(false);
    expect(reminderDue(thu9, NY, undefined)).toBe(true);
    expect(reminderDue(thu9, NY, isoWeek(thu9, NY))).toBe(false);
    expect(isoWeek(thu9, NY)).toBe('2026-W46');
  });
});

describe('E4 and E6', () => {
  const rows = [
    row({ id: 'open' }),
    row({ id: 'told', stillOpenSentAtMs: 1 }),
    row({ id: 'held', status: 'accepted', acceptance: { e2HeldForE4: true } }),
    row({ id: 'early', status: 'accepted', acceptance: { e2SentAtMs: 1 } }),
    row({ id: 'no', status: 'rejected' }),
    row({ id: 'no-told', status: 'rejected', closeDecisionSent: true }),
  ];

  it('sends the accepted version only to acceptances held for it, the declined one to untold rejections', () => {
    const plan = closeDecisionPlan(rows);
    expect(plan.accepted.map((r) => r.id)).toEqual(['held']);
    expect(plan.declined.map((r) => r.id)).toEqual(['no']);
    expect(plan.undecided.map((r) => r.id)).toEqual(['open', 'told']);
  });

  it('sends E6 once, to the queue', () => {
    expect(stillOpenRecipients(rows).map((r) => r.id)).toEqual(['open']);
  });

  it('holds E2 only for acceptances after the close date', () => {
    const cfp = { closeDate: '2027-01-31' };
    expect(holdE2ForClose(Date.parse('2027-01-31T20:00:00Z'), cfp, NY)).toBe(false);
    expect(holdE2ForClose(Date.parse('2027-02-01T15:00:00Z'), cfp, NY)).toBe(true);
    expect(holdE2ForClose(Date.parse('2027-02-01T15:00:00Z'), {}, NY)).toBe(false);
  });
});

describe('the settings warning', () => {
  it('names every unset setting', () => {
    expect(missingSettings(undefined)).toHaveLength(5);
    expect(
      missingSettings({
        closeDate: '2027-01-31',
        decisionDate: '2027-02-14',
        sessionNoticeDate: '2027-03-01',
        acceptNoticeEmail: 'min@example.org',
        reviewerReminderEmail: 'francois@example.org',
      }),
    ).toEqual([]);
  });
});

describe('when E4 may go (T252)', () => {
  it('needs a close date and two weeks after it', async () => {
    const { closeDecisionOpen, closeDecisionDate } = await import('./cfp-core');
    expect(closeDecisionDate({})).toBeUndefined();
    expect(closeDecisionOpen(Date.parse('2030-01-01T00:00:00Z'), {}, NY)).toBe(false);
    const cfp = { closeDate: '2027-01-31' };
    expect(closeDecisionDate(cfp)).toBe('2027-02-14');
    expect(closeDecisionOpen(Date.parse('2027-02-14T04:00:00Z'), cfp, NY)).toBe(false); // 23:00 on the 13th in NY
    expect(closeDecisionOpen(Date.parse('2027-02-14T15:00:00Z'), cfp, NY)).toBe(true);
  });
});

describe('the Other track (T271)', () => {
  const call = { trackIds: ['metadata'], allowOtherTrack: true };
  const name = (id: string) => (id === 'metadata' ? 'Metadata' : undefined);

  it('labels a track, an Other topic, or nothing', () => {
    expect(trackLabel({ trackId: 'metadata' }, name)).toBe('Metadata');
    expect(trackLabel({ trackOther: 'Logistics' }, name)).toBe('Other: Logistics');
    expect(trackLabel({}, name)).toBeUndefined();
  });

  it('keeps the typed topic and no track id', () => {
    expect(trackChoice(call, { trackId: OTHER_TRACK, trackOther: '  Supply   chains ' }, true)).toEqual({
      trackOther: 'Supply chains',
    });
    expect(trackChoice(call, { trackId: 'metadata', trackOther: 'left over' }, true)).toEqual({
      trackId: 'metadata',
    });
  });

  it('needs a topic to submit, not to save a draft', () => {
    expect(trackChoice(call, { trackId: OTHER_TRACK }, true).otherError).toBe('Say which topic.');
    expect(trackChoice(call, { trackId: OTHER_TRACK }, false)).toEqual({});
  });

  it('refuses a topic over the limit', () => {
    const long = 'x'.repeat(TRACK_OTHER_MAX + 1);
    expect(trackChoice(call, { trackId: OTHER_TRACK, trackOther: long }, false).otherError).toMatch(/80 characters/);
  });

  it('refuses Other on a call that does not offer it, and an unknown track', () => {
    expect(trackChoice({ trackIds: ['metadata'] }, { trackId: OTHER_TRACK, trackOther: 'x' }, true).error).toBeTruthy();
    expect(trackChoice(call, { trackId: 'nope' }, true).error).toBeTruthy();
  });

  it('asks for a track when only Other is offered', () => {
    expect(trackChoice({ trackIds: [], allowOtherTrack: true }, {}, true).error).toBe('Choose a track.');
    expect(trackChoice({ trackIds: [] }, {}, true)).toEqual({});
  });
});

describe('the session-type question follows the ticked types (T271)', () => {
  it('asks nothing for one type', () => {
    expect(sessionTypeQuestion(['talk'])).toBe('');
    expect(sessionTypeQuestion([])).toBe('');
  });
  it('asks between two', () => {
    expect(sessionTypeQuestion(['talk', 'workshop'])).toBe('Talk or workshop?');
  });
  it('lists three or more with "or" before the last', () => {
    expect(sessionTypeQuestion(['talk', 'workshop', 'panel'])).toBe('Talk, workshop or panel?');
    expect(sessionTypeQuestion(['keynote', 'talk', 'panel', 'poster'])).toBe('Keynote, talk, panel or poster?');
  });
  it('joins words and labels a type', () => {
    expect(joinWords(['talk', 'workshop'], 'and')).toBe('talk and workshop');
    expect(typeLabel('panel')).toBe('Panel');
  });
});
