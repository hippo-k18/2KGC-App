import { describe, expect, it } from "vitest";

import { exportFilename, toCsv } from "./csv-core.js";

/**
 * The escaping, and in particular the formula guard.
 *
 * It had no test at all while it lived in the dashboard, which is the reason it
 * gets one on the way out: it is the only part of a CSV writer where being
 * wrong is a security fault rather than a cosmetic one, and an exhibitor lead
 * note is typed by somebody with no organizer account.
 */
describe("toCsv", () => {
  const rows = [{ name: "Ada", note: "fine" }];
  const cols = [
    { header: "Name", value: (r: (typeof rows)[number]) => r.name },
    { header: "Note", value: (r: (typeof rows)[number]) => r.note },
  ];

  it("opens with a byte-order mark and ends every line with CRLF", () => {
    expect(toCsv(rows, cols)).toBe("﻿Name,Note\r\nAda,fine\r\n");
  });

  it("quotes a field holding a comma, and doubles an inner quote", () => {
    const out = toCsv([{ name: 'Bell, "Ada"', note: "" }], cols);
    expect(out).toContain('"Bell, ""Ada"""');
  });

  it("keeps a newline inside one quoted field rather than ending the row", () => {
    const out = toCsv([{ name: "two\nlines", note: "x" }], cols);
    expect(out).toBe('﻿Name,Note\r\n"two\nlines",x\r\n');
  });

  it.each(["=cmd|'/c calc'!A1", "+1+1", "-1", "@SUM(A1)"])(
    "defuses %s by prefixing a tab",
    (payload) => {
      const out = toCsv([{ name: payload, note: "" }], cols);
      expect(out).toContain(`\t${payload}`);
      expect(out).not.toContain(`\n${payload}`);
    },
  );

  it("keeps the guard inside the quotes when the cell also needs quoting", () => {
    const out = toCsv([{ name: '=HYPERLINK("a","b")', note: "" }], cols);
    expect(out).toContain('"\t=HYPERLINK(""a"",""b"")"');
  });

  it("writes an empty cell for null and undefined rather than the word", () => {
    const out = toCsv(
      [{ a: null, b: undefined }],
      [
        { header: "A", value: (r: { a: null; b: undefined }) => r.a },
        { header: "B", value: (r: { a: null; b: undefined }) => r.b },
      ],
    );
    expect(out).toBe("﻿A,B\r\n,\r\n");
  });

  it("writes only a header row when there is nothing to export", () => {
    expect(toCsv([], cols)).toBe("﻿Name,Note\r\n");
  });
});

describe("exportFilename", () => {
  it("carries the kind and the date", () => {
    expect(exportFilename("leads", new Date("2027-05-06T11:00:00Z"))).toBe(
      "kgc-2027-leads-2027-05-06.csv",
    );
  });
});
