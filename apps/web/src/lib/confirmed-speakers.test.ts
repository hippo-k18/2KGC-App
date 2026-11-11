import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConfirmedSpeakers } from '../components/confirmed-speakers';
import { confirmSpeakers, isPublicSession, type ProgrammeSession } from './confirmed-speakers';

const session = (over: Partial<ProgrammeSession> & { id: string }): ProgrammeSession => ({
  title: `Talk ${over.id}`,
  status: 'published',
  speakerIds: [],
  day: '2027-05-05',
  startsAtLocal: '2027-05-05T10:00',
  format: 'talk',
  ...over,
});

const ada = { id: 'ada', name: 'Ada Example' };
const ben = { id: 'ben', name: 'Ben Example' };

describe('isPublicSession', () => {
  it('is published and not deleted', () => {
    expect(isPublicSession({ status: 'published' })).toBe(true);
    expect(isPublicSession({ status: 'draft' })).toBe(false);
    expect(isPublicSession({ status: 'published', deletedAt: new Date() })).toBe(false);
    expect(isPublicSession({})).toBe(false);
  });
});

describe('confirmSpeakers', () => {
  it('lists a speaker named on a published session, with that talk', () => {
    const out = confirmSpeakers([ada], [session({ id: 's1', speakerIds: ['ada'] })]);
    expect(out.map((s) => s.id)).toEqual(['ada']);
    expect(out[0].talks.map((t) => t.id)).toEqual(['s1']);
  });

  it('drops a speaker on no session at all', () => {
    expect(confirmSpeakers([ada, ben], [session({ id: 's1', speakerIds: ['ada'] })]).map((s) => s.id)).toEqual(['ada']);
  });

  it('drops a speaker whose only session is a draft or deleted', () => {
    const out = confirmSpeakers(
      [ada, ben],
      [
        session({ id: 'd', status: 'draft', speakerIds: ['ada'] }),
        session({ id: 'x', deletedAt: { seconds: 1 }, speakerIds: ['ben'] }),
      ],
    );
    expect(out).toEqual([]);
  });

  it('leaves a draft talk off a confirmed speaker', () => {
    const out = confirmSpeakers(
      [ada],
      [
        session({ id: 'pub', speakerIds: ['ada'] }),
        session({ id: 'draft', status: 'draft', speakerIds: ['ada'] }),
      ],
    );
    expect(out[0].talks.map((t) => t.id)).toEqual(['pub']);
  });

  it('drops an unlisted speaker even when they are on the programme', () => {
    const out = confirmSpeakers(
      [{ ...ada, unlisted: true }],
      [session({ id: 's1', speakerIds: ['ada'] })],
    );
    expect(out).toEqual([]);
  });

  it('drops a record with a blank name', () => {
    const out = confirmSpeakers([{ id: 'ada', name: '  ' }], [session({ id: 's1', speakerIds: ['ada'] })]);
    expect(out).toEqual([]);
  });

  it('reads the link from the session, not from the speaker', () => {
    const stale = { ...ada, sessionIds: ['s1'] };
    expect(confirmSpeakers([stale], [session({ id: 's1', speakerIds: [] })])).toEqual([]);
  });

  it('puts featured speakers first and keeps the incoming order within each half', () => {
    const people = [
      { id: 'a', name: 'A One' },
      { id: 'b', name: 'B Two', featured: true },
      { id: 'c', name: 'C Three' },
      { id: 'd', name: 'D Four', featured: true },
    ];
    const out = confirmSpeakers(people, [session({ id: 's', speakerIds: ['a', 'b', 'c', 'd'] })]);
    expect(out.map((s) => s.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('orders a speaker’s talks by start time and lists a duplicate id once', () => {
    const out = confirmSpeakers(
      [ada],
      [
        session({ id: 'late', startsAtLocal: '2027-05-06T09:00', speakerIds: ['ada'] }),
        session({ id: 'early', startsAtLocal: '2027-05-05T09:00', speakerIds: ['ada', 'ada'] }),
      ],
    );
    expect(out[0].talks.map((t) => t.id)).toEqual(['early', 'late']);
  });
});

describe('ConfirmedSpeakers', () => {
  it('shows the announced-soon state and a link to the call when nobody is confirmed', () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmedSpeakers, { speakers: [], applyHref: '/submit/cfp-2027' }),
    );
    expect(html).toContain('Speakers will be announced soon.');
    expect(html).toContain('href="/submit/cfp-2027"');
    expect(html).not.toContain('speaker-list');
  });

  it('renders every bio and talk into the HTML, linked to its agenda page', () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmedSpeakers, {
        applyHref: '/sponsor#speak',
        speakers: [
          {
            id: 'ada',
            name: 'Ada Example',
            role: 'Chief Example',
            company: 'Example Co',
            bio: 'First paragraph.\n\nSecond paragraph.',
            talks: [
              {
                id: 's1',
                title: 'Graphs at scale',
                description: 'What we learned.',
                format: 'keynote',
                day: '2027-05-05',
                startsAtLocal: '2027-05-05T09:00',
              },
            ],
          },
        ],
      }),
    );
    expect(html).toContain('Second paragraph.');
    expect(html).toContain('href="/agenda/s1"');
    expect(html).toContain('What we learned.');
    expect(html).toContain('Keynote · Wednesday 5 May, 09:00');
    expect(html).not.toContain('announced soon');
  });
});
