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

// ---------------------------------------------------------------------------
// The programme: speakers, tracks, sessions
// ---------------------------------------------------------------------------

/*
 * ── Why these three live here and `SPONSOR_FIELDS` does not ────────────────
 *
 * `sponsor-fields.ts` keeps its specs beside its screen because they share the
 * validators (`normaliseWebsite`) with the sponsor *form*, and a spec split
 * from the form it mirrors is a spec that drifts from it. The three below have
 * no such twin — nothing else validates a track colour — and they are joined to
 * each other rather than to a screen: a session row names speakers and tracks
 * by the same strings the other two files import, so their alias lists have to
 * agree, and they agree most reliably by sitting next to each other.
 *
 * ── The alias lists are the export's own headers, first ────────────────────
 *
 * `lib/exports.ts` emits `Day, Start, End, Title, Room, Track, Speakers,
 * Format, Status` for the programme and `Name, Title, Company, …` for speakers.
 * "Export it, fix it in Excel, import it again" is the workflow every one of
 * the connection guides tells an organizer to use, and it only works if the
 * headers this module guesses from are the headers that module writes. Those
 * spellings therefore lead each list; Whova's and a hand-made sheet's follow.
 *
 * ⚠️ The programme export's `Session count`, `Has bio` and `Has photo` columns
 * are deliberately absent below. They are *derived* — computed at export time
 * from the sessions collection and from whether a field is set — and a column
 * that reads back in would let a spreadsheet assert a speaker has a bio.
 * Unmapped columns are ignored, so a round-tripped file simply drops them.
 */

/**
 * A speaker list, as the programme committee keeps one.
 *
 * `Sessions` is **not** importable, for the reason above and one more: the
 * speaker↔session link is owned by the session importer, which holds both ends
 * of it — `speakerIds` on the session and `sessionIds` on the speaker — and
 * writes them together. A second writer coming from the speaker sheet would
 * make the two directions disagree, and `people/speaker/[id].tsx` renders the
 * side that would be wrong.
 */
export const SPEAKER_FIELDS: FieldSpec[] = [
  {
    key: 'name',
    label: 'Name',
    aliases: ['speaker', 'speaker name', 'full name', 'presenter', 'presenter name'],
    required: true,
    validate: (v) => (v.length < 2 ? 'A name that short is almost certainly a stray cell.' : undefined),
  },
  { key: 'title', label: 'Job title', aliases: ['position', 'role', 'job'] },
  { key: 'company', label: 'Company', aliases: ['affiliation', 'organisation', 'organization', 'employer', 'institution'] },
  { key: 'bio', label: 'Bio', aliases: ['biography', 'about', 'blurb', 'summary'] },
  {
    key: 'photoURL',
    label: 'Photo URL',
    aliases: ['photo', 'headshot', 'picture', 'image', 'photo link'],
    validate: (v) => (isHttpUrl(v) ? undefined : `“${v}” is not an http(s) address.`),
  },
  {
    key: 'contactEmail',
    label: 'Contact email',
    // The address the committee corresponds with, months before this person
    // holds a ticket — see `SpeakerDoc.contactEmail`. It is what Message
    // Speakers sends to, so importing it is most of the value of this sheet.
    aliases: ['email', 'e-mail', 'email address', 'speaker email'],
    validate: (v) => (EMAIL.test(v) ? undefined : `“${v}” is not a valid email address.`),
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    aliases: ['linked in', 'linkedin url', 'linkedin profile'],
    validate: (v) => (isHttpUrl(v) ? undefined : `“${v}” is not an http(s) address.`),
  },
  {
    key: 'website',
    label: 'Website',
    aliases: ['url', 'site', 'homepage', 'personal site'],
    validate: (v) => (isHttpUrl(v) ? undefined : `“${v}” is not an http(s) address.`),
  },
];

/**
 * Tracks. Three columns, and the colour is the one that matters.
 *
 * `TrackDoc.color` is cached onto every session as `primaryTrackColor` and is
 * what paints the agenda card in the app and the track chip on the website.
 * Both fall back silently when it is missing, so a track sheet imported without
 * a colour column produces a colourless agenda that looks like a styling bug
 * rather than like missing data — which is exactly why the CLI importer carries
 * a palette. Here the column is optional and a blank cell leaves any existing
 * colour alone, so importing a name-only sheet over a coloured programme is
 * safe.
 */
export const TRACK_FIELDS: FieldSpec[] = [
  {
    key: 'name',
    label: 'Track',
    aliases: ['track name', 'category', 'topic', 'theme'],
    required: true,
  },
  {
    key: 'color',
    label: 'Colour',
    aliases: ['color', 'colour', 'hex', 'hex colour', 'hex color', 'track colour', 'track color'],
    validate: (v) =>
      /^#?[0-9a-f]{6}$/i.test(v.trim())
        ? undefined
        : `“${v}” is not a six-digit hex colour such as #2180b2.`,
  },
  { key: 'description', label: 'Description', aliases: ['about', 'summary', 'blurb'] },
];

/**
 * The agenda.
 *
 * ── Date and time are separate columns, and that is not an accident ────────
 *
 * Whova's export splits them, our own export splits them (`Day`, `Start`,
 * `End`), and every hand-made programme spreadsheet splits them, because a
 * conference grid is read down a day. More importantly, a single combined cell
 * is the shape spreadsheets ruin: Excel reformats anything it recognises as a
 * datetime according to the machine's locale, so `2027-05-04T09:00` comes back
 * as `5/4/2027 9:00 AM` on one laptop and `04/05/2027 09:00` on another. Two
 * columns of text survive that, and `toWallClock()` in
 * `scripts/src/lib/time.ts` already normalises both spellings of each half.
 *
 * ⚠️ **No column here is a UTC instant, and none may become one.** `startsAt`,
 * `endsAt` and `day` are derived server-side from the wall clock plus the
 * event's zone by the single `deriveTimes()`. A 21:00 reception is 01:00 UTC
 * the next day; a sheet carrying its own instants would put it on the wrong day
 * tab on every phone, and there would be nothing on screen saying so. The
 * importer's core therefore takes these two columns and derives the rest.
 *
 * `End` is optional because Whova emits it empty for lightning items and
 * anything open-ended. The importer assumes a default length rather than
 * dropping the row — an approximate slot a human can correct beats a session
 * that silently never arrived.
 */
export const SESSION_FIELDS: FieldSpec[] = [
  {
    key: 'title',
    label: 'Title',
    aliases: ['session title', 'session', 'session name', 'name'],
    required: true,
  },
  {
    key: 'day',
    label: 'Day',
    aliases: ['date', 'start date', 'session date'],
    required: true,
    validate: (v) => (isImportableDate(v) ? undefined : `“${v}” is not a date. Use 2027-05-04 or 05/04/2027.`),
  },
  {
    key: 'startTime',
    label: 'Start',
    aliases: ['start time', 'from', 'begin time', 'begins'],
    required: true,
    validate: (v) => (isImportableTime(v) ? undefined : `“${v}” is not a time. Use 09:00 or 9:00 AM.`),
  },
  {
    key: 'endTime',
    label: 'End',
    aliases: ['end time', 'to', 'finish time', 'ends'],
    validate: (v) => (isImportableTime(v) ? undefined : `“${v}” is not a time. Use 10:30 or 10:30 AM.`),
  },
  {
    // An overnight session is legal and a multi-day one is not what this is
    // for; the column exists because Whova emits it and dropping it would make
    // a 23:00–00:30 slot unimportable.
    key: 'endDate',
    label: 'End date',
    aliases: ['finish date'],
    validate: (v) => (isImportableDate(v) ? undefined : `“${v}” is not a date.`),
  },
  { key: 'room', label: 'Room', aliases: ['location', 'venue', 'hall', 'room/location', 'session location'] },
  { key: 'track', label: 'Track', aliases: ['tracks', 'category', 'topic', 'session track'] },
  { key: 'speakers', label: 'Speakers', aliases: ['speaker', 'presenter', 'presenters', 'speaker names'] },
  { key: 'format', label: 'Format', aliases: ['type', 'session type', 'kind'] },
  { key: 'status', label: 'Status', aliases: ['publication status', 'published'] },
  { key: 'skillLevel', label: 'Skill level', aliases: ['level', 'audience level', 'difficulty'] },
  {
    key: 'capacity',
    label: 'Capacity',
    aliases: ['seats', 'max attendees', 'cap'],
    validate: (v) =>
      /^\d+$/.test(v.trim()) && Number(v) > 0 ? undefined : `“${v}” is not a whole number of seats.`,
  },
  { key: 'description', label: 'Description', aliases: ['abstract', 'summary', 'session description'] },
];

/**
 * Accepts only `http:` and `https:`.
 *
 * Three surfaces put these strings into an `href` or hand them to
 * `Linking.openURL` without sanitising them, so `javascript:` typed into a
 * spreadsheet cell would be stored script on a public page. Unlike
 * `normaliseWebsite` in `sponsor-fields.ts` this does not *repair* a bare
 * `acme.com` into a URL, because a photo or profile link that arrives without a
 * scheme is far more likely to be a truncated cell than a hostname.
 */
function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** The two date spellings `toWallClock()` normalises. Shape only; it does the parsing. */
function isImportableDate(v: string): boolean {
  const d = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(d);
}

/** Likewise for times: `09:00`, `9:00 AM`, `09:00:00`. */
function isImportableTime(v: string): boolean {
  return /^\d{1,2}:\d{2}(:\d{2})?\s*([AaPp][Mm])?$/.test(v.trim());
}

// ---------------------------------------------------------------------------
// The two-step import, as one shape
// ---------------------------------------------------------------------------

/**
 * What a preview-then-commit importer hands back to its form.
 *
 * One type for all four programme importers rather than four near-identical
 * ones, because the *screen* is identical — the sponsor importer proved the
 * shape and the only thing that differs between entities is the noun. It lives
 * here rather than beside a form because a `'use server'` module may export
 * nothing but async functions, so the action files cannot own it, and both
 * halves need it.
 *
 * `csv` is echoed through the preview and posted back on commit. That is why
 * the file is read once: a second `<input type="file">` on the commit step
 * would let somebody preview one file and import another.
 */
export interface ProgrammeImportState {
  stage: 'idle' | 'preview' | 'done';
  /** The file, carried between the two steps. */
  csv?: string;
  header?: string[];
  /** The first few rows *as the importer understood them* — the only question a preview answers. */
  sample?: Record<string, string>[];
  validCount?: number;
  totalRows?: number;
  errors?: RowError[];
  /** Rows that parsed but could not be resolved or written, by line. */
  failed?: { line: number; name: string; message: string }[];
  message?: string;
  error?: string;
}

/**
 * A whole programme is a few hundred rows of short strings. Anything above this
 * is a different kind of file, and the cheapest place to find that out is
 * before parsing it.
 */
const MAX_CSV_BYTES = 2_000_000;

/**
 * The uploaded file, or the pasted text, whichever the organizer used.
 *
 * Pasting matters more than it looks: it is how somebody imports four rows
 * without saving a spreadsheet first, and it is the only way to use this
 * importer from a machine whose file picker is locked down.
 */
export async function readCsvUpload(
  formData: FormData,
): Promise<string | { error: string }> {
  const file = formData.get('file');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_CSV_BYTES) {
      return { error: 'That file is over 2 MB, which is far larger than any programme. Check it is the right file.' };
    }
    return await file.text();
  }

  const pasted = String(formData.get('pasted') ?? '').trim();
  if (pasted) {
    if (pasted.length > MAX_CSV_BYTES) return { error: 'That is more text than the importer takes.' };
    return pasted;
  }

  return { error: 'Choose a CSV file, or paste one in.' };
}
