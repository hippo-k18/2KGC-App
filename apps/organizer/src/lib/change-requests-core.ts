/**
 * The change request form's rules (T428), with no Firestore or Storage in
 * them so they can be tested. The public page is `app/request/`, the upload
 * route `app/api/change-requests/route.ts`, the store `change-requests.ts`
 * and the organizer screen `app/(dash)/tools/change-requests/`.
 *
 * Owner, 2026-11-18: "If people have small change requests build a form on
 * the dashboard where you don't have to sign in but you put your email and
 * text description of the change". Anyone with the link may send one, so
 * everything a sender types is checked here, on the server, and the sender
 * only ever hears back twice: when the change is built and when it is live.
 */
import type { ChangeRequestStatus } from '@kgc/shared';
import { sniffImageType, type AcceptedImageType } from './upload-limits';

export const CHANGE_REQUESTS_PATH = '/tools/change-requests';
export const CHANGE_REQUEST_FORM_PATH = '/request';
/** The upload route the form posts to. Kept out of the middleware's matcher with the form. */
export const CHANGE_REQUEST_API_PATH = '/api/change-requests';

export const DESCRIPTION_MAX = 4000;
export const EMAIL_MAX = 254;
export const PAGE_URL_MAX = 2000;
export const NOTE_MAX = 4000;
export const MAX_SCREENSHOTS = 3;
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
export const SCREENSHOT_TYPES: readonly AcceptedImageType[] = ['image/png', 'image/jpeg', 'image/webp'];
export const SCREENSHOT_ACCEPT = SCREENSHOT_TYPES.join(',');
/** The whole request may be this big: three full screenshots and the text, with room for the form's own framing. */
export const REQUEST_MAX_BYTES = MAX_SCREENSHOTS * SCREENSHOT_MAX_BYTES + 256 * 1024;

/** The honeypot. A real browser never fills it: it is off screen and skipped by the keyboard. */
export const HONEYPOT_FIELD = 'website';

/** Per sender address and per IP, an hour and a day (the task's "5/hour"). */
export const CHANGE_REQUEST_CAPS = { perHour: 5, perDay: 20 } as const;

export const STATUSES: readonly ChangeRequestStatus[] = ['new', 'building', 'built', 'live', 'declined'];

export const STATUS_LABEL: Record<ChangeRequestStatus, string> = {
  new: 'New',
  building: 'Building',
  built: 'Built',
  live: 'Live',
  declined: 'Declined',
};

export function isStatus(value: unknown): value is ChangeRequestStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

/** One address, as a mail server would take it. Deliberately plain: one @, a dot in the domain, no spaces. */
export function isValidEmail(raw: string): boolean {
  const email = raw.trim();
  if (!email || email.length > EMAIL_MAX) return false;
  return /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i.test(email);
}

/** A page link, when one is given: http or https only, so a `javascript:` link never reaches the screen. */
export function normalisePageUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.length > PAGE_URL_MAX) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** What the form sent, before any of it is trusted. Files are described, not read. */
export interface SubmissionInput {
  email: unknown;
  description: unknown;
  pageUrl: unknown;
  honeypot: unknown;
  files: { size: number }[];
}

export interface CleanSubmission {
  email: string;
  description: string;
  pageUrl?: string;
}

export type FieldName = 'email' | 'description' | 'pageUrl' | 'screenshots';

export type Validation =
  | { kind: 'ok'; value: CleanSubmission }
  /** The honeypot was filled: answer as if it worked, store nothing. */
  | { kind: 'trap' }
  | { kind: 'invalid'; errors: Partial<Record<FieldName, string>> };

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Every rule a submission must pass, in one place, so the page and the tests
 * agree. The words are the ones the form shows under each field.
 */
export function validateSubmission(input: SubmissionInput): Validation {
  if (text(input.honeypot).trim() !== '') return { kind: 'trap' };

  const errors: Partial<Record<FieldName, string>> = {};
  const email = text(input.email).trim().toLowerCase();
  if (!email) errors.email = 'Enter your email address.';
  else if (!isValidEmail(email)) errors.email = 'Enter an email address like name@example.com.';

  const description = text(input.description).replace(/\r\n?/g, '\n').trim();
  if (!description) errors.description = 'Describe the change you would like.';
  else if (description.length > DESCRIPTION_MAX) {
    errors.description = `Keep it under ${DESCRIPTION_MAX.toLocaleString('en-US')} characters. This one has ${description.length.toLocaleString('en-US')}.`;
  }

  const rawUrl = text(input.pageUrl);
  const pageUrl = normalisePageUrl(rawUrl);
  if (rawUrl.trim() && !pageUrl) errors.pageUrl = 'Enter a web address like https://www.knowledgegraph.tech/speakers, or leave it empty.';

  const files = input.files.filter((f) => f.size > 0);
  if (files.length > MAX_SCREENSHOTS) errors.screenshots = `Attach up to ${MAX_SCREENSHOTS} screenshots.`;
  else if (files.some((f) => f.size > SCREENSHOT_MAX_BYTES)) {
    errors.screenshots = `Each screenshot can be up to ${SCREENSHOT_MAX_BYTES / 1024 / 1024} MB.`;
  }

  if (Object.keys(errors).length) return { kind: 'invalid', errors };
  return { kind: 'ok', value: { email, description, ...(pageUrl ? { pageUrl } : {}) } };
}

/**
 * The screenshot's real type, from its first bytes, or undefined when it is
 * not a PNG, JPEG or WebP. The browser's label is never asked.
 */
export function screenshotType(bytes: Uint8Array): AcceptedImageType | undefined {
  const sniffed = sniffImageType(bytes);
  return sniffed && SCREENSHOT_TYPES.includes(sniffed) ? sniffed : undefined;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** `change-requests/{id}/shot-1.png`. The id is ours and the extension comes from the bytes. */
export function screenshotPath(id: string, index: number, type: AcceptedImageType): string {
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) throw new Error('not a change request id');
  return `change-requests/${id}/shot-${index + 1}.${EXT[type]}`;
}

/** The content type to serve a stored screenshot with, from its path. Anything else is refused. */
export function contentTypeForPath(path: string): AcceptedImageType | null {
  const m = /^change-requests\/[A-Za-z0-9]{10,40}\/shot-[1-3]\.(png|jpg|webp)$/.exec(path);
  if (!m) return null;
  return m[1] === 'png' ? 'image/png' : m[1] === 'jpg' ? 'image/jpeg' : 'image/webp';
}

/** Which email a status change owes the sender, given what has already been claimed. */
export type ChangeEmail = 'built' | 'live';

/**
 * The email a move to `next` should send, or null.
 *
 * Only a move INTO built or live sends, and only when that email has never
 * been claimed for this request: going built, back to building and built
 * again mails once. The caller writes the claim in the same transaction as
 * the status, so two presses at once still send one.
 */
export function emailForTransition(
  previous: ChangeRequestStatus,
  next: ChangeRequestStatus,
  emailed: { built?: unknown; live?: unknown } | undefined,
): ChangeEmail | null {
  if (previous === next) return null;
  if (next === 'built' && !emailed?.built) return 'built';
  if (next === 'live' && !emailed?.live) return 'live';
  return null;
}

/** The status filter from the address bar, or undefined for all. */
export function parseStatusFilter(raw: string | string[] | undefined): ChangeRequestStatus | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isStatus(v) ? v : undefined;
}

/** "3 new" for the rail, or undefined when there are none. */
export function newCountLabel(count: number): string | undefined {
  return count > 0 ? `${count > 99 ? '99+' : count} new` : undefined;
}
