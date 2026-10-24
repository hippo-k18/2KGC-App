import { describe, expect, it } from "vitest";

import {
  EMPTY_SEATS,
  canClaim,
  ineligibleMessage,
  isGated,
  planJoin,
  planLeaveSeat,
  planLeaveWaitlist,
  planPromotions,
  seatCap,
  seatStateOf,
  seatsLeft,
  ticketEligible,
} from "./session-seats.js";

describe("isGated and seatCap", () => {
  it("treats 0 and absent as uncapped", () => {
    expect(seatCap({})).toBeNull();
    expect(seatCap({ capacity: 0 })).toBeNull();
    expect(seatCap({ capacity: 40 })).toBe(40);
    expect(isGated({})).toBe(false);
    expect(isGated({ capacity: 0, eligibleTicketTypes: [] })).toBe(false);
  });

  it("is gated by a cap or by a ticket list", () => {
    expect(isGated({ capacity: 2 })).toBe(true);
    expect(isGated({ eligibleTicketTypes: ["Full Pass"] })).toBe(true);
  });
});

describe("ticketEligible", () => {
  it("lets everybody into an unrestricted session", () => {
    expect(ticketEligible({}, undefined)).toBe(true);
    expect(ticketEligible({ eligibleTicketTypes: [] }, "Main Conference")).toBe(true);
  });

  it("matches the ticket type verbatim and refuses a missing one", () => {
    const gate = { eligibleTicketTypes: ["Full Pass", "Workshop Pass"] };
    expect(ticketEligible(gate, "Full Pass")).toBe(true);
    expect(ticketEligible(gate, "full pass")).toBe(false);
    expect(ticketEligible(gate, "Main Conference")).toBe(false);
    expect(ticketEligible(gate, null)).toBe(false);
  });

  it("writes a message that names the tickets and the holder's own", () => {
    const gate = { eligibleTicketTypes: ["Full Pass", "Workshop Pass"] };
    expect(ineligibleMessage(gate, "Main Conference")).toBe(
      "This session is for Full Pass and Workshop Pass tickets. Your ticket is Main Conference.",
    );
    expect(ineligibleMessage({ eligibleTicketTypes: ["Full Pass"] }, null)).toBe(
      "This session is for Full Pass tickets.",
    );
  });
});

describe("planJoin", () => {
  it("seats while there is room", () => {
    expect(planJoin(EMPTY_SEATS, { capacity: 2 }, "a")).toEqual({
      kind: "seated",
      next: { taken: 1, waitlist: [] },
    });
  });

  it("waitlists at the cap, in arrival order", () => {
    const full = { taken: 2, waitlist: ["c"] };
    expect(planJoin(full, { capacity: 2 }, "d")).toEqual({
      kind: "waitlisted",
      next: { taken: 2, waitlist: ["c", "d"] },
      position: 2,
    });
  });

  it("does not let a newcomer jump a queue when a seat is briefly open", () => {
    const plan = planJoin({ taken: 1, waitlist: ["c"] }, { capacity: 2 }, "d");
    expect(plan.kind).toBe("waitlisted");
  });

  it("never waitlists an uncapped, ticket-restricted session", () => {
    const plan = planJoin({ taken: 900, waitlist: [] }, { eligibleTicketTypes: ["Full Pass"] }, "a");
    expect(plan.kind).toBe("seated");
  });

  it("does not add the same uid twice", () => {
    const plan = planJoin({ taken: 2, waitlist: ["c"] }, { capacity: 2 }, "c");
    expect(plan.next.waitlist).toEqual(["c"]);
  });
});

describe("planLeaveSeat", () => {
  it("frees the seat when nobody is waiting", () => {
    expect(planLeaveSeat({ taken: 2, waitlist: [] }, { capacity: 2 })).toEqual({
      next: { taken: 1, waitlist: [] },
      promote: null,
    });
  });

  it("hands the seat to the first person waiting", () => {
    expect(planLeaveSeat({ taken: 2, waitlist: ["c", "d"] }, { capacity: 2 })).toEqual({
      next: { taken: 2, waitlist: ["d"] },
      promote: "c",
    });
  });

  it("promotes nobody while the session is over a lowered cap", () => {
    expect(planLeaveSeat({ taken: 5, waitlist: ["c"] }, { capacity: 3 })).toEqual({
      next: { taken: 4, waitlist: ["c"] },
      promote: null,
    });
  });

  it("never goes below zero", () => {
    expect(planLeaveSeat({ taken: 0, waitlist: [] }, { capacity: 3 }).next.taken).toBe(0);
  });
});

describe("waitlist", () => {
  it("leaves without touching the count or the order", () => {
    expect(planLeaveWaitlist({ taken: 2, waitlist: ["c", "d", "e"] }, "d")).toEqual({
      taken: 2,
      waitlist: ["c", "e"],
    });
  });

  it("lets only the first in line claim, and only when there is room", () => {
    const state = { taken: 2, waitlist: ["c", "d"] };
    expect(canClaim(state, { capacity: 3 }, "c")).toBe(true);
    expect(canClaim(state, { capacity: 3 }, "d")).toBe(false);
    expect(canClaim(state, { capacity: 2 }, "c")).toBe(false);
  });

  it("promotes as many as a raised cap allows, in order", () => {
    expect(planPromotions({ taken: 2, waitlist: ["c", "d", "e"] }, { capacity: 4 })).toEqual({
      next: { taken: 4, waitlist: ["e"] },
      promoted: ["c", "d"],
    });
    expect(planPromotions({ taken: 2, waitlist: ["c"] }, { capacity: 2 }).promoted).toEqual([]);
    expect(planPromotions({ taken: 2, waitlist: ["c", "d"] }, {}).promoted).toEqual(["c", "d"]);
  });
});

describe("seatStateOf and seatsLeft", () => {
  it("reads a missing or malformed counter as empty", () => {
    expect(seatStateOf(undefined)).toEqual(EMPTY_SEATS);
    expect(seatStateOf({ taken: -3, waitlist: "x" })).toEqual(EMPTY_SEATS);
    expect(seatStateOf({ taken: 2, waitlist: ["a", 4] })).toEqual({ taken: 2, waitlist: ["a"] });
  });

  it("counts what is left and is null when uncapped", () => {
    expect(seatsLeft({ taken: 3, waitlist: [] }, { capacity: 5 })).toBe(2);
    expect(seatsLeft({ taken: 7, waitlist: [] }, { capacity: 5 })).toBe(0);
    expect(seatsLeft({ taken: 7, waitlist: [] }, {})).toBeNull();
  });
});
