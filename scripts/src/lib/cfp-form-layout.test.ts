import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CallFormFieldDef } from '@kgc/shared';
import { builtInFields, conceptsOf, draftWarnings, duplicateWarnings, type BuiltInInput } from './cfp-form-layout';

const CFP: BuiltInInput = {
  cfp: true,
  sessionTypes: ['talk', 'workshop', 'panel', 'hcls', 'poster', 'demo'],
  askTrack: false,
  askTalkLength: false,
  allowOtherTrack: false,
  trackNames: [],
  abstractMaxWords: 300,
  talkMinutes: [25, 45],
};

const q = (id: string, prompt: string, kind: CallFormFieldDef['kind'] = 'short-text') => ({ id, prompt, kind });

/** The live call's questions on 2026-10-19 (T299), the case that started this. */
const MIN = [
  q('audience-level', 'Audience level', 'choice'),
  q('link-to-supporting-material', 'Link to supporting material'),
  q('workshop-learning-objectives', 'Workshop learning objectives', 'long-text'),
  q('workshop-outline', 'Workshop outline', 'long-text'),
  q('what-attendees-need-to-bring-or-install', 'What attendees need to bring or install', 'long-text'),
  q('have-you-run-this-workshop-before', 'Have you run this workshop before?'),
  q('consent', 'I understand that all sessions are recorded and may be published in the KGC video library.', 'consent'),
];

describe('builtInFields', () => {
  it('lays out a CFP call the way the website draws it', () => {
    const { before, after } = builtInFields(CFP);
    expect(before.map((f) => f.label)).toEqual([
      'Session Type & Format',
      'Session Title',
      'Session Description',
      'Link to Additional Resources or Supporting Materials (Optional)',
    ]);
    expect(after.map((f) => f.label)).toEqual([
      'Your Name',
      'Your Email',
      'Organization',
      'Your Phone Number (Optional)',
      'Co-Speakers or Co-Authors (Optional)',
    ]);
    expect(before[2].hint).toBe('Up to 300 words. Word count: 0');
    expect(after[2].required).toBe(true);
  });

  it('adds talk length for talks only, a track list, and the bio outside a CFP', () => {
    const { before } = builtInFields({ ...CFP, askTalkLength: true, askTrack: true, trackNames: ['A'], allowOtherTrack: true });
    const length = before.find((f) => f.id === 'durationMinutes')!;
    expect(length.sessionTypes).toEqual(['talk']);
    expect(length.options).toEqual(['25 minutes', '45 minutes']);
    expect(before.find((f) => f.id === 'trackId')!.options).toEqual(['A', 'Other']);

    const plain = builtInFields({ ...CFP, cfp: false, sessionTypes: [] });
    expect(plain.before.map((f) => f.id)).toEqual(['title', 'abstract', 'resourceLink']);
    expect(plain.after.map((f) => f.id)).toContain('bio');
    expect(plain.after.find((f) => f.id === 'affiliation')!.required).toBe(false);
  });

  it('uses the same labels as the public form', () => {
    // The website draws its own fields. If one is renamed there, this list has to follow.
    const src = readFileSync(new URL('../../../apps/web/src/app/submit/submission-form.tsx', import.meta.url), 'utf8')
      .replace(/&amp;/g, '&')
      .replace(/&apos;/g, "'");
    const all = builtInFields({ ...CFP, askTalkLength: true, askTrack: true, trackNames: ['A'] });
    const nonCfp = builtInFields({ ...CFP, cfp: false });
    for (const f of [...all.before, ...all.after, ...nonCfp.after]) {
      expect(src, f.label).toContain(f.label);
      if (f.hint && !f.hint.startsWith('Up to')) expect(src.replace(/\s+/g, ' '), f.hint).toContain(f.hint);
    }
  });
});

describe('duplicate questions', () => {
  const layout = builtInFields(CFP);

  it("flags Min's second link question, and nothing else on her form", () => {
    const w = duplicateWarnings(MIN, layout);
    expect(Object.keys(w)).toEqual(['link-to-supporting-material']);
    expect(w['link-to-supporting-material']).toEqual([
      'The form already asks for a link: Link to Additional Resources or Supporting Materials (Optional).',
    ]);
  });

  it.each([
    ['Website URL', 'link'],
    ['GitHub repo', 'link'],
    ['Your name', 'name'],
    ['Full name', 'name'],
    ['Name', 'name'],
    ['Contact e-mail', 'email'],
    ['Organisation', 'organization'],
    ['Company', 'organization'],
    ['Mobile phone', 'phone'],
    ['Talk title', 'title'],
    ['Abstract', 'description'],
    ['Short description', 'description'],
    ['Co-authors', 'coauthors'],
    ['Co-speaker names', 'coauthors'],
  ])('reads "%s" as asking for %s', (prompt, concept) => {
    expect(conceptsOf(prompt)).toContain(concept);
  });

  it.each(['Name the dataset you will use', 'Job title', 'Audience level', 'Workshop outline', 'Have you run this workshop before?'])(
    'leaves "%s" alone',
    (prompt) => {
      const w = duplicateWarnings([q('x', prompt)], layout);
      expect(w).toEqual({});
    },
  );

  it('says which built-in field it repeats', () => {
    const w = duplicateWarnings([q('e', 'Your email address'), q('o', 'Organization')], layout);
    expect(w.e).toEqual(['The form already asks for an email address: Your Email.']);
    expect(w.o).toEqual(['The form already asks for an organization: Organization.']);
  });

  it('flags two questions of your own that ask the same thing, on both of them', () => {
    const w = duplicateWarnings([q('a', 'Twitter handle or website'), q('b', 'Slides URL')], layout);
    expect(w.a).toContain('Another question also asks for a link: Slides URL.');
    expect(w.b).toContain('Another question also asks for a link: Twitter handle or website.');
  });

  it('ignores prose, consent and single checkboxes', () => {
    const w = duplicateWarnings(
      [q('d', 'Add a link to your slides after the event.', 'description'), q('c', 'I agree to share my email', 'consent'), q('k', 'Include my phone', 'checkbox')],
      layout,
    );
    expect(w).toEqual({});
  });

  it('checks a question as it is being written, without counting it against itself', () => {
    expect(draftWarnings({ prompt: 'Link to slides', kind: 'short-text' }, MIN, layout)).toEqual([
      'The form already asks for a link: Link to Additional Resources or Supporting Materials (Optional).',
      'Another question also asks for a link: Link to supporting material.',
    ]);
    // Editing the existing link question: it is not "another question" to itself.
    expect(
      draftWarnings({ id: 'link-to-supporting-material', prompt: 'Link to supporting material', kind: 'short-text' }, MIN, layout),
    ).toEqual(['The form already asks for a link: Link to Additional Resources or Supporting Materials (Optional).']);
    expect(draftWarnings({ prompt: 'Audience level', kind: 'choice' }, MIN, layout)).toEqual([]);
  });
});
