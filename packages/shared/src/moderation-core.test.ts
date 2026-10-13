import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BLOCKED_WORDS_RULES_PATTERN,
  findBlockedWord,
  isHiddenBy,
  passesWordFilter,
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  reportId,
  reportReasonLabel,
  reportTargetKey,
  reportTargetPath,
} from "./moderation-core.js";

describe("report keys and paths", () => {
  it("names each kind of target", () => {
    expect(reportTargetKey({ type: "communityPost", postId: "p1" })).toBe("communityPost:p1");
    expect(reportTargetKey({ type: "reply", postId: "p1", replyId: "r1" })).toBe("reply:p1:r1");
    expect(reportTargetKey({ type: "message", threadId: "a_b" })).toBe("message:a_b");
    expect(reportTargetKey({ type: "message", threadId: "a_b", messageId: "m1" })).toBe("message:a_b:m1");
    expect(reportTargetKey({ type: "user", uid: "u1" })).toBe("user:u1");
    expect(reportTargetKey({ type: "job", jobId: "j1" })).toBe("job:j1");
  });

  it("points the dashboard at the document", () => {
    expect(reportTargetPath({ type: "communityPost", postId: "p1" })).toBe("communityPosts/p1");
    expect(reportTargetPath({ type: "reply", postId: "p1", replyId: "r1" })).toBe("communityPosts/p1/replies/r1");
    expect(reportTargetPath({ type: "message", threadId: "a_b", messageId: "m1" })).toBe("threads/a_b/messages/m1");
    expect(reportTargetPath({ type: "message", threadId: "a_b" })).toBe("threads/a_b");
    expect(reportTargetPath({ type: "user", uid: "u1" })).toBe("directory/u1");
  });

  it("makes one id per reporter and target, with no slash", () => {
    const id = reportId("demo_001", { type: "reply", postId: "p1", replyId: "r1" });
    expect(id).toBe("demo_001__reply:p1:r1");
    expect(id).not.toContain("/");
  });

  it("labels reasons and lists the target types the rules accept", () => {
    expect(REPORT_REASONS.map((r) => r.id)).toEqual(["spam", "offensive", "scam", "other"]);
    expect(reportReasonLabel("scam")).toBe("Scam or fraud");
    expect(reportReasonLabel("unknown")).toBe("unknown");
    expect([...REPORT_TARGET_TYPES]).toEqual(["job", "communityPost", "reply", "message", "user"]);
  });
});

describe("blocking", () => {
  it("hides only authors on the list", () => {
    const blocked = new Set(["bad"]);
    expect(isHiddenBy(blocked, "bad")).toBe(true);
    expect(isHiddenBy(blocked, "fine")).toBe(false);
    expect(isHiddenBy(null, "bad")).toBe(false);
    expect(isHiddenBy(blocked, undefined)).toBe(false);
  });
});

describe("the word filter", () => {
  it("catches whole words in any case", () => {
    expect(findBlockedWord("What the FUCK")).toBe("fuck");
    expect(findBlockedWord("line one\nyou slut")).toBe("slut");
    expect(passesWordFilter("Great talk!", "See you at lunch")).toBe(true);
    expect(passesWordFilter("ok", "fucking hell")).toBe(false);
  });

  it("leaves words that only contain one alone", () => {
    for (const ok of ["Scunthorpe", "spice", "spicy", "fagottist", "Dickens", "assessment", "retardant"]) {
      expect(findBlockedWord(ok), ok).toBeNull();
    }
    expect(findBlockedWord("")).toBeNull();
    expect(findBlockedWord(undefined)).toBeNull();
  });

  it("is the same list firestore.rules enforces", () => {
    const rules = readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8");
    const m = /function blockedWordsPattern\(\) \{\s*return '([^']+)';/.exec(rules);
    expect(m, "firestore.rules defines blockedWordsPattern()").not.toBeNull();
    expect(m![1]).toBe(BLOCKED_WORDS_RULES_PATTERN);
  });
});
