import { describe, expect, it } from "vitest";

import { EVENT } from "./event.js";
import {
  EVENT_SETTINGS_DEFAULTS,
  formatDateRange,
  isDayKey,
  isTimeZone,
  resolveEventBasics,
  validateEventSettings,
} from "./event-basics.js";

describe("formatDateRange", () => {
  it("writes the range the way the site already does", () => {
    expect(formatDateRange("2027-05-03", "2027-05-07", "long")).toBe("3–7 May 2027");
    expect(formatDateRange("2027-05-03", "2027-05-07", "short")).toBe("May 3–7, 2027");
  });

  it("handles one day, two months and two years", () => {
    expect(formatDateRange("2027-05-03", "2027-05-03", "long")).toBe("3 May 2027");
    expect(formatDateRange("2027-05-30", "2027-06-02", "long")).toBe("30 May – 2 June 2027");
    expect(formatDateRange("2027-05-30", "2027-06-02", "short")).toBe("May 30 – Jun 2, 2027");
    expect(formatDateRange("2027-12-30", "2028-01-02", "short")).toBe("Dec 30, 2027 – Jan 2, 2028");
  });
});

describe("resolveEventBasics", () => {
  it("returns today's constants when nothing is stored", () => {
    for (const stored of [undefined, null, {}, EVENT_SETTINGS_DEFAULTS]) {
      const b = resolveEventBasics(stored);
      expect(b.name).toBe(EVENT.name);
      expect(b.venue).toBe(EVENT.venue);
      expect(b.timeZone).toBe(EVENT.timeZone);
      expect(b.datesLong).toBe("3–7 May 2027");
      expect(b.eventTypeLabel).toBe("In-person event");
      expect(b.year).toBe(2027);
    }
  });

  it("takes stored values and ignores unusable ones", () => {
    const b = resolveEventBasics({
      name: " Graph Week ",
      startDate: "2027-06-01",
      endDate: "2027-06-03",
      timeZone: "Not/AZone",
      eventType: "hybrid",
    });
    expect(b.name).toBe("Graph Week");
    expect(b.datesShort).toBe("Jun 1–3, 2027");
    expect(b.timeZone).toBe(EVENT.timeZone);
    expect(b.eventType).toBe("hybrid");
  });

  it("never pairs a stored start with the constant end", () => {
    const b = resolveEventBasics({ startDate: "2027-09-10", endDate: "" });
    expect(b.endDate).toBe("2027-09-10");
  });
});

describe("validateEventSettings", () => {
  it("accepts an empty form, which clears every field", () => {
    expect(validateEventSettings(EVENT_SETTINGS_DEFAULTS)).toEqual({});
  });

  it("refuses an impossible date, a reversed range, half a range and a bad zone", () => {
    const base = { ...EVENT_SETTINGS_DEFAULTS };
    expect(validateEventSettings({ ...base, startDate: "2027-02-30", endDate: "2027-03-01" }).startDate).toBeTruthy();
    expect(validateEventSettings({ ...base, startDate: "2027-05-07", endDate: "2027-05-03" }).endDate).toBeTruthy();
    expect(validateEventSettings({ ...base, startDate: "2027-05-07" }).endDate).toBeTruthy();
    expect(validateEventSettings({ ...base, timeZone: "New York" }).timeZone).toBeTruthy();
    expect(validateEventSettings({ ...base, eventType: "online" }).eventType).toBeTruthy();
  });

  it("knows a day key and a zone", () => {
    expect(isDayKey("2028-02-29")).toBe(true);
    expect(isDayKey("2027-02-29")).toBe(false);
    expect(isTimeZone("Europe/Amsterdam")).toBe(true);
    expect(isTimeZone("")).toBe(false);
  });
});
