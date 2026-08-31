import type { SurveyDoc, SurveyResponseDoc, WithId } from '@kgc/shared';

/**
 * The pure half of the survey path: when a survey may be answered, what an
 * unfinished form is still missing, and how a multiple-choice answer is written
 * down.
 *
 * Split out for the reason `qa-core.ts` is — `surveys.ts` reaches Firestore and
 * `expo-router`, neither of which loads under Vitest, so the parts worth pinning
 * have to live beside the fetch rather than inside it. `surveys.ts` re-exports
 * everything here, so a screen still imports from one place.
 */

export type Survey = WithId<SurveyDoc>;
export type SurveyResponse = WithId<SurveyResponseDoc>;
/** One answer per question id, keyed the way `SurveyResponseDoc.answers` is. */
export type Answers = Record<string, string | number>;

/**
 * The separator a `multi` answer is joined with.
 *
 * Not a free choice: the console splits stored answers on `;` and trims each
 * part (`apps/organizer/src/lib/surveys.ts`, `summarise`), and its
 * distribution table matches those parts against the survey's own option
 * labels. Any other separator makes every multi-select answer count as one
 * unrecognised option, and the organizer sees a table of zeros beside a
 * response total that is not zero.
 */
export const MULTI_SEPARATOR = '; ';

/** Highest rating on a `rating` question. The console renders "out of 5". */
export const RATING_MAX = 5;

/**
 * Whether a survey is open to answers right now.
 *
 * `status` is the organizer's switch and the security boundary — the rules
 * refuse to serve anything but `published`, so a draft never reaches here at
 * all. `opensAt` and `closesAt` are the schedule, and both are optional because
 * the console's form does not write them: a survey with neither is open for as
 * long as it is published, which is the common case and must not read as closed.
 */
export function isOpen(survey: Survey, now: Date): boolean {
  if (survey.status !== 'published') return false;
  const opens = survey.opensAt?.toMillis();
  const closes = survey.closesAt?.toMillis();
  if (opens !== undefined && now.getTime() < opens) return false;
  if (closes !== undefined && now.getTime() >= closes) return false;
  return true;
}

/**
 * The ids of required questions the reader has not answered yet.
 *
 * Empty string counts as unanswered, which matters for `text`: a required
 * comment box that has been tapped and left blank holds `''`, and submitting it
 * would store an answer the console then counts as given. `0` does not count as
 * unanswered — no rating scale here starts at zero, but treating a falsy number
 * as missing is the bug that shape invites.
 */
export function missingRequired(survey: Survey, answers: Answers): string[] {
  return (survey.questions ?? [])
    .filter((q) => q.required)
    .filter((q) => {
      const given = answers[q.id];
      return given === undefined || (typeof given === 'string' && given.trim() === '');
    })
    .map((q) => q.id);
}

/** How many of a survey's questions carry an answer, for "3 of 4 answered". */
export function answeredCount(survey: Survey, answers: Answers): number {
  return (survey.questions ?? []).filter((q) => {
    const given = answers[q.id];
    return given !== undefined && !(typeof given === 'string' && given.trim() === '');
  }).length;
}

/**
 * Turns the set of options a reader has ticked into the stored string.
 *
 * Ordered by the survey's own option order rather than by tap order, so two
 * people who chose the same two options store the same value and the console's
 * distribution counts them together.
 */
export function encodeMulti(options: string[], chosen: ReadonlySet<string>): string {
  return options.filter((o) => chosen.has(o)).join(MULTI_SEPARATOR);
}

/** The inverse, for showing a submitted answer back. */
export function decodeMulti(stored: string | number | undefined): string[] {
  if (typeof stored !== 'string' || stored === '') return [];
  return stored.split(';').map((p) => p.trim()).filter(Boolean);
}

/**
 * Drops the answers to questions the survey no longer has.
 *
 * The console refuses to change the questions of a survey that already has
 * responses, so this cannot happen through it — but the answers map is keyed by
 * question id and nothing else enforces the correspondence, and writing a key
 * that matches no question puts a column in the organizer's aggregate that has
 * no prompt above it.
 */
export function prune(survey: Survey, answers: Answers): Answers {
  const known = new Set((survey.questions ?? []).map((q) => q.id));
  return Object.fromEntries(Object.entries(answers).filter(([id]) => known.has(id)));
}
