import type { CallCfpSettings, CallFormFieldDef, CallSessionType, SessionFormat, SubmissionStatus } from '@kgc/shared';

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

export const DEFAULT_ABSTRACT_MAX_WORDS = 300;
export const DEFAULT_TALK_MINUTES = [25, 45];
/** E2 asks for details within a week. */
export const DETAILS_DUE_DAYS = 7;
/** E3 goes this many days after E2 if nothing has arrived. */
export const NUDGE_AFTER_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The description's word limit: a maximum and no minimum (T288, the owner).
 * A stored `abstractMinWords` from before then is ignored on purpose, so the
 * live call needs no data change.
 */
export function abstractWordLimits(cfp?: CallCfpSettings): { max: number } {
  const max = cfp?.abstractMaxWords;
  return { max: Number.isInteger(max) && (max as number) > 0 ? (max as number) : DEFAULT_ABSTRACT_MAX_WORDS };
}

export function talkMinutesOf(cfp?: CallCfpSettings): number[] {
  const list = (cfp?.talkMinutes ?? DEFAULT_TALK_MINUTES).filter((n) => Number.isInteger(n) && n > 0);
  return list.length ? list : DEFAULT_TALK_MINUTES;
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

/**
 * The six things a submitter can offer on a call for speakers, in the order
 * the call editor and the form list them, with the names the owner gave them
 * (T276). The ids `talk` and `workshop` predate this list and stay, so older
 * submissions and "workshops only" questions keep working.
 */
export const CFP_SESSION_TYPES: readonly { id: CallSessionType; label: string }[] = [
  { id: 'talk', label: 'Presentation Talks & Keynotes' },
  { id: 'workshop', label: 'Workshops' },
  { id: 'panel', label: 'Panels & Fireside Chats' },
  { id: 'hcls', label: 'Health Care and Life Sciences (HCLS) Symposium' },
  { id: 'poster', label: 'Poster Sessions' },
  { id: 'demo', label: 'Tools and Demonstrations' },
];

/** The agenda's formats, for a call that is not run as a call for speakers. */
export const AGENDA_SESSION_TYPES: readonly SessionFormat[] = ['keynote', 'talk', 'panel', 'workshop', 'poster', 'social'];

/** Every id a call may offer. */
export const CALL_SESSION_TYPES: readonly CallSessionType[] = [
  ...AGENDA_SESSION_TYPES,
  'hcls',
  'demo',
];

/**
 * The agenda format an accepted submission is scheduled as. The symposium
 * and the demos have no format of their own on the agenda, and both are
 * someone presenting from the stage, so they go on as talks.
 */
export function agendaFormat(type: string | undefined): SessionFormat {
  return (AGENDA_SESSION_TYPES as readonly string[]).includes(type ?? '') ? (type as SessionFormat) : 'talk';
}

/** Whether the public form asks for a track. Off on a CFP call unless ticked. */
export function asksTrack(call: { cfp?: unknown; askTrack?: boolean }): boolean {
  return call.cfp ? call.askTrack === true : call.askTrack !== false;
}

/** Whether the public form asks a talk its length. Only a CFP call, and only when ticked. */
export function asksTalkLength(call: { cfp?: unknown; askTalkLength?: boolean }): boolean {
  return Boolean(call.cfp) && call.askTalkLength === true;
}

export const PHONE_MAX = 30;

/**
 * "Your Phone Number (Optional)", checked loosely: digits with spaces, +, -
 * and brackets, and enough digits to be a number at all.
 */
export function phoneChoice(raw: string | undefined): { phone?: string; error?: string } {
  const text = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return {};
  const digits = text.replace(/\D/g, '').length;
  if (text.length > PHONE_MAX || !/^[0-9+\-() ]+$/.test(text) || digits < 6 || digits > 15) {
    return { error: 'Enter a phone number using digits, spaces, +, - or brackets.' };
  }
  return { phone: text };
}

export const RESOURCE_LINK_MAX = 500;

/**
 * "Link to Additional Resources or Supporting Materials (Optional)". One web
 * address; `https://` is added when the author left it off.
 */
export function resourceLinkChoice(raw: string | undefined): { link?: string; error?: string } {
  const text = (raw ?? '').trim();
  if (!text) return {};
  const bad = { error: 'Enter one web address.' };
  if (/\s/.test(text) || text.length > RESOURCE_LINK_MAX) return bad;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname.includes('.')) return bad;
    return { link: url.toString() };
  } catch {
    return bad;
  }
}

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
export function abstractProblem(text: string, limits: { max: number }): string | null {
  const n = wordCount(text);
  if (n === 0) return 'Write a description of your session.';
  if (n > limits.max) {
    return `The description is ${n} words. Cut it to ${limits.max} or fewer.`;
  }
  return null;
}

/** Whether a call question is asked of one session type. */
export function askedOf(field: Pick<CallFormFieldDef, 'sessionTypes'>, type: string | undefined): boolean {
  const only = field.sessionTypes ?? [];
  if (only.length === 0) return true;
  return Boolean(type) && only.includes(type as CallSessionType);
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

/**
 * A session type as people read it: the owner's name for the six CFP types
 * (T276), and a capitalised id for the agenda's own formats.
 */
export function typeLabel(type: string): string {
  return CFP_SESSION_TYPES.find((t) => t.id === type)?.label ?? type.charAt(0).toUpperCase() + type.slice(1);
}

/** "a", "a or b", "a, b or c". */
export function joinWords(words: readonly string[], conjunction: 'or' | 'and'): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} ${conjunction} ${words[words.length - 1]}`;
}

/**
 * The type line E1, E2 and the notices print under the title: "Workshops",
 * or "Presentation Talks & Keynotes, 25 minutes" when a length was given.
 */
export function sessionTypeLine(type: string | undefined, minutes?: number): string {
  if (!type) return 'Session';
  const label = typeLabel(type);
  return type === 'talk' && minutes ? `${label}, ${minutes} minutes` : label;
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
 * The settings with `closeDate` taken from the call's own close (T293).
 *
 * There are two places to set the close: Dates and emails (`cfp.closeDate`,
 * written through to `closesAtLocal`) and the call editor (`closesAtLocal`
 * alone). Min used the editor, so the page and the emails, which read
 * `cfp.closeDate`, left the date out while the server enforced it. The
 * call's `closesAtLocal` is the deadline the server keeps, so its day wins;
 * `cfp.closeDate` is the fallback for a call with no close of its own.
 * Every reader of a call's settings goes through this, so there is one close
 * date, never two.
 */
export function cfpWithClose(
  cfp: CallCfpSettings | undefined,
  closesAtLocal: string | undefined,
): CallCfpSettings {
  const day = closesAtLocal?.slice(0, 10);
  return isIsoDate(day) ? { ...(cfp ?? {}), closeDate: day } : { ...(cfp ?? {}) };
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
    e2Owed?: boolean;
    withdrawnAtMs?: number;
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

/**
 * The Thursday reminder, at most once an ISO week.
 *
 * ⚠️ Only while there is something the reviewer could be reviewing (T258
 * #17): never before the call opens, and after the close only while
 * submissions are still undecided. There is no planned date for the "not
 * accepted" emails any more (T293), so nothing else ends it. Without `window`
 * it is the bare weekday rule, which is what the tests of that rule read.
 */
export function reminderDue(
  nowMs: number,
  timeZone: string,
  lastWeek: string | undefined,
  window?: { opensAtMs?: number; closesAtMs?: number; openCount: number },
): boolean {
  if (window) {
    if (window.opensAtMs !== undefined && nowMs < window.opensAtMs) return false;
    if (window.closesAtMs !== undefined && nowMs > window.closesAtMs) {
      if (window.openCount === 0) return false;
    }
  }
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
 * E4, sent only when someone presses Send; nothing plans a date for it
 * (T293). The accepted version goes to acceptances
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
    declined: rows.filter((r) => r.status === 'rejected' && !r.closeDecisionSent && !toldAccepted(r)),
    undecided: rows.filter(isOpen),
  };
}

/**
 * Whether the author was already told they are accepted. Such a submission,
 * if it is later rejected, never gets E4's "not accepted" version (T262): a
 * yes in November and a form no in February is the one sequence an author
 * cannot be left to read without a person explaining it.
 */
export function toldAccepted(r: Pick<CfpRow, 'acceptance'>): boolean {
  return r.acceptance?.e2SentAtMs !== undefined || r.acceptance?.withdrawnAtMs !== undefined;
}

/**
 * E2 owed: due and not delivered (T258 #5). Accepted, flagged owed and not
 * yet sent. The hourly run and the E4 button both retry these.
 */
export function e2RetriesDue<R extends CfpRow>(rows: R[]): R[] {
  return rows.filter(
    (r) => r.status === 'accepted' && r.acceptance?.e2Owed === true && r.acceptance.e2SentAtMs === undefined,
  );
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

/*
 * Never planned (T293). The owner, 2026-10-19: "the system shouldn't plan
 * rejections, that decision should be made in the future." There used to be
 * a due date two weeks after the close (T252), shown on Dates and emails and
 * used to stop the Thursday reminder. Now the "not accepted" emails have no
 * date anywhere: they go when someone presses Send, and never by themselves.
 */
