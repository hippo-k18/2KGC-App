/**
 * The access window, the join code and the projection reader.
 *
 * Three surfaces run this arithmetic — the dashboard when it writes the
 * projection, the phone when it decides which screen to draw, and
 * `firestore.rules` doing the same integer comparison against `request.time`.
 * These tests are what stops the three disagreeing about when the app closes.
 */
import { describe, expect, it } from "vitest";

import {
  APP_ACCESS_DEFAULTS,
  accessWindowSummary,
  accessWindowWallClocks,
  addDays,
  appAccessState,
  appWritesOpen,
  joinCodeMatches,
  joinCodeNeeded,
  normaliseJoinCode,
  resolveAppAccess,
} from "./app-access.js";

const MAY_7 = "2027-05-07";

describe("addDays", () => {
  it("moves a calendar day without a time zone getting in the way", () => {
    expect(addDays(MAY_7, 30)).toBe("2027-06-06");
    expect(addDays(MAY_7, 0)).toBe(MAY_7);
  });

  it("crosses a month, a year and a leap day", () => {
    expect(addDays("2027-12-31", 1)).toBe("2028-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("hands back anything that is not a date rather than inventing one", () => {
    expect(addDays("", 5)).toBe("");
    expect(addDays("soon", 5)).toBe("soon");
  });
});

describe("accessWindowWallClocks", () => {
  it("counts whole days, so 7 days means the end of the seventh", () => {
    const w = accessWindowWallClocks({ endDate: MAY_7, postEventDays: 7, postEventReadOnly: false });
    expect(w.closesAt).toBe("2027-05-14T23:59");
  });

  it("closes at the end of the last day when the organizer types 0", () => {
    const w = accessWindowWallClocks({ endDate: MAY_7, postEventDays: 0, postEventReadOnly: false });
    expect(w.closesAt).toBe("2027-05-07T23:59");
  });

  it("only sets a read-only boundary when the box is ticked", () => {
    expect(
      accessWindowWallClocks({ endDate: MAY_7, postEventDays: 30, postEventReadOnly: false }).readOnlyFrom,
    ).toBeNull();
    expect(
      accessWindowWallClocks({ endDate: MAY_7, postEventDays: 30, postEventReadOnly: true }).readOnlyFrom,
    ).toBe("2027-05-07T23:59");
  });

  /**
   * An event with no end date cannot have a window, and guessing one would
   * close the app on a date nobody chose.
   */
  it("sets no window at all without a usable end date", () => {
    expect(accessWindowWallClocks({ endDate: "", postEventDays: 30, postEventReadOnly: true })).toEqual({
      readOnlyFrom: null,
      closesAt: null,
    });
  });

  it("refuses a negative or fractional number of days rather than moving backwards", () => {
    expect(
      accessWindowWallClocks({ endDate: MAY_7, postEventDays: -5, postEventReadOnly: false }).closesAt,
    ).toBe("2027-05-07T23:59");
    expect(
      accessWindowWallClocks({ endDate: MAY_7, postEventDays: 1.9, postEventReadOnly: false }).closesAt,
    ).toBe("2027-05-08T23:59");
  });
});

describe("appAccessState", () => {
  it("is open before either boundary", () => {
    expect(appAccessState({ ...APP_ACCESS_DEFAULTS, readOnlyFromMs: 1_000, closesAtMs: 2_000 }, 500)).toBe(
      "open",
    );
  });

  it("is read-only between the two, and closed after the second", () => {
    const w = { ...APP_ACCESS_DEFAULTS, readOnlyFromMs: 1_000, closesAtMs: 2_000 };
    expect(appAccessState(w, 1_000)).toBe("read-only");
    expect(appAccessState(w, 1_999)).toBe("read-only");
    expect(appAccessState(w, 2_000)).toBe("closed");
  });

  /** `0` is "never", not 1970 — the unwritten projection has to fail open. */
  it("stays open forever on an unwritten projection", () => {
    expect(appAccessState(APP_ACCESS_DEFAULTS, Date.now())).toBe("open");
    expect(appWritesOpen(APP_ACCESS_DEFAULTS, Date.now())).toBe(true);
  });

  it("closes even when read-only was never set", () => {
    expect(appAccessState({ ...APP_ACCESS_DEFAULTS, closesAtMs: 10 }, 11)).toBe("closed");
  });

  it("stops writes the moment it is no longer open", () => {
    const w = { ...APP_ACCESS_DEFAULTS, readOnlyFromMs: 1_000, closesAtMs: 2_000 };
    expect(appWritesOpen(w, 999)).toBe(true);
    expect(appWritesOpen(w, 1_000)).toBe(false);
    expect(appWritesOpen(w, 3_000)).toBe(false);
  });
});

describe("the join code", () => {
  it("ignores case, spaces and the hyphen somebody read off a slide", () => {
    expect(normaliseJoinCode(" kgc-2027 ")).toBe("KGC2027");
    expect(joinCodeMatches("KGC-2027", "kgc 2027")).toBe(true);
    expect(joinCodeMatches("KGC-2027", "KGC2028")).toBe(false);
  });

  it("never matches when no code is set", () => {
    expect(joinCodeMatches("", "")).toBe(false);
    expect(joinCodeMatches("", "anything")).toBe(false);
  });

  it("asks only when a code is set and required, and only once", () => {
    const on = { ...APP_ACCESS_DEFAULTS, joinCode: "KGC2027", joinCodeRequired: true };
    expect(joinCodeNeeded(on, {})).toBe(true);
    expect(joinCodeNeeded(on, { joinedAt: "2027-05-03" })).toBe(false);
    expect(joinCodeNeeded({ ...on, joinCodeRequired: false }, {})).toBe(false);
    expect(joinCodeNeeded({ ...on, joinCode: "" }, {})).toBe(false);
  });

  /** A code box drawn over a loading screen is one somebody answers too early. */
  it("never asks before the profile has loaded", () => {
    const on = { ...APP_ACCESS_DEFAULTS, joinCode: "KGC2027", joinCodeRequired: true };
    expect(joinCodeNeeded(on, null)).toBe(false);
  });
});

describe("resolveAppAccess", () => {
  it("fills in the defaults for anything absent", () => {
    expect(resolveAppAccess(undefined)).toEqual(APP_ACCESS_DEFAULTS);
    expect(resolveAppAccess({ closesAtMs: 42 })).toEqual({ ...APP_ACCESS_DEFAULTS, closesAtMs: 42 });
  });

  /**
   * The failure this guards is specific: a cleared field written as `null` by
   * an older save spreads over the default, and `null >= closesAtMs` is false
   * against every clock — an app that quietly never closes.
   */
  it("drops a value of the wrong type instead of storing it", () => {
    expect(resolveAppAccess({ closesAtMs: null, messagingEnabled: "no" })).toEqual(APP_ACCESS_DEFAULTS);
  });

  it("ignores fields that are not part of the projection", () => {
    expect(resolveAppAccess({ staffNote: "who is on the desk" })).toEqual(APP_ACCESS_DEFAULTS);
  });
});

describe("accessWindowSummary", () => {
  it("prints the day the organizer typed, not the UTC day after it", () => {
    // 23:59 on 7 May in New York is 03:59 on the 8th in UTC. Formatting the
    // stored instant would say the 8th; the wall clock says the 7th.
    expect(
      accessWindowSummary({ readOnlyFrom: "2027-05-07T23:59", closesAt: "2027-05-10T23:59" }),
    ).toBe("The app read-only from the end of 2027-05-07, closes after 2027-05-10.");
  });

  it("says so plainly when nothing closes", () => {
    expect(accessWindowSummary({ readOnlyFrom: null, closesAt: null })).toBe("The app stays open.");
  });

  it("leaves read-only out when the box is not ticked", () => {
    expect(accessWindowSummary({ readOnlyFrom: null, closesAt: "2027-06-06T23:59" })).toBe(
      "The app closes after 2027-06-06.",
    );
  });
});
