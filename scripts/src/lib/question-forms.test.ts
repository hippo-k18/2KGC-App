import { describe, expect, it } from "vitest";
import type { QuestionFieldDef } from "@kgc/shared";
import {
  canSee,
  effectiveRequired,
  fieldsAtVersion,
  fieldsForTier,
  MAX_SUB_QUESTIONS,
  planFormVersion,
  redactAnswers,
  retireVersion,
  validateAnswers,
  validateField,
  validateForm,
  type FormFieldDef,
} from "./question-forms.js";

/**
 * The registration question validator.
 *
 * Tested here rather than through either website because this module gates the
 * purchase path — `startCheckout` refuses a purchase whose answers fail it — and
 * because it is the one piece both apps share. A regression here is either a
 * conference that cannot sell tickets or a consent box that records a default
 * as a decision, and each test is named after the guarantee it protects.
 *
 * `server-only` is deliberately absent from the module under test. It throws
 * outside a React Server Component, which would make the part with all the edge
 * cases the only part that cannot be tested.
 */

function field(over: Partial<QuestionFieldDef> = {}): QuestionFieldDef {
  return {
    id: "q",
    prompt: "A question",
    kind: "short-text",
    required: false,
    order: 0,
    ...over,
  };
}

describe("a buyer cannot be blocked by a question their tier does not ask", () => {
  it("drops answers to fields restricted to other tiers rather than rejecting them", () => {
    const fields = [
      field({ id: "workshop", ticketTypeIds: ["workshops"], required: true }),
      field({ id: "role" }),
    ];

    // Filled in the browser, then the buyer switched to a tier that does not
    // ask it. Rejecting would block a legitimate purchase; keeping would store
    // an answer to a question never asked of them.
    const result = validateAnswers(fields, "virtual", {
      workshop: "Advanced",
      role: "Engineer",
    });

    expect(result.ok).toBe(true);
    expect(result.answers).toEqual({ role: "Engineer" });
  });

  it("asks an unrestricted field of every tier", () => {
    const fields = [field({ id: "role" }), field({ id: "w", ticketTypeIds: ["workshops"] })];
    expect(fieldsForTier(fields, "virtual").map((f) => f.id)).toEqual(["role"]);
    expect(fieldsForTier(fields, "workshops").map((f) => f.id)).toEqual(["role", "w"]);
  });
});

describe("a required question is actually required", () => {
  it("rejects an empty required text answer", () => {
    const result = validateAnswers([field({ id: "name", required: true })], "t", { name: "  " });
    expect(result.ok).toBe(false);
    expect(result.errors.name).toBeTruthy();
  });

  it("rejects a required checkbox that was not ticked", () => {
    const result = validateAnswers(
      [field({ id: "coc", kind: "checkbox", required: true })],
      "t",
      {},
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a required multi-choice with nothing chosen", () => {
    const result = validateAnswers(
      [field({ id: "diet", kind: "multi-choice", options: ["a", "b"], required: true })],
      "t",
      {},
    );
    expect(result.ok).toBe(false);
  });
});

describe("an answer that was never offered is refused", () => {
  it("rejects a choice value outside the option list", () => {
    const fields = [field({ id: "role", kind: "choice", options: ["Engineer", "Student"] })];
    // Anything that can POST can post a value the select never contained.
    const result = validateAnswers(fields, "t", { role: "Administrator" });
    expect(result.ok).toBe(false);
  });

  it("silently discards multi-choice values outside the option list", () => {
    const fields = [
      field({ id: "diet", kind: "multi-choice", options: ["Vegan", "Halal"] }),
    ];
    const result = validateAnswers(fields, "t", { diet: ["Vegan", "injected"] });
    expect(result.ok).toBe(true);
    expect(result.answers.diet).toEqual(["Vegan"]);
  });
});

describe("an unanswered optional question is absent, not empty", () => {
  it("omits an empty optional text field rather than storing an empty string", () => {
    const result = validateAnswers([field({ id: "note" })], "t", { note: "" });
    expect(result.ok).toBe(true);
    // `""` in an export column reads as "they answered nothing", which is
    // different from "we did not ask". That difference matters at a headcount.
    expect(Object.keys(result.answers)).toEqual([]);
  });

  it("omits an unticked optional checkbox rather than storing false", () => {
    const result = validateAnswers([field({ id: "photos", kind: "consent" })], "t", {});
    expect(result.answers).toEqual({});
  });

  it("stores a ticked box as true", () => {
    const result = validateAnswers([field({ id: "photos", kind: "consent" })], "t", {
      photos: "on",
    });
    expect(result.answers).toEqual({ photos: true });
  });
});

describe("one answer cannot carry a document-sized payload", () => {
  it("caps short text at 200 characters", () => {
    const result = validateAnswers([field({ id: "s" })], "t", { s: "x".repeat(201) });
    expect(result.ok).toBe(false);
  });

  it("allows long text up to 2000", () => {
    const result = validateAnswers([field({ id: "l", kind: "long-text" })], "t", {
      l: "x".repeat(2000),
    });
    expect(result.ok).toBe(true);
  });
});

describe("the editor refuses definitions that would break the public form", () => {
  it("refuses a required consent box", () => {
    // Consent that cannot be withheld is not consent, and in several
    // jurisdictions does not constitute it at all.
    expect(validateField({ prompt: "Marketing?", kind: "consent", required: true })).toBeTruthy();
  });

  it("allows an optional consent box", () => {
    expect(
      validateField({ prompt: "Marketing?", kind: "consent", required: false }),
    ).toBeUndefined();
  });

  it("allows a required plain checkbox, which is a gate rather than a consent", () => {
    expect(
      validateField({ prompt: "I have read the code of conduct", kind: "checkbox", required: true }),
    ).toBeUndefined();
  });

  it("refuses a choice with fewer than two options", () => {
    expect(validateField({ prompt: "Pick one", kind: "choice", options: ["only"] })).toBeTruthy();
  });

  it("refuses duplicate options, which no export could tell apart", () => {
    expect(
      validateField({ prompt: "Pick one", kind: "choice", options: ["Vegan", " vegan "] }),
    ).toBeTruthy();
  });

  it("refuses a prompt too short to be a question", () => {
    expect(validateField({ prompt: "?", kind: "short-text" })).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The call for abstracts
//
// Everything below covers what `CFA-PLAN.md` Phase 1 needed on top of the
// registration form, and nothing above it changed. That is the point of the
// arrangement: one builder, one validator, and a registration form that
// behaves today exactly as it did before the abstracts work landed.
// ───────────────────────────────────────────────────────────────────────────

function formField(over: Partial<FormFieldDef> = {}): FormFieldDef {
  return {
    id: "q",
    prompt: "A question",
    kind: "short-text",
    required: false,
    order: 0,
    ...over,
  };
}

describe("a description is text on the page, not a question", () => {
  it("collects no answer, even when one is posted under its id", () => {
    const fields = [formField({ id: "note", kind: "description", prompt: "Read this first." })];
    const result = validateAnswers(fields, "t", { note: "anything" });
    expect(result.ok).toBe(true);
    expect(result.answers).toEqual({});
  });

  it("cannot block a submission by being marked required", () => {
    // `required` on something that collects nothing would be a form that can
    // never be completed, so it is ignored at submit and refused at edit.
    const fields = [formField({ id: "note", kind: "description", required: true })];
    expect(validateAnswers(fields, "t", {}).ok).toBe(true);
    expect(validateField({ prompt: "Read this first.", kind: "description", required: true })).toBeTruthy();
  });

  it("is allowed a paragraph of text where a question prompt is not", () => {
    const paragraph = "Instructions. ".repeat(30);
    expect(validateField({ prompt: paragraph, kind: "description" })).toBeUndefined();
    expect(validateField({ prompt: paragraph, kind: "short-text" })).toBeTruthy();
  });
});

describe("an abstract has a configurable limit and a ceiling", () => {
  it("keeps the 2,000-character default for a paragraph that sets no limit", () => {
    const fields = [formField({ id: "l", kind: "long-text" })];
    expect(validateAnswers(fields, "t", { l: "x".repeat(2000) }).ok).toBe(true);
    expect(validateAnswers(fields, "t", { l: "x".repeat(2001) }).ok).toBe(false);
  });

  it("enforces the organizer's limit when one is set", () => {
    const fields = [formField({ id: "summary", kind: "long-text", maxLength: 300 })];
    expect(validateAnswers(fields, "t", { summary: "x".repeat(300) }).ok).toBe(true);
    const tooLong = validateAnswers(fields, "t", { summary: "x".repeat(301) });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.errors.summary).toContain("300");
  });

  it("accepts a 10,000-character abstract and refuses a limit above it", () => {
    const fields = [formField({ id: "summary", kind: "long-text", maxLength: 10_000 })];
    expect(validateAnswers(fields, "t", { summary: "x".repeat(10_000) }).ok).toBe(true);
    expect(
      validateField({ prompt: "Your abstract", kind: "long-text", maxLength: 10_001 }),
    ).toBeTruthy();
  });

  it("refuses a character limit on something with no characters in it", () => {
    expect(
      validateField({ prompt: "Pick one", kind: "choice", options: ["a", "b"], maxLength: 50 }),
    ).toBeTruthy();
  });
});

describe("a sub-question is asked only of whoever triggers it", () => {
  const parent = formField({
    id: "recorded",
    prompt: "May we record your talk?",
    kind: "choice",
    options: ["Yes", "No"],
    order: 0,
  });
  const child = formField({
    id: "recording-note",
    prompt: "Anything we should stop recording?",
    order: 1,
    showIf: { fieldId: "recorded", equals: "Yes" },
  });

  it("renders directly under its parent, whatever its order says", () => {
    const late = { ...child, order: 99 };
    const other = formField({ id: "other", prompt: "Another question", order: 5 });
    expect(fieldsForTier([parent, other, late], "t").map((f) => f.id)).toEqual([
      "recorded",
      "recording-note",
      "other",
    ]);
  });

  it("is dropped rather than rejected when the trigger was not met", () => {
    // The submitter answered it, then changed the parent answer. Same argument
    // as a buyer switching tier: they have done nothing wrong.
    const required = { ...child, required: true };
    const result = validateAnswers([parent, required], "t", {
      recorded: "No",
      "recording-note": "something typed earlier",
    });
    expect(result.ok).toBe(true);
    expect(result.answers).toEqual({ recorded: "No" });
  });

  it("is asked, and stored, when the trigger is met", () => {
    const result = validateAnswers([parent, child], "t", {
      recorded: "Yes",
      "recording-note": "The Q&A",
    });
    expect(result.ok).toBe(true);
    expect(result.answers).toEqual({ recorded: "Yes", "recording-note": "The Q&A" });
  });

  it("inherits the parent's required setting rather than carrying its own", () => {
    const requiredParent = { ...parent, required: true };
    // Defined as optional; the parent is required, so it is required too.
    const result = validateAnswers([requiredParent, child], "t", { recorded: "Yes" });
    expect(result.ok).toBe(false);
    expect(result.errors["recording-note"]).toBeTruthy();

    // And the reverse: an optional parent makes its sub-questions optional,
    // however they were defined.
    const stubborn = { ...child, required: true };
    expect(validateAnswers([parent, stubborn], "t", { recorded: "Yes" }).ok).toBe(true);
  });

  it("follows a multi-choice parent by membership, not equality", () => {
    const tracks = formField({
      id: "tracks",
      kind: "multi-choice",
      options: ["Industry", "Research"],
      order: 0,
    });
    const followUp = formField({
      id: "peer-review",
      order: 1,
      showIf: { fieldId: "tracks", equals: "Research" },
    });
    const picked = validateAnswers([tracks, followUp], "t", {
      tracks: ["Industry", "Research"],
      "peer-review": "Yes",
    });
    expect(picked.answers["peer-review"]).toBe("Yes");

    const notPicked = validateAnswers([tracks, followUp], "t", {
      tracks: ["Industry"],
      "peer-review": "Yes",
    });
    expect(notPicked.answers["peer-review"]).toBeUndefined();
  });

  it("disappears with a parent the tier does not ask", () => {
    const tierOnly = { ...parent, ticketTypeIds: ["speaker"] };
    expect(fieldsForTier([tierOnly, child], "attendee").map((f) => f.id)).toEqual([]);
    expect(validateAnswers([tierOnly, child], "attendee", { "recording-note": "x" }).answers).toEqual({});
  });
});

describe("a consent sub-question is always required of whoever triggers it", () => {
  /**
   * The exception that is easiest to lose, and the reason it is not a
   * contradiction of "a consent box cannot be required": the decline is one
   * question further up. Answer "No" to the parent and the consent is never
   * asked; answer "Yes" and it is the condition of that answer.
   */
  const parent = formField({
    id: "recorded",
    prompt: "May we record your talk?",
    kind: "choice",
    options: ["Yes", "No"],
    required: false,
    order: 0,
  });
  const consent = formField({
    id: "recording-consent",
    prompt: "I agree to the recording being published.",
    kind: "consent",
    required: false,
    order: 1,
    showIf: { fieldId: "recorded", equals: "Yes" },
  });

  it("is required even though it is defined optional and its parent is optional", () => {
    const result = validateAnswers([parent, consent], "t", { recorded: "Yes" });
    expect(result.ok).toBe(false);
    expect(result.errors["recording-consent"]).toBeTruthy();
    expect(effectiveRequired(consent, parent)).toBe(true);
  });

  it("passes once it is ticked", () => {
    const result = validateAnswers([parent, consent], "t", { recorded: "Yes", "recording-consent": "on" });
    expect(result.ok).toBe(true);
    expect(result.answers["recording-consent"]).toBe(true);
  });

  it("is not asked at all of somebody who did not trigger it", () => {
    // This is the decline. It has to exist, or the consent is not consent.
    const result = validateAnswers([parent, consent], "t", { recorded: "No" });
    expect(result.ok).toBe(true);
    expect(result.answers["recording-consent"]).toBeUndefined();
  });

  it("is the one consent the editor allows to be required", () => {
    expect(validateField({ ...consent, required: true }, [parent, consent])).toBeUndefined();
    // The top-level rule is untouched: still refused, for the same reason.
    expect(
      validateField({ prompt: "I agree to the recording.", kind: "consent", required: true }),
    ).toBeTruthy();
  });

  it("does not extend the exception to a plain checkbox sub-question", () => {
    const box = { ...consent, id: "box", kind: "checkbox" as const };
    // A checkbox inherits like everything else — the parent here is optional.
    expect(effectiveRequired(box, parent)).toBe(false);
    expect(validateAnswers([parent, box], "t", { recorded: "Yes" }).ok).toBe(true);
  });
});

describe("the editor refuses branching that could not work", () => {
  const parent = formField({ id: "p", kind: "choice", options: ["Yes", "No"], order: 0 });

  it("refuses a trigger on a question that is not on the form", () => {
    const orphan = formField({ id: "c", order: 1, showIf: { fieldId: "gone", equals: "Yes" } });
    expect(validateField(orphan, [parent, orphan])).toBeTruthy();
  });

  it("refuses a trigger on an answer the parent does not offer", () => {
    const child = formField({ id: "c", order: 1, showIf: { fieldId: "p", equals: "Maybe" } });
    expect(validateField(child, [parent, child])).toBeTruthy();
  });

  it("refuses a trigger on free text, which has no answer to match", () => {
    const text = formField({ id: "t", kind: "long-text", order: 0 });
    const child = formField({ id: "c", order: 1, showIf: { fieldId: "t", equals: "yes" } });
    expect(validateField(child, [text, child])).toBeTruthy();
  });

  it("refuses a tick box that reveals a question by being unticked", () => {
    // Unticked is the state the form starts in, so the question would be
    // visible before anybody has touched it and then vanish.
    const box = formField({ id: "b", kind: "checkbox", order: 0 });
    const child = formField({ id: "c", order: 1, showIf: { fieldId: "b", equals: "false" } });
    expect(validateField(child, [box, child])).toBeTruthy();
    expect(
      validateField({ ...child, showIf: { fieldId: "b", equals: "true" } }, [box, child]),
    ).toBeUndefined();
  });

  it("refuses a question that is its own trigger", () => {
    const self = formField({ id: "c", showIf: { fieldId: "c", equals: "Yes" } });
    expect(validateField(self)).toBeTruthy();
  });

  it("refuses a second level of nesting", () => {
    const child = formField({ id: "c", order: 1, showIf: { fieldId: "p", equals: "Yes" } });
    const grandchild = formField({ id: "g", order: 2, showIf: { fieldId: "c", equals: "x" } });
    expect(validateField(grandchild, [parent, child, grandchild])).toBeTruthy();
  });

  it("refuses more than five sub-questions on one parent", () => {
    const kids = Array.from({ length: MAX_SUB_QUESTIONS + 1 }, (_, i) =>
      formField({ id: `c${i}`, order: i + 1, showIf: { fieldId: "p", equals: "Yes" } }),
    );
    const problems = validateForm([parent, ...kids]);
    expect(problems.some((p) => p.problem.includes(String(MAX_SUB_QUESTIONS)))).toBe(true);

    const five = kids.slice(0, MAX_SUB_QUESTIONS);
    expect(validateForm([parent, ...five])).toEqual([]);
  });

  it("refuses two questions sharing an id, which would share an answer column", () => {
    const a = formField({ id: "same", prompt: "First question" });
    const b = formField({ id: "same", prompt: "Second question" });
    expect(validateForm([a, b]).length).toBeGreaterThan(0);
  });
});

describe("who can see this question", () => {
  const publicField = formField({ id: "title", visibility: "public" });
  const reviewerField = formField({ id: "budget", visibility: "reviewers" });
  const organizerField = formField({ id: "phone" });

  it("defaults to organizers only, which is where every answer stands today", () => {
    expect(canSee(organizerField, "organizer")).toBe(true);
    expect(canSee(organizerField, "reviewer")).toBe(false);
    expect(canSee(organizerField, "public")).toBe(false);
  });

  it("lets each reader see everything at or below their level", () => {
    expect(canSee(publicField, "public")).toBe(true);
    expect(canSee(reviewerField, "public")).toBe(false);
    expect(canSee(reviewerField, "reviewer")).toBe(true);
    expect(canSee(reviewerField, "organizer")).toBe(true);
  });

  it("gives a sub-question its parent's visibility, not its own", () => {
    const parent = formField({ id: "p", kind: "choice", options: ["Yes", "No"], visibility: "public" });
    const child = formField({
      id: "c",
      order: 1,
      visibility: "organizers",
      showIf: { fieldId: "p", equals: "Yes" },
    });
    expect(canSee(child, "public", [parent, child])).toBe(true);
  });

  it("strips the answers a reader may not see, and orphans with them", () => {
    const fields = [publicField, reviewerField, organizerField];
    const answers = { title: "A talk", budget: "None", phone: "07", gone: "old answer" };
    expect(redactAnswers(fields, answers, "public")).toEqual({ title: "A talk" });
    expect(redactAnswers(fields, answers, "reviewer")).toEqual({ title: "A talk", budget: "None" });
    expect(redactAnswers(fields, answers, "organizer")).toEqual({
      title: "A talk",
      budget: "None",
      phone: "07",
    });
  });
});

describe("the form is versioned rather than frozen by its first submission", () => {
  const before: FormFieldDef[] = [
    formField({ id: "title", prompt: "Title of your talk", required: true, order: 0 }),
    formField({ id: "track", kind: "choice", options: ["Industry", "Research"], order: 1 }),
  ];

  it("adds a question without minting a version", () => {
    // The whole point. Whova refuses this edit outright.
    const after = [...before, formField({ id: "notes", prompt: "Anything else?", order: 2 })];
    const plan = planFormVersion(before, after, 3);
    expect(plan.bumped).toBe(false);
    expect(plan.version).toBe(3);
    expect(plan.changes.every((c) => !c.breaking)).toBe(true);
  });

  it("adds a required question without minting a version either", () => {
    // Nobody who already submitted can go back and answer it, so it cannot
    // invalidate them — it is reported as outstanding instead.
    const after = [...before, formField({ id: "bio", required: true, order: 2 })];
    expect(planFormVersion(before, after, 1).bumped).toBe(false);
  });

  it("mints a version when a question is removed", () => {
    const plan = planFormVersion(before, [before[0]], 1);
    expect(plan.bumped).toBe(true);
    expect(plan.version).toBe(2);
  });

  it("mints a version when a question is reworded", () => {
    // The stored answer does not change and what it answers does — the same
    // argument `consentForms` makes about wording somebody actually read.
    const after = [{ ...before[0], prompt: "Working title" }, before[1]];
    expect(planFormVersion(before, after, 1).bumped).toBe(true);
  });

  it("mints a version when a question changes kind", () => {
    const after = [{ ...before[0], kind: "long-text" as const }, before[1]];
    expect(planFormVersion(before, after, 1).bumped).toBe(true);
  });

  it("mints a version when an option is removed, and not when one is added", () => {
    const removed = [before[0], { ...before[1], options: ["Industry"] }];
    expect(planFormVersion(before, removed, 1).bumped).toBe(true);

    const added = [before[0], { ...before[1], options: ["Industry", "Research", "Posters"] }];
    expect(planFormVersion(before, added, 1).bumped).toBe(false);
  });

  it("mints a version when a question becomes required, and not when it relaxes", () => {
    const tightened = [before[0], { ...before[1], required: true }];
    expect(planFormVersion(before, tightened, 1).bumped).toBe(true);

    const relaxed = [{ ...before[0], required: false }, before[1]];
    expect(planFormVersion(before, relaxed, 1).bumped).toBe(false);
  });

  it("mints a version when a limit is lowered, and not when it is raised", () => {
    const base = [formField({ id: "summary", kind: "long-text", maxLength: 5000 })];
    const shorter = [{ ...base[0], maxLength: 1000 }];
    const longer = [{ ...base[0], maxLength: 8000 }];
    expect(planFormVersion(base, shorter, 1).bumped).toBe(true);
    expect(planFormVersion(base, longer, 1).bumped).toBe(false);
  });

  it("mints a version when a trigger changes", () => {
    const base = [
      formField({ id: "p", kind: "choice", options: ["Yes", "No"], order: 0 }),
      formField({ id: "c", order: 1, showIf: { fieldId: "p", equals: "Yes" } }),
    ];
    const rewired = [base[0], { ...base[1], showIf: { fieldId: "p", equals: "No" } }];
    expect(planFormVersion(base, rewired, 1).bumped).toBe(true);
  });

  it("mints a version when a question is asked of fewer audiences, not more", () => {
    const narrowed = [{ ...before[0], ticketTypeIds: ["speaker"] }, before[1]];
    expect(planFormVersion(before, narrowed, 1).bumped).toBe(true);
    // And back the other way — everybody is the widest set, not the narrowest.
    expect(planFormVersion(narrowed, before, 2).bumped).toBe(false);
  });

  it("reports a visibility change without minting a version", () => {
    // No answer changes meaning, so the version stands — but widening one puts
    // an answer in front of a new audience, and that belongs on screen.
    const after = [{ ...before[0], visibility: "public" as const }, before[1]];
    const plan = planFormVersion(before, after, 1);
    expect(plan.bumped).toBe(false);
    expect(plan.changes.some((c) => c.what.includes("visible to public"))).toBe(true);
  });

  it("treats moving and re-wording the help text as cosmetic", () => {
    const after = [
      { ...before[0], order: 5, helpText: "As it will appear in the programme" },
      before[1],
    ];
    const plan = planFormVersion(before, after, 4);
    expect(plan.bumped).toBe(false);
    expect(plan.changes.length).toBe(2);
  });

  it("bumps once for a batch of edits, however many break", () => {
    // A version is a snapshot of the form, not a count of edits. An organizer
    // fixing four questions in one sitting must not scatter their submissions
    // across four versions nobody ever read.
    const after = [
      { ...before[0], prompt: "Working title", required: false },
      { ...before[1], kind: "multi-choice" as const, options: ["Industry"] },
    ];
    const plan = planFormVersion(before, after, 7);
    expect(plan.version).toBe(8);
    expect(plan.changes.filter((c) => c.breaking).length).toBeGreaterThan(1);
  });

  it("shows a regenerated field id as a removal and an addition", () => {
    /**
     * ⚠️ Ids are assigned once and never regenerated — the id is what answers
     * are stored under. Nothing here can stop an editor doing it, so the
     * safety net is that it is loud: the diff reads as losing a question and
     * gaining one, which is breaking, and the orphaned answers show up in
     * every stale read afterwards.
     */
    const renamed = [{ ...before[0], id: "working-title" }, before[1]];
    const plan = planFormVersion(before, renamed, 1);
    expect(plan.bumped).toBe(true);
    expect(plan.changes.filter((c) => c.fieldId === "title" || c.fieldId === "working-title").length).toBe(2);
  });
});

describe("an archived version is what makes an old submission readable", () => {
  const v1 = [formField({ id: "title", prompt: "Title of your talk" })];
  const v2 = [formField({ id: "title", prompt: "Working title" })];

  it("keeps a native Date, never a Firestore sentinel", () => {
    // Three copies of firebase-admin exist and a Timestamp built here fails the
    // whole write in apps/web. AGENTS.md gotcha 8.
    const at = new Date("2026-09-01T10:00:00Z");
    expect(retireVersion(v1, 1, at).retiredAt).toBeInstanceOf(Date);
    expect(retireVersion(v1, 1).retiredAt).toBeInstanceOf(Date);
  });

  it("copies the fields rather than referencing the live array", () => {
    const live = [formField({ id: "title", prompt: "Title of your talk" })];
    const snapshot = retireVersion(live, 1);
    live[0].prompt = "Edited after archiving";
    expect(snapshot.fields[0].prompt).toBe("Title of your talk");
  });

  it("recovers the wording a submission was actually given", () => {
    const history = [retireVersion(v1, 1)];
    const current = { version: 2, fields: v2 };
    expect(fieldsAtVersion(current, history, 1)[0].prompt).toBe("Title of your talk");
    expect(fieldsAtVersion(current, history, 2)[0].prompt).toBe("Working title");
  });

  it("falls back to the current form rather than failing on a version it lost", () => {
    // Refusing to render a submission is worse than rendering it under a
    // slightly different prompt, and it is safe because a recorded answer is
    // never judged against the definition it is read with.
    const current = { version: 4, fields: v2 };
    expect(fieldsAtVersion(current, [], 2)).toEqual(v2);
  });
});

describe("answers recorded against an older version are read, not judged", () => {
  const asSubmitted = [
    formField({ id: "title", prompt: "Title of your talk", required: true, order: 0 }),
    formField({ id: "track", kind: "choice", options: ["Industry", "Research"], order: 1 }),
  ];

  it("still validates in full when the versions match", () => {
    const result = validateAnswers(asSubmitted, "t", {}, { recordedVersion: 2, currentVersion: 2 });
    expect(result.ok).toBe(false);
    expect(result.errors.title).toBeTruthy();
    expect(result.stale).toBeUndefined();
  });

  it("does not require an answer to a question added after the submission", () => {
    const now = [...asSubmitted, formField({ id: "bio", prompt: "Your bio", required: true, order: 2 })];
    const result = validateAnswers(
      now,
      "t",
      { title: "Graphs at scale", track: "Industry" },
      { recordedVersion: 1, currentVersion: 2 },
    );
    expect(result.ok).toBe(true);
    expect(result.stale).toBe(true);
    // Something to chase, not an error on a document nobody can edit.
    expect(result.unanswered).toEqual(["bio"]);
  });

  it("keeps an answer to a question the form no longer asks, and says so", () => {
    const now = [asSubmitted[0]];
    const result = validateAnswers(
      now,
      "t",
      { title: "Graphs at scale", track: "Research" },
      { recordedVersion: 1, currentVersion: 2 },
    );
    expect(result.ok).toBe(true);
    // Destroying somebody's answer as a side effect of an edit is not
    // recoverable, so it survives and is reported.
    expect(result.answers.track).toBe("Research");
    expect(result.orphaned).toEqual(["track"]);
  });

  it("keeps an answer naming an option that has since been removed", () => {
    const now = [asSubmitted[0], { ...asSubmitted[1], options: ["Industry"] }];
    const result = validateAnswers(
      now,
      "t",
      { title: "Graphs at scale", track: "Research" },
      { recordedVersion: 1, currentVersion: 2 },
    );
    expect(result.ok).toBe(true);
    expect(result.answers.track).toBe("Research");
  });

  it("keeps an abstract longer than a limit lowered afterwards", () => {
    const now = [formField({ id: "summary", kind: "long-text", maxLength: 500 })];
    const result = validateAnswers(
      now,
      "t",
      { summary: "x".repeat(4000) },
      { recordedVersion: 1, currentVersion: 2 },
    );
    expect(result.ok).toBe(true);
    expect(String(result.answers.summary)).toHaveLength(4000);
  });

  it("does not chase an answer to a sub-question nobody triggered", () => {
    const now = [
      formField({ id: "recorded", kind: "choice", options: ["Yes", "No"], required: true, order: 0 }),
      formField({
        id: "consent",
        kind: "consent",
        order: 1,
        showIf: { fieldId: "recorded", equals: "Yes" },
      }),
    ];
    const result = validateAnswers(
      now,
      "t",
      { recorded: "No" },
      { recordedVersion: 1, currentVersion: 3 },
    );
    expect(result.unanswered).toEqual([]);
  });
});
