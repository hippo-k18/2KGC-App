import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  publicSiteOrigin,
  type SessionDoc,
  type SpeakerDoc,
  type SpeakerProfileDraft,
  type SpeakerProfileEditDoc,
  type SpeakerProfileEditStatus,
} from '@kgc/shared';
import { emailEnabled, sendSpeakerProfileRequest } from '@kgc/scripts/src/lib/email';
import { mintSpeakerToken } from '@kgc/scripts/src/lib/speaker-token';
import {
  approvalPlan,
  draftChanges,
  trackerCounts,
  type ProfileChange,
  type SpeakerProfileNow,
  type TrackerCounts,
} from '@kgc/scripts/src/lib/speaker-portal-core';
import { appendAudit } from './audit';
import { db } from './firestore';
import { recordError } from './errors';

/**
 * Speaker self-service, from the organizer's side: mint a link, mail it, watch
 * who has opened it, and decide what they sent back.
 *
 * ── Why a speaker cannot simply edit their own record ───────────────────────
 *
 * `speakers/{id}` is what `SessionDoc.speakerNames` is cached from, what the
 * public website renders and what the app's people tab lists. A write that
 * reached it from a mailed link would put unreviewed text about a named person
 * on a public page with nobody in between. So the link writes to
 * `speakerProfileEdits/{speakerId}` and nothing else, and an organizer pressing
 * Approve is the only thing in this file that touches a speaker or a session.
 *
 * ── The arithmetic is next door ─────────────────────────────────────────────
 *
 * `@kgc/scripts/src/lib/speaker-portal-core.ts` holds the diffing, the write
 * plan and the tracker counts, because the website's own portal has to agree
 * with this file about all three and `server-only` above means Vitest cannot
 * load this one at all.
 */

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** One speaker's self-service state, as the Speaker Manager screen reads it. */
export interface PortalRow {
  speakerId: string;
  status?: SpeakerProfileEditStatus;
  linkSentAtMs?: number;
  linkSentTo?: string;
  openedAtMs?: number;
  submittedAtMs?: number;
  decidedAtMs?: number;
  decidedBy?: string;
  note?: string;
  linksValidFrom?: number;
  draft?: SpeakerProfileDraft;
}

const millis = (t: unknown): number | undefined => {
  const v = t as { toMillis?: () => number } | undefined;
  return typeof v?.toMillis === 'function' ? v.toMillis() : undefined;
};

/**
 * Every edit document, keyed by speaker.
 *
 * One unfiltered read of a collection that holds at most one document per
 * speaker — a hundred and fifty rows at this conference — rather than a query
 * per status. It also means no composite index: `eventId` alone is a
 * single-field index, which Firestore maintains without being told to.
 */
export async function listPortalRows(): Promise<Map<string, PortalRow>> {
  const snap = await db()
    .collection(COLLECTIONS.speakerProfileEdits)
    .where('eventId', '==', EVENT_ID)
    .get();

  return new Map(
    snap.docs.map((d) => {
      const e = d.data() as SpeakerProfileEditDoc;
      return [
        d.id,
        {
          speakerId: d.id,
          status: e.status,
          linkSentAtMs: millis(e.linkSentAt),
          linkSentTo: e.linkSentTo,
          openedAtMs: millis(e.openedAt),
          submittedAtMs: millis(e.submittedAt),
          decidedAtMs: millis(e.decidedAt),
          decidedBy: e.decidedBy,
          note: e.note,
          linksValidFrom: e.linksValidFrom,
          draft: e.draft,
        } satisfies PortalRow,
      ];
    }),
  );
}

export { trackerCounts };
export type { TrackerCounts };

/**
 * A working link to one speaker's page on the website, minted now.
 *
 * `publicSiteOrigin()` rather than the requesting host, for the reason
 * `reviewerLink` gives: the dashboard has no request to read at the moment it
 * mails one, and a link built from a `Host` header is a link built from
 * whatever a proxy said.
 */
export const speakerPortalLink = (speakerId: string) =>
  `${publicSiteOrigin()}/speaker/${mintSpeakerToken(speakerId)}`;

/**
 * Whether a link can be minted at all.
 *
 * `mintSpeakerToken` throws when neither `WEB_SPEAKER_SECRET` nor
 * `WEB_ORDER_SECRET` is configured. On such a deployment the screen has to say
 * so in one sentence rather than fail inside a button press.
 */
export function speakerLinksAvailable(): boolean {
  try {
    mintSpeakerToken('probe');
    return true;
  } catch (err) {
    recordError('speaker-portal.token', err);
    return false;
  }
}

/** Whether pressing Send now would leave this server as an email. */
export const speakerEmailAvailable = (): boolean => emailEnabled();

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface PortalResult {
  ok: boolean;
  message?: string;
  error?: string;
}

/**
 * What the request mail says is missing, in the words a speaker would use.
 *
 * Built from the record rather than from the draft, because this is the sentence
 * that makes somebody act: "we are missing a bio and a photo for you" is a task,
 * and "please review your profile" is an email to deal with later.
 */
function missingLabel(s: SpeakerDoc): string | undefined {
  const gaps: string[] = [];
  if (!s.bio?.trim()) gaps.push('a bio');
  if (!s.photoURL?.trim()) gaps.push('a photo');
  if (gaps.length === 0) return undefined;
  return gaps.join(' and ');
}

/**
 * Mail one speaker their link, and record that it went.
 *
 * The same button is the reminder, and each press mints a fresh link — so an
 * organizer never has to think about which of somebody's links is the live one.
 *
 * ⚠️ `status` is only ever moved *forward* to `sent`. Re-sending to somebody who
 * has already submitted must not reset the tracker to "waiting for them", which
 * would hide a submission that is actually waiting for the organizer.
 */
export async function sendPortalLink(input: {
  speakerId: string;
  note?: string;
  actor: string;
}): Promise<PortalResult> {
  try {
    const ref = db().collection(COLLECTIONS.speakers).doc(input.speakerId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: 'That speaker does not exist.' };

    const speaker = snap.data() as SpeakerDoc;
    const to = speaker.contactEmail?.trim();
    if (!to) {
      return {
        ok: false,
        error: `There is no address on file for ${speaker.name}, so there is nowhere to send the link. Add one on their record first.`,
      };
    }

    const editRef = db().collection(COLLECTIONS.speakerProfileEdits).doc(input.speakerId);
    const existing = (await editRef.get()).data() as SpeakerProfileEditDoc | undefined;

    const sessionTitles = await titlesFor(speaker.sessionIds ?? []);

    await sendSpeakerProfileRequest(db(), {
      to,
      name: speaker.name,
      link: speakerPortalLink(input.speakerId),
      sessionTitles,
      missingLabel: missingLabel(speaker),
      note: input.note?.trim() || undefined,
      actor: input.actor,
    });

    /*
     * Stamped only when a mail actually left. "Link sent" on the tracker must
     * not be true of somebody who was never written to — that is the difference
     * between a chase list and a list that says the chase is done.
     */
    if (emailEnabled()) {
      const held: SpeakerProfileEditStatus | undefined = existing?.status;
      const status: SpeakerProfileEditStatus =
        held === 'submitted' || held === 'approved' ? held : 'sent';

      await editRef.set(
        {
          eventId: EVENT_ID,
          speakerId: input.speakerId,
          status,
          linkSentAt: FieldValue.serverTimestamp(),
          linkSentTo: to,
          updatedAt: FieldValue.serverTimestamp(),
          ...(existing ? {} : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      );
    }

    await appendAudit({
      actor: input.actor,
      action: 'speaker.portalSend',
      targetPath: `${COLLECTIONS.speakers}/${input.speakerId}`,
      targetId: input.speakerId,
      before: {},
      after: { to, emailed: emailEnabled() },
    });

    return {
      ok: true,
      message: emailEnabled()
        ? `Link sent to ${to}.`
        : `Email is not switched on yet, so nothing was sent to ${to}. Copy the link and send it yourself.`,
    };
  } catch (err) {
    recordError('speaker-portal.send', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not send the link.' };
  }
}

async function titlesFor(sessionIds: string[]): Promise<string[]> {
  if (sessionIds.length === 0) return [];
  const docs = await db().getAll(
    ...sessionIds.slice(0, 20).map((id) => db().collection(COLLECTIONS.sessions).doc(id)),
  );
  return docs.filter((d) => d.exists).map((d) => (d.data() as SessionDoc).title);
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

/** What an organizer reads before pressing Approve. */
export interface PendingSubmission {
  speakerId: string;
  speakerName: string;
  submittedAtMs?: number;
  changes: ProfileChange[];
  /** Session titles for the `slides:{id}` rows, so a change names a talk. */
  sessionTitles: Record<string, string>;
}

/**
 * Everything waiting for a decision, with the diff already worked out.
 *
 * The diff is computed here against the record as it stands *now* rather than
 * against whatever the speaker saw, because an organizer may have edited the
 * profile by hand in between and the only useful question on this panel is
 * "what would pressing Approve change".
 */
export async function pendingSubmissions(): Promise<PendingSubmission[]> {
  const rows = await listPortalRows();
  const waiting = [...rows.values()].filter((r) => r.status === 'submitted' && r.draft);
  if (waiting.length === 0) return [];

  const speakers = await db().getAll(
    ...waiting.map((r) => db().collection(COLLECTIONS.speakers).doc(r.speakerId)),
  );

  const sessionIds = new Set<string>();
  for (const doc of speakers) {
    for (const id of (doc.data() as SpeakerDoc | undefined)?.sessionIds ?? []) sessionIds.add(id);
  }
  const sessions = sessionIds.size
    ? await db().getAll(
        ...[...sessionIds].map((id) => db().collection(COLLECTIONS.sessions).doc(id)),
      )
    : [];
  const sessionById = new Map(
    sessions.filter((d) => d.exists).map((d) => [d.id, d.data() as SessionDoc]),
  );

  const out: PendingSubmission[] = [];
  for (const [i, row] of waiting.entries()) {
    const doc = speakers[i];
    if (!doc?.exists) continue;
    const speaker = doc.data() as SpeakerDoc;
    out.push({
      speakerId: row.speakerId,
      speakerName: speaker.name,
      submittedAtMs: row.submittedAtMs,
      changes: draftChanges(profileNow(speaker, sessionById), row.draft ?? {}),
      sessionTitles: Object.fromEntries(
        (speaker.sessionIds ?? []).map((id) => [id, sessionById.get(id)?.title ?? id]),
      ),
    });
  }

  return out.sort((a, b) => (a.submittedAtMs ?? 0) - (b.submittedAtMs ?? 0));
}

function profileNow(speaker: SpeakerDoc, sessionById: Map<string, SessionDoc>): SpeakerProfileNow {
  return {
    title: speaker.title,
    company: speaker.company,
    bio: speaker.bio,
    photoURL: speaker.photoURL,
    social: speaker.social,
    slides: Object.fromEntries(
      (speaker.sessionIds ?? []).map((id) => [id, sessionById.get(id)?.slidesUrl ?? '']),
    ),
  };
}

/**
 * Approve what a speaker sent: write it onto their record and onto their
 * sessions.
 *
 * ⚠️ `FieldValue.delete()` rather than leaving a key out. The stores run with
 * `ignoreUndefinedProperties`, so an `undefined` on a merge write stores no key
 * and the old value survives while the action says "Approved" — AGENTS.md
 * gotcha 9, found live in this repo three times. `approvalPlan` returns `null`
 * for a clearance and this is where it becomes a sentinel built by *this* app's
 * copy of `firebase-admin`, which is the only copy this store accepts.
 *
 * The session writes go in the same batch as the speaker write. Half an
 * approval is worse than none: an organizer who saw "Approved" and later finds
 * the bio changed but the slides link missing has no way to tell which half
 * failed.
 */
export async function approveSubmission(input: {
  speakerId: string;
  actor: string;
}): Promise<PortalResult> {
  try {
    const editRef = db().collection(COLLECTIONS.speakerProfileEdits).doc(input.speakerId);
    const speakerRef = db().collection(COLLECTIONS.speakers).doc(input.speakerId);
    const [editSnap, speakerSnap] = await Promise.all([editRef.get(), speakerRef.get()]);

    const edit = editSnap.data() as SpeakerProfileEditDoc | undefined;
    if (!edit || edit.status !== 'submitted' || !edit.draft) {
      return { ok: false, error: 'There is nothing waiting for a decision on this speaker.' };
    }
    if (!speakerSnap.exists) return { ok: false, error: 'That speaker does not exist.' };

    const speaker = speakerSnap.data() as SpeakerDoc;
    const sessionIds = speaker.sessionIds ?? [];
    const sessionDocs = sessionIds.length
      ? await db().getAll(
          ...sessionIds.map((id) => db().collection(COLLECTIONS.sessions).doc(id)),
        )
      : [];
    const sessionById = new Map(
      sessionDocs.filter((d) => d.exists).map((d) => [d.id, d.data() as SessionDoc]),
    );

    const plan = approvalPlan(profileNow(speaker, sessionById), edit.draft, [...sessionById.keys()]);

    const batch = db().batch();
    const speakerWrite: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    for (const [field, value] of Object.entries(plan.speaker)) {
      speakerWrite[field] = value === null ? FieldValue.delete() : value;
    }
    batch.set(speakerRef, speakerWrite, { merge: true });

    for (const [sessionId, url] of Object.entries(plan.sessions)) {
      batch.set(
        db().collection(COLLECTIONS.sessions).doc(sessionId),
        {
          slidesUrl: url === null ? FieldValue.delete() : url,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    batch.set(
      editRef,
      {
        status: 'approved',
        decidedAt: FieldValue.serverTimestamp(),
        decidedBy: input.actor,
        note: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await batch.commit();

    await appendAudit({
      actor: input.actor,
      action: 'speaker.portalApprove',
      targetPath: `${COLLECTIONS.speakers}/${input.speakerId}`,
      targetId: input.speakerId,
      /*
       * The whole plan, both sides. This is the one action in this feature that
       * changes a public page, and the entry has to answer "what did the
       * speaker actually change" months later, when the draft has been
       * overwritten by their next submission.
       */
      before: {},
      after: {
        fields: Object.keys(plan.speaker),
        sessions: Object.keys(plan.sessions),
        ...(plan.heldPhotoURL ? { heldPhotoURL: plan.heldPhotoURL } : {}),
      },
    });

    const n = Object.keys(plan.speaker).length + Object.keys(plan.sessions).length;
    /*
     * The photo is the one thing an approval does not publish, so it is the one
     * thing the message has to name. Approving and then finding the headshot is
     * still the old one, with nothing having said so, is the failure this
     * sentence exists to prevent.
     */
    const photo = plan.heldPhotoURL
      ? ' The photo link was not published. Open it, save the picture, and add it on this speaker in Speaker Manager.'
      : '';
    return {
      ok: true,
      message:
        n === 0
          ? `Nothing in ${speaker.name}'s profile was different, so nothing changed. It is marked as done.${photo}`
          : `Approved. ${speaker.name}'s profile is live on the website and in the app.${photo}`,
    };
  } catch (err) {
    recordError('speaker-portal.approve', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not approve that.' };
  }
}

/**
 * Turn a submission down, keeping what was sent.
 *
 * The draft is kept rather than deleted, for the reason `moderation.delete`
 * keeps the post it removes: "what did they send that we said no to" is the
 * first question asked when the speaker rings up, and a record that has been
 * cleared cannot answer it. `note` is the organizer's own record of why, and it
 * is not mailed to anybody — this dashboard has no reply channel to a speaker,
 * and inventing one silently would be the worse of the two.
 */
export async function rejectSubmission(input: {
  speakerId: string;
  note?: string;
  actor: string;
}): Promise<PortalResult> {
  try {
    const editRef = db().collection(COLLECTIONS.speakerProfileEdits).doc(input.speakerId);
    const edit = (await editRef.get()).data() as SpeakerProfileEditDoc | undefined;
    if (!edit || edit.status !== 'submitted') {
      return { ok: false, error: 'There is nothing waiting for a decision on this speaker.' };
    }

    await editRef.set(
      {
        status: 'rejected',
        decidedAt: FieldValue.serverTimestamp(),
        decidedBy: input.actor,
        note: input.note?.trim() || FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await appendAudit({
      actor: input.actor,
      action: 'speaker.portalReject',
      targetPath: `${COLLECTIONS.speakerProfileEdits}/${input.speakerId}`,
      targetId: input.speakerId,
      before: {},
      after: { note: input.note?.trim() ?? null },
    });

    return {
      ok: true,
      message: 'Turned down. Nothing on the website or in the app changed. Send a new link when they are ready to try again.',
    };
  } catch (err) {
    recordError('speaker-portal.reject', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not record that.' };
  }
}

/**
 * Kill every link this speaker has been sent.
 *
 * One field write, because `speaker-token.ts` holds no state: the token carries
 * `iat` and `linkIsLive` refuses anything minted before this instant. It stops
 * one speaker's links and nobody else's, which is what rotating the signing
 * secret could not do.
 */
export async function revokePortalLinks(input: {
  speakerId: string;
  actor: string;
}): Promise<PortalResult> {
  try {
    const editRef = db().collection(COLLECTIONS.speakerProfileEdits).doc(input.speakerId);
    const existing = (await editRef.get()).data() as SpeakerProfileEditDoc | undefined;

    await editRef.set(
      {
        eventId: EVENT_ID,
        speakerId: input.speakerId,
        status: existing?.status ?? 'sent',
        linksValidFrom: Date.now(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );

    await appendAudit({
      actor: input.actor,
      action: 'speaker.portalRevoke',
      targetPath: `${COLLECTIONS.speakerProfileEdits}/${input.speakerId}`,
      targetId: input.speakerId,
      before: {},
      after: { linksValidFrom: Date.now() },
    });

    return { ok: true, message: 'Every link sent to this speaker has stopped working. Send a new one to let them back in.' };
  } catch (err) {
    recordError('speaker-portal.revoke', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not revoke the link.' };
  }
}
