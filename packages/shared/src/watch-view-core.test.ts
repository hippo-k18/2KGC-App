import { describe, expect, it } from "vitest";

import {
  recordingView,
  sessionWatchView,
  streamView,
  ticketList,
} from "./watch-view-core.js";
import type { RecordingLike, StreamLike } from "./watch-view-core.js";

const stream = (over: Partial<StreamLike> = {}): StreamLike => ({
  embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  embeddable: true,
  state: "live",
  allowedTicketTypes: [],
  ...over,
});

const recording = (over: Partial<RecordingLike> = {}): RecordingLike => ({
  embedUrl: "https://player.vimeo.com/video/76979871",
  watchUrl: "https://vimeo.com/76979871",
  embeddable: true,
  allowedTicketTypes: [],
  ...over,
});

const NOW = Date.parse("2027-05-06T12:00:00Z");

describe("streamView", () => {
  it("renders no panel when no stream has been set up", () => {
    expect(streamView(null, { ticketType: "Main Conference" })).toEqual({ kind: "none" });
  });

  it("plays an unrestricted live stream for a ticket holder", () => {
    expect(streamView(stream(), { ticketType: "Virtual" })).toEqual({
      kind: "play",
      embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });

  it("refuses a visitor holding no ticket even when the stream is unrestricted", () => {
    // The gate is "a ticket", not "the right ticket". An empty allow list means
    // every ticket type, which is not the same as the public.
    expect(streamView(stream(), { ticketType: null })).toEqual({
      kind: "blocked",
      block: "no-ticket",
      allowedTicketTypes: [],
    });
  });

  it("names the tickets it was sold with when the viewer holds the wrong one", () => {
    expect(
      streamView(stream({ allowedTicketTypes: ["All Access (VIP)", "Main Conference"] }), {
        ticketType: "Startup Table",
      }),
    ).toEqual({
      kind: "blocked",
      block: "wrong-ticket",
      allowedTicketTypes: ["All Access (VIP)", "Main Conference"],
    });
  });

  it("checks the ticket before the state, so the wrong ticket is told which ticket", () => {
    const view = streamView(
      stream({ state: "scheduled", allowedTicketTypes: ["Virtual"] }),
      { ticketType: "Workshops" },
    );
    expect(view).toMatchObject({ kind: "blocked", block: "wrong-ticket" });
  });

  it("separates not yet started from finished", () => {
    expect(streamView(stream({ state: "scheduled" }), { ticketType: "Virtual" })).toMatchObject({
      block: "not-started",
    });
    expect(streamView(stream({ state: "ended" }), { ticketType: "Virtual" })).toMatchObject({
      block: "ended",
    });
  });

  it("sends an unembeddable provider out of the page instead of framing it", () => {
    expect(
      streamView(
        stream({ embeddable: false, watchUrl: "https://kgc.zoom.us/j/1?pwd=x", embedUrl: "https://kgc.zoom.us/j/1?pwd=x" }),
        { ticketType: "Virtual" },
      ),
    ).toEqual({ kind: "open", watchUrl: "https://kgc.zoom.us/j/1?pwd=x" });
  });

  it("never hands a URL to a blocked viewer", () => {
    const view = streamView(stream({ allowedTicketTypes: ["Virtual"] }), { ticketType: null });
    expect(JSON.stringify(view)).not.toContain("youtube");
  });
});

describe("recordingView", () => {
  it("plays inside the window", () => {
    expect(
      recordingView(
        recording({
          availableFromMs: Date.parse("2027-05-06T00:00:00Z"),
          availableUntilMs: Date.parse("2027-08-01T00:00:00Z"),
        }),
        { ticketType: "Main Conference" },
        NOW,
      ),
    ).toMatchObject({ kind: "play" });
  });

  it("says not yet before the window opens", () => {
    expect(
      recordingView(
        recording({ availableFromMs: Date.parse("2027-06-01T00:00:00Z") }),
        { ticketType: "Main Conference" },
        NOW,
      ),
    ).toMatchObject({ kind: "blocked", block: "not-yet" });
  });

  it("says expired after the window closes", () => {
    expect(
      recordingView(
        recording({ availableUntilMs: Date.parse("2027-05-01T00:00:00Z") }),
        { ticketType: "Main Conference" },
        NOW,
      ),
    ).toMatchObject({ kind: "blocked", block: "expired" });
  });

  it("checks the ticket before the window", () => {
    // Otherwise somebody with the wrong ticket is told to come back in June,
    // and is refused in June for a reason nobody ever gave them.
    expect(
      recordingView(
        recording({
          allowedTicketTypes: ["All Access (VIP)"],
          availableFromMs: Date.parse("2027-06-01T00:00:00Z"),
        }),
        { ticketType: "Startup Table" },
        NOW,
      ),
    ).toMatchObject({ block: "wrong-ticket" });
  });

  it("treats an absent allow list as every ticket type, and absent bounds as open", () => {
    expect(
      recordingView({ ...recording(), allowedTicketTypes: undefined }, { ticketType: "Workshops" }, NOW),
    ).toMatchObject({ kind: "play" });
  });
});

describe("ticketList", () => {
  it("joins with or, and only commas before the last", () => {
    expect(ticketList(["Main Conference"])).toBe("Main Conference");
    expect(ticketList(["Main Conference", "Gold"])).toBe("Main Conference or Gold");
    expect(ticketList(["Main Conference", "Gold", "Platinum"])).toBe(
      "Main Conference, Gold or Platinum",
    );
  });

  it("is empty for an empty list, so the caller writes its own sentence", () => {
    expect(ticketList([])).toBe("");
    expect(ticketList(["  ", ""])).toBe("");
  });
});

/**
 * The leak this file's header warns about, pinned.
 *
 * `sessionWatchView` is the whole of what a page may hold, so the test walks
 * everything it returns and looks for the link. Written as a deep scan rather
 * than a check of named fields on purpose: the bug was somebody adding the
 * record back beside the decision, and a test that only knows today's field
 * names would not have caught it.
 */
function deepStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) deepStrings(v, out);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) deepStrings(v, out);
  return out;
}

describe("sessionWatchView", () => {
  const gatedStream = stream({ allowedTicketTypes: ["All Access (VIP)"] });
  const gatedRecording = recording({
    allowedTicketTypes: ["All Access (VIP)"],
    durationSeconds: 3_130,
    availableUntilMs: Date.parse("2028-03-31T00:00:00Z"),
  });

  it("sends no link to a visitor carrying no ticket at all", () => {
    const view = sessionWatchView(gatedStream, gatedRecording, { ticketType: null }, NOW);
    const text = deepStrings(view).join(" ");
    expect(view.live).toMatchObject({ kind: "blocked", block: "no-ticket" });
    expect(view.recorded).toMatchObject({ kind: "blocked", block: "no-ticket" });
    expect(text).not.toContain("dQw4w9WgXcQ");
    expect(text).not.toContain("76979871");
    expect(text).not.toContain("http");
  });

  it("sends no link to a visitor holding the wrong ticket", () => {
    const view = sessionWatchView(gatedStream, gatedRecording, { ticketType: "Virtual" }, NOW);
    const text = deepStrings(view).join(" ");
    expect(view.live).toMatchObject({ kind: "blocked", block: "wrong-ticket" });
    expect(text).not.toContain("dQw4w9WgXcQ");
    expect(text).not.toContain("76979871");
  });

  it("still carries the dates and the length, which are on the session anyway", () => {
    const view = sessionWatchView(gatedStream, gatedRecording, { ticketType: "Virtual" }, NOW);
    expect(view.streamState).toBe("live");
    expect(view.durationSeconds).toBe(3_130);
    expect(view.availableUntilMs).toBe(Date.parse("2028-03-31T00:00:00Z"));
  });

  it("hands the link over once the ticket covers it", () => {
    const view = sessionWatchView(
      gatedStream,
      gatedRecording,
      { ticketType: "All Access (VIP)" },
      NOW,
    );
    expect(view.live).toMatchObject({ kind: "play", embedUrl: stream().embedUrl });
    expect(view.recorded).toMatchObject({ kind: "play", embedUrl: recording().embedUrl });
  });
});
