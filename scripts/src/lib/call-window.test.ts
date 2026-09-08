import { describe, expect, it } from "vitest";
import {
  callWindow,
  canEditSubmission,
  daysUntilClose,
  submissionRefusal,
  type CallWindowInput,
} from "./call-window.js";

/**
 * The deadline, which is the one rule in the call for abstracts that has nothing
 * underneath it.
 *
 * `calls` and `submissions` have no `match` block in `firestore.rules` — every
 * write is Admin-SDK, through a server action — so there is no rule to catch a
 * write the screen let through. `CFA-PLAN.md` §4: "Deadline enforcement is
 * server-side or it is nothing." These are the tests that make it something.
 */

const DAY = 24 * 60 * 60 * 1000;
const OPENS = Date.UTC(2026, 8, 1, 0, 0);
const CLOSES = Date.UTC(2026, 8, 30, 23, 59);

const call = (over: Partial<CallWindowInput> = {}): CallWindowInput => ({
  status: "published",
  opensAtMs: OPENS,
  closesAtMs: CLOSES,
  ...over,
});

describe("callWindow", () => {
  it("is open between the two instants", () => {
    expect(callWindow(call(), OPENS + DAY)).toBe("open");
  });

  it("is not-open before the opening instant", () => {
    expect(callWindow(call(), OPENS - 1)).toBe("not-open");
  });

  it("opens inclusively, on the instant itself", () => {
    expect(callWindow(call(), OPENS)).toBe("open");
  });

  it("closes exclusively, on the instant itself", () => {
    // The deadline says 23:59. A submission stamped 23:59 is late, because the
    // alternative is a call that runs one millisecond longer than the poster.
    expect(callWindow(call(), CLOSES)).toBe("closed");
  });

  it("is still open one millisecond before the close", () => {
    expect(callWindow(call(), CLOSES - 1)).toBe("open");
  });

  it("reports draft whatever the dates say", () => {
    expect(callWindow(call({ status: "draft" }), OPENS + DAY)).toBe("draft");
  });

  it("reports cancelled whatever the dates say", () => {
    expect(callWindow(call({ status: "cancelled" }), OPENS + DAY)).toBe("cancelled");
  });

  it("fails closed when the dates are the wrong way round", () => {
    // Refusing a write that should have been allowed is a support email.
    // Accepting one that should have been refused is a decision somebody has to
    // make about a submission that arrived after the deadline.
    const inverted = call({ opensAtMs: CLOSES, closesAtMs: OPENS });
    expect(callWindow(inverted, OPENS + DAY)).toBe("closed");
  });
});

describe("submissionRefusal", () => {
  it("permits a write inside the window", () => {
    expect(submissionRefusal(call(), OPENS + DAY)).toBeNull();
  });

  it("refuses a write after the close, and says nothing was saved", () => {
    const reason = submissionRefusal(call(), CLOSES + 1);
    expect(reason).toContain("closed");
    expect(reason).toContain("Nothing has been saved");
  });

  it("refuses a write before the open", () => {
    expect(submissionRefusal(call(), OPENS - 1)).toContain("not opened yet");
  });

  it("refuses a write to a draft call without saying when it opens", () => {
    // A draft call is not public. Telling somebody who guessed the URL when it
    // opens would confirm that it exists.
    const reason = submissionRefusal(call({ status: "draft" }), OPENS + DAY);
    expect(reason).toBe("This call is not open for submissions.");
  });

  it("refuses a write to a withdrawn call in different words from a closed one", () => {
    const withdrawn = submissionRefusal(call({ status: "cancelled" }), OPENS + DAY);
    const closed = submissionRefusal(call(), CLOSES + 1);
    expect(withdrawn).toContain("withdrawn");
    expect(withdrawn).not.toBe(closed);
  });

  it("gives a reason for every state the window can be in", () => {
    // A state added to `CallWindowState` without a sentence here would return
    // `undefined`, and an action checking `if (reason)` would let the write
    // through — the exact failure this module exists to prevent.
    const moments = [OPENS - 1, OPENS, CLOSES - 1, CLOSES];
    const calls = [call(), call({ status: "draft" }), call({ status: "cancelled" })];
    for (const c of calls) {
      for (const at of moments) {
        const reason = submissionRefusal(c, at);
        expect(reason === null || typeof reason === "string").toBe(true);
        if (reason !== null) expect(reason.length).toBeGreaterThan(10);
      }
    }
  });
});

describe("canEditSubmission", () => {
  it("tracks the window exactly, so editing does not outlive the deadline", () => {
    expect(canEditSubmission(call(), CLOSES - 1)).toBe(true);
    expect(canEditSubmission(call(), CLOSES)).toBe(false);
  });
});

describe("daysUntilClose", () => {
  it("rounds up, so the last partial day is still a day", () => {
    expect(daysUntilClose(call(), CLOSES - 1)).toBe(1);
    expect(daysUntilClose(call(), CLOSES - DAY)).toBe(1);
    expect(daysUntilClose(call(), CLOSES - DAY - 1)).toBe(2);
  });

  it("floors at zero rather than going negative", () => {
    expect(daysUntilClose(call(), CLOSES + 10 * DAY)).toBe(0);
  });
});
