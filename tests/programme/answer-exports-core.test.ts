/**
 * Turning answers into a file, and the two things that must not happen while
 * doing it.
 *
 * One: **nothing may identify a respondent.** A survey response is keyed by uid
 * so nobody can answer twice, which means the server knows who said what and
 * every layer above it is built to refuse to say. The export is the layer with
 * the most to lose, because a CSV leaves the building — so the response
 * "number" is a position in a list and the test below pins that it stays one.
 *
 * Two: **an absence must not become a statement.** A blank cell has to mean "we
 * were not told", never "they said no". A spreadsheet that turns an unticked box
 * into `no` is a spreadsheet somebody caters against.
 *
 * Lives in `tests/programme` because that is the runner for pure logic needing
 * no emulator, the same reason `consent-register.test.ts` and
 * `unsubscribe.test.ts` sit here. `npm test` includes it.
 *
 * Run with: npm run test:programme
 */
import { describe, expect, it } from 'vitest';
import type { QuestionFieldDef } from '@kgc/shared';

import {
  answerColumns,
  formatAnswer,
  surveyAnswerRows,
  type SurveyAnswerSource,
} from '../../apps/organizer/src/lib/answer-exports-core';

const field = (over: Partial<QuestionFieldDef> & { id: string }): QuestionFieldDef => ({
  prompt: over.id,
  kind: 'short-text',
  required: false,
  order: 0,
  ...over,
});

const survey = (over: Partial<SurveyAnswerSource> = {}): SurveyAnswerSource => ({
  title: 'Day one feedback',
  questions: [
    { id: 'rating', prompt: 'How was it?', kind: 'rating' },
    { id: 'comment', prompt: 'Anything else?', kind: 'text' },
  ],
  responses: [],
  ...over,
});

describe('surveyAnswerRows', () => {
  it('emits one row per answer, in the order the questions are asked', () => {
    const rows = surveyAnswerRows([
      survey({ responses: [{ comment: 'Too cold', rating: 4 }] }),
    ]);

    expect(rows.map((r) => r.question)).toEqual(['How was it?', 'Anything else?']);
    expect(rows.map((r) => r.answer)).toEqual(['4', 'Too cold']);
  });

  it('numbers responses by position and never by anything else', () => {
    const rows = surveyAnswerRows([
      survey({
        questions: [{ id: 'comment', prompt: 'Anything else?', kind: 'text' }],
        responses: [{ comment: 'First' }, { comment: 'Second' }, { comment: 'Third' }],
      }),
    ]);

    expect(rows.map((r) => r.response)).toEqual([1, 2, 3]);
    // Nothing in the output may carry a uid, a document id or an address. The
    // source shape has no room for one, and this asserts the row shape agrees.
    expect(Object.keys(rows[0]).sort()).toEqual([
      'answer',
      'kind',
      'question',
      'response',
      'session',
      'survey',
    ]);
  });

  it('skips a question that response did not answer rather than emitting a blank', () => {
    const rows = surveyAnswerRows([survey({ responses: [{ rating: 5 }] })]);

    expect(rows).toHaveLength(1);
    expect(rows[0].question).toBe('How was it?');
  });

  it('carries the session title so feedback can be read per room', () => {
    const rows = surveyAnswerRows([
      survey({ sessionTitle: 'Graphs at scale', responses: [{ rating: 3 }] }),
    ]);

    expect(rows[0].session).toBe('Graphs at scale');
  });

  it('numbers restart within each survey', () => {
    const rows = surveyAnswerRows([
      survey({ title: 'A', responses: [{ rating: 1 }, { rating: 2 }] }),
      survey({ title: 'B', responses: [{ rating: 3 }] }),
    ]);

    expect(rows.filter((r) => r.survey === 'A').map((r) => r.response)).toEqual([1, 2]);
    expect(rows.filter((r) => r.survey === 'B').map((r) => r.response)).toEqual([1]);
  });

  it('produces nothing for a survey nobody has answered', () => {
    expect(surveyAnswerRows([survey()])).toEqual([]);
  });
});

describe('formatAnswer', () => {
  it('joins a multi-choice answer with a semicolon, not a comma', () => {
    // A comma inside a cell is a quoting problem the reader takes on faith.
    expect(formatAnswer(['Vegetarian', 'Gluten-free'])).toBe('Vegetarian; Gluten-free');
  });

  it('writes a ticked box as yes and an unticked one as nothing', () => {
    expect(formatAnswer(true)).toBe('yes');
    // Not "no". An untouched box is a box nobody looked at.
    expect(formatAnswer(false)).toBe('');
  });

  it('keeps a zero, because a rating of zero is a rating', () => {
    expect(formatAnswer(0)).toBe('0');
  });

  it('gives an empty cell for a missing answer', () => {
    expect(formatAnswer(undefined)).toBe('');
    expect(formatAnswer(null)).toBe('');
  });
});

describe('answerColumns', () => {
  it('keeps the form order and gives every question a column, answered or not', () => {
    const columns = answerColumns(
      [field({ id: 'diet', prompt: 'Dietary requirements?' }), field({ id: 'shirt', prompt: 'T-shirt size?' })],
      ['diet'],
    );

    expect(columns.map((c) => c.id)).toEqual(['diet', 'shirt']);
    expect(columns[0].header).toBe('Dietary requirements?');
  });

  it('carries an answer whose question was removed, marked', () => {
    const columns = answerColumns([field({ id: 'diet' })], ['diet', 'old-question']);

    expect(columns.map((c) => c.id)).toEqual(['diet', 'old-question']);
    expect(columns[1].header).toContain('question removed');
  });

  it('never repeats a column for an answer the form still asks', () => {
    const columns = answerColumns([field({ id: 'diet' })], ['diet', 'diet']);

    expect(columns).toHaveLength(1);
  });
});
