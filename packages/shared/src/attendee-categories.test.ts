import { describe, expect, it } from "vitest";

import {
  DEFAULT_ATTENDEE_CATEGORIES,
  applyCategoryEdit,
  applyTicketRule,
  categoryForTicket,
  categoryFromRule,
  resolveAttendeeCategories,
  resolveTicketRules,
} from "./attendee-categories.js";

const cats = DEFAULT_ATTENDEE_CATEGORIES;

describe("resolveAttendeeCategories", () => {
  it("falls back to the five defaults when nothing usable is stored", () => {
    expect(resolveAttendeeCategories(undefined)).toEqual(cats);
    expect(resolveAttendeeCategories([])).toEqual(cats);
    expect(resolveAttendeeCategories([{ id: "", name: "x" }, null])).toEqual(cats);
  });

  it("keeps stored order, drops repeats and an unknown colour reads as grey", () => {
    expect(
      resolveAttendeeCategories([
        { id: "media", name: " Media ", color: "teal" },
        { id: "vip", name: "VIP", color: "red" },
        { id: "media", name: "Again", color: "blue" },
      ]),
    ).toEqual([
      { id: "media", name: "Media", color: "grey" },
      { id: "vip", name: "VIP", color: "red" },
    ]);
  });
});

describe("ticket rules", () => {
  const rules = [{ ticketType: "All Access (VIP)", categoryId: "vip" }];

  it("matches a ticket type whatever its case and spacing", () => {
    expect(categoryForTicket(cats, rules, "  all access  (vip) ")?.id).toBe("vip");
    expect(categoryForTicket(cats, rules, "Main Conference")).toBeUndefined();
    expect(categoryForTicket(cats, rules, undefined)).toBeUndefined();
  });

  it("drops a stored rule whose category has been deleted, and a repeat", () => {
    expect(
      resolveTicketRules(
        [
          { ticketType: "Press Pass", categoryId: "press" },
          { ticketType: "press pass", categoryId: "vip" },
          { ticketType: "Workshop", categoryId: "gone" },
          { ticketType: "", categoryId: "vip" },
        ],
        cats,
      ),
    ).toEqual([{ ticketType: "Press Pass", categoryId: "press" }]);
  });

  it("sets, replaces and clears the rule for one ticket type", () => {
    const set = applyTicketRule(cats, rules, "Press Pass", "press");
    expect(set.ok && set.rules).toHaveLength(2);

    const replaced = applyTicketRule(cats, rules, "all access (vip)", "staff");
    expect(replaced.ok && replaced.rules).toEqual([{ ticketType: "all access (vip)", categoryId: "staff" }]);

    const cleared = applyTicketRule(cats, rules, "All Access (VIP)", "");
    expect(cleared.ok && cleared.rules).toEqual([]);

    expect(applyTicketRule(cats, rules, "Press Pass", "gone").ok).toBe(false);
  });
});

describe("categoryFromRule", () => {
  const rules = [{ ticketType: "All Access (VIP)", categoryId: "vip" }];

  it("gives a new registration the category its ticket maps to", () => {
    expect(categoryFromRule({}, cats, rules, "All Access (VIP)")).toEqual({
      categoryId: "vip",
      category: "VIP",
      categorySource: "ticket",
    });
  });

  it("never overrides a category an organizer set by hand", () => {
    expect(categoryFromRule({ categorySource: "manual" }, cats, rules, "All Access (VIP)")).toBe("keep");
  });

  it("leaves the category alone when no rule names the ticket", () => {
    expect(categoryFromRule({ categorySource: "ticket" }, cats, rules, "Main Conference")).toBe("keep");
  });
});

describe("applyCategoryEdit", () => {
  it("adds a custom category with an id minted from its name", () => {
    const res = applyCategoryEdit(cats, { op: "add", name: " Media  Partner ", color: "green" });
    expect(res.ok && res.categories.at(-1)).toEqual({ id: "media-partner", name: "Media Partner", color: "green" });
  });

  it("refuses a blank name, a duplicate and a name with no letters", () => {
    expect(applyCategoryEdit(cats, { op: "add", name: " ", color: "blue" }).ok).toBe(false);
    expect(applyCategoryEdit(cats, { op: "add", name: "vip", color: "blue" }).ok).toBe(false);
    expect(applyCategoryEdit(cats, { op: "add", name: "!!!", color: "blue" }).ok).toBe(false);
  });

  it("renames without changing the id registrations point at", () => {
    const res = applyCategoryEdit(cats, { op: "rename", id: "vip", name: "Guest of honour", color: "purple" });
    expect(res.ok && res.categories.find((c) => c.id === "vip")).toEqual({
      id: "vip",
      name: "Guest of honour",
      color: "purple",
    });
  });

  it("removes a category but keeps the last one", () => {
    const res = applyCategoryEdit(cats, { op: "remove", id: "press" });
    expect(res.ok && res.categories.map((c) => c.id)).toEqual(["speaker", "sponsor", "staff", "vip"]);
    expect(applyCategoryEdit([cats[0]], { op: "remove", id: "speaker" }).ok).toBe(false);
    expect(applyCategoryEdit(cats, { op: "remove", id: "gone" }).ok).toBe(false);
  });
});
