/**
 * Tests for CSV generation.
 *
 * Two of these matter more than the rest. The escaping tests protect a file
 * format that quietly corrupts on a comma; the injection tests protect the
 * person who opens the file.
 *
 * An attendee list is generated from text an attacker controls — anyone can put
 * anything in a name field on a public registration form — and it is opened in
 * Excel, which executes any cell beginning `=`, `+`, `-` or `@`. That makes a
 * conference export a delivery mechanism, and the tests below are the thing
 * standing between the two.
 *
 * Run with: npm run test:programme
 */
import { describe, expect, it } from 'vitest';
import { exportFilename, toCsv, type Column } from '../../apps/organizer/src/lib/csv';

interface Row {
  a: string;
  b?: unknown;
}
const cols: Column<Row>[] = [
  { header: 'A', value: (r) => r.a },
  { header: 'B', value: (r) => r.b },
];

/** Strip the BOM and trailing newline so assertions read cleanly. */
const body = (rows: Row[]) => toCsv(rows, cols).replace(/^﻿/, '').trimEnd().split('\r\n');

describe('escaping', () => {
  it('leaves ordinary values alone', () => {
    expect(body([{ a: 'Ada Nakamura', b: 'Acme' }])[1]).toBe('Ada Nakamura,Acme');
  });

  it('quotes a value containing a comma, or the columns shift', () => {
    expect(body([{ a: 'Nakamura, Ada', b: 'x' }])[1]).toBe('"Nakamura, Ada",x');
  });

  it('doubles an embedded quote', () => {
    expect(body([{ a: 'Ada "Ace" Nakamura', b: 'x' }])[1]).toBe('"Ada ""Ace"" Nakamura",x');
  });

  it('quotes a value containing a newline', () => {
    expect(body([{ a: 'line one\nline two', b: 'x' }])[1]).toBe('"line one\nline two",x');
  });

  it('writes an empty cell for null and undefined rather than the words', () => {
    // `String(undefined)` is "undefined", which is how a spreadsheet ends up
    // with a column of that word where a blank belonged.
    expect(body([{ a: '', b: undefined }])[1]).toBe(',');
    expect(body([{ a: '', b: null }])[1]).toBe(',');
  });

  it('keeps a zero, which is falsy but meaningful', () => {
    expect(body([{ a: 'x', b: 0 }])[1]).toBe('x,0');
  });
});

describe('formula injection', () => {
  // The classic payload. Without the guard, opening the export runs a program.
  it('neutralises a cell beginning with =', () => {
    const out = body([{ a: `=cmd|'/c calc'!A1`, b: 'x' }])[1];
    // Not wrapped in quotes: the payload contains no comma, double-quote or
    // newline, so RFC 4180 quoting does not apply. The leading tab is the
    // guard, and it is legal unquoted.
    expect(out.startsWith('\t=cmd')).toBe(true);
  });

  for (const lead of ['+', '-', '@']) {
    it(`neutralises a cell beginning with ${lead}`, () => {
      const out = body([{ a: `${lead}HYPERLINK("http://evil.example")`, b: 'x' }])[1];
      expect(out).toContain('\t' + lead);
    });
  }

  it('neutralises a leading tab and carriage return too', () => {
    // Both are treated as whitespace by Excel, which then reads the character
    // after them — so a leading tab is a bypass unless it is also guarded.
    expect(body([{ a: '\t=1+1', b: 'x' }])[1]).toContain('\t\t=');
    expect(body([{ a: '\r=1+1', b: 'x' }])[1]).toContain('\t\r=');
  });

  it('does not mangle a value that merely contains an equals sign', () => {
    // Only a *leading* formula character is dangerous. Guarding mid-string
    // would corrupt every URL with a query parameter in it.
    expect(body([{ a: 'https://x.example/?a=1', b: 'x' }])[1]).toBe('https://x.example/?a=1,x');
  });

  it('guards a negative number, accepting that it is the safe wrong answer', () => {
    // `-200` is a legitimate refund figure and it begins with a formula
    // character. Excel would evaluate it to -200 anyway, so guarding costs
    // nothing here — and the exports deliberately format money as `-200.00`
    // strings rather than relying on this.
    expect(body([{ a: '-200', b: 'x' }])[1]).toContain('\t-200');
  });
});

describe('file shape', () => {
  it('starts with a BOM, so Excel on Windows reads UTF-8', () => {
    expect(toCsv([{ a: 'Zoë', b: '' }], cols).charCodeAt(0)).toBe(0xfeff);
  });

  it('uses CRLF line endings, as RFC 4180 requires', () => {
    expect(toCsv([{ a: '1', b: '2' }], cols)).toContain('A,B\r\n1,2\r\n');
  });

  it('writes a header even with no rows, so the columns are still legible', () => {
    expect(body([])).toEqual(['A,B']);
  });

  it('names the file so it is findable six months later', () => {
    expect(exportFilename('attendees', new Date('2027-05-03T12:00:00Z'))).toBe(
      'kgc-2027-attendees-2027-05-03.csv',
    );
  });
});
