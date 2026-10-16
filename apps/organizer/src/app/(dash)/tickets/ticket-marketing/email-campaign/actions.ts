'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { COLLECTIONS } from '@kgc/shared';
import { emailEnabled, sendBulkMessage, sendOutcomeMessage } from '@kgc/scripts/src/lib/email';
import { appendAudit } from '@/lib/audit';
import { reauthenticate, requireOrganizer } from '@/lib/auth';
import { audienceFor, listContacts, recordSuppressedRecipients } from '@/lib/campaigns';
import { recordError } from '@/lib/errors';
import { db } from '@/lib/firestore';
import { startBulkSend } from '@/lib/send-jobs';
import { bulkCampaignId } from '@/lib/send-jobs-core';

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
  /** The background send this press started or found, for the progress line. */
  campaignId?: string;
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
        'Email sending is not set up yet, so nothing can be sent.',
      keep,
    };
  }

  // ── The test send: identical code, one recipient ─────────────────────────
  if (testOnly) {
    if (!EMAIL.test(testAddress)) {
      return { error: 'Enter a valid address to send the test to.', keep };
    }
    // Never throws; the outcome is what the screen reports (T258 #4).
    const outcome = await sendBulkMessage(db(), {
      to: testAddress,
      name: 'there',
      subject: `[TEST] ${subject}`,
      body,
      campaignId: `test_${randomUUID()}`,
      actor,
    });
    const message = sendOutcomeMessage({
      outcome,
      to: testAddress,
      sent: `Test sent to ${testAddress}. Nothing went to the list.`,
      fallback: 'Check the transaction log for the reason. Nothing went to the list.',
    });
    return outcome === 'sent' ? { ok: true, message, keep } : { error: message, keep };
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

  if (!(await reauthenticate(passphrase))) {
    return { error: 'That confirmation code is not right, or it has expired. Nothing has been sent.', keep };
  }

  if (Number(confirmCount) !== recipients.length) {
    return {
      error: `Type ${recipients.length} to confirm. That is how many people will receive this${
        suppressed > 0 ? `, with ${suppressed} suppressed and excluded` : ''
      }.`,
      keep,
    };
  }

  /**
   * The send runs as a background job (T258 #1). A list of 2,000 takes longer
   * than Apache's five-minute timeout, and when it ran inside this request the
   * organizer saw an error, pressed again and mailed everybody twice.
   *
   * The campaign id comes from the list and the message, so pressing Send
   * again with the same message resumes this campaign rather than starting a
   * new one, and only people with no `sent` row are mailed. Each mail is also
   * sent under an idempotency key built from the campaign and the address.
   */
  const campaignId = bulkCampaignId({ kind: 'campaign', audience: list, subject, body });

  let skipLog = { attempted: 0, written: 0 };
  let started;
  try {
    started = await startBulkSend({
      store: db(),
      campaignId,
      kind: 'campaign',
      audience: list,
      label: `the "${list}" list`,
      subject,
      actor,
      recipients,
      /*
       * The exclusions are recorded on the first press only, before the first
       * mail goes out. These rows are the evidence that the suppression list
       * was honoured, and a send that is interrupted must not leave a campaign
       * whose sent rows exist and whose "who we deliberately did not mail"
       * rows were never written. A resumed press does not write them again.
       */
      onFirstRun: async () => {
        skipLog = await recordSuppressedRecipients({ campaignId, subject, actor, excluded });
      },
      send: (r, ctx) =>
        sendBulkMessage(db(), {
          to: r.email,
          name: r.name,
          subject,
          body,
          campaignId: ctx.campaignId,
          issuedAt: ctx.issuedAt,
          actor,
          // A campaign mail with no working unsubscribe link is not sent (T258 #11).
          requireUnsubscribe: true,
        }),
      onError: (err) => recordError('campaign.send', err),
    });
  } catch (err) {
    recordError('campaign.start', err);
    return {
      error: 'The send could not start: the list of people already mailed could not be read. Nothing was sent. Try again in a minute.',
      keep,
    };
  }

  if (!started.started) {
    return started.reason === 'busy'
      ? {
          ok: true,
          message: 'This campaign is already sending. Its progress is below. Nobody gets it twice.',
          campaignId,
        }
      : {
          error: `Everybody on "${list}" already has this message (${started.alreadySent} sent). Nothing was sent again. Change the subject or the message to send a new campaign.`,
          keep,
        };
  }

  // Swallowed into the job document by the runner; never awaited here.
  void started.done;

  await appendAudit({
    actor,
    action: 'campaign.send',
    targetPath: `${COLLECTIONS.sendJobs}/${campaignId}`,
    targetId: campaignId,
    before: {},
    after: {
      list,
      subject,
      recipients: started.total,
      alreadySent: started.alreadySent,
      sending: started.todo,
      resumed: started.resumed,
    },
  });

  revalidatePath(PATH);

  /*
   * The exclusion sentence admits it when the log came out incomplete.
   * `written < attempted` only ever means a Firestore write failed: the
   * suppression itself held, but the record of it has a hole.
   */
  const excludedNote =
    suppressed === 0 || started.resumed
      ? ''
      : skipLog.written === skipLog.attempted
        ? ` ${suppressed} were excluded as unsubscribed, bounced or marked as spam, and each is logged as skipped.`
        : ` ${suppressed} were excluded and none of them was emailed, but only ` +
          `${skipLog.written} of ${skipLog.attempted} could be written to the log.`;

  return {
    ok: true,
    campaignId,
    message:
      (started.resumed
        ? `Resuming: ${started.alreadySent} already have it, sending to the other ${started.todo}.`
        : `Sending to ${started.todo} on "${list}".`) +
      (started.duplicates ? ` ${started.duplicates} duplicate addresses were left out.` : '') +
      excludedNote,
  };
}
