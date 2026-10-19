import type { CallCfpSettings, CallFormFieldDef, SessionFormat, SubmissionStatus } from '@kgc/shared';

/**
 * The KGC 2027 call for papers, as rules with no Firestore in them (T249).
 *
 * Min's plan: one call, talk or workshop; a rolling weekly review by one
 * person; accept mails E2 and tells onboarding; reject sends nothing until E4
 * after the close; E3 nudges five days after E2; E6 once in January; S1 is the
 * inbox's reply. The website, the dashboard and the hourly scheduler all have
 * to agree about what is due, what a status is called and what a date reads
 * as, and none of them can import another, so it is decided here where
 * `npm test` reaches it. Same posture as `review-core.ts`: pure, no sentinels.
 */

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_ABSTRACT_MIN_WORDS = 150;
export const DEFAULT_ABSTRACT_MAX_WORDS = 300;
export const DEFAULT_TALK_MINUTES = [25, 45];
/** E2 asks for details within a week. */
export const DETAILS_DUE_DAYS = 7;
/** E3 goes this many days after E2 if nothing has arrived. */
export const NUDGE_AFTER_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export function abstractWordLimits(cfp?: CallCfpSettings): { min: number; max: number } {
  const min = cfp?.abstractMinWords ?? DEFAULT_ABSTRACT_MIN_WORDS;
  const max = cfp?.abstractMaxWords ?? DEFAULT_ABSTRACT_MAX_WORDS;
  return { min, max: Math.max(min, max) };
}

export function talkMinutesOf(cfp?: CallCfpSettings): number[] {
  const list = (cfp?.talkMinutes ?? DEFAULT_TALK_MINUTES).filter((n) => Number.isInteger(n) && n > 0);
  return list.length ? list : DEFAULT_TALK_MINUTES;
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

/**
 * The Track list's "Other" choice (T271). The select posts this value and the
 * server stores the typed topic as `trackOther` with no `trackId`, so nothing
 * that reads track ids (reviewer matching, the agenda) ever sees it.
 */
export const OTHER_TRACK = '__other__';
export const TRACK_OTHER_MAX = 80;

/**
 * What a submission's track reads as on a screen or in a notice: the track's
 * name, "Other: <their topic>", or undefined when neither is set.
 */
export function trackLabel(
  sub: { trackId?: string; trackOther?: string },
  name: (id: string) => string | undefined,
): string | undefined {
  if (sub.trackId) return name(sub.trackId);
  if (sub.trackOther) return `Other: ${sub.trackOther}`;
  return undefined;
}

/**
 * The track a POST asked for, checked against the call. `error` belongs under
 * the Track list and `otherError` under the "Which topic?" box. A draft may
 * leave both empty; a finished submission may not when the call offers any.
 */
export function trackChoice(
  call: { trackIds?: string[]; allowOtherTrack?: boolean },
  input: { trackId?: string; trackOther?: string },
  finish: boolean,
): { trackId?: string; trackOther?: string; error?: string; otherError?: string } {
  const offered = call.trackIds ?? [];
  const other = call.allowOtherTrack === true;
  if (input.trackId === OTHER_TRACK) {
    if (!other) return { error: 'That is not one of this call’s tracks.' };
    const text = (input.trackOther ?? '').trim().replace(/\s+/g, ' ');
    if (text.length > TRACK_OTHER_MAX) {
      return { otherError: `Keep the topic to ${TRACK_OTHER_MAX} characters or fewer.` };
    }
    if (!text && finish) return { otherError: 'Say which topic.' };
    return text ? { trackOther: text } : {};
  }
  if (input.trackId) {
    if (!offered.includes(input.trackId)) return { error: 'That is not one of this call’s tracks.' };
    return { trackId: input.trackId };
  }
  if (finish && (offered.length > 0 || other)) return { error: 'Choose a track.' };
  return {};
}

/** Words as a reader counts them: runs of non-space. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** The sentence to show under the abstract, or null when its length is fine. */
export function abstractProblem(text: string, limits: { min: number; max: number }): string | null {
  const n = wordCount(text);
  if (n < limits.min) {
    return `The abstract is ${n} word${n === 1 ? '' : 's'}. It needs ${limits.min} to ${limits.max}.`;
  }
  if (n > limits.max) {
    return `The abstract is ${n} words. Cut it to ${limits.max} or fewer.`;
  }
  return null;
}

/** Whether a call question is asked of one session type. */
export function askedOf(field: Pick<CallFormFieldDef, 'sessionTypes'>, type: string | undefined): boolean {
  const only = field.sessionTypes ?? [];
  if (only.length === 0) return true;
  return Boolean(type) && only.includes(type as SessionFormat);
}

/**
 * The questions one session type is asked. With no type chosen yet, only the
 * questions every type is asked, so a draft saved before choosing is not held
 * to a workshop's required outline.
 */
export function fieldsForSessionType<F extends Pick<CallFormFieldDef, 'sessionTypes'>>(
  fields: F[],
  type: string | undefined,
): F[] {
  return fields.filter((f) => askedOf(f, type));
}

/** "Talk, 25 minutes" or "Workshop". The line E2 prints under the title. */
/** "Talk", "Workshop": a session type as the form and the filters name it. */
export const typeLabel = (type: string): string => type.charAt(0).toUpperCase() + type.slice(1);

/** "a", "a or b", "a, b or c". */
export function joinWords(words: readonly string[], conjunction: 'or' | 'and'): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} ${conjunction} ${words[words.length - 1]}`;
}

/**
 * The form's session-type question, built from the types ticked in the
 * dashboard (T271): "Talk or workshop?", "Talk, workshop or panel?". Empty
 * when there is one type or none, since there is then nothing to ask.
 */
export function sessionTypeQuestion(types: readonly string[]): string {
  if (types.length < 2) return '';
  return `${typeLabel(joinWords(types, 'or'))}?`;
}

export function sessionTypeLine(type: string | undefined, minutes?: number): string {
  if (type === 'workshop') return 'Workshop';
  if (type === 'talk') return minutes ? `Talk, ${minutes} minutes` : 'Talk';
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Session';
}

// ---------------------------------------------------------------------------
// Dates, as people read them
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string | undefined): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * `2027-01-15` → "Friday 15 January 2027", the form Min's plan writes dates
 * in. Read as a calendar date, never as an instant, so no zone can move it.
 */
export function formatDay(isoDate: string | undefined): string | undefined {
  if (!isIsoDate(isoDate)) return undefined;
  const d = new Date(`${isoDate}T12:00:00Z`);
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const rest = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${weekday} ${rest}`;
}

/** The calendar date an instant falls on in a zone, as `YYYY-MM-DD`. */
export function dateIn(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
  return parts;
}

/** "Friday 15 January 2027" for the day `days` after an instant, in a zone. */
export function dayAfter(ms: number, days: number, timeZone: string): string {
  return formatDay(dateIn(ms + days * DAY_MS, timeZone))!;
}

// ---------------------------------------------------------------------------
// Placeholders on the public page
// ---------------------------------------------------------------------------

/** The tokens Min's copy uses, mapped to the setting that fills each one. */
export const PAGE_TOKENS = ['CLOSE DATE', 'DECISION DATE'] as const;
export type PageToken = (typeof PAGE_TOKENS)[number];

/**
 * Fill `[CLOSE DATE]` and `[DECISION DATE]` in the call's description, and
 * leave out cleanly what cannot be filled.
 *
 * A sentence carrying an unset token is dropped whole, and a paragraph or
 * bullet left with nothing in it goes too, so "Submissions close [CLOSE
 * DATE]." disappears rather than reading "Submissions close ." The text is
 * otherwise returned exactly as typed, including its line breaks.
 */
export function fillPlaceholders(text: string, values: Partial<Record<PageToken, string>>): string {
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const kept: string[] = [];

  for (const para of paragraphs) {
    const lines = para.split('\n');
    const keptLines: string[] = [];
    for (const line of lines) {
      const filled = fillLine(line, values);
      if (filled !== null) keptLines.push(filled);
    }
    const joined = keptLines.join('\n');
    if (joined.trim() && !/^\s*[-•*]\s*$/.test(joined)) kept.push(joined);
  }
  return kept.join('\n\n');
}

function fillLine(line: string, values: Partial<Record<PageToken, string>>): string | null {
  if (!/\[[A-Z ]+\]/.test(line)) return line;
  // Sentences end at . ! ? followed by space, keeping the punctuation.
  const sentences = line.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) ?? [line];
  const out: string[] = [];
  for (const sentence of sentences) {
    let missing = false;
    const filled = sentence.replace(/\[([A-Z ]+)\]/g, (whole, token: string) => {
      const value = values[token as PageToken];
      if ((PAGE_TOKENS as readonly string[]).includes(token) && value) return value;
      missing = true;
      return whole;
    });
    if (!missing) out.push(filled);
  }
  const result = out.join('').replace(/\s+$/, '');
  // A bullet whose only sentence went is no bullet.
  if (!result.trim() || /^\s*[-•*]\s*$/.test(result)) return null;
  return result;
}

/** The page's token values from the settings, with unset ones absent. */
export function pageValues(cfp?: CallCfpSettings): Partial<Record<PageToken, string>> {
  return {
    'CLOSE DATE': formatDay(cfp?.closeDate),
    'DECISION DATE': formatDay(cfp?.decisionDate),
  };
}

// ---------------------------------------------------------------------------
// Status, as the inbox reads it
// ---------------------------------------------------------------------------

export type CfpStatus =
  | 'draft'
  | 'open'
  | 'accepted'
  | 'details-received'
  | 'rejected'
  | 'waitlisted'
  | 'withdrawn';

export const CFP_STATUS_LABEL: Record<CfpStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  accepted: 'Accepted',
  'details-received': 'Details received',
  rejected: 'Rejected',
  waitlisted: 'Waitlisted',
  withdrawn: 'Withdrawn',
};

/** One submission, reduced to what these rules read. Times are epoch ms. */
export interface CfpRow {
  id: string;
  status: SubmissionStatus;
  sessionType?: string;
  submittedAtMs?: number;
  acceptance?: {
    e2SentAtMs?: number;
    nudgedAtMs?: number;
    e2HeldForE4?: boolean;
  };
  detailsReceivedAtMs?: number;
  closeDecisionSent?: boolean;
  stillOpenSentAtMs?: number;
}

/**
 * What the support inbox tells someone who asks where they stand. "Open" is
 * every finished submission nobody has decided, which is what S1 is for.
 */
export function cfpStatus(row: Pick<CfpRow, 'status' | 'detailsReceivedAtMs'>): CfpStatus {
  switch (row.status) {
    case 'draft':
      return 'draft';
    case 'withdrawn':
      return 'withdrawn';
    case 'rejected':
      return 'rejected';
    case 'waitlisted':
      return 'waitlisted';
    case 'accepted':
      return row.detailsReceivedAtMs ? 'details-received' : 'accepted';
    default:
      return 'open';
  }
}

export const isOpen = (row: Pick<CfpRow, 'status'>) =>
  row.status === 'submitted' || row.status === 'under-review';

// ---------------------------------------------------------------------------
// The weekly review
// ---------------------------------------------------------------------------

export interface ReviewCounts {
  open: number;
  accepted: number;
  rejected: number;
}

/** The three counters on François's screen. Accepted includes details received. */
export function reviewCounts(rows: Pick<CfpRow, 'status'>[]): ReviewCounts {
  const c: ReviewCounts = { open: 0, accepted: 0, rejected: 0 };
  for (const r of rows) {
    if (isOpen(r)) c.open++;
    else if (r.status === 'accepted') c.accepted++;
    else if (r.status === 'rejected') c.rejected++;
  }
  return c;
}

/**
 * Every undecided submission, those that arrived since the last pass first
 * (newest first among them), then the ones left from earlier weeks, oldest
 * first, because the longest-waiting is the one most owed an answer.
 */
export function reviewQueue<R extends CfpRow>(
  rows: R[],
  lastPassAtMs: number | undefined,
): { row: R; isNew: boolean }[] {
  const open = rows.filter(isOpen);
  const since = lastPassAtMs ?? 0;
  const fresh = open
    .filter((r) => (r.submittedAtMs ?? 0) > since)
    .sort((a, b) => (b.submittedAtMs ?? 0) - (a.submittedAtMs ?? 0));
  const carried = open
    .filter((r) => (r.submittedAtMs ?? 0) <= since)
    .sort((a, b) => (a.submittedAtMs ?? 0) - (b.submittedAtMs ?? 0));
  return [...fresh.map((row) => ({ row, isNew: true })), ...carried.map((row) => ({ row, isNew: false }))];
}

// ---------------------------------------------------------------------------
// What the scheduler sends
// ---------------------------------------------------------------------------

/**
 * E3: accepted, E2 out at least five days, nothing back yet, not nudged.
 * Measured from E2 rather than from the acceptance, because an acceptance held
 * for E4 has not started its week.
 */
export function nudgesDue<R extends CfpRow>(rows: R[], nowMs: number): R[] {
  return rows.filter(
    (r) =>
      r.status === 'accepted' &&
      r.acceptance?.e2SentAtMs !== undefined &&
      !r.acceptance.nudgedAtMs &&
      !r.detailsReceivedAtMs &&
      nowMs >= r.acceptance.e2SentAtMs + NUDGE_AFTER_DAYS * DAY_MS,
  );
}

/** `2026-W46`, the ISO week a moment falls in, in a zone. */
export function isoWeek(ms: number, timeZone: string): string {
  const [y, m, d] = dateIn(ms, timeZone).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Thursday from 09:00 in the call's zone, once a week. */
export const REMINDER_WEEKDAY = 'Thursday';
export const REMINDER_HOUR = 9;

export function reminderDue(nowMs: number, timeZone: string, lastWeek: string | undefined): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(nowMs));
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  if (weekday !== REMINDER_WEEKDAY || hour < REMINDER_HOUR) return false;
  return isoWeek(nowMs, timeZone) !== lastWeek;
}

// ---------------------------------------------------------------------------
// The two organizer-triggered sends
// ---------------------------------------------------------------------------

/**
 * E4, two weeks after the close. The accepted version goes to acceptances
 * made at or after the close whose E2 is held for it; the declined version to
 * every rejection not yet told. Undecided submissions get neither: they are
 * counted so the screen can say they need a decision first.
 */
export function closeDecisionPlan<R extends CfpRow>(rows: R[]): {
  accepted: R[];
  declined: R[];
  undecided: R[];
} {
  return {
    accepted: rows.filter(
      (r) => r.status === 'accepted' && r.acceptance?.e2HeldForE4 === true && !r.closeDecisionSent,
    ),
    declined: rows.filter((r) => r.status === 'rejected' && !r.closeDecisionSent),
    undecided: rows.filter(isOpen),
  };
}

/** E6: everyone still in the queue who has not had it. */
export function stillOpenRecipients<R extends CfpRow>(rows: R[]): R[] {
  return rows.filter((r) => isOpen(r) && !r.stillOpenSentAtMs);
}

/**
 * Whether an acceptance at `nowMs` holds E2 back for E4: only once the close
 * date has passed, and only when one is set. Before the close, accept mails
 * at once, which is the whole point of rolling review.
 */
export function holdE2ForClose(nowMs: number, cfp: CallCfpSettings | undefined, timeZone: string): boolean {
  if (!isIsoDate(cfp?.closeDate)) return false;
  return dateIn(nowMs, timeZone) > cfp.closeDate;
}

// ---------------------------------------------------------------------------
// The dashboard's warning
// ---------------------------------------------------------------------------

/** Each unset setting, in words, for the banner and the report. */
export function missingSettings(cfp: CallCfpSettings | undefined): string[] {
  const out: string[] = [];
  if (!isIsoDate(cfp?.closeDate)) out.push('Close date');
  if (!isIsoDate(cfp?.decisionDate)) out.push('Decision date');
  if (!isIsoDate(cfp?.sessionNoticeDate)) out.push('Session day and time notice date');
  if (!cfp?.acceptNoticeEmail?.includes('@')) out.push('Acceptance notice address (Min)');
  if (!cfp?.reviewerReminderEmail?.includes('@')) out.push('Weekly reminder address (François)');
  return out;
}

// ---------------------------------------------------------------------------
// When E4 may go
// ---------------------------------------------------------------------------

/** E4 is due this many days after the close (Min's plan: "two weeks after the close"). */
export const CLOSE_DECISION_AFTER_DAYS = 14;

/** `YYYY-MM-DD` on which E4 becomes sendable, or undefined while no close date is set. */
export function closeDecisionDate(cfp: CallCfpSettings | undefined): string | undefined {
  if (!isIsoDate(cfp?.closeDate)) return undefined;
  const d = new Date(`${cfp.closeDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + CLOSE_DECISION_AFTER_DAYS);
  return d.toISOString().slice(0, 10);
}

/**
 * Whether E4 may be sent now (T252). Never before the close date is set, and
 * never before two weeks after it: one early press would tell every rejected
 * author "not accepted" months before everyone else hears.
 */
export function closeDecisionOpen(nowMs: number, cfp: CallCfpSettings | undefined, timeZone: string): boolean {
  const from = closeDecisionDate(cfp);
  return Boolean(from) && dateIn(nowMs, timeZone) >= from!;
}
