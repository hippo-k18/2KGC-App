/**
 * The notice an attendee gets when a session they saved moves.
 *
 * The id is the interesting half. Two writers exist — the dashboard's save
 * action today, the `onSessionAgendaChange` trigger once it can be deployed —
 * and the id is what stops one room change becoming two notifications on one
 * phone. These tests pin that property in both directions: the same resulting
 * state is one id, a different resulting state is a different one.
 */
import { describe, expect, it } from "vitest";

import { agendaNoticeBody, agendaNoticeId, describeAgendaChanges } from "./agenda-notice.js";

describe("agendaNoticeId", () => {
  it("is the same for two writers describing the same resulting state", () => {
    const state = { sessionId: "opening-keynote-a1b2", startsAtLocal: "2027-05-03T09:00", roomId: "main-hall" };
    expect(agendaNoticeId(state)).toBe(agendaNoticeId({ ...state }));
  });

  it("differs when the session ends up somewhere else", () => {
    const base = { sessionId: "s1", startsAtLocal: "2027-05-03T09:00", roomId: "main-hall" };
    expect(agendaNoticeId(base)).not.toBe(agendaNoticeId({ ...base, roomId: "studio" }));
    expect(agendaNoticeId(base)).not.toBe(agendaNoticeId({ ...base, startsAtLocal: "2027-05-03T10:00" }));
  });

  /** A move and back again is the state that was already announced. */
  it("returns to the first id when a session moves back", () => {
    const home = { sessionId: "s1", startsAtLocal: "2027-05-03T09:00", roomId: "main-hall" };
    const away = { ...home, roomId: "studio" };
    expect(agendaNoticeId(away)).not.toBe(agendaNoticeId(home));
    expect(agendaNoticeId({ ...away, roomId: "main-hall" })).toBe(agendaNoticeId(home));
  });

  it("gives a cancellation one id of its own, whatever the time and room say", () => {
    const id = agendaNoticeId({ sessionId: "s1", startsAtLocal: "2027-05-03T09:00", cancelled: true });
    expect(id).toBe(agendaNoticeId({ sessionId: "s1", startsAtLocal: "2027-05-04T15:00", cancelled: true }));
  });

  /** Firestore ids may not contain a slash, and a room id is organizer-typed. */
  it("survives an id with punctuation in it", () => {
    const id = agendaNoticeId({ sessionId: "a/b c", startsAtLocal: "2027-05-03T09:00", roomId: "room/1" });
    expect(id).not.toContain("/");
    expect(id.length).toBeLessThanOrEqual(1500);
  });

  it("treats no room as a state rather than as missing data", () => {
    const withRoom = { sessionId: "s1", startsAtLocal: "2027-05-03T09:00", roomId: "main-hall" };
    expect(agendaNoticeId({ ...withRoom, roomId: null })).not.toBe(agendaNoticeId(withRoom));
    expect(agendaNoticeId({ ...withRoom, roomId: null })).toBe(agendaNoticeId({ sessionId: "s1", startsAtLocal: "2027-05-03T09:00" }));
  });
});

describe("describeAgendaChanges", () => {
  it("keeps a fixed order, so the sentence does not depend on which field was read first", () => {
    expect(describeAgendaChanges(["room", "time"])).toBe("time and room");
    expect(describeAgendaChanges(["time", "room"])).toBe("time and room");
    expect(describeAgendaChanges(["room", "day", "time"])).toBe("day, time and room");
  });

  it("says nothing when nothing moved", () => {
    expect(describeAgendaChanges([])).toBe("");
  });
});

describe("agendaNoticeBody", () => {
  it("names the session and what moved, and stops", () => {
    expect(agendaNoticeBody({ title: "Graphs at scale", changed: ["room"] })).toBe(
      "Graphs at scale: the room changed. Check the new details.",
    );
  });

  it("says cancelled plainly", () => {
    expect(agendaNoticeBody({ title: "Graphs at scale", changed: ["room"], cancelled: true })).toBe(
      "Graphs at scale has been cancelled.",
    );
  });

  it("still says something useful when the change list is empty", () => {
    expect(agendaNoticeBody({ title: "Graphs at scale", changed: [] })).toBe("Graphs at scale has changed.");
  });
});
