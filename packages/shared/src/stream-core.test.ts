import { describe, expect, it } from "vitest";
import {
  formatDuration,
  mayWatch,
  parseDuration,
  parseStreamSource,
  providerLabel,
  recordingWindow,
} from "./stream-core.js";

const ok = (provider: string, raw: string) => {
  const r = parseStreamSource(provider, raw);
  if (!r.ok) throw new Error(`expected ${raw} to parse: ${r.error}`);
  return r.value;
};

describe("parseStreamSource, YouTube", () => {
  it("takes a watch link", () => {
    expect(ok("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ").videoId).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("takes a short link, a live permalink and an embed link as the same video", () => {
    const ids = [
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
      "dQw4w9WgXcQ",
    ].map((raw) => ok("youtube", raw).videoId);
    expect(new Set(ids)).toEqual(new Set(["dQw4w9WgXcQ"]));
  });

  it("stores one watch URL and one embed URL whatever was pasted", () => {
    const v = ok("youtube", "https://youtu.be/dQw4w9WgXcQ?t=42");
    expect(v.watchUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(v.embedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(v.embeddable).toBe(true);
  });

  it("refuses a channel page, which is the link people actually paste by mistake", () => {
    expect(parseStreamSource("youtube", "https://www.youtube.com/@knowledgegraphconf").ok).toBe(
      false,
    );
  });

  it("refuses a look-alike host", () => {
    expect(parseStreamSource("youtube", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ").ok)
      .toBe(false);
  });

  it("refuses http, because a framed http player is blocked with nothing on screen to say so", () => {
    expect(parseStreamSource("youtube", "http://www.youtube.com/watch?v=dQw4w9WgXcQ").ok).toBe(
      false,
    );
  });
});

describe("parseStreamSource, Vimeo", () => {
  it("takes a plain link, a player link and an unlisted hash", () => {
    expect(ok("vimeo", "https://vimeo.com/76979871").videoId).toBe("76979871");
    expect(ok("vimeo", "https://player.vimeo.com/video/76979871").videoId).toBe("76979871");
    expect(ok("vimeo", "https://vimeo.com/76979871/a1b2c3d4e5").videoId).toBe("76979871");
  });

  it("normalises both URLs", () => {
    const v = ok("vimeo", "https://player.vimeo.com/video/76979871");
    expect(v.watchUrl).toBe("https://vimeo.com/76979871");
    expect(v.embedUrl).toBe("https://player.vimeo.com/video/76979871");
  });

  it("refuses a Vimeo profile", () => {
    expect(parseStreamSource("vimeo", "https://vimeo.com/knowledgegraph").ok).toBe(false);
  });
});

describe("parseStreamSource, Zoom", () => {
  it("takes a vanity subdomain", () => {
    expect(ok("zoom", "https://kgc.zoom.us/j/8412345678?pwd=abcdef").embeddable).toBe(false);
  });

  it("keeps the passcode, because stripping it asks every attendee for one nobody gave them", () => {
    expect(ok("zoom", "https://kgc.zoom.us/j/8412345678?pwd=abcdef").watchUrl).toContain(
      "pwd=abcdef",
    );
  });

  it("refuses a host that merely ends in the same letters", () => {
    expect(parseStreamSource("zoom", "https://zoom.us.evil.example/j/1").ok).toBe(false);
  });
});

describe("parseStreamSource, a plain embed link", () => {
  it("takes any https address and frames it", () => {
    const v = ok("embed", "https://stream.example.org/kgc/keynote");
    expect(v.embedUrl).toBe("https://stream.example.org/kgc/keynote");
    expect(v.embeddable).toBe(true);
  });

  it("refuses javascript:, which is the box a script gets typed into", () => {
    expect(parseStreamSource("embed", "javascript:alert(1)").ok).toBe(false);
  });

  it("refuses an unknown provider rather than guessing one", () => {
    expect(parseStreamSource("twitch", "https://twitch.tv/kgc").ok).toBe(false);
  });

  it("refuses an empty box", () => {
    expect(parseStreamSource("embed", "   ").ok).toBe(false);
  });
});

describe("providerLabel", () => {
  it("names all four", () => {
    expect([
      providerLabel("youtube"),
      providerLabel("vimeo"),
      providerLabel("zoom"),
      providerLabel("embed"),
    ]).toEqual(["YouTube", "Vimeo", "Zoom", "Embed link"]);
  });
});

describe("mayWatch", () => {
  it("lets everybody in when no ticket types are named", () => {
    expect(mayWatch({ allowedTicketTypes: [] }, "Main Conference")).toBe(true);
    expect(mayWatch({ allowedTicketTypes: [] }, null)).toBe(true);
  });

  it("reads an absent list as no restriction, which is what old documents are", () => {
    expect(mayWatch({}, null)).toBe(true);
  });

  it("admits a named ticket and refuses one that is not named", () => {
    const gated = { allowedTicketTypes: ["All Access"] };
    expect(mayWatch(gated, "All Access")).toBe(true);
    expect(mayWatch(gated, "Main Conference")).toBe(false);
  });

  it("refuses somebody whose ticket type is unknown when the list is not empty", () => {
    expect(mayWatch({ allowedTicketTypes: ["All Access"] }, null)).toBe(false);
    expect(mayWatch({ allowedTicketTypes: ["All Access"] }, "")).toBe(false);
  });

  it("matches the name exactly, because a near miss hides the video from everyone", () => {
    expect(mayWatch({ allowedTicketTypes: ["All Access"] }, "all access")).toBe(false);
  });
});

describe("recordingWindow", () => {
  const T = Date.UTC(2027, 4, 12, 12, 0, 0);

  it("is available when neither end is set", () => {
    expect(recordingWindow({}, T)).toBe("available");
  });

  it("is not yet available before the opening date", () => {
    expect(recordingWindow({ availableFromMs: T + 1000 }, T)).toBe("not-yet");
  });

  it("is available on the opening instant", () => {
    expect(recordingWindow({ availableFromMs: T }, T)).toBe("available");
  });

  it("expires on the closing instant rather than a millisecond later", () => {
    expect(recordingWindow({ availableUntilMs: T }, T)).toBe("expired");
    expect(recordingWindow({ availableUntilMs: T + 1 }, T)).toBe("available");
  });

  it("reads null the same as absent", () => {
    expect(recordingWindow({ availableFromMs: null, availableUntilMs: null }, T)).toBe("available");
  });
});

describe("formatDuration", () => {
  it("drops the hour when there is none", () => {
    expect(formatDuration(247)).toBe("4:07");
  });

  it("keeps it when there is", () => {
    expect(formatDuration(3930)).toBe("1:05:30");
  });

  it("says nothing for a duration nobody supplied", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(Number.NaN)).toBe("");
  });
});

describe("parseDuration", () => {
  it("reads bare minutes, minutes and seconds, and hours", () => {
    expect(parseDuration("90")).toBe(5400);
    expect(parseDuration("65:30")).toBe(3930);
    expect(parseDuration("1:05:30")).toBe(3930);
  });

  it("round-trips with formatDuration", () => {
    expect(formatDuration(parseDuration("1:05:30")!)).toBe("1:05:30");
  });

  it("returns nothing for an empty box rather than zero", () => {
    expect(parseDuration("")).toBe(null);
  });

  it("refuses prose, because a duration that reads as zero says a talk is empty", () => {
    expect(parseDuration("about an hour")).toBe(null);
    expect(parseDuration("1:2:3:4")).toBe(null);
    expect(parseDuration("12:99")).toBe(null);
  });
});
