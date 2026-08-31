'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type SurveyDoc } from '@kgc/shared';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { getSurvey } from '@/lib/surveys';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';

export interface SurveyState {
  ok?: boolean;
  message?: string;
  error?: string;
}

/**
 * Creating and editing a survey.
 *
 * ── Questions are one per line, not a form builder ──────────────────────────
 *
 * Whova has a drag-and-drop question builder. This takes a textarea where each
 * line is a question, optionally prefixed with a kind:
 *
 *     rating: How useful was this session?
 *     single: Would you attend again? | Yes | No | Maybe
 *     text:   Anything else?
 *
 * That is a deliberate trade rather than a shortcut. A builder is days of
 * client state for a form an organizer writes twice a year, and the textarea
 * round-trips — an organizer can paste last year's questions straight back in,
 * which a builder makes impossible.
 */
function parseQuestions(raw: string): SurveyDoc['questions'] | { error: string } {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { error: 'Add at least one question.' };
  if (lines.length > 30) return { error: 'Thirty questions is already too many. Nobody finishes those.' };

  const questions: SurveyDoc['questions'] = [];

  for (const [i, line] of lines.entries()) {
    const m = /^(rating|single|multi|text)\s*:\s*(.+)$/i.exec(line);
    const kind = (m ? m[1].toLowerCase() : 'rating') as SurveyDoc['questions'][number]['kind'];
    const rest = m ? m[2] : line;

    const [prompt, ...options] = rest.split('|').map((x) => x.trim()).filter(Boolean);
    if (!prompt) return { error: `Question ${i + 1} has no text.` };

    if ((kind === 'single' || kind === 'multi') && options.length < 2) {
      return {
        error: `Question ${i + 1} is a ${kind} choice and needs at least two options after a | character.`,
      };
    }

    questions.push({
      // Stable across an edit so existing responses keep matching their
      // question. Renumbering on every save would orphan every answer.
      id: `q${i + 1}`,
      prompt,
      kind,
      options: options.length ? options : undefined,
      required: false,
    });
  }

  return questions;
}

export async function saveSurveyAction(
  _prev: SurveyState,
  formData: FormData,
): Promise<SurveyState> {
  const actor = await requireOrganizer();

  const id = String(formData.get('id') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const sessionId = String(formData.get('sessionId') ?? '').trim();
  const status = String(formData.get('status') ?? 'draft');
  const raw = String(formData.get('questions') ?? '');

  if (title.length < 3) return { error: 'Give the survey a title.' };
  if (!['draft', 'published', 'cancelled'].includes(status)) return { error: 'Choose a status.' };

  const parsed = parseQuestions(raw);
  if ('error' in parsed) return { error: parsed.error };

  const existing = id ? await getSurvey(id) : null;

  /**
   * Editing the questions of a survey that already has answers would silently
   * change what those answers mean — question `q3` becomes a different question
   * and every stored response still points at it. Refusing is the only honest
   * option; duplicating is the workaround, and it is suggested rather than
   * hidden.
   */
  if (existing && existing.responseCount > 0) {
    const before = JSON.stringify((existing.questions ?? []).map((q) => q.prompt));
    const after = JSON.stringify(parsed.map((q) => q.prompt));
    if (before !== after) {
      return {
        error:
          `This survey already has ${existing.responseCount} responses, so its questions cannot ` +
          'change — the answers already stored would start meaning something else. Create a new ' +
          'survey instead.',
      };
    }
  }

  try {
    const ref = id
      ? db().collection(COLLECTIONS.surveys).doc(id)
      : db().collection(COLLECTIONS.surveys).doc();

    await ref.set(
      {
        eventId: EVENT_ID,
        title,
        /**
         * Deleted rather than set to `undefined`, because the store runs with
         * `ignoreUndefinedProperties` and this is a `{ merge: true }` write:
         * `x || undefined` on a cleared field writes nothing at all, the old
         * value survives, and the action still reports "Saved". Detaching a
         * survey from a session is exactly that case.
         */
        description: description || FieldValue.delete(),
        sessionId: sessionId || FieldValue.delete(),
        questions: parsed,
        status,
        ...(existing ? {} : { responseCount: 0, createdAt: new Date() }),
        updatedAt: new Date(),
      },
      { merge: true },
    );

    await appendAudit({
      actor,
      action: existing ? 'survey.update' : 'survey.create',
      targetPath: `${COLLECTIONS.surveys}/${ref.id}`,
      targetId: ref.id,
      before: existing ? { title: existing.title, status: existing.status } : {},
      after: { title, status, questions: parsed.length, sessionId: sessionId || null },
    });

    revalidatePath('/engagement/surveys');
    revalidatePath('/engagement/session-feedback');

    return {
      ok: true,
      message: existing
        ? `Saved “${title}”.`
        : `Created “${title}” with ${parsed.length} question${parsed.length === 1 ? '' : 's'}.`,
    };
  } catch (err) {
    recordError('survey.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save the survey.' };
  }
}

/** Publish or unpublish. A form, never a link — it changes what attendees see. */
export async function setSurveyStatusAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const id = String(formData.get('id') ?? '').trim();
  const status = String(formData.get('status') ?? '');
  if (!id || !['draft', 'published', 'cancelled'].includes(status)) return;

  try {
    const existing = await getSurvey(id);
    if (!existing) return;
    await db().collection(COLLECTIONS.surveys).doc(id).update({ status, updatedAt: new Date() });
    await appendAudit({
      actor,
      action: 'survey.update',
      targetPath: `${COLLECTIONS.surveys}/${id}`,
      targetId: id,
      before: { status: existing.status },
      after: { status },
    });
  } catch (err) {
    recordError('survey.setStatus', err);
  }
  revalidatePath('/engagement/surveys');
  revalidatePath('/engagement/session-feedback');
}
