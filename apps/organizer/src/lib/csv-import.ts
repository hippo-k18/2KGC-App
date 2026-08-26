/**
 * Reading a CSV back in.
 *
 * `csv.ts` writes them; this parses them. Together they are the half of
 * `ROADMAP.md`'s Phase 2 that makes roughly forty screens cheap — every entity
 * screen in Whova is the same shape (list, filter, edit, import, export) and
 * the import is the part that is written eight times badly or once well.
 *
 * ── Not `server-only`, for the same reason `csv.ts` is not ──────────────────
 *
 * Pure string handling with no Firestore handle and no credential. `server-only`
 * throws outside a React Server Component, which would make the parser — the
 * part with all the edge cases — untestable by Vitest. The module that actually
 * writes to Firestore keeps it.
 *
 * ── Why a hand-written parser ───────────────────────────────────────────────
 *
 * `csv-parse` is already a dependency of `@kgc/scripts`, so this is not about
 * avoiding a package. It is about the two lines below `parseCsv` that a library
 * would not give us: **Excel writes a BOM** and every parser that ignores it
 * turns the first column header into `﻿Name`, which then fails to map and
 * silently drops the whole column. That has to be handled here whatever parses
 * the rest, and the rest is thirty lines.
 */

/** Rows of raw cells, header included. */
export function parseCsv(text: string): string[][] {
  // Excel writes a UTF-8 BOM. Left in place it becomes part of the first header
  // and that column stops matching anything, silently.
  const src = text.replace(/^﻿/, '');

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (quoted) {
      if (c === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
      continue;
    }

    if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r') {
      // Swallow; the \n that follows ends the row. A lone \r (old Mac) also
      // ends one, which the next branch handles.
      if (src[i + 1] !== '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      }
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }

  // A file not ending in a newline still has a last row.
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // Drop trailing blank lines, which every spreadsheet adds.
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

export interface FieldSpec {
  /** The key on the resulting object. */
  key: string;
  /** What an organizer would call it, for the mapping UI. */
  label: string;
  /**
   * Header spellings that map to this field without asking. Lower-cased and
   * stripped of punctuation before comparison, so "E-mail Address" matches
   * "email address".
   */
  aliases: string[];
  required?: boolean;
  /** Returns an error string, or undefined when the value is acceptable. */
  validate?: (value: string) => string | undefined;
}

/** Normalised for header matching: lower case, letters and digits only. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export interface Mapping {
  /** Field key → column index in the file, or null when unmapped. */
  [fieldKey: string]: number | null;
}

/**
 * Guess which column is which.
 *
 * Deliberately a *guess* that the UI shows and lets a human override, rather
 * than something applied silently. Whova's own importer has a mapping step for
 * exactly this reason, and the failure it prevents is specific: a file whose
 * columns are in an unexpected order imports every name into the company field,
 * and nothing about the result looks wrong until somebody reads a badge.
 */
export function guessMapping(header: string[], fields: FieldSpec[]): Mapping {
  const normalised = header.map(norm);
  const mapping: Mapping = {};
  const taken = new Set<number>();

  for (const f of fields) {
    const candidates = [f.key, f.label, ...f.aliases].map(norm);
    const idx = normalised.findIndex((h, i) => !taken.has(i) && candidates.includes(h));
    mapping[f.key] = idx === -1 ? null : idx;
    if (idx !== -1) taken.add(idx);
  }

  return mapping;
}

export interface RowError {
  /** 1-based, and counting the header — so it matches what the spreadsheet shows. */
  line: number;
  field?: string;
  message: string;
}

export interface ImportPreview<T> {
  /** Rows that would be written. */
  valid: T[];
  errors: RowError[];
  /** Header row, for the mapping UI. */
  header: string[];
  mapping: Mapping;
  totalRows: number;
}

/**
 * Turn a parsed file into typed rows, collecting every error rather than
 * throwing on the first.
 *
 * ── Every error, not the first one ──────────────────────────────────────────
 *
 * An importer that stops at the first bad row makes somebody fix one cell,
 * re-upload, and discover the next — which for a 400-row attendee list is an
 * afternoon. Whova's own importer reports row by row and the research file
 * calls that out as the thing worth copying.
 *
 * ── Valid rows are still returned when others fail ──────────────────────────
 *
 * The caller decides whether to write a partial import. That is a real choice:
 * for attendees, importing 398 of 400 and fixing two by hand is usually right;
 * for anything financial it is usually not. The preview reports both halves so
 * a screen can put the decision in front of a person.
 */
export function buildPreview<T extends Record<string, string>>(
  rows: string[][],
  fields: FieldSpec[],
  mapping?: Mapping,
): ImportPreview<T> {
  if (rows.length === 0) {
    return { valid: [], errors: [{ line: 0, message: 'The file is empty.' }], header: [], mapping: {}, totalRows: 0 };
  }

  const header = rows[0];
  const map = mapping ?? guessMapping(header, fields);
  const body = rows.slice(1);

  const errors: RowError[] = [];
  const valid: T[] = [];

  for (const f of fields) {
    if (f.required && map[f.key] === null) {
      errors.push({
        line: 1,
        field: f.key,
        message: `No column matched “${f.label}”, which is required. Map it above or add the column.`,
      });
    }
  }

  // A missing required column makes every row wrong; reporting 400 identical
  // errors buries the one line that says which column.
  if (errors.length > 0) {
    return { valid: [], errors, header, mapping: map, totalRows: body.length };
  }

  body.forEach((cells, i) => {
    // +2: one for the header, one because spreadsheets count from 1.
    const line = i + 2;
    const out: Record<string, string> = {};
    let rowOk = true;

    for (const f of fields) {
      const idx = map[f.key];
      const raw = idx === null || idx === undefined ? '' : (cells[idx] ?? '').trim();

      if (f.required && !raw) {
        errors.push({ line, field: f.key, message: `${f.label} is empty.` });
        rowOk = false;
        continue;
      }

      if (raw && f.validate) {
        const problem = f.validate(raw);
        if (problem) {
          errors.push({ line, field: f.key, message: problem });
          rowOk = false;
          continue;
        }
      }

      out[f.key] = raw;
    }

    if (rowOk) valid.push(out as T);
  });

  return { valid, errors, header, mapping: map, totalRows: body.length };
}

// ---------------------------------------------------------------------------
// Field specs
// ---------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Attendees, the first consumer.
 *
 * The alias lists come from what the exports here actually emit plus what
 * Eventbrite, Whova and a hand-made spreadsheet call the same things — those
 * are the four files anybody will ever drop on this.
 */
export const ATTENDEE_FIELDS: FieldSpec[] = [
  {
    key: 'name',
    label: 'Name',
    aliases: ['full name', 'attendee name', 'first name last name', 'display name'],
    required: true,
    validate: (v) => (v.length < 2 ? 'Name is too short to print on a badge.' : undefined),
  },
  {
    key: 'email',
    label: 'Email',
    aliases: ['email address', 'e-mail', 'attendee email', 'contact email'],
    required: true,
    validate: (v) => (EMAIL.test(v) ? undefined : `“${v}” is not a valid email address.`),
  },
  { key: 'ticketType', label: 'Ticket type', aliases: ['ticket', 'registration type', 'tier'] },
  { key: 'company', label: 'Company', aliases: ['organisation', 'organization', 'employer'] },
  { key: 'title', label: 'Job title', aliases: ['position', 'role at company'] },
];

/**
 * A marketing contact list — last year's delegates, a partner's export, the
 * "notify me" form.
 *
 * Only the address is required. A contact list arrives from wherever it arrives
 * and half of them are an email column and nothing else; refusing those would
 * mean the organizer strips the file by hand before uploading it, which is the
 * work this importer exists to remove.
 *
 * There is no `unsubscribed` field here on purpose. ⚠️ An import must never be
 * able to clear a suppression — see `importContacts` in `campaigns.ts` — and
 * the surest way to guarantee that is for the importer to have no vocabulary
 * for it at all.
 */
export const CONTACT_FIELDS: FieldSpec[] = [
  {
    key: 'email',
    label: 'Email',
    aliases: ['email address', 'e-mail', 'contact email', 'work email'],
    required: true,
    validate: (v) => (EMAIL.test(v) ? undefined : `“${v}” is not a valid email address.`),
  },
  { key: 'name', label: 'Name', aliases: ['full name', 'contact name', 'first name last name'] },
  { key: 'company', label: 'Company', aliases: ['organisation', 'organization', 'employer', 'account'] },
  { key: 'source', label: 'Source', aliases: ['origin', 'how they found us', 'campaign', 'list'] },
];
