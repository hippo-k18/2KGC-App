import type { EmailBodyDoc, EmailLogDoc } from '@kgc/shared';

/**
 * What `send()` keeps of each message for the dashboard's Email Log (T274).
 *
 * Pure, so the masking can be tested without a store or a provider. `email.ts`
 * calls `storedBody()` and writes the result to `emailBodies/{logId}`.
 *
 * ── Retention ───────────────────────────────────────────────────────────────
 *
 * Kept for `BODY_RETENTION_DAYS` (about thirteen months: one conference cycle
 * and the support questions that trail it). Each body carries `expireAt`, and a
 * Firestore TTL policy on `emailBodies.expireAt` deletes it after that date once
 * the policy is switched on. Until it is, nothing is deleted. The `emailLog` row
 * itself is not touched by this.
 *
 * ── Size ────────────────────────────────────────────────────────────────────
 *
 * A Firestore document holds at most 1 MiB. Our largest mail is a ticket
 * confirmation at around 15 KB, so the cap only matters for an organizer's bulk
 * message with something enormous pasted into it. Over the cap the HTML is
 * dropped and the text kept, and the preview says so.
 */

export const BODY_RETENTION_DAYS = 400;

/** Characters of HTML plus text kept per message, well inside 1 MiB of UTF-8. */
export const MAX_BODY_CHARS = 600_000;

/** What a masked code reads as in the stored copy. */
export const MASK = '••••••';

/**
 * The templates that carry a one-time code. Their callers pass the code in
 * `secrets`; on top of that every standalone run of digits that looks like a
 * code is masked in these, so a template edited later to print the code twice,
 * or a caller that forgets `secrets`, still stores nothing usable.
 */
export const CODE_TEMPLATES: ReadonlySet<EmailLogDoc['template']> = new Set([
  'sign-in-code',
  'blog-sign-in-code',
  'dashboard-sign-in-code',
  'ticket-sign-in-code',
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Six digits standing alone: not part of a word, a colour (`#222222`), a price
 * or a longer number. Every code this project mails is six digits; a year such
 * as 2027 in the footer is left alone.
 */
const CODE_LIKE = /(?<![#\w.,])\d{6}(?!\w)(?![.,]\d)/g;

/**
 * Replace each secret in `value` with `MASK`. With `codeLike`, also every
 * standalone six-digit run. Returns whether anything was replaced.
 */
export function maskSecrets(
  value: string,
  secrets: readonly string[],
  codeLike = false,
): { value: string; masked: boolean } {
  let out = value;
  for (const s of secrets) {
    const secret = s.trim();
    if (secret.length < 4) continue;
    out = out.replace(new RegExp(escapeRegExp(secret), 'g'), MASK);
  }
  if (codeLike) out = out.replace(CODE_LIKE, MASK);
  return { value: out, masked: out !== value };
}

export interface CaptureInput {
  from: string;
  replyTo: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  template: EmailLogDoc['template'];
  /** Values that must never be stored: a sign-in code. */
  secrets?: readonly string[];
}

/** The `emailBodies` document for one message, minus `eventId`. */
export function storedBody(input: CaptureInput, now: Date): Omit<EmailBodyDoc, 'eventId'> {
  const secrets = input.secrets ?? [];
  const codeLike = CODE_TEMPLATES.has(input.template);
  const subject = maskSecrets(input.subject, secrets, codeLike);
  const html = maskSecrets(input.html, secrets, codeLike);
  const text = maskSecrets(input.text, secrets, codeLike);
  const tooBig = html.value.length + text.value.length > MAX_BODY_CHARS;
  const masked = subject.masked || html.masked || text.masked;

  return {
    from: input.from,
    replyTo: input.replyTo,
    to: input.to,
    subject: subject.value,
    html: tooBig ? '' : html.value,
    text: text.value.slice(0, MAX_BODY_CHARS),
    ...(input.headers && Object.keys(input.headers).length ? { headers: input.headers } : {}),
    template: input.template,
    ...(tooBig ? { htmlDropped: true } : {}),
    ...(masked ? { masked: true } : {}),
    // Native Dates: a sentinel built in this package is the wrong class for
    // the caller's store (AGENTS.md gotcha 8).
    at: now as unknown as EmailBodyDoc['at'],
    expireAt: new Date(now.getTime() + BODY_RETENTION_DAYS * 86_400_000) as unknown as EmailBodyDoc['expireAt'],
  };
}
