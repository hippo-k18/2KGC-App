import { describe, expect, it } from "vitest";

import {
  leadConsentWording,
  leadLinkState,
  leadTimestamp,
  leadsCsv,
  normaliseLeadNote,
  readScannedCode,
} from "./leads-core.js";

describe("leadConsentWording", () => {
  /**
   * Pinned, not because the words are sacred but because the stored record
   * quotes them. A reworded sentence must be a deliberate change that fails a
   * test, not a tidy-up that silently makes every earlier lead claim agreement
   * to something nobody saw.
   */
  it("names the exhibitor and says what is shared", () => {
    expect(leadConsentWording("Graphwise")).toBe(
      "Share your name, company, job title and email address with Graphwise. They can contact you about their products after the conference.",
    );
  });

  it("still reads as a sentence when the exhibitor has no name on file", () => {
    expect(leadConsentWording("  ")).toContain("with this exhibitor.");
  });
});

describe("readScannedCode", () => {
  it("reads a badge secret, which is 32 base64url characters", () => {
    const secret = "AbC123_-defGHIjklMNOpqrsTUVwxyz4";
    expect(readScannedCode(secret)).toEqual({ kind: "badge", code: secret });
  });

  it("keeps a badge secret's case, because it is compared exactly", () => {
    const secret = "aBcDeFgHiJkLmNoPqRsTuVwXyZ012345";
    expect(readScannedCode(secret)?.code).toBe(secret);
  });

  it("reads a six-character claim code and folds it up", () => {
    expect(readScannedCode(" je5nth ")).toEqual({ kind: "claim", code: "JE5NTH" });
  });

  it("refuses an empty frame and anything that is not either shape", () => {
    expect(readScannedCode("")).toBeNull();
    expect(readScannedCode("   ")).toBeNull();
    expect(readScannedCode("https://knowledgegraph.tech/agenda")).toBeNull();
    expect(readScannedCode("ABC")).toBeNull();
    expect(readScannedCode("ABCDEFG")).toBeNull();
  });
});

describe("normaliseLeadNote", () => {
  it("returns null for nothing, so the caller deletes the field", () => {
    expect(normaliseLeadNote("")).toBeNull();
    expect(normaliseLeadNote("   \n ")).toBeNull();
  });

  it("trims and caps at 500 characters", () => {
    expect(normaliseLeadNote("  wants the demo  ")).toBe("wants the demo");
    expect(normaliseLeadNote("x".repeat(900))).toHaveLength(500);
  });
});

describe("leadTimestamp", () => {
  it("writes the event's own wall clock", () => {
    expect(leadTimestamp(Date.parse("2027-05-06T15:04:00Z"), "America/New_York")).toBe(
      "2027-05-06 11:04",
    );
  });

  it("writes midnight as 00:00 rather than 24:00", () => {
    expect(leadTimestamp(Date.parse("2027-05-06T04:00:00Z"), "America/New_York")).toBe(
      "2027-05-06 00:00",
    );
  });

  it("is empty when nothing was recorded", () => {
    expect(leadTimestamp(undefined, "America/New_York")).toBe("");
  });

  it("falls back to UTC rather than refusing on an unknown zone", () => {
    expect(leadTimestamp(Date.parse("2027-05-06T15:04:00Z"), "Mars/Olympus")).toBe(
      "2027-05-06 15:04",
    );
  });
});

describe("leadsCsv", () => {
  const rows = [
    {
      registrationId: "reg_1",
      name: "Ada Lovelace",
      email: "ada@example.test",
      company: "Analytical, Ltd",
      title: "Engineer",
      note: "wants the healthcare demo",
      scannedAtMs: Date.parse("2027-05-06T15:04:00Z"),
    },
  ];

  it("carries exactly the six columns the consent line promises", () => {
    const [header] = leadsCsv(rows, "America/New_York").split("\r\n");
    expect(header).toBe(
      "﻿Name,Company,Job title,Email,Scanned (America/New_York),Note",
    );
  });

  it("writes the row, quoting the company that holds a comma", () => {
    expect(leadsCsv(rows, "America/New_York")).toContain(
      'Ada Lovelace,"Analytical, Ltd",Engineer,ada@example.test,2027-05-06 11:04,wants the healthcare demo',
    );
  });

  it("defuses a note typed at a booth that begins with an equals sign", () => {
    const out = leadsCsv([{ ...rows[0]!, note: "=cmd|'/c calc'!A1" }], "UTC");
    expect(out).toContain("\t=cmd");
  });

  it("writes a header even with no leads, so the download is not an empty file", () => {
    expect(leadsCsv([], "UTC").trim()).toContain("Name,Company");
  });
});

/**
 * ── Finding 4, and why each case has to be able to fail ────────────────────
 *
 * The dashboard tagged a stand "stopped" and printed a working link beside it.
 * Revocation is `iat < validFrom`, which can only refuse tokens that already
 * exist, so a row that mints one as it renders always prints a live link. The
 * property under test is therefore not "revocation works" but "a stopped row
 * makes exactly one claim": `showLink` is false for that state and true for
 * every other.
 */
describe("leadLinkState", () => {
  const HOUR = 3_600_000;
  const t = (h: number) => Date.parse("2027-05-03T00:00:00Z") + h * HOUR;

  it("shows no link at all once a stand's links are stopped", () => {
    expect(leadLinkState({ issuedAtMs: t(1), sentAtMs: t(1), validFromMs: t(2) })).toEqual({
      state: "stopped",
      showLink: false,
    });
  });

  it("is stopped for a stand that was revoked before it was ever issued one", () => {
    expect(leadLinkState({ validFromMs: t(2) })).toEqual({ state: "stopped", showLink: false });
  });

  it("brings the stand back the moment a new link is issued after the revoke", () => {
    const after = leadLinkState({ issuedAtMs: t(3), validFromMs: t(2) });
    expect(after.state).toBe("issued");
    expect(after.showLink).toBe(true);
  });

  it("says emailed only when the accepted mail is not older than the link", () => {
    expect(leadLinkState({ issuedAtMs: t(3), sentAtMs: t(3) }).state).toBe("emailed");
    // A fortnight-old delivery says nothing about the link minted this morning.
    expect(leadLinkState({ issuedAtMs: t(3), sentAtMs: t(1) }).state).toBe("issued");
  });

  it("separates a link that exists from a mail that left", () => {
    expect(leadLinkState({ issuedAtMs: t(1) })).toEqual({ state: "issued", showLink: true });
  });

  it("is none, and still printable, for a stand nothing has been done to", () => {
    expect(leadLinkState({})).toEqual({ state: "none", showLink: true });
  });

  it("ignores a stamp that is not a finite number", () => {
    expect(leadLinkState({ issuedAtMs: Number.NaN, validFromMs: t(2) }).state).toBe("stopped");
    expect(leadLinkState({ issuedAtMs: t(3), validFromMs: Number.NaN }).state).toBe("issued");
  });
});
