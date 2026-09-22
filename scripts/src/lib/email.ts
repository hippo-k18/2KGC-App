import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, publicSiteOrigin, type EmailLogDoc } from '@kgc/shared';
import { contactId } from './ids.js';
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
 * **A failed send must never fail its caller.** Every function here is
 * `Promise<void>` and every one of them swallows its own errors. The callers
 * are the Stripe webhook and the invoice action; a throw in the webhook becomes
 * a non-2xx, a non-2xx makes Stripe retry the event for ever, and Stripe
 * eventually disables the endpoint — which takes *fulfilment* down because a
 * receipt did not send. The ticket matters; the receipt is a courtesy.
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
 * Who the mail comes from.
 *
 * Must be a domain verified in Resend, or every send returns 403. A friendly
 * name is included because "KGC 2027" in an inbox list is recognised and a bare
 * address is not.
 */
function fromAddress(): string {
  return process.env.EMAIL_FROM ?? 'KGC 2027 <tickets@knowledgegraph.tech>';
}

/** Where "questions?" should go. Falls back to the from address. */
function replyTo(): string {
  return process.env.EMAIL_REPLY_TO ?? 'hello@knowledgegraph.tech';
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
  actor?: string;
  /**
   * Set only on mail that is governed by the suppression list. Adds the two
   * RFC 8058 headers, which is what puts the native "Unsubscribe" button beside
   * the sender name in Gmail and Apple Mail — the genuinely one-click path,
   * because the mail client POSTs on the reader's behalf and no page is opened.
   */
  unsubscribeUrl?: string;
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

async function log(
  store: Firestore,
  entry: Omit<EmailLogDoc, 'eventId' | 'at'>,
): Promise<void> {
  try {
    await store
      .collection(COLLECTIONS.emailLog)
      // A native Date, never `FieldValue.serverTimestamp()`. Each app resolves
      // its own copy of `firebase-admin`, and Firestore checks sentinels with
      // `instanceof` — a sentinel built here is the wrong class for the
      // caller's store and the whole write fails. See `fulfilment.ts`.
      .add(defined({ ...entry, eventId: EVENT_ID, at: new Date() }));
  } catch (err) {
    // The log is the diagnostic, not the product. If even this fails, say so on
    // stdout and carry on — there is nothing useful left to do.
    console.error('[email] could not write emailLog', err);
  }
}

/**
 * Send one email. Never throws, never rejects.
 *
 * Returns nothing on purpose: there is no caller that should branch on whether
 * a receipt went out, and offering a boolean invites one to.
 */
async function send(store: Firestore, input: SendInput): Promise<void> {
  const base = {
    to: input.to,
    subject: input.subject,
    template: input.template,
    orderId: input.orderId,
    registrationId: input.registrationId,
    campaignId: input.campaignId,
    actor: input.actor,
  };

  if (!emailEnabled()) {
    await log(store, {
      ...base,
      status: 'skipped',
      reason: 'RESEND_API_KEY is not set on this deployment',
    });
    return;
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [input.to],
        reply_to: replyTo(),
        subject: input.subject,
        html: input.html,
        // A plain-text part is not decoration: some corporate mail gateways
        // score HTML-only mail as spam, and a conference receipt landing in a
        // spam folder is the failure this whole file exists to avoid.
        text: input.text,
        ...(input.unsubscribeUrl
          ? {
              headers: {
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
              },
            }
          : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      await log(store, { ...base, status: 'failed', error: `${res.status} ${body}`.slice(0, 500) });
      console.error('[email] Resend rejected', input.template, res.status, body);
      return;
    }

    const json = (await res.json().catch(() => ({}))) as { id?: string };
    await log(store, { ...base, status: 'sent', providerId: json.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(store, { ...base, status: 'failed', error: message.slice(0, 500) });
    console.error('[email] send threw', input.template, err);
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

function shell(heading: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:6px;overflow:hidden;border:1px solid #e3e5e8;">
        <tr><td style="background:${BRAND};padding:20px 28px;">
          <span style="color:#ffffff;font-size:17px;font-weight:600;letter-spacing:.02em;">Knowledge Graph Conference 2027</span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${BRAND};">${heading}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:18px 28px;background:#fafbfc;border-top:1px solid #e3e5e8;font-size:12px;color:#6b7280;">
          3–7 May 2027 · Cornell Tech, Roosevelt Island, New York City<br>
          Questions? Just reply to this email.
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
  /** The `/order/{token}` capability link. Shows the claim code and the badge. */
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
}

/**
 * The one email that actually matters.
 *
 * It carries the claim code, which is what turns a purchase into an account in
 * the mobile app. Stripe's own receipt proves money moved; only this proves
 * there is a ticket, and only this says which address to sign in with — the
 * single most common support question after "where is my confirmation".
 */
export async function sendPurchaseConfirmation(store: Firestore, input: PurchaseEmailInput): Promise<void> {
  const price = formatPrice(input.amountCents, input.currency);
  const greeting = input.name ? `Hi ${esc(input.name.split(' ')[0])},` : 'Hi,';

  const html = shell(
    'Your KGC 2027 ticket is confirmed',
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} you're registered. Here are the details.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e3e5e8;border-bottom:1px solid #e3e5e8;margin:6px 0;">
       ${row('Attendee', esc(input.name || input.to))}
       ${row('Ticket', esc(input.ticketType))}
       ${row('Paid', price)}
       ${row('Sign in with', esc(input.to))}
     </table>
     <p style="margin:18px 0 6px;font-size:15px;line-height:1.6;"><strong>Next step:</strong> open the KGC app and sign in with <strong>${esc(input.to)}</strong> — that address is how the app finds your ticket. Your claim code is:</p>
     <p style="margin:10px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;letter-spacing:.12em;background:#f4f5f7;border:1px solid #e3e5e8;border-radius:4px;padding:12px 16px;text-align:center;">${esc(input.claimCode)}</p>
     ${
       input.temporaryPassword
         ? `<p style="margin:18px 0 6px;font-size:15px;line-height:1.6;">Your temporary password is:</p>
     <p style="margin:10px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;letter-spacing:.12em;background:#f4f5f7;border:1px solid #e3e5e8;border-radius:4px;padding:12px 16px;text-align:center;">${esc(input.temporaryPassword)}</p>
     <p style="margin:6px 0 0;font-size:13px;color:#6b7280;line-height:1.6;"><strong>The app will ask you to change it the first time you sign in.</strong> It is six digits, it belongs to this ticket only, and it stops working the moment you choose your own.</p>`
         : ''
     }
     ${button(input.orderUrl, 'View your ticket')}
     <p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">Keep this link — it shows your badge QR code, which is what gets scanned at the door. Don't forward it; anyone with the link can see your ticket.</p>`,
  );

  const text = `${greeting} you're registered for KGC 2027.

Attendee:      ${input.name || input.to}
Ticket:        ${input.ticketType}
Paid:          ${price}
Sign in with:  ${input.to}

Claim code: ${input.claimCode}
${input.temporaryPassword ? `\nTemporary password: ${input.temporaryPassword}\nThe app will ask you to change it the first time you sign in. It is six\ndigits, it belongs to this ticket only, and it stops working the moment you\nchoose your own.\n` : ''}
Next step: open the KGC app and sign in with ${input.to}.
View your ticket: ${input.orderUrl}

Keep that link private — it shows the badge QR that gets scanned at the door.

3-7 May 2027, Cornell Tech, Roosevelt Island, New York City.`;

  await send(store, {
    to: input.to,
    subject: `Your KGC 2027 ticket: ${input.ticketType}`,
    html,
    text,
    template: 'purchase-confirmation',
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
export async function sendInvoiceRaised(store: Firestore, input: InvoiceEmailInput): Promise<void> {
  const total = formatPrice(input.totalCents, input.currency);
  const seats = `${input.seatCount} ${input.seatCount === 1 ? 'seat' : 'seats'}`;

  const html = shell(
    'Your KGC 2027 invoice is ready',
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">We've raised an invoice for <strong>${esc(input.companyName)}</strong> covering ${seats}.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e3e5e8;border-bottom:1px solid #e3e5e8;margin:6px 0;">
       ${row('Company', esc(input.companyName))}
       ${row('Seats', String(input.seatCount))}
       ${row('Total', total)}
       ${input.poNumber ? row('PO number', esc(input.poNumber)) : ''}
       ${input.dueDate ? row('Due', esc(input.dueDate)) : ''}
     </table>
     ${button(input.hostedInvoiceUrl, 'View and pay the invoice')}
     <p style="margin:16px 0 0;font-size:15px;line-height:1.6;"><strong>What happens next.</strong> Tickets are issued when the invoice is paid, not when it is raised — so nobody is registered yet. As soon as payment clears, every attendee on the invoice gets their own confirmation email with a claim code.</p>
     <p style="margin:12px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">The link above lets finance pay by card or bank transfer and download a PDF for your records.</p>`,
  );

  const text = `Your KGC 2027 invoice is ready.

Company:  ${input.companyName}
Seats:    ${input.seatCount}
Total:    ${total}${input.poNumber ? `\nPO:       ${input.poNumber}` : ''}${input.dueDate ? `\nDue:      ${input.dueDate}` : ''}

View and pay: ${input.hostedInvoiceUrl}

What happens next: tickets are issued when the invoice is paid, not when it is
raised, so nobody is registered yet. When payment clears, each attendee gets
their own confirmation with a claim code.`;

  await send(store, {
    to: input.to,
    subject: `KGC 2027 invoice: ${input.companyName} (${seats})`,
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
export async function sendRefundConfirmation(store: Firestore, input: RefundEmailInput): Promise<void> {
  const amount = formatPrice(input.amountCents, input.currency);
  const greeting = input.name ? `Hi ${esc(input.name.split(' ')[0])},` : 'Hi,';
  const cancelled = input.ticketCancelled ?? true;

  const ticketHtml = !cancelled
    ? `<strong>The ticket is not affected.</strong> Another order still covers it, so it scans at the door as before. If this was a mistake, reply to this email and we'll sort it out.`
    : input.transferred
      ? `<strong>The ticket you passed on is now cancelled</strong>, so it will no longer scan at the door. We have told the person who was holding it. If this was a mistake, reply to this email and we'll sort it out.`
      : `<strong>Your registration is now cancelled</strong>, so the badge QR code in the app will no longer scan at the door. If this was a mistake, reply to this email and we'll sort it out.`;

  const ticketText = !cancelled
    ? `The ticket is not affected. Another order still covers it, so it scans at the
door as before. If this was a mistake, reply to this email.`
    : input.transferred
      ? `The ticket you passed on is now cancelled, so it will no longer scan at the
door. We have told the person who was holding it. If this was a mistake, reply
to this email.`
      : `Your registration is now cancelled, so the badge QR in the app will no longer
scan at the door. If this was a mistake, reply to this email.`;

  const html = shell(
    'Your KGC 2027 ticket has been refunded',
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} we've refunded ${amount}${input.ticketType ? ` for your ${esc(input.ticketType)} ticket` : ''}. It usually reaches your account in five to ten working days, depending on your bank.</p>
     <p style="margin:14px 0 0;font-size:15px;line-height:1.6;">${ticketHtml}</p>`,
  );

  const text = `${greeting} we've refunded ${amount}${input.ticketType ? ` for your ${input.ticketType} ticket` : ''}.

It usually reaches your account in 5-10 working days.

${ticketText}`;

  await send(store, {
    to: input.to,
    subject: 'Your KGC 2027 ticket has been refunded',
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
export async function sendTicketWithdrawn(store: Firestore, input: TicketWithdrawnInput): Promise<void> {
  const greeting = input.name ? `Hi ${esc(input.name.split(' ')[0])},` : 'Hi,';

  const html = shell(
    'Your KGC 2027 ticket has been cancelled',
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} the ticket that was passed to you${input.ticketType ? ` for ${esc(input.ticketType)}` : ''} has been cancelled, because the person who bought it has been refunded.</p>
     <p style="margin:14px 0 0;font-size:15px;line-height:1.6;"><strong>Your badge will no longer scan at the door.</strong> The money went back to whoever paid for the ticket, so there is nothing for you to claim. If you think this is wrong, reply to this email and we'll sort it out.</p>`,
  );

  const text = `${greeting} the ticket that was passed to you${input.ticketType ? ` for ${input.ticketType}` : ''} has been
cancelled, because the person who bought it has been refunded.

Your badge will no longer scan at the door. The money went back to whoever paid
for the ticket, so there is nothing for you to claim. If you think this is
wrong, reply to this email.`;

  await send(store, {
    to: input.to,
    subject: 'Your KGC 2027 ticket has been cancelled',
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
export async function sendSignInCode(store: Firestore, input: SignInCodeEmailInput): Promise<void> {
  const html = shell(
    'Your KGC 2027 sign-in code',
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Enter this code in the KGC app to sign in.</p>
     <p style="margin:10px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:30px;font-weight:600;letter-spacing:.22em;background:#f4f5f7;border:1px solid #e3e5e8;border-radius:4px;padding:16px;text-align:center;">${esc(input.code)}</p>
     <p style="margin:16px 0 0;font-size:15px;line-height:1.6;">It expires in ${input.ttlMinutes} minutes and works once. If it has run out, ask for a new one from the same screen.</p>
     <p style="margin:14px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">If you didn't ask to sign in, you can ignore this email — nobody can use the code without it, and no one has been given access to your account.</p>`,
  );

  const text = `Enter this code in the KGC app to sign in.

  ${input.code}

It expires in ${input.ttlMinutes} minutes and works once. If it has run out, ask
for a new one from the same screen.

If you didn't ask to sign in, you can ignore this email — nobody can use the
code without it, and no one has been given access to your account.

3-7 May 2027, Cornell Tech, Roosevelt Island, New York City.`;

  await send(store, {
    to: input.to,
    // Deliberately does not contain the code, and deliberately does not name
    // the recipient or their ticket: this mail goes to any syntactically valid
    // address that asks, so anything specific in it would confirm to a stranger
    // that the address is on the guest list.
    subject: 'Your KGC 2027 sign-in code',
    html,
    text,
    template: 'sign-in-code',
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
): Promise<UnsubscribeLinks | null> {
  try {
    const id = contactId(email);
    const snap = await store.collection(COLLECTIONS.contacts).doc(id).get();
    if (!snap.exists) return null;

    // One token, two routes. Both verify it the same way.
    const token = mintUnsubscribeToken(id);
    const origin = publicSiteOrigin();
    return { page: `${origin}/u/${token}`, oneClick: `${origin}/api/unsubscribe/${token}` };
  } catch (err) {
    console.warn('[email] could not build an unsubscribe link; sending without one', err);
    return null;
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
export async function sendBulkMessage(store: Firestore, input: BulkMessageInput): Promise<void> {
  const greeting = input.name ? `Hi ${esc(input.name.split(' ')[0])},` : 'Hi,';
  const unsubscribe = await unsubscribeUrlFor(store, input.to);

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
         You are receiving this because your address is on a Knowledge Graph Conference mailing
         list. <a href="${unsubscribe.page}" style="color:#6b7280;">Unsubscribe</a> — one click, no
         sign-in. It stops campaign email; anything about a ticket you hold still reaches you.
       </p>`
    : '';

  const html = shell(
    esc(input.subject),
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting}</p>${paragraphs}${unsubscribeHtml}`,
  );

  const unsubscribeText = unsubscribe
    ? `\n\nYou are receiving this because your address is on a KGC mailing list.\nUnsubscribe (one click, no sign-in): ${unsubscribe.page}\nThat stops campaign email. Anything about a ticket you hold still reaches you.`
    : '';

  const text = `${input.name ? `Hi ${input.name.split(' ')[0]},` : 'Hi,'}\n\n${input.body}\n\n—\nKnowledge Graph Conference 2027\n3-7 May 2027, Cornell Tech, Roosevelt Island, New York City${unsubscribeText}`;

  await send(store, {
    to: input.to,
    subject: input.subject,
    html,
    text,
    template: 'bulk-message',
    campaignId: input.campaignId,
    actor: input.actor,
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
): Promise<void> {
  const greeting = input.name ? `Hi ${esc(input.name.split(' ')[0])},` : 'Hi,';
  const heading = input.draft
    ? 'Your abstract has been saved as a draft'
    : 'We have your abstract';

  const opening = input.draft
    ? `we have saved your draft for <strong>${esc(input.callTitle)}</strong>. It has <strong>not</strong> been submitted yet — use the link below to finish it before ${esc(input.closesAtLabel)}.`
    : `thank you — your abstract has been submitted to <strong>${esc(input.callTitle)}</strong>. There is nothing else to do for now.`;

  const html = shell(
    heading,
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} ${opening}</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:6px 0 0;">
       ${row('Title', esc(input.title))}
       ${row('Call', esc(input.callTitle))}
       ${row('Closes', esc(input.closesAtLabel))}
     </table>
     ${button(input.link, input.draft ? 'Finish your submission' : 'View or edit your submission')}
     <p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#6b7280;">
       That link opens your submission and nothing else — no other submission, no reviews, no
       scores. Please do not forward it: anybody who has it can read and, while the call is open,
       edit your abstract. It stops working after twelve months.
     </p>`,
  );

  const text = `${greeting} ${
    input.draft
      ? `we have saved your draft for ${input.callTitle}. It has NOT been submitted yet — use the link below to finish it before ${input.closesAtLabel}.`
      : `thank you — your abstract has been submitted to ${input.callTitle}.`
  }

Title:  ${input.title}
Call:   ${input.callTitle}
Closes: ${input.closesAtLabel}

${input.draft ? 'Finish your submission' : 'View or edit your submission'}:
${input.link}

That link opens your submission and nothing else. Please do not forward it —
anybody who has it can read, and while the call is open edit, your abstract.
It stops working after twelve months.

—
Knowledge Graph Conference 2027`;

  await send(store, {
    to: input.to,
    subject: input.draft
      ? `Your draft for ${input.callTitle}`
      : `We have your abstract — ${input.title}`,
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
): Promise<void> {
  const greeting = input.name ? `Hi ${esc(input.name.split(' ')[0])},` : 'Hi,';

  if (input.waitlisted) return sendWaitlisted(store, input);

  const opening = input.accepted
    ? `we are delighted to say that <strong>“${esc(input.title)}”</strong> has been accepted for ${esc(input.callTitle)}.`
    : `thank you for submitting <strong>“${esc(input.title)}”</strong> to ${esc(input.callTitle)}. After review, we are not able to include it in the programme this year.`;

  const next = input.accepted
    ? `We will be in touch separately about scheduling — the date, time and room are decided as the programme is assembled, so this is not a slot yet.`
    : `We had more good submissions than we have room for, and a decision not to include one is not a judgement that it was weak. We would be glad to see you submit again.`;

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
      ? `we are delighted to say that "${input.title}" has been accepted for ${input.callTitle}.`
      : `thank you for submitting "${input.title}" to ${input.callTitle}. After review, we are not able to include it in the programme this year.`
  }

${
  input.accepted
    ? 'We will be in touch separately about scheduling — the date, time and room are decided as the programme is assembled, so this is not a slot yet.'
    : 'We had more good submissions than we have room for, and a decision not to include one is not a judgement that it was weak. We would be glad to see you submit again.'
}
${input.note?.trim() ? `\nFrom the committee:\n${input.note.trim()}\n` : ''}
Read your submission:
${input.link}

—
Knowledge Graph Conference 2027`;

  await send(store, {
    to: input.to,
    subject: input.accepted
      ? `Accepted — ${input.title}`
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
async function sendWaitlisted(store: Firestore, input: SubmissionDecisionInput): Promise<void> {
  const greeting = input.name ? `Hi ${esc(input.name.split(' ')[0])},` : 'Hi,';
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

  await send(store, {
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
): Promise<void> {
  const greeting = input.name ? `Hi ${esc(input.name.split(' ')[0])},` : 'Hi,';
  const waiting =
    input.assigned === 0
      ? 'Nothing has been assigned to you yet. Submissions will appear on your page as they are.'
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
       There is no account and no password. The link is your access, so please do not forward it:
       anybody who has it can read the submissions assigned to you and score them in your name. If
       you have a conflict of interest with a submission, say so on its page and it is taken off
       your list. The link stops working after six months.
     </p>`,
  );

  const text = `${greeting} thank you for reviewing for ${input.callTitle}.
${noteParas.length ? `\n${noteParas.join('\n\n')}\n` : ''}
${waiting}${due}

Open your review page:
${input.link}

There is no account and no password. The link is your access, so please do not
forward it: anybody who has it can read the submissions assigned to you and
score them in your name. If you have a conflict of interest with a submission,
say so on its page and it is taken off your list. The link stops working after
six months.

Knowledge Graph Conference 2027`;

  await send(store, {
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
): Promise<void> {
  const greeting = input.name ? `Hi ${esc(input.name.split(' ')[0])},` : 'Hi,';
  const talks =
    input.sessionTitles.length === 0
      ? 'You are on the speaker list for Knowledge Graph Conference 2027.'
      : input.sessionTitles.length === 1
        ? `You are speaking at Knowledge Graph Conference 2027, on "${input.sessionTitles[0]}".`
        : `You are speaking at Knowledge Graph Conference 2027, on ${input.sessionTitles.length} sessions.`;
  const missing = input.missingLabel
    ? `We are missing ${input.missingLabel} for you.`
    : 'You can check what we hold and change anything that is out of date.';

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
       There is no account and no password. The link is your access, so please do not forward it.
       Nothing you send appears anywhere until one of the organizers has read it. The link stops
       working after six months.
     </p>`,
  );

  const text = `${greeting} ${talks}
${noteParas.length ? `\n${noteParas.join('\n\n')}\n` : ''}
${missing} Your bio, job title, company, links and a link to your slides all go
on the same page.

Fill in your profile:
${input.link}

There is no account and no password. The link is your access, so please do not
forward it. Nothing you send appears anywhere until one of the organizers has
read it. The link stops working after six months.

Knowledge Graph Conference 2027`;

  await send(store, {
    to: input.to,
    subject: 'Your speaker profile for KGC 2027',
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
  /** The dashboard's set-passphrase page, carrying a link that works once. */
  link: string;
  /** How long the link lasts, already formatted: "3 days". */
  expiresLabel: string;
  /** Who pressed send, recorded in `emailLog`. */
  actor: string;
}

/**
 * The invitation to the organizer dashboard, and every new link after it.
 *
 * One template for the first invitation and for a reset, because they are the
 * same mail: a link that sets a passphrase once. No unsubscribe link, for the
 * reason the reviewer invitation has none — one named person, one button press.
 */
export async function sendTeamInvitation(store: Firestore, input: TeamInvitationInput): Promise<void> {
  const greeting = input.name ? `Hi ${esc(input.name.split(' ')[0])},` : 'Hi,';

  const html = shell(
    'Your organizer dashboard access',
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} you have been added to the organizer dashboard for Knowledge Graph Conference 2027.</p>
     <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Your access: <strong>${esc(input.rolesLabel)}</strong>.</p>
     ${button(input.link, 'Choose your passphrase')}
     <p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#6b7280;">
       The link works once and expires in ${esc(input.expiresLabel)}. After that you sign in with
       this email address and the passphrase you chose. Please do not forward it.
     </p>`,
  );

  const text = `${greeting} you have been added to the organizer dashboard for Knowledge Graph Conference 2027.

Your access: ${input.rolesLabel}.

Choose your passphrase:
${input.link}

The link works once and expires in ${input.expiresLabel}. After that you sign in
with this email address and the passphrase you chose. Please do not forward it.

Knowledge Graph Conference 2027`;

  await send(store, {
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
): Promise<void> {
  const greeting = input.name ? `Hi ${esc(input.name.split(' ')[0])},` : 'Hi,';
  const opening = input.resigning
    ? `the wording of ${esc(input.formTitle)} has changed since you signed it. Your earlier agreement still stands for what it said, and it does not cover the new text.`
    : `please read and sign ${esc(input.formTitle)} for Knowledge Graph Conference 2027.`;

  const html = shell(
    input.resigning ? `Please sign ${esc(input.formTitle)} again` : `Please sign ${esc(input.formTitle)}`,
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} ${opening}</p>
     ${button(input.link, 'Read it and sign')}
     <p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#6b7280;">
       The link is yours alone, so please do not forward it. You can read the whole text before you
       agree to anything.
     </p>`,
  );

  const text = `${greeting} ${input.resigning
    ? `the wording of ${input.formTitle} has changed since you signed it. Your earlier agreement still stands for what it said, and it does not cover the new text.`
    : `please read and sign ${input.formTitle} for Knowledge Graph Conference 2027.`}

Read it and sign:
${input.link}

The link is yours alone, so please do not forward it. You can read the whole text
before you agree to anything.

Knowledge Graph Conference 2027`;

  await send(store, {
    to: input.to,
    subject: input.resigning
      ? `Please sign ${input.formTitle} again (version ${input.version})`
      : `Please sign ${input.formTitle}`,
    html,
    text,
    template: 'consent-request',
    actor: input.actor,
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
  });
}
