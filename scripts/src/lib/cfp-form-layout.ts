import type { CallFormFieldDef, CallSessionType } from '@kgc/shared';
import { typeLabel } from './cfp-core';

/**
 * The public call form as a list: the fields every submission has, where they
 * sit, and the organizer's own questions between them (T301).
 *
 * ── Why the dashboard needs to know the built-in fields ────────────────────
 *
 * The form builder used to list only the organizer's questions. The website
 * draws its own fields around them (title, description, a resource link, the
 * author's details), so a builder that never shows those makes it easy to ask
 * for the same thing twice. Min added "Link to supporting material" to a form
 * that already had "Link to Additional Resources or Supporting Materials" two
 * rows above it (T299). This module is the dashboard's copy of what
 * `apps/web/src/app/submit/submission-form.tsx` draws, and the test holds the
 * two labels lists together.
 *
 * Pure, with no server imports: the builder's add-question form runs the
 * duplicate check in the browser as the organizer types.
 */

/** What a field collects, as far as spotting a duplicate needs to know. */
export type FormConcept =
  | 'session-type'
  | 'title'
  | 'description'
  | 'talk-length'
  | 'track'
  | 'link'
  | 'name'
  | 'email'
  | 'organization'
  | 'phone'
  | 'bio'
  | 'coauthors';

export interface BuiltInField {
  /** The form field's name on the website. */
  id: string;
  /** Exactly as the website prints it, without the required star. */
  label: string;
  required: boolean;
  input: 'select' | 'text' | 'long-text' | 'email' | 'tel';
  hint?: string;
  options?: string[];
  /** Only asked of these session types. Empty means everyone. */
  sessionTypes?: CallSessionType[];
  concept: FormConcept;
}

export interface BuiltInLayout {
  /** Above the organizer's questions. */
  before: BuiltInField[];
  /** Below them. */
  after: BuiltInField[];
}

/** The call settings that decide which built-in fields the website draws. */
export interface BuiltInInput {
  /** Run with the call-for-speakers settings (`call.cfp` is set). */
  cfp: boolean;
  sessionTypes: readonly CallSessionType[];
  askTrack: boolean;
  askTalkLength: boolean;
  allowOtherTrack: boolean;
  trackNames: readonly string[];
  abstractMaxWords: number;
  talkMinutes: readonly number[];
}

/** The built-in fields for one call, in the order the website draws them. */
export function builtInFields(c: BuiltInInput): BuiltInLayout {
  const before: BuiltInField[] = [];
  if (c.sessionTypes.length > 0) {
    before.push({
      id: 'sessionType',
      label: 'Session Type & Format',
      required: true,
      input: 'select',
      options: c.sessionTypes.map(typeLabel),
      concept: 'session-type',
    });
  }
  before.push({ id: 'title', label: 'Session Title', required: true, input: 'text', concept: 'title' });
  before.push({
    id: 'abstract',
    label: 'Session Description',
    required: true,
    input: 'long-text',
    hint: c.cfp
      ? `Up to ${c.abstractMaxWords} words. Word count: 0`
      : 'Plain text. Blank lines separate paragraphs. Up to 10,000 characters, which is about 1,500 words.',
    concept: 'description',
  });
  if (c.cfp && c.askTalkLength) {
    before.push({
      id: 'durationMinutes',
      label: 'How long is your talk?',
      required: true,
      input: 'select',
      options: c.talkMinutes.map((m) => `${m} minutes`),
      sessionTypes: ['talk'],
      concept: 'talk-length',
    });
  }
  if (c.askTrack && (c.trackNames.length > 0 || c.allowOtherTrack)) {
    before.push({
      id: 'trackId',
      label: 'Track',
      required: true,
      input: 'select',
      options: [...c.trackNames, ...(c.allowOtherTrack ? ['Other'] : [])],
      concept: 'track',
    });
  }
  before.push({
    id: 'resourceLink',
    label: 'Link to Additional Resources or Supporting Materials (Optional)',
    required: false,
    input: 'text',
    concept: 'link',
  });

  const after: BuiltInField[] = [
    { id: 'authorName', label: 'Your Name', required: true, input: 'text', concept: 'name' },
    {
      id: 'authorEmail',
      label: 'Your Email',
      required: true,
      input: 'email',
      hint: "We'll send submission updates, decisions, and a link to your submission to this email. No password or account required.",
      concept: 'email',
    },
    { id: 'affiliation', label: 'Organization', required: c.cfp, input: 'text', concept: 'organization' },
    { id: 'phone', label: 'Your Phone Number (Optional)', required: false, input: 'tel', concept: 'phone' },
  ];
  if (!c.cfp) {
    after.push({
      id: 'bio',
      label: 'A short bio',
      required: false,
      input: 'long-text',
      hint: 'Optional. If your work is accepted, this becomes your speaker bio.',
      concept: 'bio',
    });
  }
  after.push({
    id: 'coAuthors',
    label: 'Co-Speakers or Co-Authors (Optional)',
    required: false,
    input: 'long-text',
    hint: 'One per line. Put an organization in brackets after the name if you want to.',
    concept: 'coauthors',
  });
  return { before, after };
}

// ---------------------------------------------------------------------------
// Spotting a question that asks for something already asked
// ---------------------------------------------------------------------------

/** How each concept reads in "The form already asks for …". */
const WHAT: Record<FormConcept, string> = {
  'session-type': 'a session type',
  title: 'a title',
  description: 'a description',
  'talk-length': 'the talk length',
  track: 'a track',
  link: 'a link',
  name: 'a name',
  email: 'an email address',
  organization: 'an organization',
  phone: 'a phone number',
  bio: 'a bio',
  coauthors: 'co-speakers or co-authors',
};

/*
 * Matched against the question's own wording, never its help text. Kept
 * narrow on purpose: a warning that fires on "Name the dataset you will use"
 * teaches people to ignore warnings. "name" needs a "your" or "full" in front
 * (or to be the whole question),
 * and "title" ignores "job title".
 */
const PATTERNS: [FormConcept, RegExp][] = [
  ['session-type', /\b(session type|type of session|session format)\b/i],
  ['title', /\b(session|talk|presentation|workshop|paper|proposal) (title|name)\b|(?<!job )\btitle\b/i],
  ['description', /\b(description|describe your|abstract|summary|synopsis)\b/i],
  ['talk-length', /\b(how long|talk length|length of (your|the) talk|duration)\b/i],
  ['track', /\btracks?\b/i],
  ['link', /\b(links?|urls?|website|web page|repo|repository|github)\b/i],
  ['name', /\b(your|full|first|last|speaker'?s?|presenter'?s?) name\b|^\s*name\s*[?:]?\s*$/i],
  ['email', /\be-?mail\b/i],
  ['organization', /\b(organi[sz]ations?|company|employer|affiliation|institution)\b/i],
  ['phone', /\b(phone|mobile|telephone)\b/i],
  ['bio', /\b(bio|biography)\b/i],
  ['coauthors', /\bco-?(speakers?|authors?|presenters?)\b/i],
];

/** The concepts a question's wording points at. Usually none, sometimes more than one. */
export function conceptsOf(prompt: string): FormConcept[] {
  return PATTERNS.filter(([, re]) => re.test(prompt)).map(([c]) => c);
}

/**
 * Kinds that collect something a built-in field could already hold. Prose,
 * single checkboxes and consent boxes are statements, so "I agree to share my
 * email" is not a second email field.
 */
const CHECKED_KINDS = new Set<CallFormFieldDef['kind']>(['short-text', 'long-text', 'choice', 'multi-choice']);

type Question = Pick<CallFormFieldDef, 'id' | 'prompt' | 'kind'>;

/**
 * Field id → the warnings to show on that question. A question with nothing
 * to say about it has no key. Warnings never block saving: the organizer may
 * mean it, and a second link question with a different purpose is allowed.
 */
export function duplicateWarnings(questions: readonly Question[], builtIns: BuiltInLayout): Record<string, string[]> {
  const fixed = [...builtIns.before, ...builtIns.after];
  const checked = questions.filter((q) => CHECKED_KINDS.has(q.kind));
  const concepts = new Map(checked.map((q) => [q.id, conceptsOf(q.prompt)]));
  const out: Record<string, string[]> = {};
  for (const q of checked) {
    const messages: string[] = [];
    for (const concept of concepts.get(q.id) ?? []) {
      const same = fixed.filter((f) => f.concept === concept);
      if (same.length > 0) {
        messages.push(`The form already asks for ${WHAT[concept]}: ${same.map((f) => f.label).join(', ')}.`);
      }
      const others = checked.filter((o) => o.id !== q.id && (concepts.get(o.id) ?? []).includes(concept));
      if (others.length > 0) {
        messages.push(
          `${others.length === 1 ? 'Another question also asks' : 'Other questions also ask'} for ${WHAT[concept]}: ${others.map((o) => o.prompt).join(', ')}.`,
        );
      }
    }
    if (messages.length > 0) out[q.id] = messages;
  }
  return out;
}

/** The warnings for a question still being written: the add and edit form, as the organizer types. */
export function draftWarnings(
  draft: { id?: string; prompt: string; kind: CallFormFieldDef['kind'] },
  questions: readonly Question[],
  builtIns: BuiltInLayout,
): string[] {
  const id = draft.id ?? '\u0000draft';
  const rest = questions.filter((q) => q.id !== id);
  return duplicateWarnings([...rest, { id, prompt: draft.prompt, kind: draft.kind }], builtIns)[id] ?? [];
}
