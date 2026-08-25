'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { sendBulkMessage } from '@kgc/scripts/src/lib/email';
import { emailEnabled } from '@kgc/scripts/src/lib/email';
import { appendAudit } from '@/lib/audit';
import { reauthenticate, requireOrganizer } from '@/lib/auth';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { AUDIENCES, resolveAudience, type AudienceId } from '@/lib/messaging';
import { ROUTES } from '@/lib/nav';

/**
 * Sending a bulk message.
 *
 * ── This is the second-most dangerous button in the product ─────────────────
 *
 * A refund moves money and can at least be explained. **An email cannot be
 * recalled at all.** Forty-five speakers receiving a half-finished draft, or the
 * wrong segment receiving a chase-up they already answered, is unfixable — the
 * only remedy is a second email apologising for the first.
 *
 * Four guards, each aimed at a specific way this goes wrong:
 *
 *   1. **A typed recipient count.** Not a checkbox. The organizer types the
 *      number of people who will receive it, which forces them to read it —
 *      and reading it is what catches "I meant to pick the incomplete-profiles
 *      segment and this says 45".
 *   2. **A cooldown**, checked against the newest campaign in Firestore rather
 *      than anything in this process, so it survives a reload and a second tab.
 *   3. **A test send to yourself**, which is a different code path from the real
 *      one only in its recipient list.
 *   4. **An audit entry** naming who sent what to how many.
 *
 * ── Sends are sequential, not parallel ──────────────────────────────────────
 *
 * `Promise.all` over 45 recipients would be faster and would also be the fastest
 * way to hit Resend's rate limit and have half the send rejected. At these
 * volumes the loop takes a few seconds and cannot fail that way.
 */

export interface MessageState {
  ok?: boolean;
  message?: string;
  error?: string;
  /** Echoed back so a failed send does not blank what the organizer typed. */
  keep?: { subject: string; body: string };
}

/** Two minutes. Long enough that a double-submit cannot be an accident. */
const COOLDOWN_MS = 120_000;

/**
 * A cap, not a rate limit.
 *
 * Every audience here is in the tens. If a send ever resolves to more than this
 * it means a segment filter silently did nothing, and mailing four hundred
 * people to find that out is the wrong way round.
 */
const MAX_RECIPIENTS = 200;

export async function sendBulkMessageAction(
  _prev: MessageState,
  formData: FormData,
): Promise<MessageState> {
  const actor = await requireOrganizer();

  const audienceId = String(formData.get('audience') ?? '') as AudienceId;
  const segment = String(formData.get('segment') ?? 'all');
  const subject = String(formData.get('subject') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const confirmCount = String(formData.get('confirmCount') ?? '').trim();
  const passphrase = String(formData.get('passphrase') ?? '');
  const testOnly = formData.get('testOnly') === 'on';
  const testAddress = String(formData.get('testAddress') ?? '').trim();

  const keep = { subject, body };
  const audience = AUDIENCES[audienceId];
  if (!audience) return { error: 'Unknown audience.', keep };

  if (subject.length < 3) return { error: 'Give the message a subject line.', keep };
  if (body.length < 10) return { error: 'The message body is empty.', keep };

  if (!emailEnabled()) {
    return {
      error:
        'No email provider is configured on this deployment (RESEND_API_KEY is unset), so ' +
        'nothing can be sent. Every attempt would be logged as skipped.',
      keep,
    };
  }

  // ── The test send: same code, one recipient ──────────────────────────────
  if (testOnly) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(testAddress)) {
      return { error: 'Enter a valid address to send the test to.', keep };
    }
    try {
      await sendBulkMessage(db(), {
        to: testAddress,
        name: 'there',
        subject: `[TEST] ${subject}`,
        body,
        campaignId: `test_${randomUUID()}`,
        actor,
      });
    } catch (err) {
      recordError('message.test', err);
      return { error: 'The test send failed. Check the transaction log.', keep };
    }
    return {
      ok: true,
      message: `Test sent to ${testAddress}. Nothing went to any ${audience.noun}.`,
      keep,
    };
  }

  // ── The real send ────────────────────────────────────────────────────────
  const { recipients, withoutEmail } = await resolveAudience(audienceId, segment);

  if (recipients.length === 0) {
    return { error: `That segment matches nobody with an email address on file.`, keep };
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return {
      error: `That resolves to ${recipients.length} people, above the ${MAX_RECIPIENTS} cap. A segment filter has probably not applied.`,
      keep,
    };
  }

  if (!reauthenticate(passphrase)) {
    return { error: 'That passphrase is not correct. Nothing has been sent.', keep };
  }

  if (Number(confirmCount) !== recipients.length) {
    return {
      error: `Type ${recipients.length} to confirm — that is how many ${audience.noun} will receive this.`,
      keep,
    };
  }

  const recent = await lastCampaignAt();
  if (recent && Date.now() - recent < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (Date.now() - recent)) / 1000);
    return {
      error: `A message went out ${Math.round((Date.now() - recent) / 1000)}s ago. Wait ${wait}s — a duplicate is indistinguishable from a mistake in someone's inbox.`,
      keep,
    };
  }

  const campaignId = `camp_${randomUUID()}`;

  await appendAudit({
    actor,
    action: 'message.send',
    targetPath: `emailLog/${campaignId}`,
    targetId: campaignId,
    before: {},
    after: { audience: audienceId, segment, subject, recipients: recipients.length },
  });

  /**
   * Sequential, and each send swallows its own errors inside `sendBulkMessage`.
   * One bad address must not stop the other forty-four getting their call for
   * slides — and every outcome, good or bad, lands in `emailLog`.
   */
  for (const r of recipients) {
    await sendBulkMessage(db(), {
      to: r.email,
      name: r.name,
      subject,
      body,
      campaignId,
      actor,
    });
  }

  revalidatePath(ROUTES.messageSpeakers);
  revalidatePath(ROUTES.messageSponsors);
  revalidatePath(ROUTES.transactionHistory);

  return {
    ok: true,
    message:
      `Sent to ${recipients.length} ${audience.noun}.` +
      (withoutEmail > 0
        ? ` ${withoutEmail} had no email address on file and got nothing — they are listed below.`
        : '') +
      ' Delivery outcomes are in the recipient list; anything that bounced shows as failed.',
  };
}

/** Newest bulk send, epoch ms, or null. Read from Firestore so it survives a reload. */
async function lastCampaignAt(): Promise<number | null> {
  try {
    const { COLLECTIONS, EVENT_ID } = await import('@kgc/shared');
    const snap = await db()
      .collection(COLLECTIONS.emailLog)
      .where('eventId', '==', EVENT_ID)
      .where('template', '==', 'bulk-message')
      .get();

    let newest = 0;
    for (const d of snap.docs) {
      const at = d.data().at;
      const ms = at?.toDate?.().getTime?.() ?? 0;
      if (ms > newest) newest = ms;
    }
    return newest || null;
  } catch (err) {
    // A cooldown that cannot be read must not block a send during an event.
    recordError('message.cooldown', err);
    return null;
  }
}
