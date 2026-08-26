/**
 * Tests for the CSV importer.
 *
 * The parser tests are the ones that matter. An importer is handed files made
 * by Excel, Google Sheets, Eventbrite and somebody's text editor, and the ways
 * those differ — a BOM, CRLF, a quoted comma, a quoted newline inside a cell —
 * are exactly the ways an import silently mangles a delegate list rather than
 * failing loudly.
 *
 * A round-trip test sits at the bottom: anything `csv.ts` writes, this must
 * read back identically. That is the property that makes "export it, fix it in
 * Excel, import it again" safe, which is the workflow every one of the
 * connection guides tells an organizer to use.
 *
 * Run with: npm run test:programme
 */
import { describe, expect, it } from 'vitest';
import {
  ATTENDEE_FIELDS,
  buildPreview,
  guessMapping,
  parseCsv,
} from '../../apps/organizer/src/lib/csv-import';
import { toCsv, type Column } from '../../apps/organizer/src/lib/csv';

describe('parsing', () => {
  it('reads a plain file', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips the BOM Excel writes', () => {
    // Left in place it becomes part of the first header, that column stops
    // matching any alias, and the whole column is silently dropped.
    const rows = parseCsv('﻿Name,Email\nAda,ada@example.com');
    expect(rows[0][0]).toBe('Name');
  });

  it('handles CRLF, which is what Excel emits', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a quoted comma inside one cell', () => {
    expect(parseCsv('name,company\n"Nakamura, Ada",Acme')[1]).toEqual(['Nakamura, Ada', 'Acme']);
  });

  it('keeps a quoted newline inside one cell', () => {
    const rows = parseCsv('a,b\n"line one\nline two",x');
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe('line one\nline two');
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsv('a\n"Ada ""Ace"" Nakamura"')[1][0]).toBe('Ada "Ace" Nakamura');
  });

  it('reads a last row with no trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toHaveLength(2);
  });

  it('drops trailing blank lines, which every spreadsheet adds', () => {
    expect(parseCsv('a,b\n1,2\n\n\n')).toHaveLength(2);
  });

  it('keeps an empty cell rather than collapsing the row', () => {
    expect(parseCsv('a,b,c\n1,,3')[1]).toEqual(['1', '', '3']);
  });
});

describe('column mapping', () => {
  it('matches headers regardless of case and punctuation', () => {
    const m = guessMapping(['Full Name', 'E-mail Address', 'Organisation'], ATTENDEE_FIELDS);
    expect(m.name).toBe(0);
    expect(m.email).toBe(1);
    expect(m.company).toBe(2);
  });

  it('leaves an unmatched field null rather than guessing', () => {
    // A wrong guess is worse than no guess: it imports every name into the
    // company column and nothing looks broken until somebody reads a badge.
    expect(guessMapping(['Name', 'Email'], ATTENDEE_FIELDS).ticketType).toBeNull();
  });

  it('does not assign one column to two fields', () => {
    const m = guessMapping(['Name', 'Name'], ATTENDEE_FIELDS);
    expect(m.name).toBe(0);
    expect(Object.values(m).filter((v) => v === 0)).toHaveLength(1);
  });
});

describe('preview', () => {
  const file = (body: string) => parseCsv(`Name,Email,Ticket\n${body}`);

  it('accepts a good row', () => {
    const p = buildPreview(file('Ada Nakamura,ada@example.com,Main Conference'), ATTENDEE_FIELDS);
    expect(p.errors).toEqual([]);
    expect(p.valid).toEqual([
      { name: 'Ada Nakamura', email: 'ada@example.com', ticketType: 'Main Conference', company: '', title: '' },
    ]);
  });

  it('reports every bad row, not just the first', () => {
    // An importer that stops at the first error makes somebody fix one cell,
    // re-upload, and find the next — an afternoon for a 400-row list.
    const p = buildPreview(file('Ada,not-an-email,X\nBo,also-bad,Y\nCy,cy@example.com,Z'), ATTENDEE_FIELDS);
    expect(p.errors).toHaveLength(2);
    expect(p.valid).toHaveLength(1);
  });

  it('numbers errors the way the spreadsheet does', () => {
    // Row 1 is the header, so the first data row is line 2 — which is what the
    // organizer sees in Excel while fixing it.
    const p = buildPreview(file('Ada,bad,X'), ATTENDEE_FIELDS);
    expect(p.errors[0].line).toBe(2);
  });

  it('still returns the valid rows when others fail', () => {
    const p = buildPreview(file('Ada,ada@example.com,X\nBo,bad,Y'), ATTENDEE_FIELDS);
    expect(p.valid).toHaveLength(1);
    expect(p.errors).toHaveLength(1);
  });

  it('reports a missing required column once, not once per row', () => {
    const rows = parseCsv('Name,Ticket\nAda,X\nBo,Y\nCy,Z');
    const p = buildPreview(rows, ATTENDEE_FIELDS);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0].field).toBe('email');
    // And nothing is offered for writing, because every row is wrong.
    expect(p.valid).toEqual([]);
  });

  it('rejects an empty required cell', () => {
    const p = buildPreview(file(',ada@example.com,X'), ATTENDEE_FIELDS);
    expect(p.errors[0].message).toContain('Name');
  });

  it('says the file is empty rather than throwing', () => {
    expect(buildPreview([], ATTENDEE_FIELDS).errors[0].message).toContain('empty');
  });
});

describe('round trip', () => {
  it('reads back exactly what csv.ts writes, including the nasty cells', () => {
    // The property that makes "export it, fix it in Excel, import it again"
    // safe — which is what every connection guide tells an organizer to do.
    interface Row {
      name: string;
      company: string;
    }
    const cols: Column<Row>[] = [
      { header: 'Name', value: (r) => r.name },
      { header: 'Company', value: (r) => r.company },
    ];
    const rows: Row[] = [
      { name: 'Nakamura, Ada', company: 'Acme "Holdings"' },
      { name: 'line one\nline two', company: 'Zoë & Co' },
      { name: 'Bo Chen', company: '' },
    ];

    const parsed = parseCsv(toCsv(rows, cols));
    expect(parsed[0]).toEqual(['Name', 'Company']);
    expect(parsed[1]).toEqual(['Nakamura, Ada', 'Acme "Holdings"']);
    expect(parsed[2]).toEqual(['line one\nline two', 'Zoë & Co']);
    expect(parsed[3]).toEqual(['Bo Chen', '']);
  });

  it('round-trips a formula-guarded cell, tab and all', () => {
    // `csv.ts` prefixes a tab to neutralise Excel formulas. Reading it back
    // returns the guarded string — the guard is part of the data now, and a
    // re-import must not double it or lose the original text.
    interface Row {
      a: string;
    }
    const cols: Column<Row>[] = [{ header: 'A', value: (r) => r.a }];
    const parsed = parseCsv(toCsv([{ a: '=1+1' }], cols));
    expect(parsed[1][0]).toBe('\t=1+1');
  });
});
