import { describe, expect, it } from "vitest";

import {
  andList,
  tierPromisesWatching,
  tiersPromisedWatching,
  withPromisedTiers,
  type WatchPromiseTier,
} from "./watch-promise-core.js";

/**
 * The real catalogue, copied from `scripts/src/lib/ticket-types.ts`.
 *
 * Copied rather than imported: `@kgc/shared` must not depend on `@kgc/scripts`,
 * which reaches for `node:crypto`. The lines that matter are the ones that were
 * got wrong and the ones that would be got wrong by a looser match, so they are
 * here verbatim and a drift in either file shows up as a failing expectation
 * about a tier name, not as a silent pass.
 */
const CATALOGUE: WatchPromiseTier[] = [
  {
    name: "All Access (VIP)",
    includesVideoLibrary: true,
    includes: [
      "Every in-person session, Monday to Friday",
      "All evening networking events, including the Friday watch party",
      "Live streams and recordings of every virtual session",
      "Three months of the KGC Video Library",
    ],
    groups: [
      { heading: "All Virtual Sessions", items: ["Live streams of every session", "Recordings of every session"] },
      { heading: "KGC Video Library Subscription (3 months)" },
    ],
  },
  {
    name: "Main Conference",
    includesVideoLibrary: true,
    includes: [
      "Every main conference session, Wednesday to Friday",
      "All evening networking events, including the Friday watch party",
      "Virtual conference sessions on demand",
      "Three months of the KGC Video Library",
    ],
    groups: [{ heading: "Virtual sessions", items: ["Every conference session, streamed on demand"] }],
  },
  {
    name: "Workshops",
    includesVideoLibrary: false,
    includes: [
      "Every in-person workshop, Monday and Tuesday",
      "Workshop materials and datasets to take home",
      "Community happy hour",
    ],
  },
  {
    name: "Virtual",
    includesVideoLibrary: false,
    includes: [
      "Live streams of every conference and workshop session",
      "Watch Monday through Friday in your own time zone",
      "On-demand replays for at least a month afterwards",
      "The virtual hallway track, and session Q&A in the KGC app",
    ],
  },
  {
    name: "Startup Table",
    includesVideoLibrary: false,
    includes: [
      "One poseur table in the exhibition hall, Wednesday to Friday",
      "One Main Conference pass for booth staff",
      "Lead capture by badge scan, with no per-lead fee",
    ],
  },
  {
    name: "Premium Booth",
    includesVideoLibrary: false,
    includes: [
      "Four All Access passes for booth staff",
      "A ten-minute demo slot on the exhibition-hall stage",
    ],
  },
  {
    name: "Silver",
    includesVideoLibrary: false,
    includes: [
      "Everything in Bronze",
      "A banner in the KGC app's sponsor rotation",
      "Opt-in contact details from attendees who save your listing",
    ],
  },
  {
    name: "Gold",
    includesVideoLibrary: true,
    includes: ["Everything in Silver", "A 30-minute sponsored session, listed in the agenda like any other"],
  },
  {
    name: "Platinum",
    includesVideoLibrary: true,
    includes: ["Everything in Gold", "A keynote-adjacent 45-minute session"],
  },
];

describe("tierPromisesWatching", () => {
  it("reads the Virtual tier's own bullets, which the video-library flag misses", () => {
    // The finding: $349, not in the room, flag off, and its first two bullets
    // sell exactly the two things it was being locked out of.
    const virtual = CATALOGUE.find((t) => t.name === "Virtual")!;
    expect(virtual.includesVideoLibrary).toBe(false);
    expect(tierPromisesWatching(virtual, "stream")).toBe(true);
    expect(tierPromisesWatching(virtual, "recording")).toBe(true);
  });

  it("does not sell Main Conference a live stream it never offered", () => {
    // "streamed on demand" is a recording. A seat at the live stream is a
    // different thing and this tier does not claim one.
    const main = CATALOGUE.find((t) => t.name === "Main Conference")!;
    expect(tierPromisesWatching(main, "stream")).toBe(false);
    expect(tierPromisesWatching(main, "recording")).toBe(true);
  });

  it("keeps the flag working on its own for a tier whose bullets say nothing", () => {
    const gold = CATALOGUE.find((t) => t.name === "Gold")!;
    expect(tierPromisesWatching(gold, "recording")).toBe(true);
    expect(tierPromisesWatching(gold, "stream")).toBe(false);
  });

  it("is not fooled by the Friday watch party", () => {
    expect(
      tierPromisesWatching({ name: "Party", includes: ["The Friday watch party"] }, "stream"),
    ).toBe(false);
    expect(
      tierPromisesWatching({ name: "Party", includes: ["The Friday watch party"] }, "recording"),
    ).toBe(false);
  });

  it("is not fooled by an exhibitor package that includes somebody else's pass", () => {
    const table = CATALOGUE.find((t) => t.name === "Startup Table")!;
    expect(tierPromisesWatching(table, "stream")).toBe(false);
    expect(tierPromisesWatching(table, "recording")).toBe(false);
  });

  it("leaves a tier that promises neither excludable, which is the point of the control", () => {
    const workshops = CATALOGUE.find((t) => t.name === "Workshops")!;
    expect(tierPromisesWatching(workshops, "stream")).toBe(false);
    expect(tierPromisesWatching(workshops, "recording")).toBe(false);
  });

  it("reads a group heading as copy the buyer saw", () => {
    expect(
      tierPromisesWatching(
        { name: "Bundle", groups: [{ heading: "KGC Video Library Subscription (3 months)" }] },
        "recording",
      ),
    ).toBe(true);
  });
});

describe("tiersPromisedWatching", () => {
  it("names the two tiers sold a live stream", () => {
    expect(tiersPromisedWatching(CATALOGUE, "stream")).toEqual(["All Access (VIP)", "Virtual"]);
  });

  it("names every tier sold something to watch back, Virtual among them", () => {
    expect(tiersPromisedWatching(CATALOGUE, "recording")).toEqual([
      "All Access (VIP)",
      "Gold",
      "Main Conference",
      "Platinum",
      "Virtual",
    ]);
  });

  it("drops a tier with no name rather than restoring an empty string", () => {
    expect(tiersPromisedWatching([{ name: "  ", includesVideoLibrary: true }], "recording")).toEqual(
      [],
    );
  });
});

describe("withPromisedTiers", () => {
  it("leaves an unrestricted video alone, because empty already means everybody", () => {
    expect(withPromisedTiers([], ["All Access (VIP)", "Virtual"])).toEqual({
      allowed: [],
      restored: [],
    });
  });

  it("adds back what was sold and reports it", () => {
    expect(withPromisedTiers(["Workshops"], ["All Access (VIP)", "Virtual"])).toEqual({
      allowed: ["Workshops", "All Access (VIP)", "Virtual"],
      restored: ["All Access (VIP)", "Virtual"],
    });
  });

  it("does not duplicate a tier the organizer already ticked", () => {
    expect(withPromisedTiers(["Virtual"], ["Virtual"])).toEqual({
      allowed: ["Virtual"],
      restored: [],
    });
  });
});

describe("andList", () => {
  it("joins with and, and only commas before the last", () => {
    expect(andList(["Virtual"])).toBe("Virtual");
    expect(andList(["Virtual", "Gold"])).toBe("Virtual and Gold");
    expect(andList(["Virtual", "Gold", "Platinum"])).toBe("Virtual, Gold and Platinum");
    expect(andList([])).toBe("");
  });
});
