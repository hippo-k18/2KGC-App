import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  type QuestionFieldDef,
  type QuestionFormDoc,
  type RegistrationDoc,
  type TicketAudience,
} from '@kgc/shared';
import { fieldId, validateField } from '@kgc/scripts/src/lib/question-forms';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * Registration question forms, from the organizer's side.
 *
 * The validation and the field-id derivation live in `@kgc/scripts` because
 * `apps/web` renders these questions and this app edits them, and neither can
 * import the other. A second copy of `validateAnswers` would mean the preview
 * here accepting something the checkout rejects.
 *
 * ── One document per audience ──────────────────────────────────────────────
 *
 * `questionForms/{audience}`. Not per ticket type: the questions a conference
 * asks are overwhelmingly the same across its tiers, and
 * `QuestionFieldDef.ticketTypeIds` handles the exceptions. A form per tier
 * means editing the dietary question four times and getting it wrong once.
 *
 * ── Field ids are assigned once and never regenerated ──────────────────────
 *
 * ⚠️ The id is what answers are stored under. Rewording "Dietary
 * requirements?" to "Any dietary requirements?" must not orphan the two hundred
 * answers already given to it, so an edit keeps the id it was created with.
 * This is the single most breakable thing in this module.
 */

export interface FormRow {
  audience: TicketAudience;
  fields: QuestionFieldDef[];
  active: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

const EMPTY = (audience: TicketAudience): FormRow => ({ audience, fields: [], active: false });

/**
 * Read one audience's form.
 *
 * Never throws and never returns null: a form screen that cannot render because
 * nobody has saved anything yet is a screen nobody can use to save anything.
 */
export async function getForm(audience: TicketAudience): Promise<FormRow> {
  try {
    const doc = await db().collection(COLLECTIONS.questionForms).doc(audience).get();
    if (!doc.exists) return EMPTY(audience);

    const data = doc.data() as QuestionFormDoc;
    if (data.eventId !== EVENT_ID) return EMPTY(audience);

    let updatedAt: string | undefined;
    try {
      updatedAt = data.updatedAt?.toDate().toISOString();
    } catch {
      updatedAt = undefined;
    }

    return {
      audience,
      fields: [...(data.fields ?? [])].sort((a, b) => a.order - b.order),
      active: data.active === true,
      updatedBy: data.updatedBy,
      updatedAt,
    };
  } catch (err) {
    recordError(`questionForms.get:${audience}`, err);
    return EMPTY(audience);
  }
}

export type FormResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Add a question, or edit one in place.
 *
 * ── The whole `fields` array is rewritten every time ───────────────────────
 *
 * Firestore has no way to update one element of an array by index without a
 * read, and a read-modify-write on a document only an organizer touches is
 * fine. What is *not* fine is `arrayUnion` on an object: it compares by deep
 * equality, so editing a prompt would append a second copy of the question
 * rather than replacing the first — and the public form would then ask it
 * twice.
 */
export async function saveField(input: {
  audience: TicketAudience;
  /** Absent when creating. Present, and preserved exactly, when editing. */
  id?: string;
  prompt: string;
  kind: QuestionFieldDef['kind'];
  options: string[];
  required: boolean;
  helpText?: string;
  ticketTypeIds: string[];
  actor: string;
}): Promise<FormResult> {
  const problem = validateField({
    prompt: input.prompt,
    kind: input.kind,
    options: input.options,
    required: input.required,
  });
  if (problem) return { ok: false, error: problem };

  try {
    const ref = db().collection(COLLECTIONS.questionForms).doc(input.audience);
    const snap = await ref.get();
    const existing = snap.exists ? (snap.data() as QuestionFormDoc) : undefined;
    const fields = [...(existing?.fields ?? [])];

    const index = input.id ? fields.findIndex((f) => f.id === input.id) : -1;

    /**
     * A new field's id is derived from its prompt, and de-duplicated.
     *
     * Two questions slugging to the same id would silently share an answer
     * column, which is the kind of bug that is only discovered when a catering
     * export makes no sense.
     */
    let id = input.id;
    if (!id) {
      const base = fieldId(input.prompt);
      id = base;
      let n = 2;
      while (fields.some((f) => f.id === id)) id = `${base}-${n++}`;
    }

    const field: QuestionFieldDef = {
      id,
      prompt: input.prompt.trim(),
      kind: input.kind,
      required: input.required,
      order: index >= 0 ? fields[index].order : fields.length * 10,
      ...(input.kind === 'choice' || input.kind === 'multi-choice'
        ? { options: input.options.map((o) => o.trim()).filter(Boolean) }
        : {}),
      ...(input.helpText?.trim() ? { helpText: input.helpText.trim() } : {}),
      ...(input.ticketTypeIds.length > 0 ? { ticketTypeIds: input.ticketTypeIds } : {}),
    };

    if (index >= 0) fields[index] = field;
    else fields.push(field);

    await ref.set(
      {
        eventId: EVENT_ID,
        audience: input.audience,
        fields,
        // Never written on an update: adding a question to a live form must not
        // switch the form off, and adding one to a draft must not publish it.
        ...(existing ? {} : { active: false, createdAt: FieldValue.serverTimestamp() }),
        updatedBy: input.actor,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await appendAudit({
      actor: input.actor,
      action: index >= 0 ? 'questionForm.update' : 'questionForm.create',
      targetPath: `${COLLECTIONS.questionForms}/${input.audience}`,
      targetId: id,
      before: index >= 0 ? { prompt: fields[index]?.prompt } : {},
      after: { prompt: field.prompt, kind: field.kind, required: field.required },
    });

    return {
      ok: true,
      message:
        index >= 0
          ? `Updated “${field.prompt}”. Answers already given to it are kept — the question keeps its id.`
          : `Added “${field.prompt}”.`,
    };
  } catch (err) {
    recordError('questionForms.saveField', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save the question.' };
  }
}

/**
 * Remove a question from the form.
 *
 * ⚠️ Answers already given to it are **not** deleted. They stay on the
 * registrations, keyed by an id nothing asks any more — which is deliberate:
 * an organizer removing a question mid-sale is usually fixing the *form*, and
 * silently destroying two hundred people's dietary requirements as a side
 * effect of that is not recoverable. The orphaned answers are reported on the
 * screen so the decision to delete them is a separate, explicit one.
 */
export async function deleteField(input: {
  audience: TicketAudience;
  id: string;
  actor: string;
}): Promise<FormResult> {
  try {
    const ref = db().collection(COLLECTIONS.questionForms).doc(input.audience);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: 'That form does not exist.' };

    const data = snap.data() as QuestionFormDoc;
    const gone = (data.fields ?? []).find((f) => f.id === input.id);
    if (!gone) return { ok: false, error: 'That question is not on this form.' };

    await ref.update({
      fields: (data.fields ?? []).filter((f) => f.id !== input.id),
      updatedBy: input.actor,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await appendAudit({
      actor: input.actor,
      action: 'questionForm.update',
      targetPath: `${COLLECTIONS.questionForms}/${input.audience}`,
      targetId: input.id,
      before: { prompt: gone.prompt },
      after: { removed: true },
    });

    return {
      ok: true,
      message: `Removed “${gone.prompt}”. Answers already given to it stay on the registrations — nothing was destroyed.`,
    };
  } catch (err) {
    recordError('questionForms.deleteField', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not remove the question.' };
  }
}

/** Move a question up or down. Order decides what a buyer reads first. */
export async function moveField(input: {
  audience: TicketAudience;
  id: string;
  direction: 'up' | 'down';
  actor: string;
}): Promise<FormResult> {
  try {
    const ref = db().collection(COLLECTIONS.questionForms).doc(input.audience);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: 'That form does not exist.' };

    const data = snap.data() as QuestionFormDoc;
    const fields = [...(data.fields ?? [])].sort((a, b) => a.order - b.order);
    const i = fields.findIndex((f) => f.id === input.id);
    if (i === -1) return { ok: false, error: 'That question is not on this form.' };

    const j = input.direction === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= fields.length) return { ok: true, message: 'Already at the end.' };

    [fields[i], fields[j]] = [fields[j], fields[i]];

    /**
     * Renumbered from scratch in tens rather than swapping two `order` values.
     *
     * A document written before this screen existed may have duplicate or
     * missing orders, and swapping two equal numbers moves nothing — which
     * looks exactly like a broken button.
     */
    await ref.update({
      fields: fields.map((f, n) => ({ ...f, order: n * 10 })),
      updatedBy: input.actor,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, message: 'Reordered.' };
  } catch (err) {
    recordError('questionForms.moveField', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not reorder.' };
  }
}

/**
 * Turn the form on or off for buyers.
 *
 * Off is the honest default for a new form: a half-written question set that is
 * already being asked is worse than none, and there is no draft state beyond
 * this switch.
 */
export async function setFormActive(input: {
  audience: TicketAudience;
  active: boolean;
  actor: string;
}): Promise<FormResult> {
  try {
    const ref = db().collection(COLLECTIONS.questionForms).doc(input.audience);
    const snap = await ref.get();
    const fields = snap.exists ? ((snap.data() as QuestionFormDoc).fields ?? []) : [];

    if (input.active && fields.length === 0) {
      return { ok: false, error: 'There are no questions to ask. Add one first.' };
    }

    await ref.set(
      {
        eventId: EVENT_ID,
        audience: input.audience,
        active: input.active,
        updatedBy: input.actor,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await appendAudit({
      actor: input.actor,
      action: 'questionForm.update',
      targetPath: `${COLLECTIONS.questionForms}/${input.audience}`,
      targetId: input.audience,
      before: { active: !input.active },
      after: { active: input.active },
    });

    return {
      ok: true,
      message: input.active
        ? `Buyers are now asked these ${fields.length} questions before checkout.`
        : 'The questions are no longer asked. Answers already given are kept.',
    };
  } catch (err) {
    recordError('questionForms.setActive', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update the form.' };
  }
}

// ---------------------------------------------------------------------------
// Reading answers back
// ---------------------------------------------------------------------------

export interface AnswerSummary {
  /** Registrations carrying at least one answer. */
  answered: number;
  total: number;
  /** Field id → how many people answered it, and the distribution where useful. */
  perField: Record<string, { count: number; values: { value: string; count: number }[] }>;
  /**
   * Answers stored under an id no current question uses — usually a question
   * that was removed. Surfaced rather than hidden: they are somebody's data.
   */
  orphaned: { id: string; count: number }[];
}

/**
 * Count what has actually been answered.
 *
 * ── The distribution is the point, not the count ───────────────────────────
 *
 * "184 people answered the dietary question" is not actionable. "23 vegetarian,
 * 4 gluten-free, 2 kosher" is the number the caterer needs, and it is the
 * reason this screen exists rather than an export button.
 *
 * Free-text answers are counted but not tallied — a hundred distinct sentences
 * is a list, not a distribution, and rendering it as one would be noise.
 */
export async function answerSummary(fields: QuestionFieldDef[]): Promise<AnswerSummary> {
  const known = new Set(fields.map((f) => f.id));
  const tallyable = new Set(
    fields.filter((f) => f.kind !== 'short-text' && f.kind !== 'long-text').map((f) => f.id),
  );

  const perField: AnswerSummary['perField'] = {};
  const orphanCounts = new Map<string, number>();
  let answered = 0;
  let total = 0;

  try {
    const snap = await db()
      .collection(COLLECTIONS.registrations)
      .where('eventId', '==', EVENT_ID)
      .get();

    for (const d of snap.docs) {
      const reg = d.data() as RegistrationDoc;
      if (reg.status === 'cancelled') continue;
      total++;

      const answers = reg.answers ?? {};
      if (Object.keys(answers).length > 0) answered++;

      for (const [id, value] of Object.entries(answers)) {
        if (!known.has(id)) {
          orphanCounts.set(id, (orphanCounts.get(id) ?? 0) + 1);
          continue;
        }

        const row = (perField[id] ??= { count: 0, values: [] });
        row.count++;

        if (!tallyable.has(id)) continue;

        const labels = Array.isArray(value) ? value : [value === true ? 'yes' : String(value)];
        for (const label of labels) {
          const found = row.values.find((v) => v.value === label);
          if (found) found.count++;
          else row.values.push({ value: label, count: 1 });
        }
      }
    }
  } catch (err) {
    recordError('questionForms.answerSummary', err);
  }

  for (const row of Object.values(perField)) {
    row.values.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }

  return {
    answered,
    total,
    perField,
    orphaned: [...orphanCounts.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count),
  };
}
