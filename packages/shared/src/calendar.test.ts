import { describe, expect, it } from "vitest";

import {
  googleCalendarUrl,
  icsFilename,
  localWallClockToIso,
  outlookCalendarUrl,
  sessionCalendarPath,
  sessionIcs,
  type CalendarSession,
} from "./calendar.js";

/**
 * Every way this module fails is silent.
 *
 * A wrong offset does not throw and does not render wrong: the agenda page says
 * 09:00, the attendee taps "Add to My Calendar", and the entry lands at 05:00 in
 * their phone. They find out by arriving to an empty room. That is the same
 * argument `scripts/src/lib/time.test.ts` opens with, about the other conversion
 * in this repo, and it is why the offset cases below name their expected instant
 * rather than comparing two computed values.
 *
 * The three destinations are checked against one resolution, not three, because
 * the whole reason the builders share `resolve()` is that Google, Outlook and
 * the `.ics` must not be able to disagree.
 */

const TZ = "America/New_York";

/** KGC's real shape: a 45-minute talk on the Wednesday of the conference. */
const SESSION: CalendarSession = {
  id: "sess-keynote",
  title: "Keynote: graphs at enterprise scale",
  description: "How a knowledge graph survives contact with a data warehouse.",
  startsAtLocal: "2027-05-05T09:00",
  endsAtLocal: "2027-05-05T09:45",
  roomName: "Verizon Executive Education Center",
  trackName: "Knowledge Engineering",
  speakerNames: ["Ada Lovelace", "José Ñuñez"],
};

const OPTS = { origin: "https://example.test", now: new Date("2026-09-14T12:00:00Z") };

describe("localWallClockToIso", () => {
  it("applies the daylight offset in May", () => {
    // EDT, UTC-4. An offset frozen at -05:00 would put every session of the
    // conference an hour late in every attendee's calendar.
    expect(localWallClockToIso("2027-05-05T09:00", TZ)).toBe("2027-05-05T09:00:00-04:00");
  });

  it("applies the standard offset in January", () => {
    expect(localWallClockToIso("2027-01-05T09:00", TZ)).toBe("2027-01-05T09:00:00-05:00");
  });

  it("resolves the hour either side of a spring transition", () => {
    // 2027-03-14: 02:00 EST becomes 03:00 EDT. The hour before and the hour
    // after are the two the single-pass version of this function gets wrong,
    // because it reads the offset at an instant up to a day away from the truth.
    expect(localWallClockToIso("2027-03-14T01:30", TZ)).toBe("2027-03-14T01:30:00-05:00");
    expect(localWallClockToIso("2027-03-14T03:30", TZ)).toBe("2027-03-14T03:30:00-04:00");
  });

  it("resolves the repeated hour in autumn to the first pass", () => {
    // 2027-11-07: 01:30 happens twice. Either answer is defensible; this pins
    // which one, so the choice is a decision rather than an accident of ordering.
    expect(localWallClockToIso("2027-11-07T01:30", TZ)).toBe("2027-11-07T01:30:00-04:00");
  });

  it("handles a zone at UTC and one on a 45-minute offset", () => {
    expect(localWallClockToIso("2027-05-05T09:00", "UTC")).toBe("2027-05-05T09:00:00+00:00");
    // Chatham is +12:45 in standard time. A minutes field assumed to be zero
    // would silently drop the 45.
    expect(localWallClockToIso("2027-07-05T09:00", "Pacific/Chatham")).toBe(
      "2027-07-05T09:00:00+12:45",
    );
  });

  it("refuses anything that is not a bare wall clock", () => {
    // ⚠️ `Date.parse` accepts implementation-defined formats, so the shape check
    // is what stops a malformed time from resolving to some plausible instant.
    for (const bad of ["", "2027-05-05 09:00", "2027-05-05T09:00Z", "not-a-date", "2027-05-05"]) {
      expect(localWallClockToIso(bad, TZ)).toBe("");
    }
  });
});

describe("the three destinations", () => {
  it("agree on the instant", () => {
    // 09:00 New York in May is 13:00Z. All three say so, in their own format.
    const ics = sessionIcs(SESSION, OPTS);
    expect(ics).toContain("DTSTART:20270505T130000Z");
    expect(ics).toContain("DTEND:20270505T134500Z");
    expect(googleCalendarUrl(SESSION, OPTS)).toContain(
      "dates=20270505T130000Z%2F20270505T134500Z",
    );
    expect(outlookCalendarUrl(SESSION, OPTS)).toContain("startdt=2027-05-05T13%3A00%3A00Z");
    expect(outlookCalendarUrl(SESSION, OPTS)).toContain("enddt=2027-05-05T13%3A45%3A00Z");
  });

  it("refuse a session whose stored times are malformed or inverted", () => {
    // An entry at a guessed hour is worse than no entry, because the attendee
    // finds out about the second one.
    expect(() => sessionIcs({ ...SESSION, startsAtLocal: "2027-05-05 09:00" }, OPTS)).toThrow(
      /wall clock/,
    );
    expect(() => sessionIcs({ ...SESSION, endsAtLocal: "2027-05-05T08:00" }, OPTS)).toThrow(
      /ends at or before it starts/,
    );
  });
});

describe("sessionIcs", () => {
  it("mints a UID on the conference's own host, not the deployment's", () => {
    // The UID is what makes re-adding a session update the attendee's existing
    // entry rather than duplicate it, so a Netlify preview must not change it.
    const ics = sessionIcs(SESSION, OPTS);
    expect(ics).toContain("UID:sess-keynote.kgc-2027@www.knowledgegraph.tech");
    expect(sessionIcs(SESSION, { ...OPTS, origin: "https://preview.example" })).toContain(
      "UID:sess-keynote.kgc-2027@www.knowledgegraph.tech",
    );
  });

  it("escapes TEXT properties and leaves the URL alone", () => {
    const ics = sessionIcs(
      { ...SESSION, title: "Graphs; commas, and \\ backslashes", roomName: "Room 1, Level 2" },
      OPTS,
    );
    expect(ics).toContain("SUMMARY:Graphs\\; commas\\, and \\\\ backslashes");
    expect(ics).toContain("LOCATION:Room 1\\, Level 2\\, Bryant Park\\, New York\\, NY");
    // A URI value, not TEXT. Escaping the query string would break the link.
    expect(ics).toContain("URL:https://example.test/agenda?day=2027-05-05#2027-05-05");
  });

  it("folds to 75 octets and never splits a code point", () => {
    const ics = sessionIcs({ ...SESSION, title: `🚀 ${"é".repeat(120)}` }, OPTS);
    for (const line of ics.split("\r\n")) {
      // Counted in bytes, because that is what RFC 5545 limits.
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    // The rocket survives intact rather than arriving as two replacement
    // characters split across the fold.
    expect(ics).toContain("SUMMARY:🚀");
  });

  it("is CRLF-terminated", () => {
    const ics = sessionIcs(SESSION, OPTS);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.includes("\n\r")).toBe(false);
  });
});

describe("icsFilename", () => {
  it("folds to ASCII, because Content-Disposition's filename= cannot carry anything else", () => {
    expect(icsFilename("Ontologies in Anger — José's talk")).toBe(
      "ontologies-in-anger-jose-s-talk.ics",
    );
  });

  it("never returns a bare extension", () => {
    expect(icsFilename("🚀🚀🚀")).toBe("session.ics");
  });
});

describe("sessionCalendarPath", () => {
  it("encodes an id that would otherwise change the path", () => {
    expect(sessionCalendarPath("a/b")).toBe("/agenda/a%2Fb/calendar.ics");
  });
});
