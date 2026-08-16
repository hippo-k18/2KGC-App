import { createHash, randomBytes } from 'node:crypto';

/**
 * Ids for imported records.
 *
 * Every id here is *derived from the source data*, not random, because the
 * importer has to be re-runnable. You will re-import the agenda a dozen times as
 * the programme firms up, and each run must update the same documents rather
 * than accumulate near-duplicates that then have to be reconciled by hand at
 * T-2 weeks.
 *
 * The exception is `qrSecret`, which must be unguessable — see below.
 */

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

const shortHash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 8);

/** Stable across re-imports as long as the title and start time are unchanged. */
export function sessionId(title: string, startsAtLocal: string): string {
  return `${slug(title) || 'session'}-${shortHash(`${title}|${startsAtLocal}`)}`;
}

export function speakerId(name: string, company?: string): string {
  return `${slug(name) || 'speaker'}-${shortHash(`${name}|${company ?? ''}`)}`;
}

export const trackId = (name: string) => slug(name);
export const roomId = (name: string) => slug(name);
export const sponsorId = (name: string) => slug(name);

/**
 * Registrations are keyed by an opaque id derived from the email, not by the
 * email itself: addresses are mutable, `a/b@example.com` is a legal address and
 * an illegal path segment, and an email-keyed collection is a membership oracle
 * for anyone who can attempt a read.
 *
 * Derived rather than random so a re-import updates the same registration.
 */
export function registrationId(email: string): string {
  return `reg_${createHash('sha256').update(normaliseEmail(email)).digest('hex').slice(0, 24)}`;
}

/** Lookup key. Never the document id, so the plaintext address is not a path. */
export function emailHash(email: string): string {
  return createHash('sha256').update(normaliseEmail(email)).digest('hex');
}

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

/**
 * The only value that ever goes into a badge QR code.
 *
 * Random, not derived — a derived secret would be forgeable by anyone who knows
 * the input, and the whole point is that photographing someone's badge reveals
 * nothing. A uid must never appear here.
 */
export const qrSecret = () => randomBytes(24).toString('base64url');

/** Six characters, printed on the badge as a fallback sign-in door. */
export function claimCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0, I/1
  return Array.from(randomBytes(6))
    .map((b) => alphabet[b % alphabet.length])
    .join('');
}

/** RFC 5545 UID for calendar export, so a reschedule updates instead of duplicating. */
export const stableGuid = (sid: string) => `${sid}@kgc-2027.knowledgegraph.tech`;
