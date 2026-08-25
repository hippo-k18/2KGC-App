import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type EmailLogDoc } from '@kgc/shared';

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
      .add({ ...entry, eventId: EVENT_ID, at: new Date() });
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
   * True when no payment was taken — the site is running without a Stripe
   * account. The receipt then says so, in as many words, instead of printing an
   * amount beside the word "Paid".
   *
   * This is the same rule the confirmation page and the order document follow:
   * **nothing may ever imply money changed hands when it did not.** An email is
   * the worst place to break it, because it is the artefact somebody forwards
   * to their finance team.
   */
  demo?: boolean;
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
  const price = input.demo
    ? 'Nothing — this was a test purchase'
    : formatPrice(input.amountCents, input.currency);
  const greeting = input.name ? `Hi ${esc(input.name.split(' ')[0])},` : 'Hi,';

  const html = shell(
    'Your KGC 2027 ticket is confirmed',
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} you're registered. Here are the details.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e3e5e8;border-bottom:1px solid #e3e5e8;margin:6px 0;">
       ${row('Attendee', esc(input.name || input.to))}
       ${row('Ticket', esc(input.ticketType))}
       ${row(input.demo ? 'Payment' : 'Paid', price)}
       ${row('Sign in with', esc(input.to))}
     </table>
     <p style="margin:18px 0 6px;font-size:15px;line-height:1.6;"><strong>Next step:</strong> open the KGC app and sign in with <strong>${esc(input.to)}</strong> — that address is how the app finds your ticket. Your claim code is:</p>
     <p style="margin:10px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;letter-spacing:.12em;background:#f4f5f7;border:1px solid #e3e5e8;border-radius:4px;padding:12px 16px;text-align:center;">${esc(input.claimCode)}</p>
     ${button(input.orderUrl, 'View your ticket')}
     <p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">Keep this link — it shows your badge QR code, which is what gets scanned at the door. Don't forward it; anyone with the link can see your ticket.</p>`,
  );

  const text = `${greeting} you're registered for KGC 2027.
${input.demo ? '\nNO PAYMENT WAS TAKEN. This was a test purchase on a deployment with no\npayment processor configured. Your registration is real; no money moved.\n' : ''}
Attendee:      ${input.name || input.to}
Ticket:        ${input.ticketType}
${input.demo ? 'Payment:       none — test purchase' : `Paid:          ${price}`}
Sign in with:  ${input.to}

Claim code: ${input.claimCode}

Next step: open the KGC app and sign in with ${input.to}.
View your ticket: ${input.orderUrl}

Keep that link private — it shows the badge QR that gets scanned at the door.

3-7 May 2027, Cornell Tech, Roosevelt Island, New York City.`;

  await send(store, {
    to: input.to,
    subject: input.demo
      ? `[TEST] Your KGC 2027 ticket — ${input.ticketType}`
      : `Your KGC 2027 ticket — ${input.ticketType}`,
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
    subject: `KGC 2027 invoice — ${input.companyName} (${seats})`,
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
}

/**
 * Confirms the money went back and, more usefully, that the ticket did not
 * survive it.
 *
 * The second half is the point. Someone who refunds and still has a
 * confirmation email in their inbox will otherwise turn up at the door — and
 * finding out there is that the badge does not scan is a worse conversation
 * than an email that said so in April.
 */
export async function sendRefundConfirmation(store: Firestore, input: RefundEmailInput): Promise<void> {
  const amount = formatPrice(input.amountCents, input.currency);
  const greeting = input.name ? `Hi ${esc(input.name.split(' ')[0])},` : 'Hi,';

  const html = shell(
    'Your KGC 2027 ticket has been refunded',
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting} we've refunded ${amount}${input.ticketType ? ` for your ${esc(input.ticketType)} ticket` : ''}. It usually reaches your account in five to ten working days, depending on your bank.</p>
     <p style="margin:14px 0 0;font-size:15px;line-height:1.6;"><strong>Your registration is now cancelled</strong>, so the badge QR code in the app will no longer scan at the door. If this was a mistake, reply to this email and we'll sort it out.</p>`,
  );

  const text = `${greeting} we've refunded ${amount}${input.ticketType ? ` for your ${input.ticketType} ticket` : ''}.

It usually reaches your account in 5-10 working days.

Your registration is now cancelled, so the badge QR in the app will no longer
scan at the door. If this was a mistake, reply to this email.`;

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
 */
export async function sendBulkMessage(store: Firestore, input: BulkMessageInput): Promise<void> {
  const greeting = input.name ? `Hi ${esc(input.name.split(' ')[0])},` : 'Hi,';

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

  const html = shell(esc(input.subject), `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${greeting}</p>${paragraphs}`);

  const text = `${input.name ? `Hi ${input.name.split(' ')[0]},` : 'Hi,'}\n\n${input.body}\n\n—\nKnowledge Graph Conference 2027\n3-7 May 2027, Cornell Tech, Roosevelt Island, New York City`;

  await send(store, {
    to: input.to,
    subject: input.subject,
    html,
    text,
    template: 'bulk-message',
    campaignId: input.campaignId,
    actor: input.actor,
  });
}
