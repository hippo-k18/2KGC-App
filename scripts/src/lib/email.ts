import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT, EVENT_ID, publicSiteOrigin, type EmailLogDoc } from '@kgc/shared';
import { storedBody, type CaptureInput } from './email-capture.js';
import { contactId } from './ids.js';
import { ensureReferralCode, firstNameOf, inviteMailto, personalInviteUrl } from './referrals.js';
import { mintUnsubscribeToken } from './unsubscribe-token.js';

/**
 * `119900` → `$1,199`. A local copy rather than an import from the website's
 * `tickets.ts`, because this package must not depend on a Next.js app — and a
 * four-line formatter is a cheaper duplication than an inverted dependency.
 */
function formatPrice(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/**
 * Transactional email, through Resend.
 *
 * Lives in `@kgc/scripts` rather than in the website because two callers need
 * it and neither can import the other: the website's Stripe webhook, and the
 * organizer dashboard's mark-invoice-paid action. Duplicating the templates
 * would mean a receipt that says one thing when Stripe reports payment and
 * another when an organizer accepts a purchase order.
 *
 * `store` is a parameter for the same reason it is in `fulfilment.ts` — each
 * app initialises Firestore with its own credential rules.
 *
 * ── The one rule that governs this whole file ───────────────────────────────
 *
 * **A failed send must never fail its caller.** Every function here swallows
 * its own errors and none of them rejects. The callers are the Stripe webhook
 * and the invoice action; a throw in the webhook becomes a non-2xx, a non-2xx
 * makes Stripe retry the event for ever, and Stripe eventually disables the
 * endpoint — which takes *fulfilment* down because a receipt did not send. The
 * ticket matters; the receipt is a courtesy.
 *
 * ⚠️ They return `SendOutcome` rather than nothing, and that is a correction,
 * not a relaxation. The old signature was `Promise<void>` with a comment
 * saying "there is no caller that should branch on whether a receipt went out,
 * and offering a boolean invites one to". True of a receipt; false of every
 * screen with a Send button on it. The dashboard was telling organizers "Link
 * sent to marek@…" for mail the provider had refused seconds earlier, because
 * the only thing the caller could check was whether an API key existed. A
 * caller may now *report* what happened. It still must not *fail* on it: the
 * webhook and the invoice action ignore the value and are right to.
 *
 * ── Why there is a log ──────────────────────────────────────────────────────
 *
 * The commonest support question a conference gets is "I never got my
 * confirmation". The only useful answers are "we sent it at 14:02, check spam"
 * and "we tried, and the provider rejected the address". Both need a record, so
 * every attempt writes `emailLog` — including the skips, so that a deployment
 * with no API key is visibly not sending rather than apparently succeeding.
 *
 * ── No provider SDK ─────────────────────────────────────────────────────────
 *
 * Resend's REST API is one POST with a JSON body. Adding their SDK to get that
 * would pull a dependency into a serverless bundle for no benefit, and pinning
 * it becomes another upgrade to track. `fetch` is in the runtime already.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Who the mail comes from: the conference's staffed inbox, for every email
 * this system sends (owner, 2026-10-19: "all emails should come from contact
 * at knowledge graph ... not from hello").
 *
 * A constant, not `EMAIL_FROM`. Every deployment's env file still names
 * hello@, and an override would quietly keep it; one address in the code is
 * the only way "every email" stays true. The domain is verified in Resend, so
 * a send from it is accepted. The friendly name is there because "Knowledge
 * Graph Conference" in an inbox list is recognised and a bare address is not.
 */
export const FROM_ADDRESS = `Knowledge Graph Conference <${EVENT.contactEmail}>`;

function fromAddress(): string {
  return FROM_ADDRESS;
}

/**
 * Where replies go: the same staffed inbox the mail now comes from. Set
 * explicitly anyway, so a client that prefers Reply-To lands in the same
 * place, and so does the List-Unsubscribe mailto. Not `EMAIL_REPLY_TO` either,
 * for the same reason as the from address.
 */
const CONTACT = EVENT.contactEmail;

function replyTo(): string {
  return CONTACT;
}

/**
 * The footer line. Mail used to come from hello@, which has no mailbox, so it
 * said "Please don't reply". It comes from contact@ now and a reply arrives,
 * so every email invites one.
 */
const REPLY_LINE_TEXT = `Questions? Reply to this email or write to ${CONTACT}.`;
const REPLY_LINE_HTML = `Questions? Reply to this email or write to <a href="mailto:${CONTACT}" style="color:#6b7280;">${CONTACT}</a>.`;

/** Who mail is from and where replies go, as configured now. For the Email Log's re-created previews (T274). */
export function senderIdentity(): { from: string; replyTo: string } {
  return { from: fromAddress(), replyTo: replyTo() };
}

interface SendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: EmailLogDoc['template'];
  orderId?: string;
  registrationId?: string;
  campaignId?: string;
  /** The submission a call-for-papers email is about. */
  submissionId?: string;
  actor?: string;
  /**
   * Set only on mail that is governed by the suppression list. Adds the two
   * RFC 8058 headers, which is what puts the native "Unsubscribe" button beside
   * the sender name in Gmail and Apple Mail — the genuinely one-click path,
   * because the mail client POSTs on the reader's behalf and no page is opened.
   */
  unsubscribeUrl?: string;
  /**
   * What makes two sends "the same mail", for Resend's `Idempotency-Key`.
   *
   * The header is built from (template, this key, recipient), so a bulk send
   * passes its campaign id and a re-press of the same campaign cannot mail
   * anybody twice inside Resend's 24-hour window, even when the first answer
   * was lost to a timeout. Left out, each call gets a random key: its own
   * retries are covered, and a deliberate re-send (Resend confirmation) still
   * goes out.
   *
   * ⚠️ A key only dedupes when the payload is byte-identical. A different
   * payload under the same key is refused with a 409, so a caller passing one
   * must build the same message every time (see `issuedAt` on bulk mail).
   */
  idempotencyKey?: string;
  /**
   * Values that must not be kept in the Email Log's stored copy: a sign-in
   * code. Masked in the subject, HTML and text before anything is written.
   */
  secrets?: readonly string[];
}

/**
 * Drops keys whose value is `undefined`.
 *
 * `SendInput` carries four optional correlation fields, and every send spreads
 * all four into the log entry whether or not the caller supplied them. That is
 * a Firestore error — `undefined` is not a value — and it was invisible for as
 * long as this module had only two callers, because `apps/web` and
 * `@kgc/scripts` both call `settings({ ignoreUndefinedProperties: true })` and
 * that setting silently did this job for us. Cloud Functions does not set it,
 * so `requestOtp` became the first caller for which every `emailLog` write
 * threw — into the `catch` below, which reports on stdout and carries on,
 * exactly as designed. The result was a sender that appeared to work and logged
 * nothing at all.
 *
 * Doing it here rather than turning the setting on in `functions/` is
 * deliberate: `ignoreUndefinedProperties` is a store-wide behaviour that also
 * makes `set(…, { merge: true })` unable to clear a field (AGENTS.md gotcha 9),
 * and no module should require its callers to adopt a footgun to be usable.
 */
function defined<T extends Record<string, unknown>>(doc: T): Partial<T> {
  return Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Write one `emailLog` row and, when given, the message behind it.
 *
 * Both go in one batch, so the row says `hasBody` exactly when the body landed
 * and the send pays one round trip, not two (T274). If the batch fails (a body
 * Firestore refuses), the row is written alone: a lost preview never costs the
 * row, and never the send.
 */
async function log(
  store: Firestore,
  entry: Omit<EmailLogDoc, 'eventId' | 'at'>,
  body?: CaptureInput,
): Promise<void> {
  try {
    const at = new Date();
    const ref = store.collection(COLLECTIONS.emailLog).doc();
    // A native Date, never `FieldValue.serverTimestamp()`. Each app resolves
    // its own copy of `firebase-admin`, and Firestore checks sentinels with
    // `instanceof` — a sentinel built here is the wrong class for the
    // caller's store and the whole write fails. See `fulfilment.ts`.
    const row = defined({ ...entry, eventId: EVENT_ID, at });
    if (body) {
      try {
        await store
          .batch()
          .set(store.collection(COLLECTIONS.emailBodies).doc(ref.id), defined({ ...storedBody(body, at), eventId: EVENT_ID }))
          .set(ref, { ...row, hasBody: true })
          .commit();
        return;
      } catch (err) {
        console.error('[email] could not store the message for the Email Log', err);
      }
    }
    await ref.set(row);
  } catch (err) {
    // The log is the diagnostic, not the product. If even this fails, say so on
    // stdout and carry on — there is nothing useful left to do.
    console.error('[email] could not write emailLog', err);
  }
}

/**
 * What happened to one send. The same three words the log stores, so a screen
 * and the log can never disagree about a single attempt.
 *
 * `skipped` — this deployment cannot send at all.
 * `failed`  — the provider was asked and refused, or the call threw.
 * `sent`    — the provider accepted it.
 *
 * ⚠️ `sent` is the provider accepting it for delivery, which is the strongest
 * thing any sender can honestly claim. It is not "it arrived" and it is not
 * "they read it".
 */
export type SendOutcome = 'sent' | 'skipped' | 'failed';

/**
 * One line for a screen, saying what actually happened to a send.
 *
 * ⚠️ This exists because the dashboard was reporting intent as fact. Every Send
 * button branched on `emailEnabled()`, which only asks whether an API key is
 * configured, so a key plus a provider that refused the address produced a
 * green "Link sent to marek@…" beside a log row reading `failed`. An organizer
 * then tells a stand to check an inbox nothing was ever delivered to.
 *
 * The `skipped` wording is the sentence this project already uses on the
 * screens where sending is switched off, and `failed` is deliberately shaped
 * the same way: something did not happen, and here is the thing to do instead.
 * A reader should not have to know which of the two it was to know what to do.
 *
 * `fallback` is the by-hand path for this particular screen, so it is the
 * caller's to supply. It should be a whole sentence.
 */
export function sendOutcomeMessage(input: {
  outcome: SendOutcome;
  to: string;
  /** The whole sentence to show when the provider accepted it. */
  sent: string;
  /** What to do instead, when it did not go. */
  fallback: string;
}): string {
  if (input.outcome === 'sent') return input.sent;
  if (input.outcome === 'skipped') {
    return `Email is not switched on yet, so nothing was sent to ${input.to}. ${input.fallback}`;
  }
  return `The email to ${input.to} was refused, so nothing arrived. ${input.fallback}`;
}

/**
 * Send one email. Never throws, never rejects.
 *
 * Returns what happened. Every `return` below is paired with the `log()` call
 * that records the same word, and they are written together on purpose: an
 * outcome the screen reports and a log row support reads have to come from one
 * branch, or the two answers to "did it go?" drift apart.
 */
/**
 * How long Resend gets to answer before the send counts as `failed`.
 *
 * Without a limit a provider that accepts the connection and never answers
 * held the webhook and the buyer's return redirect open for undici's five
 * minutes, with the confirmation claim stuck `pending` all that time (T135B,
 * TK-222). A send normally takes well under a second. `RESEND_TIMEOUT_MS`
 * overrides it, for tests.
 */
export function sendTimeoutMs(): number {
  const fromEnv = Number(process.env.RESEND_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 10_000;
}

/**
 * One line of text for a header: control characters (CR and LF above all)
 * become spaces, runs of whitespace collapse, and the ends are trimmed. A
 * company name typed with a line break in it went into the subject line
 * as-is (T135B, TK-227).
 */
export function headerText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function send(store: Firestore, input: SendInput): Promise<SendOutcome> {
  input = { ...input, subject: headerText(input.subject) };
  const base = {
    to: input.to,
    subject: input.subject,
    template: input.template,
    orderId: input.orderId,
    registrationId: input.registrationId,
    campaignId: input.campaignId,
    submissionId: input.submissionId,
    actor: input.actor,
  };

  const headers: Record<string, string> | undefined = input.unsubscribeUrl
    ? {
        /*
         * RFC 8058 one-click. `List-Unsubscribe-Post` is what promotes
         * the header from "open this link" to a button the client
         * presses itself, and both Gmail and Yahoo have required it
         * since 2024 for anyone sending bulk mail at volume.
         *
         * The `mailto:` is the fallback for clients that honour the
         * header but not the POST. It is second because a client that
         * understands both must prefer the https one.
         */
        'List-Unsubscribe': `<${input.unsubscribeUrl}>, <mailto:${replyTo()}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      }
    : undefined;
  // What the Email Log keeps: the message exactly as it is handed to Resend.
  const body: CaptureInput = {
    from: fromAddress(),
    replyTo: replyTo(),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    headers,
    template: input.template,
    secrets: input.secrets,
  };

  const captured = capture(input);
  if (captured) {
    await log(store, { ...base, status: 'sent', providerId: `capture:${captured}` }, body);
    return 'sent';
  }

  if (!emailEnabled()) {
    await log(
      store,
      {
        ...base,
        status: 'skipped',
        reason: 'RESEND_API_KEY is not set on this deployment',
      },
      body,
    );
    return 'skipped';
  }

  const payload = JSON.stringify({
    from: body.from,
    to: [input.to],
    reply_to: body.replyTo,
    subject: input.subject,
    html: input.html,
    // A plain-text part is not decoration: some corporate mail gateways
    // score HTML-only mail as spam, and a conference receipt landing in a
    // spam folder is the failure this whole file exists to avoid.
    text: input.text,
    ...(headers ? { headers } : {}),
  });
  const key = idempotencyKeyFor(input.template, input.idempotencyKey ?? randomUUID(), input.to);

  const result = await deliver(payload, key);
  if (result.ok) {
    await log(
      store,
      {
        ...base,
        status: 'sent',
        providerId: result.id,
        ...(result.attempts > 1 ? { attempts: result.attempts } : {}),
      },
      body,
    );
    return 'sent';
  }
  await log(
    store,
    {
      ...base,
      status: 'failed',
      error: result.error.slice(0, 500),
      ...(result.attempts > 1 ? { attempts: result.attempts } : {}),
    },
    body,
  );
  console.error('[email] not sent', input.template, result.error.slice(0, 200));
  return 'failed';
}

// ---------------------------------------------------------------------------
// Pacing, retries and idempotency (T258 #1-3)
//
// Every sender in this process shares one Resend key and one rate limit, so a
// campaign of 2,000 and a buyer's receipt queue for the same slots. Before
// this, nothing paced the sends: the consent send fired 20 at once against a
// 2/s limit, every 429 was logged `failed` and never retried, and a receipt
// that went out while a campaign ran could be refused the same way.
// ---------------------------------------------------------------------------

/**
 * Requests per second this process may make to Resend. `RESEND_MAX_PER_SECOND`
 * overrides the default of 2, which is Resend's default team limit. Two
 * processes (website and dashboard) share the key, so a 429 is still possible
 * and is retried below.
 */
export function sendRatePerSecond(): number {
  const n = Number(process.env.RESEND_MAX_PER_SECOND);
  return Number.isFinite(n) && n > 0 ? n : 2;
}

/** How many times one mail is tried, first attempt included. */
export function sendMaxAttempts(): number {
  const n = Number(process.env.RESEND_MAX_ATTEMPTS);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 8) : 4;
}

/** The first backoff, doubled on each retry. `RESEND_RETRY_BASE_MS` overrides it, for tests. */
function retryBaseMs(): number {
  const n = Number(process.env.RESEND_RETRY_BASE_MS);
  return Number.isFinite(n) && n >= 0 ? n : 1_000;
}

/** The longest any single wait may be, whatever `Retry-After` asks for. */
const MAX_BACKOFF_MS = 20_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The next free slot under the rate limit, shared by every send in this
 * process. First come, first served: a receipt waits behind at most the one
 * campaign mail already queued, because the bulk senders await each send.
 */
let nextSlotAt = 0;
/** Callers holding a reserved slot and sleeping until it comes round. */
let waiting = 0;
export async function takeSlot(): Promise<void> {
  const gap = 1_000 / sendRatePerSecond();
  const now = Date.now();
  /*
   * Never further ahead than the callers already queued can justify (T280,
   * gate A#1/A#2). `nextSlotAt` is wall-clock: a clock stepped back by hours
   * (an NTP correction, or a test faking `Date`) left it hours in the future,
   * and every send in the process then slept until the clock caught up. Each
   * queued caller legitimately holds one gap, and the last send before them
   * one more, so the bound is one gap per waiter plus one.
   */
  nextSlotAt = Math.min(nextSlotAt, now + (waiting + 1) * gap);
  const at = Math.max(now, nextSlotAt);
  nextSlotAt = at + gap;
  if (at > now) {
    waiting++;
    try {
      await sleep(at - now);
    } finally {
      waiting--;
    }
  }
}

/**
 * The `Idempotency-Key` header for one mail: (template, key, recipient),
 * hashed so the address does not travel in a header and the length stays well
 * inside Resend's 256 characters.
 */
export function idempotencyKeyFor(template: string, key: string, to: string): string {
  const digest = createHash('sha256')
    .update(`${template}\u0000${key}\u0000${to.trim().toLowerCase()}`)
    .digest('hex');
  return `kgc-${digest.slice(0, 48)}`;
}

/**
 * Whether a refused request is worth trying again.
 *
 * 429 and 5xx are the provider saying "not now". A 409 whose code is
 * `concurrent_idempotent_requests` means an earlier attempt with the same key
 * is still being processed, which is also "not now". Every other 4xx (a bad
 * address, an unverified domain, the same key with a different payload) will
 * fail the same way every time.
 */
export function retryableStatus(status: number, body: string): boolean {
  if (status === 429 || status >= 500) return true;
  return status === 409 && body.includes('concurrent_idempotent_requests');
}

/** `Retry-After` in seconds or as a date, in ms, or null. */
function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/** Exponential backoff with a little jitter, so two processes do not retry in step. */
export function backoffMs(attempt: number, retryAfter: number | null, base = retryBaseMs()): number {
  const wait = retryAfter ?? base * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);
  return Math.min(MAX_BACKOFF_MS, Math.round(wait));
}

type Delivery = { ok: true; id?: string; attempts: number } | { ok: false; error: string; attempts: number };

/**
 * POST one mail, paced, retried on 429, 5xx and timeouts, under one
 * idempotency key for every attempt.
 *
 * ⚠️ The key is what makes the timeout retry safe. A Resend that accepted the
 * mail and answered after our timeout used to be logged `failed`, and the next
 * attempt sent it again. With the same key and the same body, Resend answers
 * the retry with the first result and sends nothing new.
 */
async function deliver(body: string, key: string): Promise<Delivery> {
  const attempts = sendMaxAttempts();
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await takeSlot();
    let retryAfter: number | null = null;
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        // An abort throws, and the catch below treats it as worth retrying.
        signal: AbortSignal.timeout(sendTimeoutMs()),
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body,
      });

      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as { id?: string };
        return { ok: true, id: json.id, attempts: attempt };
      }

      const text = await res.text().catch(() => '');
      lastError = `${res.status} ${text}`;
      if (!retryableStatus(res.status, text)) return { ok: false, error: lastError, attempts: attempt };
      retryAfter = retryAfterMs(res.headers.get('retry-after'));
    } catch (err) {
      lastError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
    if (attempt < attempts) await sleep(backoffMs(attempt, retryAfter));
  }
  return { ok: false, error: `${lastError} (after ${attempts} attempts)`, attempts };
}

/**
 * `EMAIL_CAPTURE_DIR`: write each message to a JSON file there instead of
 * sending it, and report it as sent.
 *
 * For local and emulator runs only, so a test can read what E1 or E3 actually
 * said rather than only that a send was skipped. Refused when
 * `NODE_ENV=production` or when a Resend key is set, so a stray variable on
 * the droplet cannot turn real mail into files nobody reads.
 */
function capture(input: SendInput): string | null {
  const dir = process.env.EMAIL_CAPTURE_DIR;
  if (!dir || process.env.NODE_ENV === 'production' || process.env.RESEND_API_KEY) return null;
  try {
    mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${input.template}-${Math.random().toString(36).slice(2, 8)}.json`;
    writeFileSync(
      path.join(dir, name),
      JSON.stringify(
        {
          from: fromAddress(),
          replyTo: replyTo(),
          to: input.to,
          subject: input.subject,
          template: input.template,
          submissionId: input.submissionId,
          text: input.text,
          html: input.html,
        },
        null,
        2,
      ),
    );
    return name;
  } catch (err) {
    console.error('[email] could not capture', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Templates
//
// Inline HTML with inline styles, because email clients strip <style> blocks
// and Outlook ignores most of what survives. Kept deliberately plain: a receipt
// that renders as readable text everywhere beats one that is beautiful in
// Gmail and broken in Outlook, which is what finance departments use.
// ---------------------------------------------------------------------------

const BRAND = '#1c2b4a';

/**
 * Images for a template, served by the website from `public/email/`.
 *
 * Linked, not attached: an attachment is sent with every copy of every
 * receipt, and inline attachments are shown as a paperclip by some clients.
 * The URL comes from `WEB_PUBLIC_ORIGIN`, so it must name a site that has the
 * file deployed. Every image has width and height set and alt text, so a
 * client that blocks images still shows a sensible layout.
 */
interface ShellImages {
  /** A 2:1 photo, full width under the header band. */
  hero?: { src: string; alt: string };
  /** Play confetti above the heading: an animated GIF, first frame is static. */
  confetti?: boolean;
}

function emailImage(file: string): string {
  return `${publicSiteOrigin()}/email/${file}`;
}

function shell(heading: string, body: string, images: ShellImages = {}): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:6px;overflow:hidden;border:1px solid #e3e5e8;">
        <tr><td style="background:${BRAND};padding:20px 28px;">
          <span style="color:#ffffff;font-size:17px;font-weight:600;letter-spacing:.02em;">Knowledge Graph Conference 2027</span>
        </td></tr>
        ${
          images.hero
            ? `<tr><td style="padding:0;line-height:0;"><img src="${images.hero.src}" width="560" height="280" alt="${images.hero.alt}" style="display:block;width:100%;max-width:560px;height:auto;border:0;"></td></tr>`
            : ''
        }
        <tr><td style="padding:${images.confetti ? '0' : '28px'} 28px 28px;">
          ${
            images.confetti
              ? `<img src="${emailImage('confetti.gif')}" width="504" height="81" alt="" style="display:block;width:100%;max-width:504px;height:auto;border:0;margin:0 0 4px;">`
              : ''
          }
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${BRAND};">${heading}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:18px 28px;background:#fafbfc;border-top:1px solid #e3e5e8;font-size:12px;color:#6b7280;">
          3–7 May 2027 · Jay Conference Bryant Park, New York<br>
          ${REPLY_LINE_HTML}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:22px 0;"><a href="${href}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:4px;font-size:15px;font-weight:600;">${label}</a></p>`;
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:7px 0;color:#6b7280;font-size:14px;width:150px;">${label}</td><td style="padding:7px 0;font-size:14px;font-weight:600;">${value}</td></tr>`;
}

/** Escapes into HTML text. Names and company names are user input. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface PurchaseEmailInput {
  to: string;
  name: string;
  ticketType: string;
  amountCents: number;
  currency: string;
  /** The `/order/{token}` capability link: the ticket itself. */
  orderUrl: string;
  claimCode: string;
  orderId?: string;
  registrationId?: string;
  /**
   * The six-digit temporary password this buyer's account was created with,
   * when one was set. Omitted or null for an account that already existed, and
   * whenever `ISSUE_TEMPORARY_PASSWORDS=0`.
   *
   * ⚠️ Passed in rather than read from the environment here, so the receipt can
   * only ever print a password that provisioning actually set. Reading it
   * independently would mail a credential to somebody whose account does not
   * have it the moment the two disagree — which is precisely the support
   * ticket nobody can diagnose.
   */
  temporaryPassword?: string | null;
  /**
   * The attendee's referral code, for the "Bring your team" block. When left
   * out, it is read or minted from `registrationId`, so the dashboard's senders
   * (invoices, manual orders, comp passes) get the block without each minting
   * their own. With neither, or if minting fails, the block is left out.
   */
  referralCode?: string | null;
  /**
   * Set when this purchase added an extra to a ticket the person already holds
   * ("Workshops"). The email then says it was added, and `ticketType` should be
   * the whole badge label ("Main Conference + Workshops"). Same link, same QR.
   */
  addedExtra?: string;
}

/**
 * The "Bring your team" block's link and button, or null.
 *
 * The personal link goes to the same site as the ticket link, so a staging
 * receipt invites people to staging and a live one to live.
 */
async function inviteFor(
  store: Firestore,
  input: PurchaseEmailInput,
): Promise<{ link: string; mailto: string } | null> {
  let code = input.referralCode ?? null;
  if (!code && input.registrationId) {
    try {
      code = await ensureReferralCode(store, input.registrationId);
    } catch (err) {
      console.error('[email] could not mint a referral code for', input.registrationId, err);
    }
  }
  if (!code) return null;
  let origin: string;
  try {
    origin = new URL(input.orderUrl).origin;
  } catch {
    origin = publicSiteOrigin();
  }
  const link = personalInviteUrl(origin, code);
  return { link, mailto: inviteMailto(link, firstNameOf(input.name)) };
}

/** Min's copy, verbatim (2026-09-28). */
const BRING_YOUR_TEAM =
  'Most of what people take home from KGC happens between the sessions, and those conversations go further when the people you work with are in the room too!';

/**
 * The one email that actually matters.
 *
 * Stripe's own receipt proves money moved; only this proves there is a ticket.
 * It deliberately carries no claim code and no password (owner, 2026-09-26):
 * the registration desk finds people by email, and the website's session pages
 * sign in with an emailed code. `claimCode` and `temporaryPassword` are still
 * accepted so callers need not change, and are not printed.
 */
export async function sendPurchaseConfirmation(store: Firestore, input: PurchaseEmailInput): Promise<SendOutcome> {
  if (input.addedExtra) return sendExtraAdded(store, { ...input, addedExtra: input.addedExtra });
  const message = purchaseConfirmationMessage(input, await inviteFor(store, input));
  return send(store, {
    to: input.to,
    ...message,
    template: 'purchase-confirmation',
    orderId: input.orderId,
    registrationId: input.registrationId,
  });
}

/**
 * The ticket confirmation, built and not sent. Pure, so the dashboard's Email
 * Log can re-create the preview of one sent before bodies were stored (T274).
 * `invite` is the "Bring your team" block, or null to leave it out.
 */
export function purchaseConfirmationMessage(
  input: Pick<PurchaseEmailInput, 'to' | 'name' | 'ticketType' | 'amountCents' | 'currency' | 'orderUrl'>,
  invite: { link: string; mailto: string } | null,
): { subject: string; html: string; text: string } {
  const price = formatPrice(input.amountCents, input.currency);
  const greeting = firstNameOf(input.name) ? `Hi ${esc(firstNameOf(input.name))},` : 'Hi,';

  const html = shell(
    "You're going to the Knowledge Graph Conference",
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} you're registered. Here are the details.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e3e5e8;border-bottom:1px solid #e3e5e8;margin:6px 0;">
       ${row('Attendee', esc(input.name || input.to))}
       ${row('Ticket', esc(input.ticketType))}
       ${row('Paid', price)}
     </table>
     ${button(input.orderUrl, 'View your ticket')}
     <p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">Your badge QR code is in the KGC app. If you don't have the app, give your name at the registration desk. Keep this link private: anyone with it can see your ticket.</p>${
       invite
         ? `
     <h2 style="margin:28px 0 8px;padding-top:22px;border-top:1px solid #e3e5e8;font-size:17px;line-height:1.3;color:${BRAND};">Bring your team</h2>
     <p style="margin:0;font-size:15px;line-height:1.6;">${esc(BRING_YOUR_TEAM)}</p>
     ${button(esc(invite.mailto), 'Invite your team')}`
         : ''
     }`,
    {
      hero: {
        src: emailImage('ticket-hero.jpg'),
        alt: 'The main hall at the Knowledge Graph Conference',
      },
      confetti: true,
    },
  );

  const text = `${greeting} you're registered for the Knowledge Graph Conference.

Attendee:      ${input.name || input.to}
Ticket:        ${input.ticketType}
Paid:          ${price}

View your ticket: ${input.orderUrl}

Your badge QR code is in the KGC app. If you don't have the app, give your
name at the registration desk. Keep the link private: anyone with it can see
your ticket.
${
  invite
    ? `
Bring your team

${BRING_YOUR_TEAM}

Your personal link to share: ${invite.link}
`
    : ''
}
3-7 May 2027, Jay Conference Bryant Park, New York.
${REPLY_LINE_TEXT}`;

  return { subject: `Your Knowledge Graph Conference ticket: ${input.ticketType}`, html, text };
}

/** The invite block for a re-created preview: the referral code the registration already holds. */
export function inviteForCode(code: string | undefined, orderUrl: string, name: string): { link: string; mailto: string } | null {
  if (!code) return null;
  let origin: string;
  try {
    origin = new URL(orderUrl).origin;
  } catch {
    origin = publicSiteOrigin();
  }
  const link = personalInviteUrl(origin, code);
  return { link, mailto: inviteMailto(link, firstNameOf(name)) };
}

/**
 * An extra ticket (Workshops) added to a ticket the person already holds. No
 * new badge, so no new QR code and no "Bring your team" block: it confirms the
 * purchase and says the ticket they have now covers it.
 */
async function sendExtraAdded(
  store: Firestore,
  input: PurchaseEmailInput & { addedExtra: string },
): Promise<SendOutcome> {
  const price = formatPrice(input.amountCents, input.currency);
  const greeting = firstNameOf(input.name) ? `Hi ${esc(firstNameOf(input.name))},` : 'Hi,';
  const extra = esc(input.addedExtra);

  const html = shell(
    `${extra} added to your ticket`,
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} ${extra} is now on your ticket. You keep the same badge and QR code.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e3e5e8;border-bottom:1px solid #e3e5e8;margin:6px 0;">
       ${row('Attendee', esc(input.name || input.to))}
       ${row('Ticket', esc(input.ticketType))}
       ${row('Paid', price)}
     </table>
     ${button(input.orderUrl, 'View your ticket')}
     <p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">This is the same link as before. Don't forward it: anyone with the link can see your ticket.</p>`,
  );

  const text = `${greeting} ${input.addedExtra} is now on your ticket for the Knowledge Graph Conference. You keep the same badge and QR code.

Attendee:      ${input.name || input.to}
Ticket:        ${input.ticketType}
Paid:          ${price}

View your ticket: ${input.orderUrl}

3-7 May 2027, Jay Conference Bryant Park, New York.
${REPLY_LINE_TEXT}`;

  return send(store, {
    to: input.to,
    subject: `${input.addedExtra} added to your Knowledge Graph Conference ticket`,
    html,
    text,
    template: 'extra-added',
    orderId: input.orderId,
    registrationId: input.registrationId,
  });
}

export interface InvoiceEmailInput {
  to: string;
  companyName: string;
  seatCount: number;
  totalCents: number;
  currency: string;
  hostedInvoiceUrl: string;
  poNumber?: string;
  dueDate?: string;
  orderId?: string;
}

/**
 * Sent to the person who asked for the invoice, alongside Stripe's own.
 *
 * Stripe emails the invoice to the billing contact already. This one exists
 * because Stripe's does not say *what happens next for the attendees* — and the
 * answer ("nothing until it's paid") is the part that causes phone calls if it
 * is left implicit.
 */
export async function sendInvoiceRaised(store: Firestore, input: InvoiceEmailInput): Promise<SendOutcome> {
  const total = formatPrice(input.totalCents, input.currency);
  const seats = `${input.seatCount} ${input.seatCount === 1 ? 'seat' : 'seats'}`;

  const html = shell(
    'Your Knowledge Graph Conference invoice is ready',
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">We've raised an invoice for <strong>${esc(input.companyName)}</strong> covering ${seats}.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e3e5e8;border-bottom:1px solid #e3e5e8;margin:6px 0;">
       ${row('Company', esc(input.companyName))}
       ${row('Seats', String(input.seatCount))}
       ${row('Total', total)}
       ${input.poNumber ? row('PO number', esc(input.poNumber)) : ''}
       ${input.dueDate ? row('Due', esc(input.dueDate)) : ''}
     </table>
     ${button(input.hostedInvoiceUrl, 'View and pay the invoice')}
     <p style="margin:16px 0 0;font-size:15px;line-height:1.6;">Tickets are issued once the invoice is paid, so nobody is registered yet. When payment clears, each attendee on the invoice gets a confirmation email with their ticket.</p>
     <p style="margin:12px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">The invoice can be paid by card or bank transfer from that link, and downloaded as a PDF.</p>`,
  );

  const text = `Your Knowledge Graph Conference invoice is ready.

Company:  ${input.companyName}
Seats:    ${input.seatCount}
Total:    ${total}${input.poNumber ? `\nPO:       ${input.poNumber}` : ''}${input.dueDate ? `\nDue:      ${input.dueDate}` : ''}

View and pay: ${input.hostedInvoiceUrl}

Tickets are issued once the invoice is paid, so nobody is registered yet. When
payment clears, each attendee on the invoice gets a confirmation email with
their ticket.`;

  return send(store, {
    to: input.to,
    subject: `Knowledge Graph Conference invoice: ${input.companyName} (${seats})`,
    html,
    text,
    template: 'invoice-raised',
    orderId: input.orderId,
  });
}

export interface RefundEmailInput {
  to: string;
  name?: string;
  ticketType?: string;
  amountCents: number;
  currency: string;
  orderId?: string;
  registrationId?: string;
  /**
   * Whether this refund actually took a ticket away. False when a second,
   * still-paid order covers the same person and their badge keeps working.
   * Defaults to true, which is what a single-order refund does.
   */
  ticketCancelled?: boolean;
  /**
   * Whether the ticket had been passed to somebody else before the refund. The
   * buyer's own badge stopped working at the transfer, not now, so the sentence
   * about a badge that no longer scans is about a ticket they no longer hold.
   */
  transferred?: boolean;
  /**
   * Set when the refund took one ticket off a badge that stays valid:
   * Workshops refunded with Main Conference kept, or Main Conference refunded
   * with Workshops kept (2026-10-07). `remaining` is what the badge still holds.
   */
  extraRemoved?: { name: string; remaining: string };
}

/**
 * Confirms the money went back and, more usefully, what happened to the ticket.
 *
 * The second half is the point. Someone who refunds and still has a
 * confirmation email in their inbox will otherwise turn up at the door — and
 * finding out there is that the badge does not scan is a worse conversation
 * than an email that said so in April.
 *
 * ── Three readings, because the buyer is not always the ticket holder ───────
 *
 * This goes to whoever paid, always: they are owed the receipt. What it can say
 * about a badge depends on what the refund did.
 *
 * A plain refund cancels the buyer's own ticket, which is the original mail. A
 * refund of an order whose ticket was **transferred** cancels somebody else's
 * badge and not the buyer's, so the buyer is told about the ticket they passed
 * on and `sendTicketWithdrawn` tells the person now holding it. And a refund
 * that cancelled nothing, because another paid order still covers the seat,
 * must not claim a badge has stopped working when it has not.
 */
export async function sendRefundConfirmation(store: Firestore, input: RefundEmailInput): Promise<SendOutcome> {
  const amount = formatPrice(input.amountCents, input.currency);
  const greeting = firstNameOf(input.name) ? `Hi ${esc(firstNameOf(input.name))},` : 'Hi,';
  const cancelled = input.ticketCancelled ?? true;

  const removed = input.extraRemoved;

  const ticketHtml = removed
    ? `<strong>${esc(removed.name)} is no longer on your ticket.</strong> ${removed.remaining ? `Your ${esc(removed.remaining)} ticket is not affected and scans at the door as before.` : ''} If this was a mistake, write to ${CONTACT} and we'll sort it out.`
    : !cancelled
    ? `<strong>The ticket is not affected.</strong> Another order still covers it, so it scans at the door as before. If this was a mistake, write to ${CONTACT} and we'll sort it out.`
    : input.transferred
      ? `<strong>The ticket you passed on is now cancelled</strong>, so it will no longer scan at the door. We have told the person who was holding it. If this was a mistake, write to ${CONTACT} and we'll sort it out.`
      : `<strong>Your registration is now cancelled</strong>, so the badge QR code in the app will no longer scan at the door. If this was a mistake, write to ${CONTACT} and we'll sort it out.`;

  const ticketText = removed
    ? `${removed.name} is no longer on your ticket.${removed.remaining ? ` Your ${removed.remaining} ticket is not
affected and scans at the door as before.` : ''} If this was a mistake, write to ${CONTACT}.`
    : !cancelled
    ? `The ticket is not affected. Another order still covers it, so it scans at the
door as before. If this was a mistake, write to ${CONTACT}.`
    : input.transferred
      ? `The ticket you passed on is now cancelled, so it will no longer scan at the
door. We have told the person who was holding it. If this was a mistake, write
to ${CONTACT}.`
      : `Your registration is now cancelled, so the badge QR in the app will no longer
scan at the door. If this was a mistake, write to ${CONTACT}.`;

  const html = shell(
    'Your Knowledge Graph Conference ticket has been refunded',
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} we've refunded ${amount}${input.ticketType ? ` for your ${esc(input.ticketType)} ticket` : ''}. It usually reaches your account in five to ten working days, depending on your bank.</p>
     <p style="margin:14px 0 0;font-size:15px;line-height:1.6;">${ticketHtml}</p>`,
  );

  const text = `${greeting} we've refunded ${amount}${input.ticketType ? ` for your ${input.ticketType} ticket` : ''}.

It usually reaches your account in 5-10 working days.

${ticketText}`;

  return send(store, {
    to: input.to,
    subject: 'Your Knowledge Graph Conference ticket has been refunded',
    html,
    text,
    template: 'refund-confirmation',
    orderId: input.orderId,
    registrationId: input.registrationId,
  });
}

export interface TicketWithdrawnInput {
  to: string;
  name?: string;
  ticketType?: string;
  orderId?: string;
  /** The holder's own registration, never the buyer's. */
  registrationId?: string;
}

/**
 * Tells the person holding a transferred ticket that it has stopped working.
 *
 * The refund receipt goes to whoever paid, and after a transfer that is not the
 * person whose badge just died. Without this mail the holder learns at the
 * door, from a scanner, which is the exact conversation the refund receipt
 * exists to prevent for the buyer.
 *
 * It carries no amount. No money moved for this reader, and a figure in front
 * of them would read as a refund they are owed, which it is not.
 */
export async function sendTicketWithdrawn(store: Firestore, input: TicketWithdrawnInput): Promise<SendOutcome> {
  const greeting = firstNameOf(input.name) ? `Hi ${esc(firstNameOf(input.name))},` : 'Hi,';

  const html = shell(
    'Your Knowledge Graph Conference ticket has been cancelled',
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} the ticket that was passed to you${input.ticketType ? ` for ${esc(input.ticketType)}` : ''} has been cancelled, because the person who bought it has been refunded.</p>
     <p style="margin:14px 0 0;font-size:15px;line-height:1.6;"><strong>Your badge will no longer scan at the door.</strong> The money went back to whoever paid for the ticket, so there is nothing for you to claim. If you think this is wrong, write to ${CONTACT} and we'll sort it out.</p>`,
  );

  const text = `${greeting} the ticket that was passed to you${input.ticketType ? ` for ${input.ticketType}` : ''} has been
cancelled, because the person who bought it has been refunded.

Your badge will no longer scan at the door. The money went back to whoever paid
for the ticket, so there is nothing for you to claim. If you think this is
wrong, write to ${CONTACT}.`;

  return send(store, {
    to: input.to,
    subject: 'Your Knowledge Graph Conference ticket has been cancelled',
    html,
    text,
    template: 'ticket-cancelled',
    orderId: input.orderId,
    registrationId: input.registrationId,
  });
}

export interface SignInCodeEmailInput {
  to: string;
  /** Six digits. Never logged, never put in the subject — see below. */
  code: string;
  /** `CODE_TTL_MINUTES` from `requestOtp`, passed in so the two cannot drift. */
  ttlMinutes: number;
}

/**
 * The sign-in code for the attendee app.
 *
 * ── Why this one is different from the three above ──────────────────────────
 *
 * The other templates in this file carry *information*. This one carries a
 * **credential**, and that changes three things.
 *
 * **Nothing outside the message body may contain the code.** Not the subject —
 * subjects are recorded in `emailLog`, shown in notification previews on a
 * locked phone, and retained by mail gateways that do not retain bodies. Not
 * `reason` or `error`, which is why the code is never passed to `send()`
 * anywhere except inside `html` and `text`. `send()` logs `base` on every
 * outcome and `base` is built from `to`/`subject`/`template` only, so this
 * property holds by construction rather than by care.
 *
 * **It says how long the code lasts and what to do if you did not ask for it.**
 * Both are the standard advice for one-time codes, and both are load-bearing
 * here rather than boilerplate: without the first, someone who opens the mail
 * an hour later reads a failed sign-in as a broken app; without the second, an
 * unrequested code is alarming with no stated response.
 *
 * **It carries no link.** Every other template in this file has a button. A
 * sign-in mail that contains a clickable link is the exact shape of the
 * phishing mail an attacker would send to harvest these codes, and teaching
 * attendees that ours has one makes theirs work better. The code is typed into
 * the app the reader already opened.
 *
 * ── Delivery failure ────────────────────────────────────────────────────────
 *
 * The governing rule of this file — a failed send never fails its caller —
 * applies unchanged, and for a second reason on top of the webhook one:
 * `requestOtp` must return the same thing for every address, so a send that
 * threw would leak, through an error response, exactly the membership fact the
 * whole flow is built not to reveal. The `emailLog` row is the record that
 * something was attempted, including the `skipped` row written when no
 * `RESEND_API_KEY` is configured.
 */
export async function sendSignInCode(store: Firestore, input: SignInCodeEmailInput): Promise<SendOutcome> {
  const html = shell(
    'Your Knowledge Graph Conference sign-in code',
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Enter this code in the KGC app to sign in.</p>
     <p style="margin:10px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:30px;font-weight:600;letter-spacing:.22em;background:#f4f5f7;border:1px solid #e3e5e8;border-radius:4px;padding:16px;text-align:center;">${esc(input.code)}</p>
     <p style="margin:16px 0 0;font-size:15px;line-height:1.6;">It expires in ${input.ttlMinutes} minutes and works once. If it expires, request a new one on the same screen.</p>
     <p style="margin:14px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">If you didn't ask for this code, you can ignore this email. No one can sign in to your account without it.</p>`,
  );

  const text = `Enter this code in the KGC app to sign in.

  ${input.code}

It expires in ${input.ttlMinutes} minutes and works once. If it expires, request
a new one on the same screen.

If you didn't ask for this code, you can ignore this email. No one can sign in
to your account without it.

3-7 May 2027, Jay Conference Bryant Park, New York.
${REPLY_LINE_TEXT}`;

  return send(store, {
    to: input.to,
    // Deliberately does not contain the code, and deliberately does not name
    // the recipient or their ticket: this mail goes to any syntactically valid
    // address that asks, so anything specific in it would confirm to a stranger
    // that the address is on the guest list.
    subject: 'Your Knowledge Graph Conference sign-in code',
    html,
    text,
    template: 'sign-in-code',
    secrets: [input.code],
  });
}


// ---------------------------------------------------------------------------
// Bulk messages from an organizer
// ---------------------------------------------------------------------------

export interface BulkMessageInput {
  to: string;
  /** For "Hi Ada," — falls back to a plain greeting when absent. */
  name?: string;
  subject: string;
  /** Plain text. Blank lines become paragraphs; nothing else is interpreted. */
  body: string;
  /** Groups every row of one send in `emailLog`. */
  campaignId: string;
  /** The organizer who pressed send, recorded per recipient. */
  actor: string;
  /**
   * Campaign mail: refuse to send at all when no working unsubscribe link can
   * be built (T258 #11). Message Speakers leaves it off, because speakers are
   * not on the suppression list and get no link (see `unsubscribeUrlFor`).
   */
  requireUnsubscribe?: boolean;
  /**
   * The issued-at written into the unsubscribe token. A bulk send passes one
   * fixed value per campaign, so a resumed campaign builds byte-identical mail
   * and Resend's idempotency key can recognise a repeat. Defaults to now.
   */
  issuedAt?: number;
}

/**
 * The sender's postal address for the foot of bulk mail, from
 * `EMAIL_POSTAL_ADDRESS`, or null while the owner has not supplied one.
 *
 * CAN-SPAM asks commercial mail for a valid physical postal address of the
 * sender. The venue line in the footer is not one (T258 #10).
 */
export function postalAddress(): string | null {
  const raw = headerText(process.env.EMAIL_POSTAL_ADDRESS ?? '');
  return raw || null;
}

/**
 * The unsubscribe link for one recipient — **or null, which is the point.**
 *
 * ── Why this reads a document instead of always returning a link ────────────
 *
 * `sendBulkMessage` has two callers and only one of them is governed by the
 * suppression list. Email Campaign resolves its audience from `contacts` and
 * runs it through `audienceFor()`, which drops anybody with `unsubscribedAt`.
 * Message Speakers resolves its audience from `speakers` and consults
 * `contacts` never.
 *
 * So an unsubscribe link in a Message Speakers mail would be a promise this
 * code cannot keep: the reader clicks it, `contacts/{id}` records the
 * unsubscribe, and the next call for slides reaches them anyway. That is
 * exactly the defect class `AGENTS.md` counts fourteen instances of, and on an
 * unsubscribe confirmation it is also a legal claim.
 *
 * The honest gate is therefore "does a contact document exist for this
 * address?", because that is precisely the set of people whose suppression is
 * actually enforced. A speaker who is *also* on a contact list gets the link,
 * and for them it is true of the campaign mail it appeared in.
 *
 * ── The cost ────────────────────────────────────────────────────────────────
 *
 * One extra document read per recipient, at most 2,000 per send (the cap in
 * `email-campaign/actions.ts`). A `get()` by id, not a query, so it needs no
 * index. The sends are already sequential to avoid rate-limiting the sending
 * domain, so this adds no concurrency either.
 *
 * Returns null rather than throwing on any failure. A send must never be
 * stopped by this function — but note that a null here means the mail goes out
 * *without* a link, which for a campaign send is the thing to notice in the
 * log, hence the `console.warn`.
 *
 * ── Two URLs, and they are not interchangeable ──────────────────────────────
 *
 * ⚠️ `page` is for the human — a `GET` that renders a confirmation with a
 * button. `oneClick` is for the `List-Unsubscribe` header, and it **must** be
 * the route that accepts a `POST`.
 *
 * Putting `page` in that header is a silent failure and it was in this file
 * once: Gmail POSTs to the URL the header names, a POST to the page route
 * returns **200** without running anything, and Gmail shows the reader
 * "Unsubscribed" while they stay on the list. A visibly broken link would be
 * better — this one reports success to everybody involved.
 */
interface UnsubscribeLinks {
  /** `GET` — the human confirmation page with the button. */
  page: string;
  /** `POST` — RFC 8058. The only URL the `List-Unsubscribe` header may name. */
  oneClick: string;
}

async function unsubscribeUrlFor(
  store: Firestore,
  email: string,
  issuedAt?: number,
): Promise<UnsubscribeLinks | 'no-contact' | 'error'> {
  try {
    const id = contactId(email);
    const snap = await store.collection(COLLECTIONS.contacts).doc(id).get();
    if (!snap.exists) return 'no-contact';

    // One token, two routes. Both verify it the same way.
    const token = mintUnsubscribeToken(id, issuedAt);
    const origin = publicSiteOrigin();
    return { page: `${origin}/u/${token}`, oneClick: `${origin}/api/unsubscribe/${token}` };
  } catch (err) {
    console.warn('[email] could not build an unsubscribe link', err);
    return 'error';
  }
}

/**
 * One recipient of an organizer's bulk message.
 *
 * ── The body is plain text, on purpose ──────────────────────────────────────
 *
 * Organizers paste from Word, Google Docs and their own inbox. Accepting HTML
 * would mean either trusting it — pasting `<script>` into a form that emails a
 * thousand people is not a risk worth carrying — or sanitising it, which is a
 * dependency and a permanent source of "why did my formatting break".
 *
 * Blank lines become paragraphs and that is the whole grammar. Everything is
 * escaped, so a speaker writing `<3` or `Q&A` gets what they typed rather than
 * a broken tag.
 *
 * Like every other send here, this never throws: a bad address must not stop
 * the other forty-four people getting their call for slides.
 *
 * ── The unsubscribe link ────────────────────────────────────────────────────
 *
 * Added in two places, because they are two different mechanisms and a bulk
 * sender needs both: the RFC 8058 headers, which give Gmail and Apple Mail a
 * native one-click button, and a visible line at the foot of the message, which
 * is what a reader on a client that shows neither will look for. Both point at
 * the same `/u/{token}` capability link.
 *
 * ⚠️ It appears **only when a `contacts` document governs this address** — see
 * `unsubscribeUrlFor()` for why offering it otherwise would be a promise this
 * code cannot keep.
 */
export async function sendBulkMessage(store: Firestore, input: BulkMessageInput): Promise<SendOutcome> {
  const greeting = firstNameOf(input.name) ? `Hi ${esc(firstNameOf(input.name))},` : 'Hi,';
  const links = await unsubscribeUrlFor(store, input.to, input.issuedAt);
  const unsubscribe = typeof links === 'object' ? links : null;

  /*
   * Campaign mail without a working unsubscribe link is not sent at all
   * (T258 #11). It used to go out bare with only a console warning when the
   * token could not be minted, which is a legal problem on every copy.
   */
  if (input.requireUnsubscribe && !unsubscribe) {
    await log(store, {
      to: input.to,
      subject: headerText(input.subject),
      template: 'bulk-message',
      campaignId: input.campaignId,
      actor: input.actor,
      status: 'failed',
      error:
        links === 'no-contact'
          ? 'Not sent: this address is not on the contact list, so it has no unsubscribe link.'
          : 'Not sent: the unsubscribe link could not be built. Check WEB_UNSUBSCRIBE_SECRET or WEB_ORDER_SECRET.',
    });
    return 'failed';
  }
  const postal = postalAddress();

  const paragraphs = input.body
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter(Boolean)
    // Single newlines inside a paragraph become <br>, which is what somebody
    // typing an address block or a list of dates expects to happen.
    .map(
      (para) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${esc(para).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');

  /*
   * Above the shell's own footer rule rather than inside it, because `shell()`
   * is shared with the receipts and a receipt must never carry an unsubscribe
   * link — offering to stop a transactional mail is offering something we will
   * not honour, and it invites somebody to opt out of their own claim code.
   */
  const unsubscribeHtml = unsubscribe
    ? `<p style="margin:26px 0 0;padding-top:16px;border-top:1px solid #e3e5e8;font-size:12px;color:#6b7280;line-height:1.6;">
         You are receiving this because you are on a Knowledge Graph Conference mailing list.
         <a href="${unsubscribe.page}" style="color:#6b7280;">Unsubscribe</a>. You will still get
         emails about any ticket you hold.
       </p>`
    : '';
  const postalHtml = postal
    ? `<p style="margin:${unsubscribe ? '8px' : '26px'} 0 0;font-size:12px;color:#6b7280;line-height:1.6;">${esc(postal)}</p>`
    : '';

  const html = shell(
    esc(input.subject),
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting}</p>${paragraphs}${unsubscribeHtml}${postalHtml}`,
  );

  const unsubscribeText = unsubscribe
    ? `\n\nYou are receiving this because you are on a Knowledge Graph Conference mailing list.\nUnsubscribe: ${unsubscribe.page}\nYou will still get emails about any ticket you hold.`
    : '';

  const text = `${firstNameOf(input.name) ? `Hi ${firstNameOf(input.name)},` : 'Hi,'}\n\n${input.body}\n\n--\nKnowledge Graph Conference 2027\n3-7 May 2027, Jay Conference Bryant Park, New York\n${REPLY_LINE_TEXT}${unsubscribeText}${postal ? `\n${postal}` : ''}`;

  return send(store, {
    to: input.to,
    subject: input.subject,
    html,
    text,
    template: 'bulk-message',
    campaignId: input.campaignId,
    actor: input.actor,
    idempotencyKey: input.campaignId,
    // The header gets the POST route, the body got the page. See UnsubscribeLinks.
    ...(unsubscribe ? { unsubscribeUrl: unsubscribe.oneClick } : {}),
  });
}

// ---------------------------------------------------------------------------
// Call for abstracts
//
// Two transactional templates, added rather than a second mail path. Everything
// below goes through the same `send()` as every receipt: one place that knows
// the Resend key, one place that writes `emailLog`, one place that decides what
// a plain-text part looks like. `CFA-PLAN.md` §4 calls the accept/reject mail
// "the cheapest piece — the bulk sender is built" and this is what that meant.
//
// ⚠️ Neither carries an unsubscribe link, and that is deliberate. `List-Unsubscribe`
// is for mail governed by the suppression list; an author who submitted a paper
// has asked for these, and offering to stop them would be offering something
// this code will not honour — the decision mail is sent whatever `contacts`
// says. See `unsubscribeUrlFor` for the same argument in the other direction.
// ---------------------------------------------------------------------------

export interface SubmissionReceiptInput {
  to: string;
  /** The author's name, as they typed it. */
  name?: string;
  /** The call, in the words on the public page. */
  callTitle: string;
  /** The abstract's title, as submitted. */
  title: string;
  /** `/submit/token/{token}` — the way back to their own draft. */
  link: string;
  /**
   * When the call closes, already formatted for a human in the call's own zone.
   *
   * A string rather than a `Date`, because the deadline is authored as wall
   * clock in a named timezone and the only correct rendering of it is the one
   * the organizer typed. Formatting it here would do so in the server's zone,
   * which on Netlify is UTC and on a laptop is not.
   */
  closesAtLabel: string;
  /** Whether this is a finished submission or a draft they can come back to. */
  draft: boolean;
}

/**
 * The close date to print, or null when the caller has none.
 *
 * A call with no close date used to arrive as the words "the call closes",
 * which printed "Closes: the call closes" (T258 #18). A label with no digit in
 * it is not a date, and neither is the " ()" left by an empty wall clock and
 * zone, so the row is dropped and the sentence says "before the call closes".
 */
export function closesLabel(raw: string | undefined | null): string | null {
  const label = (raw ?? '').replace(/\(\s*\)/g, '').trim();
  return /\d/.test(label) ? label : null;
}

/**
 * The acknowledgement, and — more importantly — the link back.
 *
 * The link is the whole point of the mail. There is no account here, so this
 * message *is* the author's only route back to their own work: lose it and the
 * answer is "ask an organizer to re-send it", which is a support ticket per
 * author. It says what the link does and that it should not be forwarded,
 * because it is a bearer credential for unpublished work and the reader has no
 * other way to know that.
 */
export async function sendSubmissionReceipt(
  store: Firestore,
  input: SubmissionReceiptInput,
): Promise<SendOutcome> {
  const greeting = firstNameOf(input.name) ? `Hi ${esc(firstNameOf(input.name))},` : 'Hi,';
  const heading = input.draft
    ? 'Your abstract has been saved as a draft'
    : 'We have your abstract';
  const closes = closesLabel(input.closesAtLabel);
  const before = closes ?? 'the call closes';

  const opening = input.draft
    ? `we have saved your draft for <strong>${esc(input.callTitle)}</strong>. It has <strong>not</strong> been submitted yet. Use the link below to finish it before ${esc(before)}.`
    : `thank you, your abstract has been submitted to <strong>${esc(input.callTitle)}</strong>. There is nothing else to do for now.`;

  const html = shell(
    heading,
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} ${opening}</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:6px 0 0;">
       ${row('Title', esc(input.title))}
       ${row('Call', esc(input.callTitle))}
       ${closes ? row('Closes', esc(closes)) : ''}
     </table>
     ${button(input.link, input.draft ? 'Finish your submission' : 'View your submission')}
     <p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#6b7280;">
       Please do not forward this link. Anyone who has it can read your
       ${input.draft ? 'draft and, while the call is open, edit it' : 'submission'}. It stops working after twelve months.
     </p>`,
  );

  const text = `${greeting} ${
    input.draft
      ? `we have saved your draft for ${input.callTitle}. It has NOT been submitted yet. Use the link below to finish it before ${before}.`
      : `thank you, your abstract has been submitted to ${input.callTitle}.`
  }

Title:  ${input.title}
Call:   ${input.callTitle}${closes ? `\nCloses: ${closes}` : ''}

${input.draft ? 'Finish your submission' : 'View your submission'}:
${input.link}

Please do not forward this link. Anyone who has it can read your ${input.draft ? 'draft and,\nwhile the call is open, edit it' : 'submission'}. It stops working after twelve months.

--
Knowledge Graph Conference 2027`;

  return send(store, {
    to: input.to,
    subject: input.draft
      ? `Your draft for ${input.callTitle}`
      : `We have your abstract: ${input.title}`,
    html,
    text,
    template: 'submission-receipt',
  });
}

export interface SubmissionDecisionInput {
  to: string;
  name?: string;
  callTitle: string;
  title: string;
  accepted: boolean;
  /**
   * Set for a waiting-list decision, which is neither. `accepted` is then
   * ignored. A flag beside the boolean rather than a three-way field so that
   * every existing caller keeps meaning what it meant.
   */
  waitlisted?: boolean;
  /** The author's link back, so they can read their own submission beside the decision. */
  link: string;
  /**
   * Anything the committee chose to forward — reviewer comments marked for
   * authors, or a note typed on the decision screen.
   *
   * Plain text, and only what an organizer explicitly sent. ⚠️ Never
   * `commentsToCommittee`: `ReviewDoc` keeps the two in separate fields for
   * exactly this reason, and one textarea doing both jobs is how a private
   * remark about a submitter ends up in their rejection.
   */
  note?: string;
  /** Who pressed send, recorded per recipient in `emailLog`. */
  actor: string;
}

/**
 * Accept or reject, in one template.
 *
 * ── The rejection gets the same care as the acceptance ──────────────────────
 *
 * Most of the mail this function sends is a rejection — that is what a call for
 * papers is — and the version of this template that only reads well when
 * `accepted` is true is the version that gets written by accident. So the
 * rejection has a first sentence that says the answer in the first line, a
 * reason it was competitive rather than a form apology, and the same "here is
 * your submission" link, because somebody who was turned down is entitled to
 * read what they sent.
 *
 * ⚠️ It says nothing about the agenda. Acceptance is not scheduling: promoting a
 * submission into a session is a separate, deliberate step in Session Manager
 * (`CFA-PLAN.md` §4), and a mail promising a slot before anybody has decided a
 * room and a time is a promise this system has not made.
 */
export async function sendSubmissionDecision(
  store: Firestore,
  input: SubmissionDecisionInput,
): Promise<SendOutcome> {
  const greeting = firstNameOf(input.name) ? `Hi ${esc(firstNameOf(input.name))},` : 'Hi,';

  if (input.waitlisted) return sendWaitlisted(store, input);

  const opening = input.accepted
    ? `we are pleased to tell you that <strong>“${esc(input.title)}”</strong> has been accepted for ${esc(input.callTitle)}.`
    : `thank you for submitting <strong>“${esc(input.title)}”</strong> to ${esc(input.callTitle)}. After review, we are not able to include it in the programme this year.`;

  const next = input.accepted
    ? `We will be in touch about scheduling. The date, time and room are set when the programme is put together.`
    : `We had more good submissions than we have room for, and this is not a judgement on the quality of yours. We would be glad to see you submit again.`;

  const noteHtml = input.note?.trim()
    ? `<div style="margin:20px 0 0;padding:14px 16px;background:#fafbfc;border:1px solid #e3e5e8;border-radius:4px;">
         <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#6b7280;">From the committee</p>
         ${input.note
           .split(/\n\s*\n/)
           .map((para) => para.trim())
           .filter(Boolean)
           .map(
             (para) =>
               `<p style="margin:0 0 10px;font-size:14px;line-height:1.6;">${esc(para).replace(/\n/g, '<br>')}</p>`,
           )
           .join('')}
       </div>`
    : '';

  const html = shell(
    input.accepted ? 'Your abstract has been accepted' : `About your abstract for ${esc(input.callTitle)}`,
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} ${opening}</p>
     <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${next}</p>
     ${noteHtml}
     ${button(input.link, 'Read your submission')}`,
  );

  const text = `${greeting} ${
    input.accepted
      ? `we are pleased to tell you that "${input.title}" has been accepted for ${input.callTitle}.`
      : `thank you for submitting "${input.title}" to ${input.callTitle}. After review, we are not able to include it in the programme this year.`
  }

${
  input.accepted
    ? 'We will be in touch about scheduling. The date, time and room are set when the programme is put together.'
    : 'We had more good submissions than we have room for, and this is not a judgement on the quality of yours. We would be glad to see you submit again.'
}
${input.note?.trim() ? `\nFrom the committee:\n${input.note.trim()}\n` : ''}
Read your submission:
${input.link}

--
Knowledge Graph Conference 2027`;

  return send(store, {
    to: input.to,
    subject: input.accepted
      ? `Accepted: ${input.title}`
      : `Your submission to ${input.callTitle}`,
    html,
    text,
    template: 'submission-decision',
    actor: input.actor,
  });
}

/**
 * The waiting-list mail. Its own wording rather than a third branch through
 * every ternary above, and the same log template, because to the author it is
 * still "the decision".
 *
 * It promises nothing. A place may open or it may not, and the one thing it has
 * to say clearly is that the author will hear either way.
 */
async function sendWaitlisted(store: Firestore, input: SubmissionDecisionInput): Promise<SendOutcome> {
  const greeting = firstNameOf(input.name) ? `Hi ${esc(firstNameOf(input.name))},` : 'Hi,';
  const opening = `thank you for submitting “${input.title}” to ${input.callTitle}. It is on our waiting list.`;
  const next =
    'The reviewers rated it well and the programme is full for now. If a place opens we will offer it to you, and we will write to you either way before the programme is final.';
  const paras = (input.note ?? '')
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter(Boolean);

  const html = shell(
    `About your abstract for ${esc(input.callTitle)}`,
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} ${esc(opening)}</p>
     <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${next}</p>
     ${
       paras.length
         ? `<div style="margin:20px 0 0;padding:14px 16px;background:#fafbfc;border:1px solid #e3e5e8;border-radius:4px;">
         <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#6b7280;">From the committee</p>
         ${paras
           .map(
             (para) =>
               `<p style="margin:0 0 10px;font-size:14px;line-height:1.6;">${esc(para).replace(/\n/g, '<br>')}</p>`,
           )
           .join('')}
       </div>`
         : ''
     }
     ${button(input.link, 'Read your submission')}`,
  );

  const text = `${greeting} ${opening}

${next}
${paras.length ? `\nFrom the committee:\n${paras.join('\n\n')}\n` : ''}
Read your submission:
${input.link}

Knowledge Graph Conference 2027`;

  return send(store, {
    to: input.to,
    subject: `Your submission to ${input.callTitle}`,
    html,
    text,
    template: 'submission-decision',
    actor: input.actor,
  });
}

export interface ReviewerInvitationInput {
  to: string;
  name?: string;
  /** The call they are being asked to review for, in the words on the public page. */
  callTitle: string;
  /** `/review/{token}`, freshly minted for this send. */
  link: string;
  /** How many submissions are waiting for them right now. Zero is allowed. */
  assigned: number;
  /** When reviews are wanted by, already formatted for a human. Optional. */
  dueLabel?: string;
  /** A paragraph from the chair, shown above the button. Plain text. */
  note?: string;
  /** Who pressed send, recorded in `emailLog`. */
  actor: string;
}

/**
 * The invitation to review, and every reminder after it.
 *
 * One template for both, because a reminder is the same mail sent again: each
 * send carries a newly minted link (`reviewer-token.ts`), so the practical life
 * of any one URL is "since the last nudge".
 *
 * Like the two submission mails it carries no unsubscribe link. It is sent to
 * one named person by an organizer pressing a button, and it is not governed by
 * the suppression list.
 *
 * ⚠️ It says what the link is: a bearer credential for other people's
 * unpublished work. The reader has no other way to know not to forward it.
 */
export async function sendReviewerInvitation(
  store: Firestore,
  input: ReviewerInvitationInput,
): Promise<SendOutcome> {
  const greeting = firstNameOf(input.name) ? `Hi ${esc(firstNameOf(input.name))},` : 'Hi,';
  const waiting =
    input.assigned === 0
      ? 'Nothing has been assigned to you yet. Submissions will appear on your page when they are.'
      : `${input.assigned} submission${input.assigned === 1 ? ' is' : 's are'} waiting for you.`;
  const due = input.dueLabel ? ` Reviews are wanted by ${input.dueLabel}.` : '';

  const noteParas = (input.note ?? '')
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter(Boolean);

  const html = shell(
    `Reviewing for ${esc(input.callTitle)}`,
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} thank you for reviewing for <strong>${esc(input.callTitle)}</strong>.</p>
     ${noteParas
       .map(
         (para) =>
           `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${esc(para).replace(/\n/g, '<br>')}</p>`,
       )
       .join('')}
     <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${esc(waiting)}${esc(due)}</p>
     ${button(input.link, 'Open your review page')}
     <p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#6b7280;">
       You don't need an account or a password. This link is your access, so please do not forward
       it: anyone who has it can read and score the submissions assigned to you. If you have a
       conflict of interest with a submission, say so on its page and it will be taken off your
       list. The link stops working after six months.
     </p>`,
  );

  const text = `${greeting} thank you for reviewing for ${input.callTitle}.
${noteParas.length ? `\n${noteParas.join('\n\n')}\n` : ''}
${waiting}${due}

Open your review page:
${input.link}

You don't need an account or a password. This link is your access, so please
do not forward it: anyone who has it can read and score the submissions
assigned to you. If you have a conflict of interest with a submission, say so
on its page and it will be taken off your list. The link stops working after
six months.

Knowledge Graph Conference 2027`;

  return send(store, {
    to: input.to,
    subject: `Reviewing for ${input.callTitle}`,
    html,
    text,
    template: 'reviewer-invitation',
    actor: input.actor,
  });
}

export interface SpeakerProfileRequestInput {
  to: string;
  name?: string;
  /** `/speaker/{token}`, freshly minted for this send. */
  link: string;
  /** The titles of the talks they are on, so the mail is obviously about them. */
  sessionTitles: string[];
  /** What is missing today: "a bio and a photo". Empty when nothing is. */
  missingLabel?: string;
  /** A paragraph from the organizer, shown above the button. Plain text. */
  note?: string;
  /** Who pressed send, recorded in `emailLog`. */
  actor: string;
}

/**
 * The request for a speaker's own bio, photo and slides, and every reminder.
 *
 * One template for both, because a reminder is the same mail sent again: each
 * send carries a newly minted link (`speaker-token.ts`), so the practical life
 * of any one URL is "since the last nudge".
 *
 * No unsubscribe link, for the reason the reviewer invitation has none — one
 * named person, one organizer pressing a button, and a speaker who opted out of
 * the newsletter still has to be asked for the bio their talk is published with.
 *
 * ⚠️ It says what the link is and what it is not: a way into one profile, where
 * nothing appears anywhere until an organizer has read it. That second half
 * matters, because a speaker who thinks the page publishes straight to the
 * website writes differently on it.
 */
export async function sendSpeakerProfileRequest(
  store: Firestore,
  input: SpeakerProfileRequestInput,
): Promise<SendOutcome> {
  const greeting = firstNameOf(input.name) ? `Hi ${esc(firstNameOf(input.name))},` : 'Hi,';
  const talks =
    input.sessionTitles.length === 0
      ? 'You are on the speaker list for Knowledge Graph Conference 2027.'
      : input.sessionTitles.length === 1
        ? `You are speaking at Knowledge Graph Conference 2027, on "${input.sessionTitles[0]}".`
        : `You are speaking at Knowledge Graph Conference 2027, on ${input.sessionTitles.length} sessions.`;
  const missing = input.missingLabel
    ? `We are missing ${input.missingLabel} for you.`
    : 'You can check your details and update anything that is out of date.';

  const noteParas = (input.note ?? '')
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter(Boolean);

  const html = shell(
    'Your speaker profile',
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} ${esc(talks)}</p>
     ${noteParas
       .map(
         (para) =>
           `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${esc(para).replace(/\n/g, '<br>')}</p>`,
       )
       .join('')}
     <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${esc(missing)} Your bio, job title, company, links and a link to your slides all go on the same page.</p>
     ${button(input.link, 'Fill in your profile')}
     <p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#6b7280;">
       You don't need an account or a password. This link is your access, so please do not forward
       it. Nothing you send is published until an organizer has reviewed it. The link stops working
       after six months.
     </p>`,
  );

  const text = `${greeting} ${talks}
${noteParas.length ? `\n${noteParas.join('\n\n')}\n` : ''}
${missing} Your bio, job title, company, links and a link to your slides all go
on the same page.

Fill in your profile:
${input.link}

You don't need an account or a password. This link is your access, so please
do not forward it. Nothing you send is published until an organizer has
reviewed it. The link stops working after six months.

Knowledge Graph Conference 2027`;

  return send(store, {
    to: input.to,
    subject: 'Your speaker profile for the Knowledge Graph Conference',
    html,
    text,
    template: 'speaker-profile-request',
    actor: input.actor,
  });
}

export interface TeamInvitationInput {
  to: string;
  name?: string;
  /** What they will be able to open, already in words: "Finance, Check-in only". */
  rolesLabel: string;
  /** The dashboard's sign-in page. */
  link: string;
  /** Who pressed send, recorded in `emailLog`. */
  actor: string;
}

/**
 * Someone has been added to the organizer dashboard. There is nothing to set
 * up: they sign in with this address and a code we email them each time.
 */
export async function sendTeamInvitation(store: Firestore, input: TeamInvitationInput): Promise<SendOutcome> {
  const greeting = firstNameOf(input.name) ? `Hi ${esc(firstNameOf(input.name))},` : 'Hi,';

  const html = shell(
    'Your organizer dashboard access',
    `<p style="${P}">${greeting} you have been added to the organizer dashboard for Knowledge Graph Conference 2027.</p>
     <p style="${P}">Your access: <strong>${esc(input.rolesLabel)}</strong>.</p>
     <p style="${P}">Sign in with this email address. We will email you a code each time you sign in.</p>
     ${button(input.link, 'Open the dashboard')}`,
  );

  const text = `${greeting} you have been added to the organizer dashboard for Knowledge Graph Conference 2027.

Your access: ${input.rolesLabel}.

Sign in with this email address. We will email you a code each time you sign in.

${input.link}`;

  return send(store, {
    to: input.to,
    subject: 'Your organizer dashboard access',
    html,
    text,
    template: 'team-invitation',
    actor: input.actor,
  });
}

export interface ConsentRequestInput {
  to: string;
  name?: string;
  /** The form's title, as published: "Photo and video release". */
  formTitle: string;
  /** The version being asked for. Recorded in the subject, see `EmailLogDoc`. */
  version: number;
  /** The personal signing link. It identifies one signatory and one form. */
  link: string;
  /** True when this person has already signed an earlier wording. */
  resigning: boolean;
  /** Who pressed send, recorded in `emailLog`. */
  actor: string;
  /**
   * Groups every row of one send in `emailLog`, exactly as a campaign does.
   *
   * It is what makes the send resumable: one id per form and version, so the
   * rows already written are the list of people already asked, and a second
   * press picks up where the first stopped instead of mailing everybody twice.
   * Absent for a link sent to one named person as they are added.
   */
  campaignId?: string;
}

/**
 * The request to sign a release, carrying that person's own signing link.
 *
 * ── One template, two situations ───────────────────────────────────────────
 *
 * A first request and a request after the wording changed are the same mail
 * with a different first sentence, and `resigning` chooses it. Splitting them
 * is how the second one quietly loses the sentence that matters most: an
 * earlier signature still stands for what it said, and it does not cover the
 * new text.
 *
 * No unsubscribe link. The suppression list governs marketing, and a release
 * somebody is being asked to sign is a document about them, not a campaign —
 * the same reason the reviewer and team invitations carry none.
 */
export async function sendConsentRequest(
  store: Firestore,
  input: ConsentRequestInput,
): Promise<SendOutcome> {
  const greeting = firstNameOf(input.name) ? `Hi ${esc(firstNameOf(input.name))},` : 'Hi,';
  const opening = input.resigning
    ? `the wording of ${esc(input.formTitle)} has changed since you signed it. Your earlier agreement still stands for what it said, and it does not cover the new text.`
    : `please read and sign ${esc(input.formTitle)} for Knowledge Graph Conference 2027.`;

  const html = shell(
    input.resigning ? `Please sign ${esc(input.formTitle)} again` : `Please sign ${esc(input.formTitle)}`,
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} ${opening}</p>
     ${button(input.link, 'Read it and sign')}
     <p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#6b7280;">
       This link is personal to you, so please do not forward it.
     </p>`,
  );

  const text = `${greeting} ${input.resigning
    ? `the wording of ${input.formTitle} has changed since you signed it. Your earlier agreement still stands for what it said, and it does not cover the new text.`
    : `please read and sign ${input.formTitle} for Knowledge Graph Conference 2027.`}

Read it and sign:
${input.link}

This link is personal to you, so please do not forward it.

Knowledge Graph Conference 2027`;

  return send(store, {
    to: input.to,
    subject: input.resigning
      ? `Please sign ${input.formTitle} again (version ${input.version})`
      : `Please sign ${input.formTitle}`,
    html,
    text,
    template: 'consent-request',
    actor: input.actor,
    // A consent campaign is one form at one version, so a second press that
    // reaches somebody the first press already reached is the same mail.
    ...(input.campaignId ? { campaignId: input.campaignId, idempotencyKey: input.campaignId } : {}),
  });
}

export interface ExhibitorLeadLinkInput {
  to: string;
  /** The exhibiting company, not a person: the mail is read by whoever runs the stand. */
  companyName: string;
  contactName?: string;
  /** `/exhibitor/{token}`, freshly minted for this send. */
  link: string;
  boothNumber?: string;
  /** A paragraph from the organizer, shown above the button. Plain text. */
  note?: string;
  /** Who pressed send, recorded in `emailLog`. */
  actor: string;
}

/**
 * The link a stand scans badges with, and every re-send.
 *
 * One template for both, because a re-send is the same mail again: each press
 * mints a fresh link (`exhibitor-token.ts`), so the practical life of any one
 * URL is "since the last send".
 *
 * ⚠️ It says three things that the page also says, deliberately, because the
 * person who reads this mail is usually not the person who will hold the phone:
 * the link is the access and must not be posted publicly, every attendee agrees
 * on screen before anything is stored, and the leads are theirs to download.
 * A stand that does not know the second one asks attendees to "just scan", and
 * the agreement stops being one.
 */
export async function sendExhibitorLeadLink(
  store: Firestore,
  input: ExhibitorLeadLinkInput,
): Promise<SendOutcome> {
  const greeting = firstNameOf(input.contactName) ? `Hi ${esc(firstNameOf(input.contactName))},` : 'Hi,';
  const booth = input.boothNumber
    ? `${esc(input.companyName)} is on stand ${esc(input.boothNumber)} at Knowledge Graph Conference 2027.`
    : `${esc(input.companyName)} is exhibiting at Knowledge Graph Conference 2027.`;

  const noteParas = (input.note ?? '')
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter(Boolean);

  const html = shell(
    'Scan badges at your stand',
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} ${booth}</p>
     ${noteParas
       .map(
         (para) =>
           `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${esc(para).replace(/\n/g, '<br>')}</p>`,
       )
       .join('')}
     <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Open this link on the phone or tablet you will use on the stand and scan an attendee's badge. They agree on screen to share their details. You can add notes and download your list as a spreadsheet at any time.</p>
     ${button(input.link, 'Open your lead desk')}
     <p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#6b7280;">
       You don't need an account or a password. This link is your access, so share it only with
       your stand team. Attendees are added to your list only when they agree on screen, and you see
       only the people your stand has scanned. The link stops working after four months.
     </p>`,
  );

  const text = `${greeting} ${input.companyName}${
    input.boothNumber ? ` is on stand ${input.boothNumber}` : ' is exhibiting'
  } at Knowledge Graph Conference 2027.
${noteParas.length ? `\n${noteParas.join('\n\n')}\n` : ''}
Open this link on the phone or tablet you will use on the stand and scan an
attendee's badge. They agree on screen to share their details. You can add
notes and download your list as a spreadsheet at any time.

Open your lead desk:
${input.link}

You don't need an account or a password. This link is your access, so share it
only with your stand team. Attendees are added to your list only when they agree
on screen, and you see only the people your stand has scanned. The link stops
working after four months.

Knowledge Graph Conference 2027`;

  return send(store, {
    to: input.to,
    subject: `Scanning badges at the Knowledge Graph Conference: ${input.companyName}`,
    html,
    text,
    template: 'exhibitor-lead-link',
    actor: input.actor,
  });
}

// ---------------------------------------------------------------------------
// The blog editor at blog.knowledgegraph.tech
//
// Four mails, all transactional and all to one named person: a sign-in code,
// an invitation to write, a post waiting for review, and the decision on it.
// None carries an unsubscribe link, for the reason `sendTeamInvitation` has
// none. The links are built by the caller, which knows the blog's origin.
// ---------------------------------------------------------------------------

const P = 'margin:0 0 14px;font-size:15px;line-height:1.6;';
const SMALL = 'margin:14px 0 0;font-size:14px;line-height:1.6;color:#6b7280;';

export interface BlogSignInCodeInput {
  to: string;
  code: string;
  /** How long the code lasts, already formatted: "10 minutes". */
  expiresLabel: string;
  /**
   * Which door it opens. The dashboard also uses a code to confirm a refund or
   * a mass send, which reads differently from signing in.
   */
  surface?: 'blog' | 'dashboard' | 'dashboard-confirm' | 'ticket';
}

const CODE_COPY = {
  blog: { heading: 'Your blog sign-in code', lead: 'Enter this code to sign in to the KGC blog editor:', subject: 'is your KGC blog code', log: 'Blog sign-in code', template: 'blog-sign-in-code' },
  dashboard: { heading: 'Your dashboard sign-in code', lead: 'Enter this code to sign in to the KGC organizer dashboard:', subject: 'is your KGC dashboard code', log: 'Dashboard sign-in code', template: 'dashboard-sign-in-code' },
  ticket: { heading: 'Your KGC sign-in code', lead: 'Enter this code on the KGC website to watch the sessions your ticket includes:', subject: 'is your KGC sign-in code', log: 'Ticket sign-in code', template: 'ticket-sign-in-code' },
  'dashboard-confirm': { heading: 'Confirm this action', lead: 'Enter this code in the dashboard to confirm what you are about to do:', subject: 'confirms your KGC dashboard action', log: 'Dashboard confirmation code', template: 'dashboard-sign-in-code' },
} as const;

/**
 * A six-digit code for the blog editor, the organizer dashboard, or a ticket
 * holder watching on the website. The subject
 * leads with the code so it can be read from a lock-screen notification, as
 * the app's does. `emailLog` records the subject, so the logged subject is a
 * code-free one and the real one is sent directly.
 */
export async function sendBlogSignInCode(store: Firestore, input: BlogSignInCodeInput): Promise<SendOutcome> {
  const copy = CODE_COPY[input.surface ?? 'blog'];
  const html = shell(
    copy.heading,
    `<p style="${P}">${copy.lead}</p>
     <p style="margin:18px 0;font-size:32px;font-weight:700;letter-spacing:.18em;color:${BRAND};">${esc(input.code)}</p>
     <p style="${SMALL}">It expires in ${esc(input.expiresLabel)}. If you did not ask for it, ignore this email.</p>`,
  );
  const text = `${copy.lead} ${input.code}

It expires in ${input.expiresLabel}. If you did not ask for it, ignore this email.`;
  const logged = { to: input.to, subject: copy.log, template: copy.template };
  // The stored copy has the real subject with the code masked, so the preview
  // reads as the inbox did.
  const body: CaptureInput = {
    from: fromAddress(),
    replyTo: replyTo(),
    to: input.to,
    subject: `${input.code} ${copy.subject}`,
    html,
    text,
    template: copy.template,
    secrets: [input.code],
  };

  if (!emailEnabled()) {
    await log(store, { ...logged, status: 'skipped', reason: 'RESEND_API_KEY is not set on this deployment' }, body);
    return 'skipped';
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      // An abort throws, and the catch below records it as `failed`.
      signal: AbortSignal.timeout(sendTimeoutMs()),
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress(),
        to: [input.to],
        reply_to: replyTo(),
        subject: `${input.code} ${copy.subject}`,
        html,
        text,
      }),
    });
    if (!res.ok) {
      const failure = await res.text().catch(() => '');
      await log(store, { ...logged, status: 'failed', error: `${res.status} ${failure}`.slice(0, 500) }, body);
      return 'failed';
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    await log(store, { ...logged, status: 'sent', providerId: json.id }, body);
    return 'sent';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(store, { ...logged, status: 'failed', error: message.slice(0, 500) }, body);
    return 'failed';
  }
}

/** The same mail, named for the dashboard's callers. */
export const sendAccessCode = sendBlogSignInCode;

export interface BlogInvitationInput {
  to: string;
  name?: string;
  /** The inviting editor's name, or their address. */
  invitedBy: string;
  /** "an editor" or "a writer". */
  roleLabel: string;
  /** The editor's sign-in page, with the address filled in. */
  link: string;
  actor: string;
}

export async function sendBlogInvitation(store: Firestore, input: BlogInvitationInput): Promise<SendOutcome> {
  const greeting = firstNameOf(input.name) ? `Hi ${esc(firstNameOf(input.name))},` : 'Hi,';
  const html = shell(
    'Write for the KGC blog',
    `<p style="${P}">${greeting} ${esc(input.invitedBy)} has added you to the Knowledge Graph Conference blog as ${esc(input.roleLabel)}.</p>
     <p style="${P}">Sign in with this email address. We will email you a code each time you sign in.</p>
     ${button(input.link, 'Open the blog editor')}
     <p style="${SMALL}">Posts you write go to the KGC editors for review before they are published.</p>`,
  );
  const text = `${greeting} ${input.invitedBy} has added you to the Knowledge Graph Conference blog as ${input.roleLabel}.

Sign in with this email address. We will email you a code each time you sign in.

${input.link}

Posts you write go to the KGC editors for review before they are published.`;
  return send(store, { to: input.to, subject: 'Write for the KGC blog', html, text, template: 'blog-invitation', actor: input.actor });
}

export interface BlogReviewRequestInput {
  to: string;
  authorName: string;
  title: string;
  /** The post in the editor. */
  link: string;
  /** True when the post is already live and these are edits to it. */
  isEdit: boolean;
}

export async function sendBlogReviewRequest(store: Firestore, input: BlogReviewRequestInput): Promise<SendOutcome> {
  const what = input.isEdit ? 'changes to a published post' : 'a new post';
  const html = shell(
    'A blog post is waiting for review',
    `<p style="${P}">${esc(input.authorName)} submitted ${what}:</p>
     <p style="${P}"><strong>${esc(input.title)}</strong></p>
     ${button(input.link, 'Review it')}`,
  );
  const text = `${input.authorName} submitted ${what}:

${input.title}

${input.link}`;
  return send(store, {
    to: input.to,
    subject: `Review: ${input.title}`.slice(0, 180),
    html,
    text,
    template: 'blog-review-request',
    actor: input.authorName,
  });
}

export interface BlogReviewDecisionInput {
  to: string;
  name?: string;
  title: string;
  decision: 'published' | 'changes-requested';
  /** The editor's note, when they left one. */
  note?: string;
  /** The live post when published, the draft in the editor otherwise. */
  link: string;
  actor: string;
}

export async function sendBlogReviewDecision(store: Firestore, input: BlogReviewDecisionInput): Promise<SendOutcome> {
  const greeting = firstNameOf(input.name) ? `Hi ${esc(firstNameOf(input.name))},` : 'Hi,';
  const published = input.decision === 'published';
  const heading = published ? 'Your post is live' : 'Your post needs a few changes';
  const lead = published
    ? `${greeting} <strong>${esc(input.title)}</strong> is now published on the KGC blog.`
    : `${greeting} an editor has sent <strong>${esc(input.title)}</strong> back to you.`;
  const note = input.note
    ? `<p style="margin:0 0 14px;padding:12px 16px;background:#f4f5f7;border-left:3px solid ${BRAND};font-size:15px;line-height:1.6;white-space:pre-wrap;">${esc(input.note)}</p>`
    : '';
  const html = shell(
    heading,
    `<p style="${P}">${lead}</p>${note}${button(input.link, published ? 'Read it' : 'Open your draft')}`,
  );
  const text = `${published ? `${input.title} is now published on the KGC blog.` : `An editor has sent "${input.title}" back to you.`}
${input.note ? `\n${input.note}\n` : ''}
${input.link}`;
  return send(store, {
    to: input.to,
    subject: published ? `Published: ${input.title}`.slice(0, 180) : `Changes requested: ${input.title}`.slice(0, 180),
    html,
    text,
    template: 'blog-review-decision',
    actor: input.actor,
  });
}

// ---------------------------------------------------------------------------
// The KGC 2027 call for papers (T249)
//
// Min's copy, word for word, with the em dashes taken out and nothing else
// changed. Two kinds of exception, both decided in one place below:
//
// · A date that is not set yet leaves its sentence out. Min's plan has the
//   close date, the decision date and the session-notice date all open until
//   the Friday weekly, and an email must never print "[DECISION DATE]".
// · E2's "[DAY], [DATE] May 2027" line is Min's own replacement, "Your session
//   day and time will be shared by [date]" (plan §3, E2 note).
//
// Every builder is pure and exported, so the dashboard can show S1 and tests
// can read the words without sending anything.
// ---------------------------------------------------------------------------

/** One block of a call-for-papers email. Text and HTML are rendered from the same list. */
type CfpBlock =
  | { p: string }
  | { lines: string[] }
  | { bullets: string[] }
  | { link: { href: string; label: string } };

export interface CfpMessage {
  subject: string;
  text: string;
  html: string;
}

function cfpMessage(
  subject: string,
  greetingName: string | undefined,
  blocks: CfpBlock[],
  signedBy = 'The KGC team',
): CfpMessage {
  const first = firstNameOf(greetingName);
  const greeting = first ? `Hi ${first},` : 'Hi,';
  const all: CfpBlock[] = [{ p: greeting }, ...blocks, { lines: ['Best,', signedBy] }];

  const text = all
    .map((b) => {
      if ('p' in b) return b.p;
      if ('lines' in b) return b.lines.join('\n');
      if ('bullets' in b) return b.bullets.map((x) => `  • ${x}`).join('\n');
      return `  → ${b.link.href}`;
    })
    .join('\n\n');

  const para = (inner: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${inner}</p>`;
  const html = all
    .map((b) => {
      if ('p' in b) return para(esc(b.p));
      if ('lines' in b) {
        // The title block is indented in Min's copy; the sign-off is not.
        const indented = b.lines[0] !== 'Best,';
        return indented
          ? `<div style="margin:0 0 14px;padding:10px 16px;border-left:3px solid ${BRAND};background:#fafbfc;font-size:15px;line-height:1.6;">${b.lines
              .map((l, i) => (i === 0 ? `<strong>${esc(l)}</strong>` : esc(l)))
              .join('<br>')}</div>`
          : para(b.lines.map(esc).join('<br>'));
      }
      if ('bullets' in b) {
        return `<ul style="margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.6;">${b.bullets
          .map((x) => `<li>${esc(x)}</li>`)
          .join('')}</ul>`;
      }
      return button(b.link.href, b.link.label);
    })
    .join('\n');

  return { subject, text, html: shell(esc(subject), html) };
}

/** Drops blocks whose sentence needed a date that is not set. */
const when = <T>(value: T | undefined | null | false, block: (v: T) => CfpBlock): CfpBlock[] =>
  value ? [block(value)] : [];

export interface CfpSubmissionRef {
  name?: string;
  title: string;
  /** "Workshops", or "Presentation Talks & Keynotes, 25 minutes", from `sessionTypeLine`. */
  typeLine: string;
}

/**
 * E1. On submission. The owner's copy, word for word (T275, 2026-10-19),
 * exclamation marks and "The KGC Team" included. Two things around it are
 * ours: the greeting every CFP email opens with, and the title block under
 * the first line, so the author can see which submission this is. The type
 * line is left out when there is none (the form may stop asking for a track
 * or a length).
 */
export function cfpReceivedMessage(
  input: CfpSubmissionRef & {
    /** No longer printed: the owner's copy names no date. Kept so callers need not change. */
    decisionDay?: string;
    /** The author's own link back to the submission. */
    link?: string;
  },
): CfpMessage {
  const titleBlock = [input.title, input.typeLine].map((l) => l?.trim()).filter((l): l is string => Boolean(l));
  const msg = cfpMessage(
    'We received your KGC 2027 submission',
    input.name,
    [
      { p: 'Thank you for submitting your proposal to the Knowledge Graph Conference (KGC)!' },
      ...(titleBlock.length ? [{ lines: titleBlock }] : []),
      {
        p:
          'We review and announce accepted submissions on a rolling basis. Given that we host various ' +
          'programs and events throughout the year, we may consider your submission for future ' +
          'opportunities as well.',
      },
      {
        p:
          'Please note that we will only follow up with submissions that are accepted, rather than ' +
          'providing individual updates on every submission.',
      },
      {
        p:
          "If you have any questions or need anything in the meantime, please don't hesitate to reach " +
          'out to us at program@knowledgegraph.tech.',
      },
      { p: 'Thank you again for your interest in contributing to the KGC community!' },
    ],
    'The KGC Team',
  );
  if (!input.link) return msg;
  /*
   * Not the owner's copy: the author's only way back to their submission is
   * this link, and the acknowledgement it replaced carried it. Kept below the
   * sign-off so the message reads exactly as written.
   */
  return {
    ...msg,
    text: `${msg.text}\n\nView your submission and, later, our decision here:\n${input.link}`,
    html: msg.html.replace(
      '</td></tr>\n        <tr><td style="padding:18px 28px;background:#fafbfc;',
      `<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">View your submission and, later, our decision here: <a href="${input.link}" style="color:#6b7280;">your submission</a>. Please do not forward this link.</p></td></tr>\n        <tr><td style="padding:18px 28px;background:#fafbfc;`,
    ),
  };
}

export interface CfpAcceptedInput extends CfpSubmissionRef {
  workshop: boolean;
  /** `/speaker/{token}`. */
  link: string;
  /** E2 plus seven days, "Monday 9 November 2026". */
  dueDay: string;
  /** "Your session day and time will be shared by …", absent while unset. */
  sessionNoticeDay?: string;
}

/** E2. On accept. */
export function cfpAcceptedMessage(input: CfpAcceptedInput): CfpMessage {
  return cfpMessage('Your session is in: KGC 2027', input.name, [
    { p: 'Good news. We would like you to present at KGC 2027:' },
    { lines: [input.title, input.typeLine, 'May 2027, Jay Conference Bryant Park, New York'] },
    ...when(input.sessionNoticeDay, (d) => ({
      p: `Your session day and time will be shared by ${d}.`,
    })),
    { p: 'We need a few things from you to put you in the program and start promoting you:' },
    {
      bullets: [
        'A short bio, around 100 words',
        'A headshot',
        'Your final title and session description',
        ...(input.workshop ? ['For workshops: your learning objectives, outline and anything attendees must install'] : []),
      ],
    },
    { link: { href: input.link, label: 'Send your details' } },
    {
      p:
        `Please send them within one week, by ${input.dueDay}. We are announcing speakers as they ` +
        'are confirmed, so this is what gets you into the next announcement. If we have not heard ' +
        'from you after a week, we may give the slot to someone else.',
    },
    { p: "If there's anything you are unsure about, just reply to this email." },
    { p: 'Welcome aboard.' },
  ]);
}

/** E3. Five days after E2, if nothing has arrived. */
export function cfpNudgeMessage(
  input: Pick<CfpAcceptedInput, 'name' | 'title' | 'link' | 'dueDay' | 'workshop'>,
): CfpMessage {
  return cfpMessage('Still need a few details for your KGC 2027 session', input.name, [
    { p: 'A quick nudge. We are still missing the details for:' },
    { lines: [input.title] },
    {
      bullets: [
        'A short bio, around 100 words',
        'A headshot',
        'Your final title and session description',
        ...(input.workshop ? ['For workshops: your outline and anything attendees must install'] : []),
      ],
    },
    { link: { href: input.link, label: 'Send your details' } },
    {
      p:
        `The week is up on ${input.dueDay}. If something is holding you up, reply and tell us; ` +
        'we would rather know than guess.',
    },
  ]);
}

/** E4, accepted at the close. E2 follows it. */
export function cfpCloseAcceptedMessage(input: Pick<CfpSubmissionRef, 'name' | 'title'>): CfpMessage {
  return cfpMessage('Your KGC 2027 submission', input.name, [
    { p: 'We are through the submissions and we would like you to present at KGC 2027:' },
    { lines: [input.title] },
    { p: 'The details we need, and the one week to send them, are in the message that follows this one.' },
  ]);
}

/** E4, not accepted. `reason` is the one editable line; absent leaves it out. */
export function cfpCloseDeclinedMessage(
  input: Pick<CfpSubmissionRef, 'name' | 'title'> & { reason?: string },
): CfpMessage {
  const reason = input.reason?.trim().replace(/\s+/g, ' ');
  return cfpMessage('Your KGC 2027 submission', input.name, [
    { p: 'Thank you for proposing:' },
    { lines: [input.title] },
    { p: `We are not able to fit it into the 2027 program.${reason ? ` ${reason}` : ''}` },
    {
      p:
        'This is not a comment on the work. We had far more good submissions than time slots, and the ' +
        'ones we could not accept were in many cases a scheduling problem rather than a quality one.',
    },
    {
      p:
        'Two things, if they are useful. The poster track and the startup pitch run their own calls ' +
        'and are still open. And if you are coming anyway, speakers who were not placed this year are ' +
        'the first people we read next year.',
    },
    { p: 'Thank you for your submission.' },
  ]);
}

/** E6. The one manual send in January to everyone still in the queue. */
export function cfpStillOpenMessage(
  input: Pick<CfpSubmissionRef, 'name' | 'title'> & { decisionDay?: string },
): CfpMessage {
  return cfpMessage('Your KGC 2027 submission is still with us', input.name, [
    { p: 'A short note because it has been a while and silence is not much use to anyone.' },
    { p: 'Your submission is still open and still in the queue:' },
    { lines: [input.title] },
    {
      p:
        'We are reading submissions every week and accepting them as we go, and we have not reached a ' +
        `decision on your submission yet. That is all it means.${
          input.decisionDay ? ` You will have an answer by ${input.decisionDay} at the latest, and most likely before.` : ''
        }`,
    },
    { p: 'If you would like to know more than that, reply and ask.' },
  ]);
}

/**
 * S1. Not sent by anything: the inbox copies it. Plain text only, because it
 * goes into a reply in Gmail.
 */
export function cfpStatusReplyText(input: { name?: string; decisionDay?: string }): string {
  const first = firstNameOf(input.name);
  return [
    first ? `Hi ${first},` : 'Hi,',
    'Thanks for checking in.',
    'Your submission is still open. We read submissions every week and accept as we go, so a submission that has not been answered is one we have not reached a decision on yet, not one we have turned down.',
    ...(input.decisionDay ? [`You will have an answer by ${input.decisionDay} at the latest.`] : []),
    'Sorry we cannot be more precise than that. If anything changes on your side, a new title, a co-presenter, a date you cannot make, tell us and we will add it to your submission.',
    'Best,\nThe KGC team',
  ].join('\n\n');
}

export interface CfpAcceptNoticeInput {
  speakerName: string;
  organisation?: string;
  title: string;
  track?: string;
  typeLine: string;
  /** "Tuesday 10 November 2026". */
  acceptedDay: string;
  /** The submission on the dashboard. */
  link: string;
  /** Whether E2 went to the speaker, so onboarding knows where things stand. */
  e2: 'sent' | 'held' | 'not sent';
}

/** The internal notice to Min on every acceptance. Plain, because it is a notification. */
export function cfpAcceptNoticeMessage(input: CfpAcceptNoticeInput): CfpMessage {
  const rows: [string, string][] = [
    ['Speaker', input.speakerName],
    ['Organisation', input.organisation || 'Not given'],
    ['Title', input.title],
    // Left out when there is none: the call may not ask for a track (T276).
    ...(input.track ? [['Track', input.track] as [string, string]] : []),
    ['Type', input.typeLine],
    ['Accepted', input.acceptedDay],
  ];
  const e2 =
    input.e2 === 'sent'
      ? 'The acceptance email with their self-service link has gone to the speaker.'
      : input.e2 === 'held'
        ? 'The call has closed, so their acceptance email waits for the decision send after the close.'
        : 'The acceptance email did not go out. Check the submission and send the link from Speaker Manager.';
  const subject = `Accepted: ${input.speakerName}, ${input.title}`;
  const text = `${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${e2}\n\nThe submission:\n${input.link}`;
  const html = shell(
    'A submission was accepted',
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 14px;">${rows
      .map(([k, v]) => row(esc(k), esc(v)))
      .join('')}</table>
     <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${esc(e2)}</p>
     ${button(input.link, 'Open the submission')}`,
  );
  return { subject, text, html };
}

/** The Thursday reminder to the reviewer. */
export function cfpWeeklyReminderMessage(input: {
  name?: string;
  fresh: number;
  open: number;
  link: string;
}): CfpMessage {
  const fresh =
    input.fresh === 0
      ? 'Nothing new has arrived since your last pass.'
      : `${input.fresh} new submission${input.fresh === 1 ? ' has' : 's have'} arrived since your last pass.`;
  return cfpMessage(
    `KGC 2027 submissions: ${input.open} open`,
    input.name,
    [
      { p: `${fresh} ${input.open} in all are waiting for a decision.` },
      { p: 'Accept, reject or leave each one for next week. Accepting a submission emails the speaker.' },
      { link: { href: input.link, label: 'Open the review list' } },
    ],
  );
}

type CfpTemplate = Extract<EmailLogDoc['template'], `cfp-${string}`>;

/** Send one built call-for-papers message. Never throws, like every sender here. */
export async function sendCfpMessage(
  store: Firestore,
  input: { to: string; message: CfpMessage; template: CfpTemplate; submissionId?: string; actor?: string },
): Promise<SendOutcome> {
  return send(store, {
    to: input.to,
    subject: input.message.subject,
    html: input.message.html,
    text: input.message.text,
    template: input.template,
    submissionId: input.submissionId,
    actor: input.actor,
  });
}
