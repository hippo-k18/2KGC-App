import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  type SessionDoc,
  type SurveyDoc,
  type SurveyResponseDoc,
  type WithId,
} from '@kgc/shared';
import { db } from './firestore';

/**
 * Surveys and session feedback.
 *
 * ── One shape, two screens ──────────────────────────────────────────────────
 *
 * Whova has these as separate products. They differ only in what they are
 * attached to: a survey carrying a `sessionId` is session feedback, one without
 * is an event survey. Same questions, same responses, same arithmetic — so
 * `SurveyDoc` covers both and the screens filter.
 *
 * ── ⚠️ Responses are counted, never attributed ──────────────────────────────
 *
 * A response is keyed by uid — that is what stops one person voting twice — so
 * the *server* can tell who said what. This module deliberately never returns
 * that mapping. Feedback that a speaker or an organizer can trace back to a
 * named attendee is feedback nobody gives honestly, and the value of a session
 * survey is entirely in it being candid.
 *
 * So `summarise()` returns distributions and free text with no uid attached,
 * and there is no function here that would let a screen join the two. If
 * somebody later needs "who has not responded yet", that is a list of uids with
 * **no answers** — which is a different query and does not leak anything.
 */

export interface SurveyRow {
  id: string;
  title: string;
  description: string;
  sessionId?: string;
  sessionTitle?: string;
  questionCount: number;
  status: SurveyDoc['status'];
  responseCount: number;
  opensAt?: string;
  closesAt?: string;
  /** Live now: published, and inside its window if it has one. */
  open: boolean;
}

function iso(t: { toDate(): Date } | undefined): string | undefined {
  try {
    return t?.toDate().toISOString();
  } catch {
    return undefined;
  }
}

function isOpen(s: SurveyDoc, now: Date): boolean {
  if (s.status !== 'published') return false;
  if (s.opensAt && s.opensAt.toDate() > now) return false;
  if (s.closesAt && s.closesAt.toDate() < now) return false;
  return true;
}

/**
 * Every survey, with its session title resolved.
 *
 * One equality filter per collection, sorted in memory — the rule everywhere
 * here. The emulator does not enforce composite indexes, so `where` plus
 * `orderBy` passes locally and fails in production with `failed-precondition`;
 * that has shipped twice on this project.
 */
export async function listSurveys(): Promise<SurveyRow[]> {
  const [surveySnap, sessionSnap] = await Promise.all([
    db().collection(COLLECTIONS.surveys).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get(),
  ]);

  const titles = new Map(sessionSnap.docs.map((d) => [d.id, (d.data() as SessionDoc).title]));
  const now = new Date();

  return surveySnap.docs
    .map((d) => {
      const s = d.data() as SurveyDoc;
      return {
        id: d.id,
        title: s.title,
        description: s.description ?? '',
        sessionId: s.sessionId,
        sessionTitle: s.sessionId ? titles.get(s.sessionId) : undefined,
        questionCount: (s.questions ?? []).length,
        status: s.status ?? 'draft',
        // The stored counter is maintained by a trigger that does not exist on
        // the Spark plan, so it may lag. `responsesFor()` counts the real
        // subcollection when a screen needs a number it can trust.
        responseCount: s.responseCount ?? 0,
        opensAt: iso(s.opensAt),
        closesAt: iso(s.closesAt),
        open: isOpen(s, now),
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function getSurvey(id: string): Promise<WithId<SurveyDoc> | null> {
  const doc = await db().collection(COLLECTIONS.surveys).doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as SurveyDoc;
  if (data.eventId !== EVENT_ID) return null;
  return { id: doc.id, ...data };
}

export interface QuestionSummary {
  id: string;
  prompt: string;
  kind: SurveyDoc['questions'][number]['kind'];
  /** For `rating`: the mean, and how many answered. */
  average?: number;
  /** For `single` and `multi`: option → count. */
  distribution?: { label: string; count: number }[];
  /** For `text`: the answers, unattributed. */
  comments?: string[];
  answered: number;
}

export interface SurveySummary {
  survey: SurveyRow;
  responses: number;
  questions: QuestionSummary[];
}

/**
 * Aggregate one survey's responses.
 *
 * Counts the subcollection rather than trusting `responseCount`, because that
 * counter is written by an unbuilt trigger. A response total that is quietly
 * wrong is worse here than elsewhere: it is the number somebody quotes when
 * deciding whether the feedback is representative.
 */
export async function summarise(id: string): Promise<SurveySummary | null> {
  const survey = await getSurvey(id);
  if (!survey) return null;

  const snap = await db()
    .collection(COLLECTIONS.surveys)
    .doc(id)
    .collection(SUBCOLLECTIONS.responses)
    .get();

  // Answers only. The uid on each document is deliberately dropped here and
  // never returned — see the note at the top of this file.
  const answerSets = snap.docs.map((d) => (d.data() as SurveyResponseDoc).answers ?? {});

  const questions: QuestionSummary[] = (survey.questions ?? []).map((q) => {
    const given = answerSets
      .map((a) => a[q.id])
      .filter((v) => v !== undefined && v !== null && v !== '');

    if (q.kind === 'rating') {
      const nums = given.map(Number).filter((n) => Number.isFinite(n));
      return {
        id: q.id,
        prompt: q.prompt,
        kind: q.kind,
        answered: nums.length,
        average: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined,
      };
    }

    if (q.kind === 'text') {
      return {
        id: q.id,
        prompt: q.prompt,
        kind: q.kind,
        answered: given.length,
        comments: given.map(String),
      };
    }

    const counts = new Map<string, number>();
    for (const raw of given) {
      // `multi` answers are stored joined; splitting here keeps the storage
      // shape simple and the arithmetic correct for both kinds.
      for (const part of String(raw).split(';').map((x) => x.trim()).filter(Boolean)) {
        counts.set(part, (counts.get(part) ?? 0) + 1);
      }
    }

    return {
      id: q.id,
      prompt: q.prompt,
      kind: q.kind,
      answered: given.length,
      distribution: (q.options ?? [...counts.keys()]).map((label) => ({
        label,
        count: counts.get(label) ?? 0,
      })),
    };
  });

  const rows = await listSurveys();
  const row = rows.find((r) => r.id === id)!;

  return { survey: { ...row, responseCount: snap.size }, responses: snap.size, questions };
}

/** Sessions a feedback survey could be attached to, for the picker. */
export async function feedbackTargets(): Promise<{ id: string; label: string }[]> {
  const snap = await db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get();
  return snap.docs
    .map((d) => ({ id: d.id, doc: d.data() as SessionDoc }))
    .filter((r) => r.doc.status === 'published' && !r.doc.deletedAt)
    .sort((a, b) => a.doc.startsAtLocal.localeCompare(b.doc.startsAtLocal))
    .map((r) => ({
      id: r.id,
      label: `${r.doc.day} ${r.doc.startsAtLocal.slice(11, 16)} — ${r.doc.title}`,
    }));
}
