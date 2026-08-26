import { describe, expect, it } from "vitest";
import type { QuestionFieldDef } from "@kgc/shared";
import {
  fieldsForTier,
  validateAnswers,
  validateField,
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
