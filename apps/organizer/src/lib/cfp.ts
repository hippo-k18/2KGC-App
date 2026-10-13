import 'server-only';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  SUBMISSION_IDENTITY_DOC,
  TIME_ZONE,
  publicSiteOrigin,
  type CallCfpSettings,
  type CallDoc,
  type SpeakerDoc,
  type SpeakerProfileEditDoc,
  type SubmissionDoc,
  type SubmissionIdentityDoc,
  type TrackDoc,
} from '@kgc/shared';
import {
  DETAILS_DUE_DAYS,
  closeDecisionDate,
  closeDecisionOpen,
  closeDecisionPlan,
  dateIn,
  dayAfter,
  formatDay,
  holdE2ForClose,
  isIsoDate,
  isoWeek,
  nudgesDue,
  reminderDue,
  reviewQueue,
  sessionTypeLine,
  stillOpenRecipients,
  type CfpRow,
} from '@kgc/scripts/src/lib/cfp-core';
import {
  cfpAcceptNoticeMessage,
  cfpAcceptedMessage,
  cfpCloseAcceptedMessage,
  cfpCloseDeclinedMessage,
  cfpNudgeMessage,
  cfpStillOpenMessage,
  cfpWeeklyReminderMessage,
  sendCfpMessage,
  type SendOutcome,
} from '@kgc/scripts/src/lib/email';
import { speakerId as deriveSpeakerId } from '@kgc/scripts/src/lib/ids';
import { mintSpeakerToken } from '@kgc/scripts/src/lib/speaker-token';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';
import { decideSubmission, listSubmissions, type SubmissionRow } from './submissions';
import { ensureSpeakerContact } from './speaker-contacts';
import { fromWallClock } from './time';

/**
 * Min's call-for-papers flow on the dashboard (T249).
 *
 * The plan, in the order things happen: someone submits and gets E1 (the
 * website does that). It lands in François's list. On Thursday he is reminded.
 * He accepts, rejects or leaves each one. Accept, in one click, creates the
 * speaker, mails E2 with the self-service link and a date a week out, and
 * tells Min. Reject records and sends nothing. Five days after E2, E3 nudges
 * anyone who has sent nothing. In January one manual E6 goes to everyone
 * still waiting. Two weeks after the close one E4 send tells everyone else.
 *
 * Every rule about *what is due* is in `@kgc/scripts/src/lib/cfp-core.ts`,
 * pure and tested. This file reads, writes and sends.
 *
 * ── Sends are recorded on the submission, and never repeated ─────────────────
 *
 * E2, E3, E4 and E6 each stamp the submission when they go, and each is
 * selected only when its stamp is absent. That is what makes the hourly
 * scheduler safe to run twice, and the E4 and E6 buttons safe to press twice.
 */

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** A submission as the review list, the E4 screen and the status column read it. */
export interface CfpSubmission extends CfpRow {
  title: string;
  abstract: string;
  trackName?: string;
  durationMinutes?: number;
  name?: string;
  email?: string;
  organisation?: string;
  declineReason?: string;
  detailsDueAtMs?: number;
}

const ms = (t: unknown): number | undefined => {
  const v = t as { toMillis?: () => number } | undefined;
  return typeof v?.toMillis === 'function' ? v.toMillis() : undefined;
};

async function trackNames(): Promise<Map<string, string>> {
  const snap = await db().collection(COLLECTIONS.tracks).where('eventId', '==', EVENT_ID).get();
  return new Map(snap.docs.map((d) => [d.id, (d.data() as TrackDoc).name]));
}

/**
 * Every submission to a call, shaped for the CFP screens.
 *
 * Built on `listSubmissions`, so the author join and the in-memory ordering
 * are the ones every other CFA screen uses, then the fields this flow adds
 * are read off the raw documents in one more `getAll`.
 */
export async function listCfpSubmissions(callId: string): Promise<CfpSubmission[]> {
  const [rows, tracks] = await Promise.all([listSubmissions(callId), trackNames()]);
  if (rows.length === 0) return [];
  const docs = await db().getAll(
    ...rows.map((r) => db().collection(COLLECTIONS.submissions).doc(r.id)),
  );
  const raw = new Map(docs.map((d) => [d.id, d.data() as SubmissionDoc | undefined]));
  return rows.map((r) => toCfp(r, raw.get(r.id), tracks));
}

function toCfp(r: SubmissionRow, s: SubmissionDoc | undefined, tracks: Map<string, string>): CfpSubmission {
  return {
    id: r.id,
    status: r.status,
    sessionType: r.sessionType,
    submittedAtMs: r.submittedAtMs,
    title: r.title,
    abstract: r.abstract,
    trackName: r.trackId ? (tracks.get(r.trackId) ?? r.trackId) : undefined,
    durationMinutes: s?.durationMinutes,
    name: r.author?.name,
    email: r.author?.email,
    organisation: r.author?.affiliation,
    acceptance: s?.acceptance
      ? {
          e2SentAtMs: ms(s.acceptance.e2SentAt),
          nudgedAtMs: ms(s.acceptance.nudgedAt),
          e2HeldForE4: s.acceptance.e2HeldForE4,
        }
      : undefined,
    detailsDueAtMs: ms(s?.acceptance?.detailsDueAt),
    detailsReceivedAtMs: ms(s?.details?.receivedAt),
    closeDecisionSent: Boolean(s?.closeDecision),
    stillOpenSentAtMs: ms(s?.stillOpenSentAt),
    declineReason: s?.declineReason,
  };
}

export interface CfpCall {
  id: string;
  title: string;
  cfp: CallCfpSettings;
  timeZone: string;
  closesAtLocal: string;
  opensAtLocal: string;
  /** False on a call made before this flow, which then keeps its old behaviour. */
  enabled: boolean;
}

export async function getCfpCall(callId: string): Promise<CfpCall | null> {
  const snap = await db().collection(COLLECTIONS.calls).doc(callId).get();
  if (!snap.exists) return null;
  const c = snap.data() as CallDoc;
  if (c.eventId !== EVENT_ID) return null;
  return {
    id: snap.id,
    title: c.title,
    cfp: c.cfp ?? {},
    timeZone: c.timeZone ?? TIME_ZONE,
    closesAtLocal: c.closesAtLocal,
    opensAtLocal: c.opensAtLocal,
    enabled: Boolean(c.cfp),
  };
}

/** The call this flow is about: the published one with settings, else the newest published. */
export async function currentCfpCallId(): Promise<string | null> {
  const snap = await db().collection(COLLECTIONS.calls).where('eventId', '==', EVENT_ID).get();
  const calls = snap.docs.map((d) => ({ id: d.id, c: d.data() as CallDoc }));
  const pick =
    calls.find(({ c }) => c.status === 'published' && c.cfp) ??
    calls.find(({ c }) => c.status === 'published') ??
    calls.find(({ c }) => c.cfp);
  return pick?.id ?? null;
}

/** Where a dashboard link in an email points. The scheduler has no request to read a host from. */
export function dashboardOrigin(): string {
  return (process.env.ORGANIZER_PUBLIC_ORIGIN ?? 'https://dashboard.knowledgegraph.tech').replace(/\/$/, '');
}

const CFA = '/content/call-for-speakers-abstracts';
export const submissionDashboardUrl = (id: string) => `${dashboardOrigin()}${CFA}/submissions/${id}`;
export const reviewDashboardUrl = () => `${dashboardOrigin()}${CFA}/review`;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type CfpResult = { ok: true; message: string } | { ok: false; error: string };

export interface CfpSettingsInput {
  closeDate: string;
  decisionDate: string;
  sessionNoticeDate: string;
  acceptNoticeEmail: string;
  reviewerReminderEmail: string;
  abstractMinWords: string;
  abstractMaxWords: string;
  talkMinutes: string;
}

/**
 * Save the dates and addresses, and switch the call onto this flow.
 *
 * ⚠️ The close date is written through to `closesAtLocal` as 23:59 that day
 * in the call's zone, with `closesAt` derived exactly as `saveCall` derives
 * it. The page says "Submissions close Sunday 31 January 2027" from the one,
 * and the server refuses a late submission from the other, and those two must
 * never disagree. Clearing the close date leaves the deadline where it was.
 *
 * Blank means "not decided yet", and is stored as no field at all
 * (`FieldValue.delete()`, AGENTS.md gotcha 9) so the page leaves the sentence
 * out rather than printing an empty date.
 */
export async function saveCfpSettings(
  callId: string,
  input: CfpSettingsInput,
  actor: string,
): Promise<CfpResult> {
  const ref = db().collection(COLLECTIONS.calls).doc(callId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'That call does not exist.' };
  const call = snap.data() as CallDoc;

  const dates = {
    closeDate: input.closeDate.trim(),
    decisionDate: input.decisionDate.trim(),
    sessionNoticeDate: input.sessionNoticeDate.trim(),
  };
  for (const [k, v] of Object.entries(dates)) {
    if (v && !isIsoDate(v)) return { ok: false, error: `“${v}” is not a date. Use the date picker.` };
    void k;
  }
  if (dates.closeDate && dates.decisionDate && dates.decisionDate < dates.closeDate) {
    return { ok: false, error: 'The decision date is before the close date. Everyone is answered after the call closes.' };
  }
  if (dates.closeDate && `${dates.closeDate}T23:59` <= call.opensAtLocal) {
    return { ok: false, error: 'The close date is before the call opens.' };
  }

  const emails = {
    acceptNoticeEmail: input.acceptNoticeEmail.trim().toLowerCase(),
    reviewerReminderEmail: input.reviewerReminderEmail.trim().toLowerCase(),
  };
  for (const v of Object.values(emails)) {
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { ok: false, error: `“${v}” is not an email address.` };
  }

  const min = Number(input.abstractMinWords || 150);
  const max = Number(input.abstractMaxWords || 300);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
    return { ok: false, error: 'The abstract word limits need a minimum no larger than the maximum.' };
  }
  const minutes = input.talkMinutes
    .split(/[,\s]+/)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (minutes.length === 0) return { ok: false, error: 'Offer at least one talk length, in minutes.' };

  const put = (v: string) => v || FieldValue.delete();
  const write: Record<string, unknown> = {
    'cfp.closeDate': put(dates.closeDate),
    'cfp.decisionDate': put(dates.decisionDate),
    'cfp.sessionNoticeDate': put(dates.sessionNoticeDate),
    'cfp.acceptNoticeEmail': put(emails.acceptNoticeEmail),
    'cfp.reviewerReminderEmail': put(emails.reviewerReminderEmail),
    'cfp.abstractMinWords': min,
    'cfp.abstractMaxWords': max,
    'cfp.talkMinutes': minutes,
    updatedBy: actor,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (dates.closeDate) {
    const closesAtLocal = `${dates.closeDate}T23:59`;
    write.closesAtLocal = closesAtLocal;
    write.closesAt = fromWallClock(closesAtLocal, call.timeZone ?? TIME_ZONE);
  }
  await ref.update(write);

  await appendAudit({
    actor,
    action: 'call.cfpSettings',
    targetPath: `${COLLECTIONS.calls}/${callId}`,
    targetId: callId,
    before: { ...(call.cfp ?? {}), closesAtLocal: call.closesAtLocal },
    after: { ...dates, ...emails, min, max, minutes },
  });

  const moved = dates.closeDate && `${dates.closeDate}T23:59` !== call.closesAtLocal;
  return {
    ok: true,
    message: moved
      ? `Saved. Submissions now close at 23:59 on ${formatDay(dates.closeDate)}.`
      : 'Saved.',
  };
}

// ---------------------------------------------------------------------------
// Accept, in one click
// ---------------------------------------------------------------------------

/**
 * Accept a submission: record it, create or find the speaker, mail E2 with the
 * self-service link, and tell the onboarding inbox.
 *
 * ── The speaker is created unlisted ─────────────────────────────────────────
 *
 * `speakers` is what the website's /speakers page and the app's People tab
 * list. Min announces speakers the week after, with a bio and a photo, so the
 * record is created with `unlisted: true` and Speaker Manager lists it.
 * An author already on the bill (same derived id) is found, not duplicated,
 * and keeps whatever listing they had.
 *
 * ── E2 goes once ────────────────────────────────────────────────────────────
 *
 * A submission that already carries an acceptance with E2 sent is not mailed
 * again; pressing Accept twice is harmless. After an undo the acceptance stays
 * as history and a fresh Accept sends a fresh E2, because the author was never
 * told the undo happened and may be holding a dead deadline.
 */
export async function acceptCfp(input: {
  submissionId: string;
  actor: string;
  nowMs?: number;
}): Promise<CfpResult> {
  const now = input.nowMs ?? Date.now();
  try {
    const subRef = db().collection(COLLECTIONS.submissions).doc(input.submissionId);
    const at = Timestamp.fromMillis(now);

    /*
     * ── The claim (T252) ──────────────────────────────────────────────────
     *
     * Two organizers pressing Accept at once (the review row and the
     * submission page, say) both used to pass a plain "already accepted?"
     * read and both mailed E2 and Min (T250 F2). The decision and the
     * acceptance are now written in one transaction that first checks for
     * an acceptance; exactly one caller wins it and only the winner creates
     * the speaker and sends. The others get the ordinary "already accepted"
     * answer.
     */
    const claim = await db().runTransaction(async (tx) => {
      const snap = await tx.get(subRef);
      const s = snap.data() as SubmissionDoc | undefined;
      if (!s || s.eventId !== EVENT_ID) return { kind: 'refused' as const, error: 'That submission does not exist.' };
      if (s.status === 'draft') {
        return { kind: 'refused' as const, error: 'That submission is still a draft. Its author has not finished it.' };
      }
      if (s.status === 'withdrawn') {
        return { kind: 'refused' as const, error: 'The author withdrew this, so it cannot be accepted.' };
      }
      if (s.status === 'accepted' && s.acceptance) return { kind: 'already' as const, s };
      const round = (s.decision?.round ?? 0) + 1;
      tx.update(subRef, {
        status: 'accepted',
        decision: { by: input.actor, at, round },
        acceptance: { at, by: input.actor },
        updatedAt: at,
      });
      return { kind: 'won' as const, s, round };
    });

    if (claim.kind === 'refused') return { ok: false, error: claim.error };
    if (claim.kind === 'already') {
      const a = claim.s.acceptance!;
      return {
        ok: true,
        message: a.e2SentAt
          ? 'Already accepted, and the speaker already has their email.'
          : a.e2HeldForE4
            ? 'Already accepted. Their acceptance email waits for the decision send after the close.'
            : 'Already accepted. Their acceptance email did not go; send the link from Speaker Manager.',
      };
    }
    const before = claim.s;

    await appendAudit({
      actor: input.actor,
      action: 'submission.decide',
      targetPath: `${COLLECTIONS.submissions}/${input.submissionId}`,
      targetId: input.submissionId,
      before: { status: before.status, round: before.decision?.round ?? null },
      after: { status: 'accepted', round: claim.round, notified: true },
    });

    const call = await getCfpCall(before.callId);
    const identityRef = subRef.collection(SUBCOLLECTIONS.identity).doc(SUBMISSION_IDENTITY_DOC);
    const identity = (await identityRef.get()).data() as SubmissionIdentityDoc | undefined;
    if (!identity?.email) {
      return {
        ok: true,
        message:
          'Accepted, but there is no author on file for this submission, so no speaker was created ' +
          'and nobody was emailed.',
      };
    }

    const speakerDocId = identity.speakerId ?? deriveSpeakerId(identity.name, identity.affiliation);
    const speakerRef = db().collection(COLLECTIONS.speakers).doc(speakerDocId);
    const editRef = db().collection(COLLECTIONS.speakerProfileEdits).doc(speakerDocId);

    /*
     * `create()`, and losing that race is not an error: the same author's
     * second talk accepted at the same moment creates the same speaker id,
     * and the loser simply uses the record the winner wrote (T250 F2 showed
     * the raw ALREADY_EXISTS to the organizer).
     */
    let speakerCreated = false;
    const speaker: Omit<SpeakerDoc, 'createdAt' | 'updatedAt'> = {
      eventId: EVENT_ID,
      name: identity.name,
      ...(identity.affiliation ? { company: identity.affiliation } : {}),
      ...(identity.bio ? { bio: identity.bio } : {}),
      sessionIds: [],
      unlisted: true,
    };
    try {
      await speakerRef.create({ ...speaker, createdAt: at, updatedAt: at });
      speakerCreated = true;
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
    }
    // The address is server-only, never on the attendee-readable record (T252 F3).
    await ensureSpeakerContact(speakerDocId, identity.email);
    await identityRef.set({ speakerId: speakerDocId, updatedAt: at }, { merge: true });

    const cfp = call?.cfp ?? {};
    const tz = call?.timeZone ?? TIME_ZONE;
    const hold = holdE2ForClose(now, cfp, tz);
    const typeLine = sessionTypeLine(before.sessionType, before.durationMinutes);

    let e2: SendOutcome | 'held' = 'held';
    if (!hold) {
      e2 = await sendE2({
        submissionId: input.submissionId,
        to: identity.email,
        name: identity.name,
        title: before.title,
        typeLine,
        workshop: before.sessionType === 'workshop',
        speakerId: speakerDocId,
        cfp,
        tz,
        nowMs: now,
        actor: input.actor,
      });
    }

    const existingEdit = (await editRef.get()).data() as SpeakerProfileEditDoc | undefined;
    const keep = existingEdit?.status === 'submitted' || existingEdit?.status === 'approved';
    await editRef.set(
      {
        eventId: EVENT_ID,
        speakerId: speakerDocId,
        submissionIds: FieldValue.arrayUnion(input.submissionId),
        ...(e2 === 'sent'
          ? { status: keep ? existingEdit!.status : 'sent', linkSentAt: at, linkSentTo: identity.email }
          : {}),
        updatedAt: at,
        ...(existingEdit ? {} : { createdAt: at }),
      },
      { merge: true },
    );

    await subRef.update({
      'acceptance.speakerId': speakerDocId,
      ...(e2 === 'sent'
        ? {
            'acceptance.e2SentAt': at,
            'acceptance.detailsDueAt': Timestamp.fromMillis(now + DETAILS_DUE_DAYS * 86_400_000),
          }
        : {}),
      ...(hold ? { 'acceptance.e2HeldForE4': true } : {}),
      updatedAt: at,
    });

    const tracks = before.trackId ? await trackNames() : new Map<string, string>();
    let notice: SendOutcome | 'unset' = 'unset';
    if (cfp.acceptNoticeEmail) {
      notice = await sendCfpMessage(db(), {
        to: cfp.acceptNoticeEmail,
        template: 'cfp-accept-notice',
        submissionId: input.submissionId,
        actor: input.actor,
        message: cfpAcceptNoticeMessage({
          speakerName: identity.name,
          organisation: identity.affiliation,
          title: before.title,
          track: before.trackId ? (tracks.get(before.trackId) ?? before.trackId) : undefined,
          typeLine,
          acceptedDay: formatDay(dateIn(now, tz)) ?? '',
          link: submissionDashboardUrl(input.submissionId),
          e2: e2 === 'sent' ? 'sent' : e2 === 'held' ? 'held' : 'not sent',
        }),
      });
    }

    await appendAudit({
      actor: input.actor,
      action: 'submission.cfpAccept',
      targetPath: `${COLLECTIONS.submissions}/${input.submissionId}`,
      targetId: input.submissionId,
      before: { status: before.status },
      after: { status: 'accepted', speakerId: speakerDocId, e2, notice, speakerCreated },
    });

    const parts = [`Accepted. ${identity.name} is a speaker${speakerCreated ? ', not yet listed on the website' : ' already'}.`];
    if (e2 === 'sent') parts.push(`The acceptance email went to ${identity.email}.`);
    else if (e2 === 'held') parts.push('The call has closed, so their acceptance email waits for the decision send.');
    else if (e2 === 'skipped') parts.push(`Email is not switched on, so ${identity.email} was not told.`);
    else parts.push(`The acceptance email to ${identity.email} failed. Send the link from Speaker Manager.`);
    if (notice === 'unset') parts.push('No onboarding address is set, so nobody else was told.');
    else if (notice !== 'sent') parts.push('The notice to onboarding did not go.');
    return { ok: true, message: parts.join(' ') };
  } catch (err) {
    // Recorded for us, and never shown raw: a Firestore status line tells an
    // organizer nothing they can act on (T250).
    recordError('cfp.accept', err);
    return {
      ok: false,
      error:
        'Something went wrong part way through accepting this. Open the submission to see what was ' +
        'recorded before pressing Accept again.',
    };
  }
}

async function sendE2(input: {
  submissionId: string;
  to: string;
  name: string;
  title: string;
  typeLine: string;
  workshop: boolean;
  speakerId: string;
  cfp: CallCfpSettings;
  tz: string;
  nowMs: number;
  actor?: string;
}): Promise<SendOutcome> {
  return sendCfpMessage(db(), {
    to: input.to,
    template: 'cfp-accepted',
    submissionId: input.submissionId,
    actor: input.actor,
    message: cfpAcceptedMessage({
      name: input.name,
      title: input.title,
      typeLine: input.typeLine,
      workshop: input.workshop,
      link: `${publicSiteOrigin()}/speaker/${mintSpeakerToken(input.speakerId)}`,
      dueDay: dayAfter(input.nowMs, DETAILS_DUE_DAYS, input.tz),
      sessionNoticeDay: formatDay(input.cfp.sessionNoticeDate),
    }),
  });
}

/** Reject: the decision is recorded and nothing is sent. E4 tells them after the close. */
export async function rejectCfp(input: { submissionId: string; actor: string }): Promise<CfpResult> {
  const r = await decideSubmission({ id: input.submissionId, accept: false, notify: false, actor: input.actor });
  if (!r.ok) return r;
  return { ok: true, message: 'Rejected. Nothing was sent; the author hears with everyone else after the close.' };
}

/** "Finish this pass": what arrives after now is new on the next visit. */
export async function finishPass(callId: string, actor: string, nowMs = Date.now()): Promise<CfpResult> {
  await db().collection(COLLECTIONS.calls).doc(callId).update({
    'cfp.lastPassAtMs': nowMs,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await appendAudit({
    actor,
    action: 'call.cfpPass',
    targetPath: `${COLLECTIONS.calls}/${callId}`,
    targetId: callId,
    before: {},
    after: { lastPassAtMs: nowMs },
  });
  return { ok: true, message: 'Pass finished. Anything you left stays on the list for next week.' };
}

export { reviewQueue };

// ---------------------------------------------------------------------------
// E4 and E6, the two organizer-triggered sends
// ---------------------------------------------------------------------------

/** The one-line reason the declined E4 carries. Editable until E4 goes. */
export async function saveDeclineReason(submissionId: string, reason: string, actor: string): Promise<CfpResult> {
  const ref = db().collection(COLLECTIONS.submissions).doc(submissionId);
  const sub = (await ref.get()).data() as SubmissionDoc | undefined;
  if (!sub) return { ok: false, error: 'That submission does not exist.' };
  if (sub.closeDecision) return { ok: false, error: 'The decision email has already gone, so the reason can no longer change.' };
  const line = reason.trim().replace(/\s+/g, ' ').slice(0, 300);
  await ref.update({ declineReason: line || FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
  await appendAudit({
    actor,
    action: 'submission.declineReason',
    targetPath: `${COLLECTIONS.submissions}/${submissionId}`,
    targetId: submissionId,
    before: { declineReason: sub.declineReason ?? null },
    after: { declineReason: line || null },
  });
  return { ok: true, message: 'Saved.' };
}

/**
 * E4. The declined version to every rejection not yet told, and the accepted
 * version, followed by E2, to every acceptance made after the close.
 * Undecided submissions are skipped and counted.
 */
export async function sendCloseDecisions(input: { callId: string; actor: string; nowMs?: number }): Promise<CfpResult> {
  const now = input.nowMs ?? Date.now();
  const call = await getCfpCall(input.callId);
  if (!call) return { ok: false, error: 'That call does not exist.' };
  // Enforced here as well as by the disabled button (T252).
  if (!closeDecisionOpen(now, call.cfp, call.timeZone)) {
    const from = closeDecisionDate(call.cfp);
    return {
      ok: false,
      error: from
        ? `The decision email can go from ${formatDay(from)}, two weeks after the close. Nothing was sent.`
        : 'Set the close date first. The decision email goes two weeks after it. Nothing was sent.',
    };
  }
  const rows = await listCfpSubmissions(input.callId);
  const plan = closeDecisionPlan(rows);
  const at = Timestamp.fromMillis(now);
  let declined = 0;
  let accepted = 0;
  let failed = 0;
  let e2Failed = 0;

  for (const r of plan.declined) {
    if (!r.email) continue;
    const ref = db().collection(COLLECTIONS.submissions).doc(r.id);
    // Claimed before it is sent, so a second press or a second tab skips it.
    const mine = await claimSend(
      ref,
      (d) => d?.status === 'rejected' && !d?.closeDecision,
      {
        closeDecision: { version: 'declined', ...(r.declineReason ? { reason: r.declineReason } : {}), sentAt: at, by: input.actor },
        updatedAt: at,
      },
    );
    if (!mine) continue;
    const outcome = await sendCfpMessage(db(), {
      to: r.email,
      template: 'cfp-decision-declined',
      submissionId: r.id,
      actor: input.actor,
      message: cfpCloseDeclinedMessage({ name: r.name, title: r.title, reason: r.declineReason }),
    });
    if (outcome !== 'sent') {
      await releaseSend(ref, { closeDecision: FieldValue.delete() });
      failed++;
      continue;
    }
    declined++;
  }

  for (const r of plan.accepted) {
    if (!r.email) continue;
    const ref = db().collection(COLLECTIONS.submissions).doc(r.id);
    const mine = await claimSend(
      ref,
      (d) => d?.status === 'accepted' && d?.acceptance?.e2HeldForE4 === true && !d?.closeDecision,
      { closeDecision: { version: 'accepted', sentAt: at, by: input.actor }, updatedAt: at },
    );
    if (!mine) continue;
    const outcome = await sendCfpMessage(db(), {
      to: r.email,
      template: 'cfp-decision-accepted',
      submissionId: r.id,
      actor: input.actor,
      message: cfpCloseAcceptedMessage({ name: r.name, title: r.title }),
    });
    if (outcome !== 'sent') {
      await releaseSend(ref, { closeDecision: FieldValue.delete() });
      failed++;
      continue;
    }
    const sub = (await db().collection(COLLECTIONS.submissions).doc(r.id).get()).data() as SubmissionDoc;
    const speakerDocId = sub.acceptance?.speakerId;
    // E2 follows, as E4's accepted version promises, and the week starts now.
    const e2 = speakerDocId
      ? await sendE2({
          submissionId: r.id,
          to: r.email,
          name: r.name ?? '',
          title: r.title,
          typeLine: sessionTypeLine(r.sessionType, r.durationMinutes),
          workshop: r.sessionType === 'workshop',
          speakerId: speakerDocId,
          cfp: call.cfp,
          tz: call.timeZone,
          nowMs: now,
          actor: input.actor,
        })
      : 'failed';
    await ref.update({
      ...(e2 === 'sent'
        ? {
            'acceptance.e2SentAt': at,
            'acceptance.detailsDueAt': Timestamp.fromMillis(now + DETAILS_DUE_DAYS * 86_400_000),
            'acceptance.e2HeldForE4': FieldValue.delete(),
          }
        : {}),
      updatedAt: at,
    });
    if (e2 !== 'sent') e2Failed++;
    accepted++;
  }

  await appendAudit({
    actor: input.actor,
    action: 'call.cfpCloseDecisions',
    targetPath: `${COLLECTIONS.calls}/${input.callId}`,
    targetId: input.callId,
    before: {},
    after: { declined, accepted, failed, undecided: plan.undecided.length },
  });

  return {
    ok: true,
    message:
      `Sent ${declined} “not accepted” and ${accepted} “accepted” email${declined + accepted === 1 ? '' : 's'}.` +
      (failed ? ` ${failed} did not go; they stay on the list and pressing Send again retries only those.` : '') +
      (e2Failed
        ? ` ${e2Failed} acceptance email${e2Failed === 1 ? '' : 's'} with the details link did not follow. Send ${e2Failed === 1 ? 'that link' : 'those links'} from Speaker Manager.`
        : '') +
      (plan.undecided.length ? ` ${plan.undecided.length} still undecided were left alone.` : ''),
  };
}

/** E6. Once, to everyone still in the queue. */
export async function sendStillOpen(input: { callId: string; actor: string; nowMs?: number }): Promise<CfpResult> {
  const now = input.nowMs ?? Date.now();
  const call = await getCfpCall(input.callId);
  if (!call) return { ok: false, error: 'That call does not exist.' };
  const rows = stillOpenRecipients(await listCfpSubmissions(input.callId));
  const at = Timestamp.fromMillis(now);
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    if (!r.email) continue;
    const ref = db().collection(COLLECTIONS.submissions).doc(r.id);
    const mine = await claimSend(
      ref,
      (d) => (d?.status === 'submitted' || d?.status === 'under-review') && !d?.stillOpenSentAt,
      { stillOpenSentAt: at },
    );
    if (!mine) continue;
    const outcome = await sendCfpMessage(db(), {
      to: r.email,
      template: 'cfp-still-open',
      submissionId: r.id,
      actor: input.actor,
      message: cfpStillOpenMessage({ name: r.name, title: r.title, decisionDay: formatDay(call.cfp.decisionDate) }),
    });
    if (outcome === 'sent') sent++;
    else {
      await releaseSend(ref, { stillOpenSentAt: FieldValue.delete() });
      failed++;
    }
  }
  await appendAudit({
    actor: input.actor,
    action: 'call.cfpStillOpen',
    targetPath: `${COLLECTIONS.calls}/${input.callId}`,
    targetId: input.callId,
    before: {},
    after: { sent, failed },
  });
  return {
    ok: true,
    message: `Sent to ${sent} author${sent === 1 ? '' : 's'}.${failed ? ` ${failed} did not go and stay on the list.` : ''}`,
  };
}

// ---------------------------------------------------------------------------
// The hourly run: E3 and the Thursday reminder
// ---------------------------------------------------------------------------

export interface ScheduleReport {
  calls: number;
  nudged: string[];
  reminded: string[];
  failures: string[];
}

/**
 * Everything time-driven, for every call on this flow. Safe to run as often
 * as the timer likes: each send is stamped and selected only while unstamped.
 * `nowMs` is a parameter so tests can move the clock.
 */
export async function runCfpSchedule(nowMs: number = Date.now()): Promise<ScheduleReport> {
  const report: ScheduleReport = { calls: 0, nudged: [], reminded: [], failures: [] };
  const snap = await db().collection(COLLECTIONS.calls).where('eventId', '==', EVENT_ID).get();

  for (const doc of snap.docs) {
    const call = doc.data() as CallDoc;
    if (!call.cfp || call.status !== 'published') continue;
    report.calls++;
    const tz = call.timeZone ?? TIME_ZONE;
    const rows = await listCfpSubmissions(doc.id);

    for (const r of nudgesDue(rows, nowMs)) {
      if (!r.email || r.acceptance?.e2SentAtMs === undefined) continue;
      const ref = db().collection(COLLECTIONS.submissions).doc(r.id);
      const sub = (await ref.get()).data() as SubmissionDoc;
      const speakerDocId = sub.acceptance?.speakerId;
      if (!speakerDocId) continue;
      const mine = await claimSend(
        ref,
        (d) => d?.status === 'accepted' && !d?.acceptance?.nudgedAt && !d?.details,
        { 'acceptance.nudgedAt': Timestamp.fromMillis(nowMs) },
      );
      if (!mine) continue;
      const outcome = await sendCfpMessage(db(), {
        to: r.email,
        template: 'cfp-nudge',
        submissionId: r.id,
        message: cfpNudgeMessage({
          name: r.name,
          title: r.title,
          workshop: r.sessionType === 'workshop',
          link: `${publicSiteOrigin()}/speaker/${mintSpeakerToken(speakerDocId)}`,
          dueDay: dayAfter(r.acceptance.e2SentAtMs, DETAILS_DUE_DAYS, tz),
        }),
      });
      if (outcome === 'sent') report.nudged.push(r.id);
      else {
        await releaseSend(ref, { 'acceptance.nudgedAt': FieldValue.delete() });
        report.failures.push(`E3 ${r.id}: ${outcome}`);
      }
    }

    const to = call.cfp.reviewerReminderEmail;
    const week = isoWeek(nowMs, tz);
    if (
      to &&
      reminderDue(nowMs, tz, call.cfp.lastReminderWeek) &&
      (await claimSend(
        doc.ref,
        (d) => reminderDue(nowMs, tz, (d as CallDoc | undefined)?.cfp?.lastReminderWeek),
        { 'cfp.lastReminderWeek': week },
      ))
    ) {
      const queue = reviewQueue(rows, call.cfp.lastPassAtMs);
      const outcome = await sendCfpMessage(db(), {
        to,
        template: 'cfp-weekly-reminder',
        message: cfpWeeklyReminderMessage({
          name: await reviewerName(to),
          fresh: queue.filter((q) => q.isNew).length,
          open: queue.length,
          link: reviewDashboardUrl(),
        }),
      });
      if (outcome === 'sent') report.reminded.push(doc.id);
      else {
        await releaseSend(doc.ref, {
          'cfp.lastReminderWeek': call.cfp.lastReminderWeek ?? FieldValue.delete(),
        });
        report.failures.push(`reminder ${doc.id}: ${outcome}`);
      }
    }
  }
  return report;
}

/** The reviewer's name as the team list spells it, for the greeting. Absent means "Hi,". */
async function reviewerName(email: string): Promise<string | undefined> {
  try {
    const snap = await db()
      .collection(COLLECTIONS.teamMembers)
      .where('email', '==', email.toLowerCase())
      .limit(1)
      .get();
    return (snap.docs[0]?.data() as { name?: string } | undefined)?.name;
  } catch {
    return undefined;
  }
}

/** The rolling-review facts for one submission's page. */
export interface CfpDetail {
  durationMinutes?: number;
  acceptance?: {
    speakerId?: string;
    e2SentAtMs?: number;
    detailsDueAtMs?: number;
    nudgedAtMs?: number;
    e2HeldForE4?: boolean;
  };
  details?: { title?: string; description?: string; outline?: string; install?: string; receivedAtMs?: number };
  closeDecision?: { version: 'accepted' | 'declined'; reason?: string; sentAtMs?: number };
  declineReason?: string;
  stillOpenSentAtMs?: number;
}

export async function getCfpDetail(submissionId: string): Promise<CfpDetail | null> {
  const s = (await db().collection(COLLECTIONS.submissions).doc(submissionId).get()).data() as
    | SubmissionDoc
    | undefined;
  if (!s) return null;
  return {
    durationMinutes: s.durationMinutes,
    acceptance: s.acceptance
      ? {
          speakerId: s.acceptance.speakerId,
          e2SentAtMs: ms(s.acceptance.e2SentAt),
          detailsDueAtMs: ms(s.acceptance.detailsDueAt),
          nudgedAtMs: ms(s.acceptance.nudgedAt),
          e2HeldForE4: s.acceptance.e2HeldForE4,
        }
      : undefined,
    details: s.details
      ? {
          title: s.details.title,
          description: s.details.description,
          outline: s.details.outline,
          install: s.details.install,
          receivedAtMs: ms(s.details.receivedAt),
        }
      : undefined,
    closeDecision: s.closeDecision
      ? { version: s.closeDecision.version, reason: s.closeDecision.reason, sentAtMs: ms(s.closeDecision.sentAt) }
      : undefined,
    declineReason: s.declineReason,
    stillOpenSentAtMs: ms(s.stillOpenSentAt),
  };
}

/** Firestore's ALREADY_EXISTS, from `create()` on a document someone else just wrote. */
function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === 6 || code === 'already-exists' || /ALREADY_EXISTS/.test(String((err as Error)?.message));
}

/**
 * Claim one send on one document: run `isFree` inside a transaction and, if
 * it holds, write `stamp`. True means this caller owns the send. Used for E3,
 * E4, E6 and the reminder so that two runs at once send once (T250 F2).
 */
async function claimSend(
  ref: FirebaseFirestore.DocumentReference,
  isFree: (data: FirebaseFirestore.DocumentData | undefined) => boolean,
  stamp: Record<string, unknown>,
): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!isFree(snap.data())) return false;
    tx.update(ref, stamp);
    return true;
  });
}

/** Give a claim back after the send it guarded did not go, so a retry can send. */
async function releaseSend(ref: FirebaseFirestore.DocumentReference, fields: Record<string, unknown>): Promise<void> {
  try {
    await ref.update(fields);
  } catch (err) {
    recordError('cfp.release', err);
  }
}
