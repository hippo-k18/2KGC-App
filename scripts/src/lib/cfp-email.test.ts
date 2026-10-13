import { describe, expect, it } from 'vitest';
import {
  cfpAcceptNoticeMessage,
  cfpAcceptedMessage,
  cfpCloseAcceptedMessage,
  cfpCloseDeclinedMessage,
  cfpNudgeMessage,
  cfpReceivedMessage,
  cfpStatusReplyText,
  cfpStillOpenMessage,
  cfpWeeklyReminderMessage,
  type CfpMessage,
} from './email';

/** Min's emails, checked for what must never reach a submitter. */
const clean = (m: CfpMessage | string) => {
  const all = typeof m === 'string' ? m : `${m.subject}\n${m.text}\n${m.html}`;
  expect(all).not.toMatch(/\[[A-Z +]+\]/);
  expect(all).not.toContain('—');
  expect(all).not.toContain('undefined');
};

const ref = { name: 'Ada Lovelace', title: 'Lineage at scale', typeLine: 'Talk, 25 minutes' };

describe('E1', () => {
  it('says when the answer comes once the decision date is set', () => {
    const m = cfpReceivedMessage({ ...ref, decisionDay: 'Sunday 14 February 2027', link: 'https://x/t' });
    expect(m.subject).toBe('We have your KGC 2027 submission');
    expect(m.text).toContain('Hi Ada,');
    expect(m.text).toContain('Lineage at scale\nTalk, 25 minutes');
    expect(m.text).toContain('you will have an answer by Sunday 14 February 2027 at the latest.');
    expect(m.text).toContain('https://x/t');
    expect(m.html).toContain('href="https://x/t"');
    clean(m);
  });

  it('leaves that sentence out while the date is unset', () => {
    const m = cfpReceivedMessage(ref);
    expect(m.text).not.toContain('Either way');
    expect(m.text).toContain('If you would rather just ask, write to contact@knowledgegraph.tech');
    clean(m);
  });
});

describe('E2 and E3', () => {
  const e2 = {
    ...ref,
    workshop: false,
    link: 'https://x/speaker/abc',
    dueDay: 'Monday 9 November 2026',
  };

  it('carries the link, the seven-day date and Min’s session-day sentence', () => {
    const m = cfpAcceptedMessage({ ...e2, sessionNoticeDay: 'Monday 1 March 2027' });
    expect(m.subject).toBe('Your session is in: KGC 2027');
    expect(m.text).toContain('Your session day and time will be shared by Monday 1 March 2027.');
    expect(m.text).toContain('Please send them within one week, by Monday 9 November 2026.');
    expect(m.text).toContain('→ https://x/speaker/abc');
    expect(m.text).not.toContain('For workshops');
    expect(m.html).toContain('Replies go to');
    clean(m);
  });

  it('asks a workshop for its outline and install list, and drops an unset notice date', () => {
    const m = cfpAcceptedMessage({ ...e2, workshop: true, typeLine: 'Workshop' });
    expect(m.text).toContain('For workshops: your outline and anything attendees must install');
    expect(m.text).not.toContain('will be shared by');
    clean(m);
  });

  it('nudges with the same date', () => {
    const m = cfpNudgeMessage(e2);
    expect(m.subject).toBe('Still need a few details for your KGC 2027 session');
    expect(m.text).toContain('The week is up on Monday 9 November 2026.');
    clean(m);
  });
});

describe('E4, E6 and S1', () => {
  it('has two E4 versions, the declined one with its editable line', () => {
    clean(cfpCloseAcceptedMessage(ref));
    const with_ = cfpCloseDeclinedMessage({ ...ref, reason: 'The program already covers this ground.' });
    expect(with_.text).toContain(
      'We are not able to fit it into the 2027 program. The program already covers this ground.',
    );
    const without = cfpCloseDeclinedMessage(ref);
    expect(without.text).toContain('We are not able to fit it into the 2027 program.\n');
    clean(with_);
    clean(without);
  });

  it('E6 and S1 drop the decision date while unset', () => {
    const e6 = cfpStillOpenMessage(ref);
    expect(e6.text).not.toContain('answer by');
    clean(e6);
    const s1 = cfpStatusReplyText({ name: 'Ada Lovelace', decisionDay: 'Sunday 14 February 2027' });
    expect(s1).toContain('You will have an answer by Sunday 14 February 2027 at the latest.');
    clean(s1);
    clean(cfpStatusReplyText({}));
  });
});

describe('the internal mail', () => {
  it('gives Min the six facts and the link', () => {
    const m = cfpAcceptNoticeMessage({
      speakerName: 'Ada Lovelace',
      organisation: 'Analytical Engines',
      title: 'Lineage at scale',
      track: 'Metadata',
      typeLine: 'Talk, 25 minutes',
      acceptedDay: 'Tuesday 10 November 2026',
      link: 'https://dash/sub',
      e2: 'sent',
    });
    for (const fact of ['Ada Lovelace', 'Analytical Engines', 'Lineage at scale', 'Metadata', 'Tuesday 10 November 2026', 'https://dash/sub']) {
      expect(m.text).toContain(fact);
    }
    clean(m);
    clean(cfpWeeklyReminderMessage({ name: 'François', fresh: 2, open: 5, link: 'https://dash/review' }));
  });
});
