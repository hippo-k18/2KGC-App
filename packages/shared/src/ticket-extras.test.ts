import { describe, expect, it } from "vitest";
import {
  cartVerdictForExtra,
  chooseExtraBase,
  chooseExtraOnlyBadge,
  heldTicketNames,
  isExtraOnlyBadge,
  orderSeatsForExtras,
  ticketLabel,
  type ExtraTierShape,
} from "./ticket-extras.js";
import { ineligibleMessage, ticketEligible } from "./session-seats.js";
import { mayWatch } from "./stream-core.js";

const workshops: ExtraTierShape = {
  id: "workshops",
  name: "Workshops",
  kind: "extra",
  addOnFor: "main-conference",
  includesWorkshops: true,
  inPerson: true,
};
const tiers: ExtraTierShape[] = [
  workshops,
  { id: "main-conference", name: "Main Conference", inPerson: true },
  { id: "all-access", name: "All Access (VIP)", includesWorkshops: true, inPerson: true },
  { id: "virtual", name: "Virtual", inPerson: false },
  {
    id: "main-conference-continuing-education",
    name: "Main Conference + Continuing education units",
    bundleOf: ["main-conference", "continuing-education"],
    inPerson: true,
  },
];
const byName = (n: string) => tiers.find((t) => t.name === n);
const byId = (id: string) => tiers.find((t) => t.id === id);

describe("the badge label", () => {
  it("reads the admission ticket and its extras together", () => {
    expect(ticketLabel({ ticketType: "Main Conference", extraNames: ["Workshops"] })).toBe(
      "Main Conference + Workshops",
    );
    expect(ticketLabel({ ticketType: "Main Conference" })).toBe("Main Conference");
    expect(ticketLabel({}, "Ticket")).toBe("Ticket");
    expect(heldTicketNames({ ticketType: "Main Conference", extraNames: ["Workshops", "Workshops"] })).toEqual([
      "Main Conference",
      "Workshops",
    ]);
  });
});

describe("which badge Workshops goes on", () => {
  it("goes on the Main Conference badge", () => {
    expect(
      chooseExtraBase(workshops, [{ registrationId: "r1", status: "active", ticketType: "Main Conference" }], byName),
    ).toEqual({ ok: true, registrationId: "r1" });
  });

  it("goes on a Main Conference bundle too (CEUs)", () => {
    const v = chooseExtraBase(
      workshops,
      [{ registrationId: "r1", status: "active", ticketType: "Main Conference + Continuing education units" }],
      byName,
    );
    expect(v).toEqual({ ok: true, registrationId: "r1" });
  });

  it("picks the newest active Main Conference when an address holds two", () => {
    const v = chooseExtraBase(
      workshops,
      [
        { registrationId: "old", status: "active", ticketType: "Main Conference", createdAtMs: 1 },
        { registrationId: "new", status: "active", ticketType: "Main Conference", createdAtMs: 2 },
        { registrationId: "gone", status: "cancelled", ticketType: "Main Conference", createdAtMs: 3 },
      ],
      byName,
    );
    expect(v).toEqual({ ok: true, registrationId: "new" });
  });

  it("is a badge of its own for an address with no ticket (T186)", () => {
    expect(chooseExtraBase(workshops, [], byName)).toEqual({ ok: true });
    expect(
      chooseExtraBase(workshops, [{ registrationId: "r", status: "cancelled", ticketType: "Main Conference" }], byName),
    ).toEqual({ ok: true });
  });

  it("goes on a Virtual badge (T186)", () => {
    expect(
      chooseExtraBase(workshops, [{ registrationId: "r", status: "active", ticketType: "Virtual" }], byName),
    ).toEqual({ ok: true, registrationId: "r" });
  });

  it("goes on a badge whose ticket is not in the catalogue, such as an imported one", () => {
    expect(
      chooseExtraBase(workshops, [{ registrationId: "r", status: "active", ticketType: "Speaker" }], byName),
    ).toEqual({ ok: true, registrationId: "r" });
  });

  it("refuses a second Workshops for a Workshops-only badge", () => {
    expect(
      chooseExtraBase(workshops, [{ registrationId: "w", status: "active", ticketType: "Workshops" }], byName),
    ).toEqual({ ok: false, reason: "already", registrationId: "w" });
  });

  it("refuses All Access, which includes the workshops", () => {
    expect(
      chooseExtraBase(
        workshops,
        [
          { registrationId: "a", status: "active", ticketType: "All Access (VIP)" },
          { registrationId: "m", status: "active", ticketType: "Main Conference" },
        ],
        byName,
      ),
    ).toEqual({ ok: false, reason: "included", heldName: "All Access (VIP)" });
  });

  it("refuses a second Workshops on the same badge", () => {
    expect(
      chooseExtraBase(
        workshops,
        [{ registrationId: "r", status: "active", ticketType: "Main Conference", extras: [{ tierId: "workshops" }] }],
        byName,
      ),
    ).toEqual({ ok: false, reason: "already", registrationId: "r" });
  });
});

describe("Workshops in the same cart", () => {
  it("is covered by Main Conference for the same person", () => {
    const seats = [
      { email: "ada@example.com", tierId: "main-conference" },
      { email: "ADA@example.com", tierId: "workshops" },
    ];
    expect(cartVerdictForExtra(workshops, 1, seats, byId)).toEqual({ covered: true });
  });

  it("is covered by Virtual for the same person (T186)", () => {
    const seats = [
      { email: "a@x.io", tierId: "virtual" },
      { email: "a@x.io", tierId: "workshops" },
    ];
    expect(cartVerdictForExtra(workshops, 1, seats, byId)).toEqual({ covered: true });
  });

  it("is not covered by somebody else's Main Conference", () => {
    const seats = [
      { email: "ada@example.com", tierId: "main-conference" },
      { email: "bob@example.com", tierId: "workshops" },
    ];
    expect(cartVerdictForExtra(workshops, 1, seats, byId)).toEqual({ covered: false });
  });

  it("is refused beside All Access for the same person", () => {
    expect(
      cartVerdictForExtra(workshops, 1, [
        { email: "a@x.io", tierId: "all-access" },
        { email: "a@x.io", tierId: "workshops" },
      ], byId),
    ).toEqual({ covered: false, refusal: "included", heldName: "All Access (VIP)" });
  });

  it("is refused twice for one person", () => {
    const seats = [
      { email: "a@x.io", tierId: "main-conference" },
      { email: "a@x.io", tierId: "workshops" },
      { email: "a@x.io", tierId: "workshops" },
    ];
    expect(cartVerdictForExtra(workshops, 2, seats, byId)).toEqual({ covered: false, refusal: "already" });
  });

  it("puts extras after admission tickets and keeps the buyer first", () => {
    const isExtra = (id: string) => id === "workshops";
    expect(
      orderSeatsForExtras(
        [
          { email: "buyer@x.io", tierId: "workshops" },
          { email: "bob@x.io", tierId: "workshops" },
          { email: "bob@x.io", tierId: "main-conference" },
          { email: "buyer@x.io", tierId: "main-conference" },
        ],
        isExtra,
      ),
    ).toEqual([
      { email: "buyer@x.io", tierId: "main-conference" },
      { email: "bob@x.io", tierId: "main-conference" },
      { email: "bob@x.io", tierId: "workshops" },
      { email: "buyer@x.io", tierId: "workshops" },
    ]);
  });
});

describe("access with extras", () => {
  const limited = { eligibleTicketTypes: ["Workshops", "All Access (VIP)"] };

  it("lets Main Conference + Workshops into a workshop limited to Workshops", () => {
    expect(ticketEligible(limited, ["Main Conference", "Workshops"])).toBe(true);
    expect(ticketEligible(limited, "Main Conference")).toBe(false);
    expect(ticketEligible(limited, [])).toBe(false);
    expect(ticketEligible({}, null)).toBe(true);
  });

  it("names every ticket on the badge when it refuses", () => {
    expect(ineligibleMessage(limited, ["Main Conference"])).toBe(
      "This session is for Workshops and All Access (VIP) tickets. Your ticket is Main Conference.",
    );
  });

  it("lets an extra unlock a restricted stream", () => {
    expect(mayWatch({ allowedTicketTypes: ["Workshops"] }, ["Main Conference", "Workshops"])).toBe(true);
    expect(mayWatch({ allowedTicketTypes: ["Workshops"] }, "Main Conference")).toBe(false);
    expect(mayWatch({ allowedTicketTypes: [] }, null)).toBe(true);
  });
});

describe("a conference ticket joins a Workshops-only badge (T186)", () => {
  it("picks the newest active Workshops-only badge", () => {
    expect(
      chooseExtraOnlyBadge(
        [
          { registrationId: "main", status: "active", ticketType: "Main Conference", createdAtMs: 9 },
          { registrationId: "w1", status: "active", ticketType: "Workshops", createdAtMs: 1 },
          { registrationId: "w2", status: "active", ticketType: "Workshops", createdAtMs: 2 },
          { registrationId: "w3", status: "cancelled", ticketType: "Workshops", createdAtMs: 3 },
        ],
        byName,
      ),
    ).toBe("w2");
  });

  it("joins nothing when there is no Workshops-only badge", () => {
    expect(
      chooseExtraOnlyBadge([{ registrationId: "m", status: "active", ticketType: "Main Conference" }], byName),
    ).toBeNull();
    expect(chooseExtraOnlyBadge([], byName)).toBeNull();
  });

  it("knows a Workshops-only badge from one with Workshops beside a ticket", () => {
    expect(isExtraOnlyBadge({ ticketType: "Workshops" }, ["Workshops"])).toBe(true);
    expect(isExtraOnlyBadge({ ticketType: "Main Conference", extraNames: ["Workshops"] }, ["Workshops"])).toBe(false);
  });
});

describe("seat checks for a Workshops-only badge (T186)", () => {
  it("opens a workshop limited to Workshops and nothing limited to the conference", () => {
    expect(ticketEligible({ eligibleTicketTypes: ["Workshops", "All Access (VIP)"] }, ["Workshops"])).toBe(true);
    expect(ticketEligible({ eligibleTicketTypes: ["Main Conference", "All Access (VIP)"] }, ["Workshops"])).toBe(false);
    expect(mayWatch({ allowedTicketTypes: ["Workshops"] }, ["Workshops"])).toBe(true);
  });
});
