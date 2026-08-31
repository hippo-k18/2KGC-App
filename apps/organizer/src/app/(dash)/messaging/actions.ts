'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, SUBCOLLECTIONS, type ThreadDoc, type UserDoc } from '@kgc/shared';
import { sendBulkMessage } from '@kgc/scripts/src/lib/email';
import { emailEnabled } from '@kgc/scripts/src/lib/email';
import { appendAudit } from '@/lib/audit';
import { reauthenticate, requireOrganizer } from '@/lib/auth';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import {
  AUDIENCES,
  DESK_UID,
  deskThreadIdFor,
  ensureDeskDirectoryEntry,
  resolveAudience,
  type AudienceId,
} from '@/lib/messaging';
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
    // `COLLECTIONS` and `EVENT_ID` used to be pulled in with a dynamic import
    // here because this file imported neither at the top. It does now, and a
    // local re-binding of the same two names would shadow them.
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

// ---------------------------------------------------------------------------
// The conference desk — one direct message at a time
// ---------------------------------------------------------------------------

/**
 * Sending a direct message as the conference desk.
 *
 * The opposite risk profile to `sendBulkMessageAction` above, and the guards are
 * sized accordingly. A bulk email reaches forty-five people and cannot be
 * recalled, so it is defended by a typed count, a cooldown, a passphrase and a
 * test send. This reaches exactly one person, in an app they have open, and the
 * organizer is looking at the conversation while they type — so a second
 * passphrase prompt here would be friction bought with nothing, and would be
 * paid during the fifteen minutes when a speaker is stuck at JFK.
 *
 * What it does still do is refuse to write past the attendee's own privacy
 * switch, and record who sent it. See `lib/messaging.ts` for the whole argument
 * — the identity, the refusal to read other people's conversations, and why the
 * desk is one shared account rather than one per organizer.
 */

export interface DeskMessageState {
  ok?: boolean;
  message?: string;
  error?: string;
  /** Echoed back so a failed send does not blank what the organizer typed. */
  keep?: string;
}

/**
 * Long enough for "your session has moved to Bloomberg 165, the AV team will
 * meet you at the door at 14:30", short enough that nobody pastes a newsletter
 * into a chat window. `lastMessage` on the thread is truncated to 140 for the
 * inbox preview either way.
 */
const MAX_BODY = 2000;

export async function sendDeskMessageAction(
  _prev: DeskMessageState,
  formData: FormData,
): Promise<DeskMessageState> {
  const actor = await requireOrganizer();

  const recipientUid = String(formData.get('recipientUid') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();

  if (!recipientUid) return { error: 'Choose somebody to message.', keep: body };
  if (!body) return { error: 'The message is empty.', keep: body };
  if (body.length > MAX_BODY) {
    return {
      error: `That is ${body.length} characters, above the ${MAX_BODY} cap. A direct message is not the right instrument for something this long — use Message Speakers.`,
      keep: body,
    };
  }

  /**
   * Re-checked here rather than trusted from the form, and against `users`
   * rather than the picker that rendered it.
   *
   * ⚠️ `messagingEnabled` is the attendee's own switch and **nothing enforces
   * it** — `firestore.rules` allows them to write the field and never reads it,
   * so this is the only thing standing between the switch and a message that
   * ignores it. A recipient who turned it off between the page load and the send
   * must not receive this, and the form's `recipientUid` is a value the browser
   * could have supplied for anybody at all.
   */
  const userDoc = await db().collection(COLLECTIONS.users).doc(recipientUid).get();
  if (!userDoc.exists) {
    return {
      error:
        'That person has no profile, so there is no inbox to deliver to. Somebody who has never opened the app can only be reached by email.',
      keep: body,
    };
  }
  const user = userDoc.data() as UserDoc;
  if (!user.messagingEnabled) {
    return {
      error: `${user.name || 'That attendee'} has turned off direct messages. Nothing has been sent — their email address is on the Attendees screen.`,
      keep: body,
    };
  }

  // Built by concatenation in `@kgc/shared`. Nothing here or anywhere else
  // takes a thread id apart again.
  const threadId = deskThreadIdFor(recipientUid);
  const threadRef = db().collection(COLLECTIONS.threads).doc(threadId);

  try {
    await ensureDeskDirectoryEntry();

    /**
     * The thread summary first, the message second.
     *
     * Not a stylistic ordering. The `messages` create rule proves membership
     * with a `get()` on the parent thread, and `get()` on a document that does
     * not exist returns null — so a message written into a thread that has not
     * been created yet is rejected as `permission-denied`. The Admin SDK is not
     * subject to that rule, but the *attendee's* reply is, and a thread whose
     * first message exists without the parent summary is a conversation they
     * cannot answer. `app/src/lib/data/messages.ts` solved this once already;
     * this is the same ordering for the same reason.
     */
    await threadRef.set(
      {
        eventId: EVENT_ID,
        participantIds: [DESK_UID, recipientUid].sort(),
        lastMessage: body.slice(0, 140),
        lastMessageAt: FieldValue.serverTimestamp(),
        lastSenderId: DESK_UID,
        /**
         * ⚠️ **Exactly the two participant keys, no more and no fewer.**
         * `metadataWriteIsSane()` in `firestore.rules` requires
         * `next.keys().hasOnly([me, other]) && hasAll([me, other])` on the
         * attendee's own writes. If the desk ever leaves a third key here — a
         * stale uid from a thread that changed hands, say — the attendee's next
         * reply is denied by the rules, and the symptom is a message bouncing
         * out of the composer in the app with nothing in this dashboard to
         * explain it.
         *
         * `increment` rather than read-then-write for the same reason the app
         * uses it: three messages sent in quick succession would all read the
         * same count and all write the same value, and two of them would vanish
         * from the badge.
         */
        unread: { [DESK_UID]: 0, [recipientUid]: FieldValue.increment(1) },
      },
      { merge: true },
    );

    await threadRef.collection(SUBCOLLECTIONS.messages).add({
      senderId: DESK_UID,
      body,
      sentAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    recordError('desk.message.send', err);
    return { error: 'The message could not be sent. Check the transaction log.', keep: body };
  }

  /**
   * The audit entry is the whole of the per-person accountability this design
   * has. Every organizer shares one desk identity, so the attendee sees "KGC
   * Conference Desk" and `senderId` records the desk — the only place the
   * question "which organizer wrote this?" can be answered is here. That makes
   * it load-bearing rather than routine, which is why the body is recorded and
   * not just the fact of a send.
   */
  await appendAudit({
    actor,
    action: 'desk.message.send',
    targetPath: `${COLLECTIONS.threads}/${threadId}`,
    targetId: threadId,
    before: {},
    after: { to: recipientUid, name: user.name ?? null, body },
  });

  revalidatePath('/messaging');
  revalidatePath(`/messaging/${threadId}`);

  return {
    ok: true,
    message: `Sent to ${user.name || 'them'}. It is in their app now — there is no push notification, so they see it when they next open it.`,
  };
}

/**
 * Clear the desk's own unread count on a thread.
 *
 * A dot path, so the attendee's side is untouched whatever it was when this
 * page was last rendered — the same shape `markThreadRead` uses in the app, and
 * the reason the rules can allow both sides to write one map.
 *
 * Membership is verified from `participantIds` on the document before writing.
 * The Admin SDK would happily zero a counter on a conversation between two
 * attendees, and a thread id arriving from a URL is not evidence of anything.
 */
export async function markDeskThreadReadAction(threadId: string): Promise<void> {
  await requireOrganizer();

  try {
    const ref = db().collection(COLLECTIONS.threads).doc(threadId);
    const doc = await ref.get();
    if (!doc.exists) return;

    const thread = doc.data() as ThreadDoc;
    if (!thread.participantIds?.includes(DESK_UID)) return;
    if ((thread.unread?.[DESK_UID] ?? 0) === 0) return;

    await ref.update({ [`unread.${DESK_UID}`]: 0 });
  } catch (err) {
    // Failing to clear a badge must never stop an organizer reading the thread.
    recordError('desk.message.read', err);
    return;
  }

  revalidatePath('/messaging');
}
