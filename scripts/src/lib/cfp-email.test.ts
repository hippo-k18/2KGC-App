import { describe, expect, it } from 'vitest';
import {
  cfpAcceptNoticeMessage,
  cfpAcceptedAsEdited,
  cfpContactDraft,
  cfpPlainMessage,
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
  // The owner's copy, word for word (T275).
  const OWNER = [
    'Thank you for submitting your proposal to the Knowledge Graph Conference (KGC)!',
    'We review and announce accepted submissions on a rolling basis. Given that we host various programs and events throughout the year, we may consider your submission for future opportunities as well.',
    'Please note that we will only follow up with submissions that are accepted, rather than providing individual updates on every submission.',
    "If you have any questions or need anything in the meantime, please don't hesitate to reach out to us at program@knowledgegraph.tech.",
    'Thank you again for your interest in contributing to the KGC community!',
    'Best,\nThe KGC Team',
  ];

  it('is the owner\'s copy, with the greeting, the title block and the private link around it', () => {
    const m = cfpReceivedMessage({ ...ref, decisionDay: 'Sunday 14 February 2027', link: 'https://x/t' });
    expect(m.subject).toBe('We received your KGC 2027 submission');
    expect(m.text).toBe(
      [
        'Hi Ada,',
        OWNER[0],
        'Lineage at scale\nTalk, 25 minutes',
        ...OWNER.slice(1),
        'View your submission and, later, our decision here:\nhttps://x/t',
      ].join('\n\n'),
    );
    // The old copy named a date; the owner's does not.
    expect(m.text).not.toContain('Sunday 14 February 2027');
    expect(m.html).toContain('href="https://x/t"');
    expect(m.html).toContain('The KGC Team');
    expect(m.html).toContain('reach out to us at program@knowledgegraph.tech.');
    clean(m);
  });

  it('works without a type line, or a link', () => {
    const m = cfpReceivedMessage({ ...ref, typeLine: '' });
    expect(m.text).toContain(`${OWNER[0]}\n\nLineage at scale\n\n${OWNER[1]}`);
    expect(m.text.endsWith('Best,\nThe KGC Team')).toBe(true);
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
    expect(m.text).toContain("If there's anything you are unsure about, just reply to this email.");
    expect(m.html).toContain('Questions? Reply to this email');
    clean(m);
  });

  it('asks a workshop for its outline and install list, and drops an unset notice date', () => {
    const m = cfpAcceptedMessage({ ...e2, workshop: true, typeLine: 'Workshop' });
    expect(m.text).toContain('For workshops: your learning objectives, outline and anything attendees must install');
    expect(m.text).not.toContain('will be shared by');
    clean(m);
  });

  it('points an accepted workshop at the CEU form, word for word, between the deadline and the reply line (T369)', () => {
    const line =
      'If you opted in for KGC|Learn Continuing Education Units (CEUs), please also complete this form: https://forms.gle/dDZpxjfkkWzscdJ56';
    const m = cfpAcceptedMessage({ ...e2, workshop: true, typeLine: 'Workshop' });
    expect(m.text).toContain(line);
    const at = m.text.indexOf(line);
    expect(at).toBeGreaterThan(m.text.indexOf('Please send them within one week'));
    expect(at).toBeLessThan(m.text.indexOf("If there's anything you are unsure about"));
    expect(m.html).toContain('KGC|Learn Continuing Education Units (CEUs), please also complete this form:');
    expect(m.html).toMatch(
      /<a href="https:\/\/forms\.gle\/dDZpxjfkkWzscdJ56"[^>]*>https:\/\/forms\.gle\/dDZpxjfkkWzscdJ56<\/a>/,
    );
    clean(m);
  });

  it('says nothing about CEUs to a talk, or in the E3 nudge', () => {
    for (const m of [
      cfpAcceptedMessage(e2),
      cfpNudgeMessage(e2),
      cfpNudgeMessage({ ...e2, workshop: true }),
    ]) {
      expect(`${m.text}\n${m.html}`).not.toContain('CEU');
      expect(`${m.text}\n${m.html}`).not.toContain('forms.gle');
    }
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
    expect(without.text).toContain('We had far more good submissions than time slots, and the ones we could not accept');
    expect(without.text).toContain('Thank you for your submission.');
    clean(with_);
    clean(without);
  });

  it('E6 and S1 drop the decision date while unset', () => {
    const e6 = cfpStillOpenMessage(ref);
    expect(e6.text).not.toContain('answer by');
    expect(e6.text).toContain('we have not reached a decision on your submission yet. That is all it means.');
    expect(cfpStillOpenMessage({ ...ref, decisionDay: 'Sunday 14 February 2027' }).text).toContain(
      'You will have an answer by Sunday 14 February 2027 at the latest, and most likely before.',
    );
    clean(e6);
    const s1 = cfpStatusReplyText({ name: 'Ada Lovelace', decisionDay: 'Sunday 14 February 2027' });
    expect(s1).toContain('You will have an answer by Sunday 14 February 2027 at the latest.');
    expect(s1).toContain('We read submissions every week and accept as we go');
    expect(s1).toContain('tell us and we will add it to your submission.');
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

describe('the Accept dialog (T378)', () => {
  const standard = cfpAcceptedMessage({
    ...ref,
    typeLine: 'Workshops',
    workshop: true,
    link: 'https://www.knowledgegraph.tech/speaker/TOKEN',
    dueDay: 'Tuesday 17 November 2026',
  });

  it('opens on the standard E2, the CEU line for a workshop included', () => {
    expect(standard.text).toContain('Continuing Education Units');
    expect(standard.text).toContain('https://www.knowledgegraph.tech/speaker/TOKEN');
  });

  it('sends the standard email, button and all, when nothing was changed', () => {
    expect(cfpAcceptedAsEdited(standard, undefined)).toBe(standard);
    expect(cfpAcceptedAsEdited(standard, { subject: standard.subject, text: `${standard.text}\r\n` })).toBe(standard);
  });

  it('keeps the standard body when only the subject changed', () => {
    const m = cfpAcceptedAsEdited(standard, { subject: 'You are in', text: standard.text });
    expect(m.subject).toBe('You are in');
    expect(m.html).toBe(standard.html);
  });

  it('sends the edited words when the body changed', () => {
    const text = standard.text.replace('Welcome aboard.', 'Welcome aboard, see you in May.');
    const m = cfpAcceptedAsEdited(standard, { subject: standard.subject, text });
    expect(m.text).toBe(text.trim());
    expect(m.html).toContain('Welcome aboard, see you in May.');
    // The details link still works as a link.
    expect(m.html).toContain('href="https://www.knowledgegraph.tech/speaker/TOKEN"');
    clean(m);
  });
});

describe('plain text as an email (T378)', () => {
  it('escapes what was typed, so nothing typed becomes markup', () => {
    const m = cfpPlainMessage('Hi <b>there</b>', 'Hello <script>alert(1)</script>\n\n"quoted" & more');
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).not.toContain('<b>there</b>');
  });

  it('keeps paragraphs, line breaks, lists and links', () => {
    const m = cfpPlainMessage('Subject', 'One\ntwo\n\n  • a\n  • b\n\nSee https://example.com/x?a=1');
    expect(m.html).toContain('One<br>two');
    expect(m.html).toContain('<li>a</li><li>b</li>');
    expect(m.html).toContain('<a href="https://example.com/x?a=1"');
  });

  it('puts a subject on one line', () => {
    expect(cfpPlainMessage('Line one\nline two', 'x').subject).toBe('Line one line two');
  });
});

describe('Contact the author (T378)', () => {
  it('opens with a greeting, a sign-off and the talk in the subject', () => {
    const d = cfpContactDraft({ name: 'Ada Lovelace', title: 'Lineage at scale' });
    expect(d.subject).toBe('About your KGC 2027 submission: Lineage at scale');
    expect(d.text.startsWith('Hi Ada,')).toBe(true);
    expect(d.text.endsWith('Best,\nThe KGC team')).toBe(true);
    clean(cfpPlainMessage(d.subject, d.text));
  });

  it('greets nobody by name when there is none', () => {
    expect(cfpContactDraft({ title: '' }).text.startsWith('Hi,')).toBe(true);
    expect(cfpContactDraft({ title: '' }).subject).toContain('Untitled');
  });
});
