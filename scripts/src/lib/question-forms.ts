import type { QuestionFieldDef } from "@kgc/shared";

/**
 * Registration question forms: the parts both websites need.
 *
 * Lives in `@kgc/scripts` for the same reason `ensureRegistration` and the
 * email templates do — `apps/web` renders the form and `apps/organizer` edits
 * it, and neither can import the other. A second copy of `validateAnswers`
 * would mean the organizer's preview accepting something the checkout rejects,
 * or worse, the reverse.
 *
 * ── No Firestore, no sentinels, nothing async ──────────────────────────────
 *
 * Pure functions over plain data. That is deliberate twice over: it keeps this
 * testable by Vitest (`server-only` throws outside a Server Component), and it
 * keeps it clear of the rule that no Firestore sentinel may be constructed
 * inside this package — three copies of `firebase-admin` exist and sentinels do
 * not cross them.
 */

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
export function appliesToTier(field: QuestionFieldDef, ticketTypeId: string): boolean {
  const only = field.ticketTypeIds ?? [];
  return only.length === 0 || only.includes(ticketTypeId);
}

/** The fields a buyer of one tier actually sees, in order. */
export function fieldsForTier(
  fields: QuestionFieldDef[],
  ticketTypeId: string,
): QuestionFieldDef[] {
  return fields
    .filter((f) => appliesToTier(f, ticketTypeId))
    .sort((a, b) => a.order - b.order || a.prompt.localeCompare(b.prompt));
}

export type AnswerValue = string | string[] | boolean;

export interface ValidationResult {
  ok: boolean;
  /** Field id → the problem, for rendering beside the input. */
  errors: Record<string, string>;
  /** Only the fields that apply, cleaned. Safe to write. */
  answers: Record<string, AnswerValue>;
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
 * directions.
 *
 * ── An empty optional answer is absent, not an empty string ────────────────
 *
 * `""` in an export column reads as "they answered nothing", which is different
 * from "we did not ask". The distinction matters at a catering headcount.
 */
export function validateAnswers(
  fields: QuestionFieldDef[],
  ticketTypeId: string,
  raw: Record<string, AnswerValue | undefined>,
): ValidationResult {
  const errors: Record<string, string> = {};
  const answers: Record<string, AnswerValue> = {};

  for (const f of fieldsForTier(fields, ticketTypeId)) {
    const value = raw[f.id];

    if (f.kind === "checkbox" || f.kind === "consent") {
      const checked = value === true || value === "on" || value === "true";
      /**
       * A required consent is refused by the editor, so this only ever fires
       * for a required plain checkbox — "I have read the code of conduct",
       * which is a legitimate gate. Consent that cannot be withheld is not
       * consent, and the editor is where that argument is enforced.
       */
      if (f.required && !checked) {
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
      if (f.required && picked.length === 0) {
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
      if (f.required && !text) {
        errors[f.id] = "Choose one.";
        continue;
      }
      if (text) answers[f.id] = text;
      continue;
    }

    if (f.required && !text) {
      errors[f.id] = "This is required.";
      continue;
    }

    /**
     * A cap, so one field cannot carry a document-sized payload.
     *
     * Firestore's own limit is a megabyte per document, and the registration
     * has to stay small — the app reads it on every cold start.
     */
    const max = f.kind === "long-text" ? 2000 : 200;
    if (text.length > max) {
      errors[f.id] = `Keep this under ${max} characters.`;
      continue;
    }

    if (text) answers[f.id] = text;
  }

  return { ok: Object.keys(errors).length === 0, errors, answers };
}

/**
 * Refuse a field definition that cannot work.
 *
 * Called by the organizer's editor before saving. Every rule here is one that
 * produces a broken *public* form if it slips through, which is the worst place
 * to discover it.
 */
export function validateField(field: Partial<QuestionFieldDef>): string | undefined {
  const prompt = (field.prompt ?? "").trim();
  if (prompt.length < 3) return "Give the question a prompt.";
  if (prompt.length > 200) return "That prompt is too long to read on a phone.";

  if (field.kind === "choice" || field.kind === "multi-choice") {
    const options = (field.options ?? []).filter((o) => o.trim());
    if (options.length < 2) return "A choice needs at least two options.";
    if (new Set(options.map((o) => o.trim().toLowerCase())).size !== options.length) {
      return "Two options are the same. A buyer cannot tell them apart, and neither can the export.";
    }
  }

  /**
   * The rule worth stating out loud: consent that cannot be withheld is not
   * consent. A required consent box is a dark pattern with a checkbox on it,
   * and in several jurisdictions it does not constitute consent at all — so
   * this is refused rather than warned about.
   */
  if (field.kind === "consent" && field.required) {
    return (
      "A consent box cannot be required — consent that cannot be withheld is not consent. " +
      "If this is a condition of attending, make it a plain checkbox and say so in the prompt."
    );
  }

  return undefined;
}
