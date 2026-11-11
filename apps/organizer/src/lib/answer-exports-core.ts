import type { QuestionFieldDef } from '@kgc/shared';

/**
 * Turning answers into spreadsheet shapes.
 *
 * Three screens collect answers and none of them could hand them over: survey
 * results, session feedback and the registration question form all rendered a
 * tally and stopped there. A tally is the right thing on a screen and the wrong
 * thing to send a caterer, a speaker or an accessibility coordinator, and
 * retyping two hundred rows out of a browser is how a conference ends up
 * emailing a screenshot.
 *
 * Deliberately **not** `server-only`, for the same reason `csv.ts` is not: this
 * is arithmetic over plain objects with no Firestore handle in sight, and
 * `server-only` throws outside a React Server Component, which would make the
 * two decisions below untestable. `exports.ts` does the reading and keeps it.
 *
 * ── The two files have different shapes on purpose ─────────────────────────
 *
 * **Survey answers are long** — one row per answer, carrying the survey, the
 * response number and the question. Surveys differ from each other in every
 * question they ask, so a column per question would mean a different file for
 * every survey and an unusable one for all of them together. Long format also
 * survives a question being added mid-collection, which wide format cannot: the
 * new column would be blank for everybody who answered first, which reads as a
 * refusal rather than as an absence.
 *
 * **Registration answers are wide** — one row per person, one column per
 * question. There is one form per audience, everybody is asked the same
 * questions, and the file's whole purpose is to be sorted and counted by a
 * human: "how many vegetarians" is a column to filter, not a subset of rows to
 * find. It is the same reason the catering export exists.
 *
 * ── An unasked question and an unanswered one are not the same ─────────────
 *
 * Both come out as an empty cell, which is a real limitation of a CSV and worth
 * naming. What is *not* done is filling either with a zero or a "no": a blank
 * dietary cell means nobody said anything, and a spreadsheet that turned that
 * into "no requirements" would be inventing a statement somebody then caters
 * against.
 */

/** One row of the long-format survey answer file. */
export interface SurveyAnswerRow {
  survey: string;
  /** The session a feedback survey is attached to. Blank for an event survey. */
  session: string;
  /**
   * Which response this answer came from, numbered from 1 within its survey.
   *
   * ⚠️ Deliberately a number and never the response document's id, which is the
   * respondent's uid. `surveys.ts` will not return that mapping and this must
   * not reintroduce it: feedback a speaker can trace back to a named attendee
   * is feedback nobody gives honestly. The number exists only so that the three
   * answers one person gave can be seen as one set.
   */
  response: number;
  question: string;
  kind: string;
  answer: string;
}

/** A survey and its responses, flattened out of Firestore. */
export interface SurveyAnswerSource {
  title: string;
  sessionTitle?: string;
  questions: { id: string; prompt: string; kind: string }[];
  /** One entry per response, keyed by question id. Ids are dropped by the caller. */
  responses: Record<string, unknown>[];
}

/**
 * Every answer, one per row, in the order the questions are asked.
 *
 * Questions nobody answered produce no rows rather than empty ones. A survey
 * with no responses contributes nothing at all, which is why the caller reports
 * the row count: an empty file is a real answer to "has anybody replied yet?".
 */
export function surveyAnswerRows(sources: SurveyAnswerSource[]): SurveyAnswerRow[] {
  const rows: SurveyAnswerRow[] = [];

  for (const source of sources) {
    source.responses.forEach((answers, i) => {
      for (const q of source.questions) {
        const value = answers[q.id];
        const answer = formatAnswer(value);
        if (!answer) continue;
        rows.push({
          survey: source.title,
          session: source.sessionTitle ?? '',
          response: i + 1,
          question: q.prompt,
          kind: q.kind,
          answer,
        });
      }
    });
  }

  return rows;
}

/**
 * One answer as a cell.
 *
 * A multi-choice answer is joined with `; ` rather than `, ` because the file is
 * a CSV and a comma inside a cell is a quoting problem the reader then has to
 * take on faith. The same separator every other list column in these exports
 * uses.
 *
 * `true` becomes `yes` and `false` becomes an empty cell, not `no`: a ticked box
 * is a statement somebody made and an unticked one is usually a box they never
 * looked at. `0` is kept, because a rating of zero is a rating.
 */
export function formatAnswer(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (value === true) return 'yes';
  if (value === false) return '';
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean).join('; ');
  return String(value);
}

/** One column of the wide registration answer file. */
export interface AnswerColumn {
  /** The field id the answer is stored under. */
  id: string;
  /** The question as an organizer worded it, or the bare id for a removed one. */
  header: string;
}

/**
 * The answer columns, in form order, followed by anything else that was found.
 *
 * ── Removed questions still get a column ───────────────────────────────────
 *
 * An answer keyed by an id no question uses is somebody's data — the screen
 * already says so and refuses to delete it — so the export carries it too,
 * headed with the bare id and marked. Dropping it would make this file quietly
 * narrower than the database, which is the one thing an export must never be:
 * the whole reason to take a copy is that it is a copy.
 *
 * A question nobody has answered still gets its column, so the file's shape is
 * the form's shape and two exports taken a week apart line up.
 */
export function answerColumns(
  fields: QuestionFieldDef[],
  answered: Iterable<string>,
): AnswerColumn[] {
  const known = new Set(fields.map((f) => f.id));
  const columns: AnswerColumn[] = fields.map((f) => ({ id: f.id, header: f.prompt }));

  const orphans = new Set<string>();
  for (const id of answered) if (!known.has(id)) orphans.add(id);

  for (const id of [...orphans].sort()) {
    columns.push({ id, header: `${id} (question removed)` });
  }

  return columns;
}
