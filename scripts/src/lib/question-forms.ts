import type { QuestionFieldDef } from "@kgc/shared";

/**
 * Form definitions and the validator that gates them.
 *
 * Lives in `@kgc/scripts` for the same reason `ensureRegistration` and the
 * email templates do — `apps/web` renders the form and `apps/organizer` edits
 * it, and neither can import the other. A second copy of `validateAnswers`
 * would mean the organizer's preview accepting something the checkout rejects,
 * or worse, the reverse.
 *
 * ── One builder, two products ──────────────────────────────────────────────
 *
 * This started as the registration question form and now also carries the call
 * for abstracts (`CFA-PLAN.md` Phase 1). That is deliberate and is the whole
 * reason the file grew rather than a second one appearing: the two need the
 * same field types, the same required/optional rules and the same "an answer
 * that was never offered is refused" check, and building them separately is how
 * a codebase ends up with two validators that disagree at 3am on the day the
 * call closes.
 *
 * What the abstracts form needed on top of registration, all additive:
 *
 *   - a `description` field, which is a block of text and collects no answer
 *   - a per-field `maxLength`, so an abstract can be capped at 10,000 characters
 *   - per-field `visibility` — "who can see this question?"
 *   - conditional sub-questions, up to five per parent
 *   - form versioning, so a call that runs for months is not frozen by its
 *     first submission
 *
 * Whova has branching logic on abstracts and not on registration. That
 * asymmetry is an artefact of two teams, not a design; everything here is
 * available to both. Nothing changes for registration until somebody defines a
 * field that uses it — a form with no `showIf`, no `maxLength` and no
 * `visibility` validates today exactly as it did before.
 *
 * ── No Firestore, no sentinels, nothing async ──────────────────────────────
 *
 * Pure functions over plain data. That is deliberate twice over: it keeps this
 * testable by Vitest (`server-only` throws outside a Server Component), and it
 * keeps it clear of the rule that no Firestore sentinel may be constructed
 * inside this package — three copies of `firebase-admin` exist and sentinels do
 * not cross them. Where a time is needed (`retireVersion`) it is a native
 * `Date`, which is a global and converts on write.
 */

// ───────────────────────────────────────────────────────────────────────────
// Field definitions
// ───────────────────────────────────────────────────────────────────────────

/**
 * Every field kind either form can ask.
 *
 * The six registration kinds are `QuestionFieldDef["kind"]` in `@kgc/shared`
 * and are not re-spelled here, so adding one there adds it here. `description`
 * is the seventh and the only one that is not a question: it renders a block of
 * text between questions — the instructions above the abstract box, the note
 * about the word limit — and collects nothing.
 *
 * The abstract/summary field is **not** an eighth kind. It is a `long-text`
 * with an explicit `maxLength`; a separate kind would be `long-text` with a
 * different name and two code paths that have to agree about trimming.
 */
export type FormFieldKind = QuestionFieldDef["kind"] | "description";

/**
 * Who may see the answer to a question.
 *
 * The submitter always sees their own answers — this is about everybody else,
 * and it is the "Who can see this question?" control on Whova's abstract form.
 * `organizers` is the default when absent, because that is what every answer
 * this project has ever stored is today, and a field whose visibility somebody
 * forgot to set must not become the one that publishes an email address.
 *
 * ⚠️ This is a *display* decision and it is enforced by whoever renders the
 * answer, through `canSee` / `redactAnswers`. It is not a security boundary —
 * `firestore.rules` filters documents, not fields (AGENTS.md, Security model),
 * so a genuinely secret answer belongs in a subcollection, the way
 * `submissions/{id}/identity` does for blind review.
 */
export type FieldVisibility = "public" | "reviewers" | "organizers";

/** The classes of reader `canSee` knows about. */
export type FieldViewer = "public" | "reviewer" | "organizer";

/**
 * What makes a sub-question appear.
 *
 * One parent, one answer. Whova's own control is "show this when the answer to
 * X is Y", and anything richer — two conditions, a range, "any answer except" —
 * is a rules engine that has to be rendered, validated and explained to an
 * organizer in a dropdown.
 */
export interface FieldTrigger {
  /** The id of the parent question. Never a prompt: ids are what answers key on. */
  fieldId: string;
  /**
   * The parent answer that reveals this question. For `multi-choice` it is
   * satisfied when the value is among those picked; for `checkbox`/`consent` it
   * is the string `"true"`, meaning ticked.
   */
  equals: string;
}

/**
 * One field on any form this project builds.
 *
 * A widening of `QuestionFieldDef`, not a replacement: every `QuestionFieldDef`
 * is a valid `FormFieldDef`, so `questionForms/{audience}` documents flow
 * through everything here untouched and every existing caller keeps its own
 * narrower type through the generics below.
 *
 * ⚠️ Defined here rather than in `packages/shared/src/models.ts` only because
 * the schema for the call for abstracts is being written in parallel. The
 * intent is that this shape lands there — `FormFieldDef`, plus `version` and a
 * retired-version archive on the form document, plus `formVersion` on a
 * submission — and this local definition is deleted in favour of the import.
 */
export interface FormFieldDef extends Omit<QuestionFieldDef, "kind"> {
  kind: FormFieldKind;
  /**
   * Characters allowed in a text answer. Absent means the default for the kind:
   * 200 for `short-text`, 2,000 for `long-text` — the numbers registration has
   * always enforced, so an existing form is unaffected.
   *
   * Capped by `MAX_ANSWER_LENGTH`. 10,000 for a paragraph is Whova's ceiling on
   * an abstract and is a real limit rather than a round number: Firestore's own
   * limit is a megabyte per *document*, and a submission carries a title, a
   * summary and every other answer beside it.
   */
  maxLength?: number;
  /** Who may see the answer. Absent means `organizers`. */
  visibility?: FieldVisibility;
  /**
   * Present on a sub-question: the parent answer that reveals it.
   *
   * Sub-questions are held in the same flat `fields` array as everything else,
   * not nested inside their parent. Answers are a flat map keyed by field id at
   * every depth, `fieldsForTier` already orders the array, and a nested array
   * inside a Firestore document is a shape the editor would have to walk twice.
   * The nesting is one level deep and `validateForm` enforces that — see
   * `MAX_SUB_QUESTIONS`.
   */
  showIf?: FieldTrigger;
}

/** Whova's limit, and a sensible one: five sub-questions per parent answer. */
export const MAX_SUB_QUESTIONS = 5;

/**
 * The hard ceiling on a text answer, by kind, whatever `maxLength` says.
 *
 * 10,000 for a paragraph is the abstract limit. 500 for a single-line input is
 * this project's own: an `<input>` holding more than that is a paragraph field
 * somebody chose the wrong kind for.
 */
export const MAX_ANSWER_LENGTH: Record<"short-text" | "long-text", number> = {
  "short-text": 500,
  "long-text": 10_000,
};

/** The length enforced when a field sets no `maxLength` of its own. */
const DEFAULT_ANSWER_LENGTH: Record<"short-text" | "long-text", number> = {
  "short-text": 200,
  "long-text": 2000,
};

/** `"Dietary requirements?"` → `"dietary-requirements"`. Stable once assigned. */
export function fieldId(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
  // A prompt of only punctuation would slug to nothing, and a field with an
  // empty id silently overwrites the next one.
  return slug || `q${Date.now().toString(36)}`;
}

/** Whether a field is asked at all for a given tier. */
export function appliesToTier<F extends FormFieldDef>(field: F, ticketTypeId: string): boolean {
  const only = field.ticketTypeIds ?? [];
  return only.length === 0 || only.includes(ticketTypeId);
}

/**
 * The fields one audience actually sees, in order.
 *
 * Generic in the field type so a caller holding `QuestionFieldDef[]` gets
 * `QuestionFieldDef[]` back — `apps/web`'s renderer switches on the narrower
 * union and must not be handed the wider one.
 *
 * ── Sub-questions follow their parent ──────────────────────────────────────
 *
 * Sorting by `order` alone would let a sub-question land anywhere in the form,
 * including above the question that reveals it. Each one is therefore lifted to
 * sit immediately after its parent, keeping their relative order. A form with
 * no sub-questions — which is every registration form today — comes out in
 * exactly the order it always did.
 *
 * A sub-question whose parent the tier does not ask is dropped with it. The
 * alternative is a question that appears with no way to trigger it.
 */
export function fieldsForTier<F extends FormFieldDef>(fields: F[], ticketTypeId: string): F[] {
  const asked = fields
    .filter((f) => appliesToTier(f, ticketTypeId))
    .sort((a, b) => a.order - b.order || a.prompt.localeCompare(b.prompt));

  const byParent = new Map<string, F[]>();
  const roots: F[] = [];
  for (const f of asked) {
    const parentId = f.showIf?.fieldId;
    if (parentId && asked.some((p) => p.id === parentId)) {
      const kids = byParent.get(parentId) ?? [];
      kids.push(f);
      byParent.set(parentId, kids);
    } else if (parentId) {
      // Parent filtered out by tier, or dangling. Nothing can reveal this, so
      // asking it would be asking a question with no context.
      continue;
    } else {
      roots.push(f);
    }
  }

  return roots.flatMap((f) => [f, ...(byParent.get(f.id) ?? [])]);
}

/** The parent question of a sub-question, if the form still holds one. */
export function parentOf<F extends FormFieldDef>(field: F, fields: F[]): F | undefined {
  const parentId = field.showIf?.fieldId;
  return parentId ? fields.find((f) => f.id === parentId) : undefined;
}

/**
 * Whether a sub-question's trigger is satisfied by the answers so far.
 *
 * Exported because the browser needs the same answer the server reaches — a
 * form that reveals a question the validator does not ask, or the reverse, is
 * the class of bug this module exists to make impossible.
 */
export function isTriggered(
  field: FormFieldDef,
  answers: Record<string, AnswerValue | undefined>,
): boolean {
  const trigger = field.showIf;
  if (!trigger) return true;
  const parentAnswer = answers[trigger.fieldId];
  if (parentAnswer === undefined) return false;
  if (Array.isArray(parentAnswer)) return parentAnswer.includes(trigger.equals);
  if (typeof parentAnswer === "boolean") return parentAnswer === (trigger.equals === "true");
  return parentAnswer === trigger.equals;
}

/**
 * Whether an answer is actually required of somebody looking at this field.
 *
 * A sub-question inherits its parent's `required` — asking somebody to answer a
 * question they only reached because of a previous answer, while the question
 * that revealed it was optional, is a trap.
 *
 * ── Except consent, which is always required of whoever triggers it ────────
 *
 * This looks like it contradicts the rule two functions down, that a consent
 * box may not be required. It does not, and the difference is where the refusal
 * lives. A top-level required consent offers no way to decline and still
 * submit, which is not consent. A consent *sub-question* is reached only by
 * choosing the parent answer that reveals it — "yes, my talk will be recorded"
 * — so declining is still available one question up. The consent is required
 * *given* that answer, and the answer is freely given.
 *
 * So it is forced here rather than merely permitted: a definition that says
 * `required: false` on a consent sub-question is overruled, because the
 * inheritance rule above would otherwise copy an optional parent's setting onto
 * it and record a blank where a decision belongs.
 */
export function effectiveRequired(field: FormFieldDef, parent?: FormFieldDef): boolean {
  // A description collects nothing, so it can never be outstanding.
  if (field.kind === "description") return false;
  if (!parent) return field.required;
  if (field.kind === "consent") return true;
  return parent.required;
}

/** A sub-question is seen by whoever may see its parent. */
export function effectiveVisibility(field: FormFieldDef, parent?: FormFieldDef): FieldVisibility {
  return (parent ?? field).visibility ?? "organizers";
}

const VIEWER_RANK: Record<FieldViewer, number> = { public: 1, reviewer: 2, organizer: 3 };
const VISIBILITY_RANK: Record<FieldVisibility, number> = {
  public: 1,
  reviewers: 2,
  organizers: 3,
};

/** Whether one class of reader may see this field's answer. */
export function canSee(
  field: FormFieldDef,
  viewer: FieldViewer,
  fields: FormFieldDef[] = [],
): boolean {
  const visibility = effectiveVisibility(field, parentOf(field, fields));
  return VIEWER_RANK[viewer] >= VISIBILITY_RANK[visibility];
}

/**
 * Strip the answers one reader may not see.
 *
 * ⚠️ Answers keyed by an id the form no longer holds are dropped, not kept.
 * Everywhere else in this module an orphaned answer survives, because deleting
 * somebody's data as a side effect of an edit is not recoverable — but this
 * function's whole job is deciding what leaves the server, and a field whose
 * visibility cannot be looked up has no visibility to honour.
 */
export function redactAnswers(
  fields: FormFieldDef[],
  answers: Record<string, AnswerValue>,
  viewer: FieldViewer,
): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {};
  for (const f of fields) {
    const value = answers[f.id];
    if (value !== undefined && canSee(f, viewer, fields)) out[f.id] = value;
  }
  return out;
}

/** The character cap on a text answer: the field's own, bounded by the kind's. */
export function maxAnswerLength(field: FormFieldDef): number {
  if (field.kind !== "short-text" && field.kind !== "long-text") return MAX_ANSWER_LENGTH["short-text"];
  const ceiling = MAX_ANSWER_LENGTH[field.kind];
  const wanted = field.maxLength ?? DEFAULT_ANSWER_LENGTH[field.kind];
  return Math.max(1, Math.min(wanted, ceiling));
}

// ───────────────────────────────────────────────────────────────────────────
// Answers
// ───────────────────────────────────────────────────────────────────────────

export type AnswerValue = string | string[] | boolean;

export interface ValidationResult {
  ok: boolean;
  /** Field id → the problem, for rendering beside the input. */
  errors: Record<string, string>;
  /** Only the fields that apply, cleaned. Safe to write. */
  answers: Record<string, AnswerValue>;
  /**
   * True when these answers were recorded against an older version of the form
   * than the one they were checked against. Absent on a live submission.
   */
  stale?: boolean;
  /**
   * Ids the *current* form asks and requires, and this record does not answer.
   * Only populated in recorded mode: these are questions added since, so they
   * are something to chase rather than something to reject.
   */
  unanswered?: string[];
  /**
   * Ids answered here that the current form no longer asks. Kept in `answers`,
   * reported so the organizer can see them rather than wonder where they went.
   */
  orphaned?: string[];
}

/**
 * Which version of the form the answers belong to.
 *
 * Both absent — the normal case, and what every existing caller passes — means
 * "these are being submitted now, against this definition", and every rule
 * applies.
 */
export interface ValidateAnswersOptions {
  /** The version stamped on the submission when it was made. */
  recordedVersion?: number;
  /** The version the form carries now. */
  currentVersion?: number;
}

/**
 * Check and clean a set of answers.
 *
 * ── Fields that do not apply are dropped, not rejected ─────────────────────
 *
 * A buyer switching tier after filling the form leaves stale values in the
 * POST. Rejecting them would block a legitimate purchase over a field the buyer
 * can no longer see; keeping them would store an answer to a question that was
 * never asked of them. Dropping is the only behaviour that is right in both
 * directions. A sub-question whose trigger was not met is the same case: it was
 * answered, then un-revealed, and it is dropped for the same reason.
 *
 * ── An empty optional answer is absent, not an empty string ────────────────
 *
 * `""` in an export column reads as "they answered nothing", which is different
 * from "we did not ask". The distinction matters at a catering headcount.
 *
 * ── An older version is read, not judged ───────────────────────────────────
 *
 * See `readRecordedAnswers`. Passing `recordedVersion`/`currentVersion` is how
 * a caller says "this is a record, not a submission".
 */
export function validateAnswers(
  fields: FormFieldDef[],
  ticketTypeId: string,
  raw: Record<string, AnswerValue | undefined>,
  options: ValidateAnswersOptions = {},
): ValidationResult {
  const { recordedVersion, currentVersion } = options;
  if (
    recordedVersion !== undefined &&
    currentVersion !== undefined &&
    recordedVersion !== currentVersion
  ) {
    return readRecordedAnswers(fields, ticketTypeId, raw);
  }

  const errors: Record<string, string> = {};
  const answers: Record<string, AnswerValue> = {};

  const asked = fieldsForTier(fields, ticketTypeId);

  for (const f of asked) {
    // A description is text on the page, not a question. It has no answer, it
    // cannot be required, and a value posted under its id is somebody probing.
    if (f.kind === "description") continue;

    const parent = parentOf(f, asked);
    /**
     * Triggers are read from the answers already *cleaned* this pass, not from
     * `raw`. `fieldsForTier` guarantees a parent is processed first, and the
     * cleaned value is the one that will be stored — so the form the submitter
     * saw and the record that results agree about which questions were asked.
     */
    if (parent && !isTriggered(f, answers)) continue;

    const required = effectiveRequired(f, parent);
    const value = raw[f.id];

    if (f.kind === "checkbox" || f.kind === "consent") {
      const checked = value === true || value === "on" || value === "true";
      /**
       * A required consent is refused by the editor at the top level, so this
       * fires for a required plain checkbox — "I have read the code of conduct",
       * which is a legitimate gate — and for a consent sub-question, which is
       * required of whoever triggered it. See `effectiveRequired` for why those
       * are the same rule rather than an exception to it.
       */
      if (required && !checked) {
        errors[f.id] = "This has to be ticked to continue.";
        continue;
      }
      // Only stored when ticked. An untouched optional box is not a "no" that
      // anybody said.
      if (checked) answers[f.id] = true;
      continue;
    }

    if (f.kind === "multi-choice") {
      const options = f.options ?? [];
      const picked = (Array.isArray(value) ? value : value ? [String(value)] : []).filter((v) =>
        options.includes(v),
      );
      if (required && picked.length === 0) {
        errors[f.id] = "Choose at least one.";
        continue;
      }
      if (picked.length > 0) answers[f.id] = picked;
      continue;
    }

    const text = typeof value === "string" ? value.trim() : "";

    if (f.kind === "choice") {
      const options = f.options ?? [];
      if (text && !options.includes(text)) {
        // Not merely invalid — somebody posted a value that was never offered.
        errors[f.id] = "That is not one of the options.";
        continue;
      }
      if (required && !text) {
        errors[f.id] = "Choose one.";
        continue;
      }
      if (text) answers[f.id] = text;
      continue;
    }

    if (required && !text) {
      errors[f.id] = "This is required.";
      continue;
    }

    /**
     * A cap, so one field cannot carry a document-sized payload.
     *
     * Firestore's own limit is a megabyte per document, and the registration
     * has to stay small — the app reads it on every cold start. An abstract is
     * the one answer allowed to be large, and it is large by an organizer
     * setting `maxLength`, not by the cap being lifted for everybody.
     */
    const max = maxAnswerLength(f);
    if (text.length > max) {
      errors[f.id] = `Keep this under ${max} characters.`;
      continue;
    }

    if (text) answers[f.id] = text;
  }

  return { ok: Object.keys(errors).length === 0, errors, answers };
}

/**
 * Read answers recorded against an older version of the form.
 *
 * ── Validation is a gate for a write happening now ─────────────────────────
 *
 * For a record already made it is documentation, not a gate. An abstract
 * submitted in March against version 2 cannot be made to satisfy version 4, and
 * nothing good happens if it is asked to: the submitter is not in the room, the
 * answer is what they actually said, and marking it invalid would either hide
 * it from the committee or push somebody to edit it into compliance — which is
 * the one thing a submission record must never do.
 *
 * So nothing here can fail. Concretely, against an older version:
 *
 *   - **Required is not enforced.** A question added since could not have been
 *     answered. It is listed in `unanswered` instead, which is a task for an
 *     organizer, not an error on a document.
 *   - **Option membership is not enforced.** An option removed in version 3
 *     was still on the form in version 2, and the person who picked it picked
 *     something real.
 *   - **Length is not enforced.** A cap lowered later cannot retroactively make
 *     an abstract too long.
 *   - **Answers to questions the form no longer asks are kept**, and reported
 *     in `orphaned`. This is the same decision `deleteField` already takes in
 *     the organizer: removing a question is usually fixing the form, and
 *     silently destroying two hundred answers as a side effect is not
 *     recoverable.
 *
 * Types are still normalised — a ticked box is `true`, a string is trimmed —
 * because that is a reading of the stored value, not a judgement of it.
 */
function readRecordedAnswers(
  fields: FormFieldDef[],
  ticketTypeId: string,
  raw: Record<string, AnswerValue | undefined>,
): ValidationResult {
  const known = new Map(fields.map((f) => [f.id, f]));
  const answers: Record<string, AnswerValue> = {};
  const orphaned: string[] = [];

  for (const [id, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    const field = known.get(id);
    if (!field) {
      // Kept deliberately. See the docblock.
      answers[id] = value;
      orphaned.push(id);
      continue;
    }
    if (field.kind === "description") continue;
    if (field.kind === "checkbox" || field.kind === "consent") {
      const checked = value === true || value === "on" || value === "true";
      if (checked) answers[id] = true;
      continue;
    }
    if (field.kind === "multi-choice") {
      const picked = Array.isArray(value) ? value : [String(value)];
      if (picked.length > 0) answers[id] = picked;
      continue;
    }
    const text = typeof value === "string" ? value.trim() : String(value);
    if (text) answers[id] = text;
  }

  const unanswered: string[] = [];
  for (const f of fieldsForTier(fields, ticketTypeId)) {
    if (f.kind === "description") continue;
    const parent = parentOf(f, fields);
    if (parent && !isTriggered(f, answers)) continue;
    if (!effectiveRequired(f, parent)) continue;
    if (answers[f.id] === undefined) unanswered.push(f.id);
  }

  return { ok: true, errors: {}, answers, stale: true, unanswered, orphaned };
}

// ───────────────────────────────────────────────────────────────────────────
// Definition rules
// ───────────────────────────────────────────────────────────────────────────

/**
 * Refuse a field definition that cannot work.
 *
 * Called by the organizer's editor before saving. Every rule here is one that
 * produces a broken *public* form if it slips through, which is the worst place
 * to discover it.
 *
 * `siblings` is the rest of the form and is optional, because the registration
 * editor has always called this with one field and no context. The rules that
 * need the whole form — a trigger pointing at a question that exists, one level
 * of nesting, five sub-questions per parent — are skipped when it is empty and
 * are also checked by `validateForm`, which is the whole-form pass.
 */
export function validateField(
  field: Partial<FormFieldDef>,
  siblings: FormFieldDef[] = [],
): string | undefined {
  const prompt = (field.prompt ?? "").trim();
  if (prompt.length < 3) return "Give the question a prompt.";

  if (field.kind === "description") {
    /**
     * A description *is* its text, so the phone-screen limit that applies to a
     * question prompt would be the wrong rule — instructions above an abstract
     * box are a paragraph. It is bounded by the paragraph cap instead.
     */
    if (prompt.length > DEFAULT_ANSWER_LENGTH["long-text"]) {
      return "That is longer than a note on a form; put it in the call's instructions instead.";
    }
    if (field.required) {
      return "A description collects no answer, so it cannot be required.";
    }
    if ((field.options ?? []).length > 0) {
      return "A description has no options — it is text on the page, not a question.";
    }
  } else if (prompt.length > 200) {
    return "That prompt is too long to read on a phone.";
  }

  if (field.kind === "choice" || field.kind === "multi-choice") {
    const options = (field.options ?? []).filter((o) => o.trim());
    if (options.length < 2) return "A choice needs at least two options.";
    if (new Set(options.map((o) => o.trim().toLowerCase())).size !== options.length) {
      return "Two options are the same. A buyer cannot tell them apart, and neither can the export.";
    }
  }

  if (field.maxLength !== undefined) {
    if (field.kind !== "short-text" && field.kind !== "long-text") {
      return "A character limit only means something on a text answer.";
    }
    if (!Number.isInteger(field.maxLength) || field.maxLength < 1) {
      return "A character limit has to be a whole number of characters.";
    }
    const ceiling = MAX_ANSWER_LENGTH[field.kind];
    if (field.maxLength > ceiling) {
      return `A ${field.kind === "long-text" ? "paragraph" : "short answer"} cannot be longer than ${ceiling} characters.`;
    }
  }

  /**
   * The rule worth stating out loud: consent that cannot be withheld is not
   * consent. A required consent box is a dark pattern with a checkbox on it,
   * and in several jurisdictions it does not constitute consent at all — so
   * this is refused rather than warned about.
   *
   * A consent *sub-question* is exempt, and the exemption is not a loophole:
   * it is reached only by choosing the parent answer that reveals it, so it can
   * still be declined — one question earlier. `effectiveRequired` carries the
   * full argument, and forces it required rather than merely allowing it.
   */
  if (field.kind === "consent" && field.required && !field.showIf) {
    return (
      "A consent box cannot be required — consent that cannot be withheld is not consent. " +
      "If this is a condition of attending, make it a plain checkbox and say so in the prompt."
    );
  }

  const trigger = field.showIf;
  if (trigger) {
    if (trigger.fieldId === field.id) return "A question cannot be its own trigger.";
    if (siblings.length > 0) {
      const problem = triggerProblem(trigger, siblings);
      if (problem) return problem;
    }
  }

  return undefined;
}

/**
 * The rules a trigger has to satisfy against the rest of the form.
 *
 * Split out because `validateField` checks one field and `validateForm` checks
 * every field, and both need exactly this.
 */
function triggerProblem(trigger: FieldTrigger, fields: FormFieldDef[]): string | undefined {
  const parent = fields.find((f) => f.id === trigger.fieldId);
  if (!parent) {
    return "The question this one depends on is not on the form. Nothing would ever reveal it.";
  }

  /**
   * One level, and it is a decision rather than a limitation of the loop.
   * A chain of conditions is a form whose author cannot see what any given
   * person will be asked, and whose renderer has to resolve an ordering that
   * the flat `fields` array does not express. Whova's own builder is one level;
   * so is this.
   */
  if (parent.showIf) {
    return "A sub-question cannot have sub-questions of its own. Ask it of the parent instead.";
  }

  if (parent.kind === "checkbox" || parent.kind === "consent") {
    /**
     * Only "ticked" may reveal a sub-question. "Not ticked" is the state every
     * form is in before anybody touches it, so a question triggered by it is
     * visible from the start and then vanishes — which reads as a question the
     * form asks of everyone, right up until it does not.
     */
    if (trigger.equals !== "true") {
      return "A tick box can only reveal a question when it is ticked.";
    }
    return undefined;
  }

  if (parent.kind === "choice" || parent.kind === "multi-choice") {
    if (!(parent.options ?? []).includes(trigger.equals)) {
      return "That answer is not one of the parent question's options, so nothing could trigger this.";
    }
    return undefined;
  }

  return "Only a choice or a tick box can reveal a sub-question — free text has no answer to match.";
}

/** One thing wrong with a form, and the field it is wrong on. */
export interface FormProblem {
  /** Absent for a problem with the form as a whole. */
  fieldId?: string;
  problem: string;
}

/**
 * Check a whole form, including the rules a single field cannot see.
 *
 * The editor saves one field at a time, so `validateField` is what usually
 * runs; this is the pass to make before publishing a form or opening a call,
 * where a dangling trigger means a question nobody will ever be shown.
 */
export function validateForm(fields: FormFieldDef[]): FormProblem[] {
  const problems: FormProblem[] = [];

  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.id)) {
      // Two fields sharing an id share an answer column, and neither the form
      // nor the export can tell which one somebody answered.
      problems.push({ fieldId: f.id, problem: "Two questions have the same id." });
    }
    seen.add(f.id);
  }

  for (const f of fields) {
    const problem = validateField(f, fields);
    if (problem) problems.push({ fieldId: f.id, problem });
  }

  const childCount = new Map<string, number>();
  for (const f of fields) {
    const parentId = f.showIf?.fieldId;
    if (!parentId) continue;
    childCount.set(parentId, (childCount.get(parentId) ?? 0) + 1);
  }
  for (const [parentId, count] of childCount) {
    if (count > MAX_SUB_QUESTIONS) {
      problems.push({
        fieldId: parentId,
        problem: `A question can have at most ${MAX_SUB_QUESTIONS} sub-questions; this one has ${count}.`,
      });
    }
  }

  return problems;
}

// ───────────────────────────────────────────────────────────────────────────
// Versioning
// ───────────────────────────────────────────────────────────────────────────

/**
 * ── Why the form is versioned rather than frozen ───────────────────────────
 *
 * Whova freezes the submission form the moment one submission arrives — *"if at
 * least 1 submission has been made you cannot edit the submission form
 * anymore"* — and its own notes call that brutal for a call that runs for
 * months. It is: a typo in question three is then permanent, and adding "which
 * track?" after the tracks are agreed is impossible.
 *
 * `CFA-PLAN.md` §1.2 takes the other route, which `consentForms` already proves
 * in this codebase: the form carries a `version`, every submission stores the
 * `formVersion` it was answered against, and an edit either keeps the version
 * or mints a new one. Adding a question is then free; changing or removing one
 * costs a version and leaves every existing submission pointing at the wording
 * it was actually given.
 *
 * ── Compatible or breaking, and the test that decides ──────────────────────
 *
 * A change is **compatible** when every answer already recorded stays both
 * *valid* and *true*. It is **breaking** when it would make an existing answer
 * wrong, unanswerable, or an answer to a different question.
 *
 * Compatible — the version stands:
 *
 *   - **Adding a field**, required or not. An old submission simply has no
 *     answer for it, which `readRecordedAnswers` reports rather than rejects.
 *     This is the case the whole scheme exists for.
 *   - **Reordering**, and editing `helpText`. Neither changes an answer.
 *   - **Adding an option** to a choice. Every previous answer is still offered.
 *   - **Making a required field optional**, or **raising** a `maxLength`.
 *     Strictly fewer answers are refused than before.
 *   - **Widening `ticketTypeIds`** to more audiences.
 *   - **Changing `visibility`.** No answer changes meaning. ⚠️ It is still a
 *     disclosure decision — widening one moves an answer somebody gave to an
 *     organizer in front of reviewers or the public — so it is reported as a
 *     change even though it does not bump the version. It must appear in the
 *     editor's "what will change" list, not be discovered later.
 *
 * Breaking — a new version:
 *
 *   - **Removing a field.** Its answers become orphaned; the version is what
 *     records that they were once asked for.
 *   - **Changing `kind`.** A string stored for a `short-text` is not an answer
 *     to a `multi-choice`.
 *   - **Changing `prompt`.** The stored answer does not change and what it
 *     answers does. This is the `consentForms` argument exactly: "Jane
 *     consented" is worth nothing without the wording Jane saw, and "Jane
 *     answered yes" is worth nothing without the question.
 *   - **Removing an option.** Existing answers now name something the form does
 *     not offer.
 *   - **Making an optional field required.** Every submission that skipped it
 *     becomes retroactively incomplete against a rule it was never shown.
 *   - **Lowering `maxLength`.** A stored abstract may already be longer.
 *   - **Changing or adding a `showIf` trigger**, or removing one. The answer was
 *     given under a condition that no longer holds, or under none.
 *   - **Narrowing `ticketTypeIds`.** Somebody answered a question their tier is
 *     no longer asked.
 *
 * ⚠️ **A new version does not mint new field ids.** The id is what answers are
 * stored under (AGENTS.md, on `questionForms`), and it is assigned once from
 * the prompt and never regenerated — so a reworded question is the *same* id at
 * a *new* form version, and `fieldsAtVersion` is what recovers the old wording.
 * `diffFields` matches fields by id for that reason: an editor that regenerated
 * an id would show up here as a removal plus an addition, which is two breaking
 * changes and a set of orphaned answers, and that visibility is the safety net.
 */
export interface FormVersionChange {
  fieldId: string;
  /** What changed, in the words the editor should put in front of an organizer. */
  what: string;
  /** Whether this change on its own forces a new version. */
  breaking: boolean;
}

export interface FormVersionPlan {
  /** The version the edited form should be saved with. */
  version: number;
  /** Whether that is a new number. */
  bumped: boolean;
  changes: FormVersionChange[];
}

/** One retired form definition, kept so old submissions can still be read. */
export interface FormVersionSnapshot {
  version: number;
  fields: FormFieldDef[];
  /**
   * When this version stopped being the live one.
   *
   * A native `Date`. ⚠️ Never a Firestore sentinel: three copies of
   * `firebase-admin` exist and a `Timestamp` built in `@kgc/scripts` fails the
   * whole write in `apps/web` (AGENTS.md gotcha 8).
   */
  retiredAt: Date;
}

function sameOptions(a: string[] | undefined, b: string[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function sameTrigger(a: FieldTrigger | undefined, b: FieldTrigger | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.fieldId === b.fieldId && a.equals === b.equals;
}

/**
 * Every difference between two form definitions, classified.
 *
 * Matched by id, never by position or prompt — see the ⚠️ above.
 */
export function diffFields(before: FormFieldDef[], after: FormFieldDef[]): FormVersionChange[] {
  const changes: FormVersionChange[] = [];
  const previous = new Map(before.map((f) => [f.id, f]));
  const current = new Map(after.map((f) => [f.id, f]));

  for (const f of after) {
    if (!previous.has(f.id)) {
      changes.push({
        fieldId: f.id,
        what: `Added “${f.prompt}”. Submissions already made simply have no answer to it.`,
        breaking: false,
      });
    }
  }

  for (const was of before) {
    const now = current.get(was.id);
    if (!now) {
      changes.push({
        fieldId: was.id,
        what: `Removed “${was.prompt}”. Answers already given to it are kept and stop being asked for.`,
        breaking: true,
      });
      continue;
    }

    if (was.kind !== now.kind) {
      changes.push({
        fieldId: was.id,
        what: `“${was.prompt}” changed from ${was.kind} to ${now.kind}. Answers already stored are of the old shape.`,
        breaking: true,
      });
    }

    if (was.prompt !== now.prompt) {
      changes.push({
        fieldId: was.id,
        what: `Reworded to “${now.prompt}”. Existing answers stay, and stay answers to the old wording.`,
        breaking: true,
      });
    }

    if (!sameOptions(was.options, now.options)) {
      const removed = (was.options ?? []).filter((o) => !(now.options ?? []).includes(o));
      changes.push(
        removed.length > 0
          ? {
              fieldId: was.id,
              what: `Removed the option${removed.length > 1 ? "s" : ""} ${removed
                .map((o) => `“${o}”`)
                .join(", ")} from “${was.prompt}”. Some answers already name ${
                removed.length > 1 ? "them" : "it"
              }.`,
              breaking: true,
            }
          : {
              fieldId: was.id,
              what: `Added options to “${was.prompt}”.`,
              breaking: false,
            },
      );
    }

    if (was.required !== now.required) {
      changes.push(
        now.required
          ? {
              fieldId: was.id,
              what: `“${was.prompt}” is now required. Submissions that skipped it were never shown that rule.`,
              breaking: true,
            }
          : {
              fieldId: was.id,
              what: `“${was.prompt}” is now optional.`,
              breaking: false,
            },
      );
    }

    if (!sameTrigger(was.showIf, now.showIf)) {
      changes.push({
        fieldId: was.id,
        what: `Changed what reveals “${was.prompt}”. Existing answers were given under the old condition.`,
        breaking: true,
      });
    }

    const wasMax = maxAnswerLength(was);
    const nowMax = maxAnswerLength(now);
    if (wasMax !== nowMax) {
      changes.push(
        nowMax < wasMax
          ? {
              fieldId: was.id,
              what: `Shortened “${was.prompt}” to ${nowMax} characters. Answers already given may be longer.`,
              breaking: true,
            }
          : {
              fieldId: was.id,
              what: `Lengthened “${was.prompt}” to ${nowMax} characters.`,
              breaking: false,
            },
      );
    }

    const wasTiers = was.ticketTypeIds ?? [];
    const nowTiers = now.ticketTypeIds ?? [];
    if (!sameOptions(wasTiers, nowTiers)) {
      /**
       * Empty means "everybody", so it is the **widest** possible set rather
       * than the narrowest. Reading it as an ordinary list gets this exactly
       * backwards and calls every relaxation a breaking change — which would
       * mint a version every time an organizer stopped restricting a question.
       */
      const narrowed =
        nowTiers.length > 0 &&
        (wasTiers.length === 0 || wasTiers.some((t) => !nowTiers.includes(t)));
      changes.push({
        fieldId: was.id,
        what: narrowed
          ? `“${was.prompt}” is asked of fewer audiences than before.`
          : `“${was.prompt}” is asked of more audiences than before.`,
        breaking: narrowed,
      });
    }

    if ((was.visibility ?? "organizers") !== (now.visibility ?? "organizers")) {
      // Not breaking — no answer changes meaning — but never silent. Widening
      // one moves an answer somebody gave in confidence in front of a new
      // audience, and that belongs in front of the organizer making the edit.
      changes.push({
        fieldId: was.id,
        what: `Answers to “${was.prompt}” are now visible to ${now.visibility ?? "organizers"}.`,
        breaking: false,
      });
    }

    if ((was.helpText ?? "") !== (now.helpText ?? "")) {
      changes.push({ fieldId: was.id, what: `Changed the help text on “${was.prompt}”.`, breaking: false });
    }

    if (was.order !== now.order) {
      changes.push({ fieldId: was.id, what: `Moved “${was.prompt}”.`, breaking: false });
    }
  }

  return changes;
}

/** Whether a set of changes forces a new version. */
export function hasBreakingChange(changes: FormVersionChange[]): boolean {
  return changes.some((c) => c.breaking);
}

/**
 * What version an edited form should be saved with, and why.
 *
 * The editor calls this before writing and shows `changes` to the organizer:
 * "this adds a question, and everything already submitted keeps its answers" is
 * a different sentence from "this reworks question three, and 41 submissions
 * will stay pinned to the old wording". Whova can show neither, because Whova
 * refuses the edit.
 *
 * ⚠️ The version is bumped **once** for a batch of edits, however many breaking
 * changes it contains. A version is a snapshot of the form, not a counter of
 * edits, and an organizer who fixes four questions in one sitting should not
 * scatter their submissions across four versions none of which anyone read.
 */
export function planFormVersion(
  before: FormFieldDef[],
  after: FormFieldDef[],
  currentVersion: number,
): FormVersionPlan {
  const changes = diffFields(before, after);
  const bumped = hasBreakingChange(changes);
  return { version: bumped ? currentVersion + 1 : currentVersion, bumped, changes };
}

/**
 * The definition to archive when a breaking edit mints a new version.
 *
 * Without this the version number names wording nobody kept, which is the
 * failure `consentForms.bodyHash` exists to prevent one layer down. `at`
 * defaults to now and is a native `Date` — see `FormVersionSnapshot.retiredAt`.
 */
export function retireVersion(
  fields: FormFieldDef[],
  version: number,
  at: Date = new Date(),
): FormVersionSnapshot {
  // Copied, not referenced: the caller is about to mutate the array it just
  // handed over, and an archive that changes with the live form archives
  // nothing.
  return { version, fields: fields.map((f) => ({ ...f })), retiredAt: at };
}

/**
 * The form as it stood at one version.
 *
 * ── Falls back to the current definition rather than failing ───────────────
 *
 * A submission naming a version that is not in the archive is a bug or a
 * hand-edit, and the useful response is to show the committee the submission
 * against today's questions with a caveat, not to refuse to render it. That is
 * safe here precisely because `readRecordedAnswers` judges nothing: the worst
 * case is an answer displayed under a slightly different prompt, not an answer
 * rejected.
 */
export function fieldsAtVersion(
  current: { version: number; fields: FormFieldDef[] },
  history: FormVersionSnapshot[],
  version: number,
): FormFieldDef[] {
  if (version === current.version) return current.fields;
  return history.find((h) => h.version === version)?.fields ?? current.fields;
}
