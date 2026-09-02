'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { emailEnabled, sendBulkMessage } from '@kgc/scripts/src/lib/email';
import { reauthenticate, requireOrganizer } from '@/lib/auth';
import { audienceFor, listContacts, recordSuppressedRecipients } from '@/lib/campaigns';
import { recordError } from '@/lib/errors';
import { db } from '@/lib/firestore';

/**
 * Sending an email campaign to a contact list.
 *
 * ── Why this is not `messaging/actions.ts` ──────────────────────────────────
 *
 * `lib/messaging.ts` says in as many words that attendee mail is "a genuinely
 * different tool — contact lists, link tracking, an unsubscribe register. Forty
 * five speakers is a different problem from a thousand attendees, and
 * pretending otherwise is how a conference gets its sending domain blocked."
 * This is that tool, and the difference is entirely in the guards.
 *
 * Message Speakers resolves an audience from `speakers` and mails all of them.
 * This resolves an audience from `contacts` and then **removes everyone who
 * unsubscribed or bounced** before it counts anything, because the list is
 * three orders of magnitude larger and the people on it did not buy a ticket
 * from you. Each removal is then written to `emailLog` as a `skipped` row, so
 * "we did not email anyone who opted out" is something the log can be asked
 * rather than something this comment asserts.
 *
 * ── Four guards, each stopping a different disaster ─────────────────────────
 *
 * Suppression, so a send cannot reach somebody who asked it to stop.
 * A typed count, so a segment that silently matched everybody is caught before
 * a thousand people hear about it rather than after.
 * A passphrase, because this is irreversible in a way a refund is not — an
 * email in a thousand inboxes cannot be recalled.
 * A test send, which runs the identical code path against one address.
 *
 * ── No scheduling ───────────────────────────────────────────────────────────
 *
 * The same argument as Message Speakers, with more force at this volume: a
 * queued blast fires whether or not anybody is awake to stop it, and the
 * classic failure is 6am in the wrong timezone to a list you cannot recall.
 */

const PATH = '/tickets/ticket-marketing/email-campaign';

export interface CampaignState {
  ok?: boolean;
  message?: string;
  error?: string;
  /** What was typed, so a failed send does not blank the draft. */
  keep?: { subject: string; body: string };
}

/**
 * A cap, not a rate limit.
 *
 * Higher than the 200 on Message Speakers because a contact list legitimately
 * is this big — but still a cap: if a send ever resolves past it, the segment
 * filter has probably not applied, and finding that out by mailing five
 * thousand people is the wrong way round.
 */
const MAX_RECIPIENTS = 2_000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function sendCampaignAction(
  _prev: CampaignState,
  form: FormData,
): Promise<CampaignState> {
  const actor = await requireOrganizer();

  const list = String(form.get('list') ?? '').trim();
  const subject = String(form.get('subject') ?? '').trim();
  const body = String(form.get('body') ?? '').trim();
  const confirmCount = String(form.get('confirmCount') ?? '').trim();
  const passphrase = String(form.get('passphrase') ?? '');
  const testOnly = form.get('testOnly') === 'on';
  const testAddress = String(form.get('testAddress') ?? '').trim();

  const keep = { subject, body };

  if (subject.length < 3) return { error: 'Give the campaign a subject line.', keep };
  if (body.length < 10) return { error: 'The message body is empty.', keep };

  if (!emailEnabled()) {
    return {
      error:
        'No email provider is configured on this deployment (RESEND_API_KEY is unset), so ' +
        'nothing can be sent. Every attempt would be logged as skipped.',
      keep,
    };
  }

  // ── The test send: identical code, one recipient ─────────────────────────
  if (testOnly) {
    if (!EMAIL.test(testAddress)) {
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
      recordError('campaign.test', err);
      return { error: 'The test send failed. Check the transaction log.', keep };
    }
    return { ok: true, message: `Test sent to ${testAddress}. Nothing went to the list.`, keep };
  }

  // ── The real send ────────────────────────────────────────────────────────
  const contacts = await listContacts();
  const { recipients, suppressed, excluded } = audienceFor(contacts, list);

  if (recipients.length === 0) {
    return {
      error:
        suppressed > 0
          ? `Everybody on "${list}" has unsubscribed or bounced. Nothing will be sent.`
          : `"${list}" matches nobody.`,
      keep,
    };
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return {
      error: `That resolves to ${recipients.length} people, above the ${MAX_RECIPIENTS} cap. A list filter has probably not applied.`,
      keep,
    };
  }

  if (!reauthenticate(passphrase)) {
    return { error: 'That passphrase is not correct. Nothing has been sent.', keep };
  }

  if (Number(confirmCount) !== recipients.length) {
    return {
      error: `Type ${recipients.length} to confirm — that is how many people will receive this${
        suppressed > 0 ? `, with ${suppressed} suppressed and excluded` : ''
      }.`,
      keep,
    };
  }

  /**
   * One campaign id for the whole send, and one `emailLog` row per recipient.
   *
   * The per-recipient row is what answers the question people actually ask —
   * "did Ada get it?" — and the campaign summary is derived from those rows at
   * read time, so it can never disagree with them.
   */
  const campaignId = `campaign_${randomUUID()}`;
  let sent = 0;
  let failed = 0;

  /**
   * The exclusions are recorded *before* the first mail goes out.
   *
   * Not cosmetic ordering. These rows are the evidence that the suppression
   * list was honoured, and the send that follows takes minutes — a deploy that
   * restarts, a request that times out or an organizer who closes the tab
   * halfway through would otherwise leave a campaign whose `sent` rows exist
   * and whose "and here is who we deliberately did not mail" rows never got
   * written. That is precisely the state that cannot be reconstructed
   * afterwards, because `unsubscribedAt` keeps moving as more people opt out.
   *
   * It also fixes the campaign's timestamp at the moment the send started,
   * since `listCampaigns()` takes a campaign's time from its earliest row.
   *
   * Never throws — see `recordSuppressedRecipients`. A campaign is not stopped
   * by a failure to write its own diagnostics.
   */
  const skipLog = await recordSuppressedRecipients({ campaignId, subject, actor, excluded });

  /**
   * Sequential, and each send swallows its own errors inside `sendBulkMessage`.
   *
   * One bad address must not stop the rest of a list being reached, and the
   * failure is already recorded per recipient. Sequential rather than parallel
   * because a thousand simultaneous requests is how a provider rate-limits a
   * sending domain into a temporary block.
   */
  for (const r of recipients) {
    try {
      await sendBulkMessage(db(), {
        to: r.email,
        name: r.name,
        subject,
        body,
        campaignId,
        actor,
      });
      sent++;
    } catch (err) {
      recordError('campaign.send', err);
      failed++;
    }
  }

  revalidatePath(PATH);

  /*
   * The exclusion sentence admits it when the log came out incomplete.
   *
   * `written < attempted` only ever means a Firestore write failed, and on
   * every ordinary send they are equal. When they are not, the honest reading
   * is that the suppression itself held — nobody excluded was emailed, because
   * the audience was filtered long before any of this — but the *record* of it
   * has a hole, and an organizer reading "62 excluded" off the log later would
   * otherwise be reading a number that quietly means something else.
   */
  const excludedNote =
    suppressed === 0
      ? ''
      : skipLog.written === skipLog.attempted
        ? ` ${suppressed} were excluded as unsubscribed or bounced, and each is logged as skipped.`
        : ` ${suppressed} were excluded as unsubscribed or bounced — none of them was emailed, but only ` +
          `${skipLog.written} of ${skipLog.attempted} could be written to the log. ` +
          `See the transaction log for the write failure.`;

  return {
    ok: true,
    message:
      `Sent to ${sent} of ${recipients.length} on "${list}".` +
      (failed > 0 ? ` ${failed} failed — see the log below.` : '') +
      excludedNote,
  };
}
