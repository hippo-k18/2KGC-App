/**
 * The community board's shared vocabulary.
 *
 * `replyIsVisible` is the one with teeth: it is the only place a hidden reply
 * is actually taken off the board, because Firestore cannot express the query
 * and `firestore.rules` cannot filter a list. The cases below are the ones that
 * matter — a reply written before the field existed, and a reply an organizer
 * has hidden.
 */
import { describe, expect, it } from "vitest";

import { communityCategoryLabel, replyIsVisible } from "./community.js";

describe("replyIsVisible", () => {
  it("keeps a reply written before the status field existed", () => {
    expect(replyIsVisible({})).toBe(true);
    expect(replyIsVisible({ status: undefined })).toBe(true);
  });

  it("keeps a visible reply and drops a hidden one", () => {
    expect(replyIsVisible({ status: "visible" })).toBe(true);
    expect(replyIsVisible({ status: "hidden" })).toBe(false);
  });

  /**
   * Anything that is not "visible" and not absent is treated as hidden, which
   * is the safe direction: a status nobody has taught this function about is a
   * moderation decision it has not learned to honour yet.
   */
  it("drops a status it does not recognise rather than showing it anyway", () => {
    expect(replyIsVisible({ status: "removed" })).toBe(false);
  });
});

describe("communityCategoryLabel", () => {
  it("prints the word an attendee chose under, and falls back to the id", () => {
    expect(communityCategoryLabel("ride-share")).toBe("Travel");
    expect(communityCategoryLabel("something-else")).toBe("something-else");
  });
});
