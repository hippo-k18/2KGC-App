import { describe, expect, it } from 'vitest';
import {
  CALL_SESSION_TYPES,
  CFP_SESSION_TYPES,
  OTHER_TRACK,
  TRACK_OTHER_MAX,
  agendaFormat,
  asksTalkLength,
  asksTrack,
  phoneChoice,
  resourceLinkChoice,
  joinWords,
  trackChoice,
  trackLabel,
  typeLabel,
  abstractProblem,
  abstractWordLimits,
  cfpStatus,
  closeDecisionPlan,
  dayAfter,
  e2RetriesDue,
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

  it('takes any length up to 300 words, but not none (T288)', () => {
    const limits = { max: 300 };
    expect(abstractProblem(words(1), limits)).toBeNull();
    expect(abstractProblem(words(149), limits)).toBeNull();
    expect(abstractProblem(words(300), limits)).toBeNull();
    expect(abstractProblem('   ', limits)).toMatch(/Write a description/);
    expect(abstractProblem(words(301), limits)).toMatch(/301 words\. Cut it to 300/);
  });

  it('ignores a stored minimum and keeps the stored maximum (T288)', () => {
    expect(abstractWordLimits({ abstractMinWords: 150, abstractMaxWords: 300 })).toEqual({ max: 300 });
    expect(abstractWordLimits({ abstractMaxWords: 250 })).toEqual({ max: 250 });
    expect(abstractWordLimits(undefined)).toEqual({ max: 300 });
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
    expect(sessionTypeLine('talk', 25)).toBe('Presentation Talks & Keynotes, 25 minutes');
    expect(sessionTypeLine('talk')).toBe('Presentation Talks & Keynotes');
    expect(sessionTypeLine('workshop', 45)).toBe('Workshops');
    expect(sessionTypeLine('hcls')).toBe('Health Care and Life Sciences (HCLS) Symposium');
    expect(sessionTypeLine(undefined)).toBe('Session');
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

  it('stays quiet before the call opens and after the close once nothing is left (T258 #17)', () => {
    const thu9 = Date.parse('2026-11-12T14:00:00Z');
    const opensAtMs = Date.parse('2026-11-01T04:00:00Z');
    const closesAtMs = Date.parse('2027-02-01T04:59:00Z');
    // Before 1 November: no reminder, even on a Thursday morning.
    const earlyThu = Date.parse('2026-10-29T13:00:00Z');
    expect(reminderDue(earlyThu, NY, undefined)).toBe(true);
    expect(reminderDue(earlyThu, NY, undefined, { opensAtMs, closesAtMs, openCount: 3 })).toBe(false);
    // Open: yes, whatever the count.
    expect(reminderDue(thu9, NY, undefined, { opensAtMs, closesAtMs, openCount: 0 })).toBe(true);
    // After the close: only while something is undecided. E4 has no due date to end it (T293).
    const after = Date.parse('2027-02-04T14:00:00Z');
    expect(reminderDue(after, NY, undefined, { opensAtMs, closesAtMs, openCount: 0 })).toBe(false);
    expect(reminderDue(after, NY, undefined, { opensAtMs, closesAtMs, openCount: 2 })).toBe(true);
    const twoWeeksOn = Date.parse('2027-02-18T14:00:00Z');
    expect(reminderDue(twoWeeksOn, NY, undefined, { opensAtMs, closesAtMs, openCount: 2 })).toBe(true);
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
    // Accepted and told in November, then changed to rejected (T262).
    row({ id: 'yes-then-no', status: 'rejected', acceptance: { e2SentAtMs: 1, withdrawnAtMs: 2 } }),
    // Accepted after the close, E2 held, then rejected before anyone was told: E4 is right.
    row({ id: 'held-then-no', status: 'rejected', acceptance: { e2HeldForE4: true } }),
    row({ id: 'owed', status: 'accepted', closeDecisionSent: true, acceptance: { e2Owed: true } }),
  ];

  it('sends the accepted version only to acceptances held for it, the declined one to untold rejections', () => {
    const plan = closeDecisionPlan(rows);
    expect(plan.accepted.map((r) => r.id)).toEqual(['held']);
    expect(plan.declined.map((r) => r.id)).toEqual(['no', 'held-then-no']);
    expect(plan.undecided.map((r) => r.id)).toEqual(['open', 'told']);
  });

  it('retries an owed E2 until it goes (T258 #5)', () => {
    expect(e2RetriesDue(rows).map((r) => r.id)).toEqual(['owed']);
    const sent = row({ id: 'sent', status: 'accepted', acceptance: { e2Owed: true, e2SentAtMs: 5 } });
    expect(e2RetriesDue([sent])).toEqual([]);
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

describe('E4 has no planned date (T293)', () => {
  it('exports nothing that computes one', async () => {
    const core = (await import('./cfp-core')) as Record<string, unknown>;
    expect(core.closeDecisionDate).toBeUndefined();
    expect(core.closeDecisionOpen).toBeUndefined();
    expect(core.CLOSE_DECISION_AFTER_DAYS).toBeUndefined();
  });
});

describe('one close date (T293)', () => {
  it("takes the day from the call's own close, set in the call editor", async () => {
    const { cfpWithClose, pageValues, holdE2ForClose: hold, missingSettings: missing } = await import('./cfp-core');
    const cfp = cfpWithClose({ decisionDate: '2027-02-14' }, '2027-01-31T23:59');
    expect(cfp).toEqual({ decisionDate: '2027-02-14', closeDate: '2027-01-31' });
    expect(pageValues(cfp)['CLOSE DATE']).toBe('Sunday 31 January 2027');
    expect(missing(cfp)).not.toContain('Close date');
    expect(hold(Date.parse('2027-02-01T15:00:00Z'), cfp, NY)).toBe(true);
  });

  it('lets the call editor win when the two disagree, and falls back when the call has none', async () => {
    const { cfpWithClose } = await import('./cfp-core');
    expect(cfpWithClose({ closeDate: '2027-02-28' }, '2027-01-31T23:59').closeDate).toBe('2027-01-31');
    expect(cfpWithClose({ closeDate: '2027-02-28' }, undefined).closeDate).toBe('2027-02-28');
    expect(cfpWithClose({ closeDate: '2027-02-28' }, '').closeDate).toBe('2027-02-28');
    expect(cfpWithClose(undefined, undefined)).toEqual({});
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

describe('session-type words (T271)', () => {
  it('joins words and labels a type', () => {
    expect(joinWords(['talk', 'workshop'], 'and')).toBe('talk and workshop');
    expect(typeLabel('panel')).toBe('Panels & Fireside Chats');
    expect(typeLabel('keynote')).toBe('Keynote');
  });
});

describe('the six CFP session types (T276)', () => {
  it('lists them in the owner’s order and words, keeping talk and workshop', () => {
    expect(CFP_SESSION_TYPES.map((t) => [t.id, t.label])).toEqual([
      ['talk', 'Presentation Talks & Keynotes'],
      ['workshop', 'Workshops'],
      ['panel', 'Panels & Fireside Chats'],
      ['hcls', 'Health Care and Life Sciences (HCLS) Symposium'],
      ['poster', 'Poster Sessions'],
      ['demo', 'Tools and Demonstrations'],
    ]);
    for (const t of CFP_SESSION_TYPES) expect(CALL_SESSION_TYPES).toContain(t.id);
  });
  it('schedules each onto an agenda format', () => {
    expect(CFP_SESSION_TYPES.map((t) => agendaFormat(t.id))).toEqual(['talk', 'workshop', 'panel', 'talk', 'poster', 'talk']);
    expect(agendaFormat('keynote')).toBe('keynote');
    expect(agendaFormat(undefined)).toBe('talk');
  });
});

describe('track and talk length switches (T276)', () => {
  it('a CFP call asks neither unless ticked', () => {
    expect(asksTrack({ cfp: {} })).toBe(false);
    expect(asksTalkLength({ cfp: {} })).toBe(false);
    expect(asksTrack({ cfp: {}, askTrack: true })).toBe(true);
    expect(asksTalkLength({ cfp: {}, askTalkLength: true })).toBe(true);
  });
  it('any other call asks for a track as before and never a length', () => {
    expect(asksTrack({})).toBe(true);
    expect(asksTrack({ askTrack: false })).toBe(false);
    expect(asksTalkLength({ askTalkLength: true })).toBe(false);
  });
});

describe('phone and resource link (T276)', () => {
  it('takes a phone loosely and refuses letters', () => {
    expect(phoneChoice('')).toEqual({});
    expect(phoneChoice(' +1 (212) 555-0100 ')).toEqual({ phone: '+1 (212) 555-0100' });
    expect(phoneChoice('call me').error).toBeTruthy();
    expect(phoneChoice('12345').error).toBeTruthy();
    expect(phoneChoice('+1 212 555 0100 ext 4').error).toBeTruthy();
  });
  it('takes one web address and adds https when left off', () => {
    expect(resourceLinkChoice('')).toEqual({});
    expect(resourceLinkChoice('github.com/acme/repo')).toEqual({ link: 'https://github.com/acme/repo' });
    expect(resourceLinkChoice('https://example.org/slides.pdf')).toEqual({ link: 'https://example.org/slides.pdf' });
    expect(resourceLinkChoice('two words').error).toBeTruthy();
    expect(resourceLinkChoice('javascript:alert(1)').error).toBeTruthy();
    expect(resourceLinkChoice('localhost').error).toBeTruthy();
  });
});
