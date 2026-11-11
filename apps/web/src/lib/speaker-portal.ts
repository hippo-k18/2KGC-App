import 'server-only';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  type SessionDoc,
  type SubmissionDoc,
  type SpeakerDoc,
  type SpeakerProfileEditDoc,
} from '@kgc/shared';
import { readSpeakerToken } from '@kgc/scripts/src/lib/speaker-token';
import {
  normaliseDraft,
  portalLinkOpens,
  type DraftInput,
} from '@kgc/scripts/src/lib/speaker-portal-core';
import { db } from '@/lib/firestore';

/**
 * A speaker filling in their own profile, with no account.
 *
 * ── Why this is on the website and uses the Admin SDK ───────────────────────
 *
 * The same reason `consent/store.ts` is: a speaker has no Firebase account.
 * `SpeakerDoc` is authored by the programme committee from a CSV, most speakers
 * never buy a ticket, so there is no uid, no `registered` claim and nothing for
 * `firestore.rules` to check. The capability link is the whole of the
 * authentication, and `speaker-token.ts` says what that is worth.
 *
 * ── What this file will not do ──────────────────────────────────────────────
 *
 * **It never writes to `speakers` or to `sessions`.** Everything typed here
 * lands in `speakerProfileEdits/{speakerId}` and stays there until an organizer
 * approves it in the dashboard. That is the difference between a self-service
 * form and an unattended write to a public page.
 *
 * **It never takes the speaker from the request body.** Who is editing comes
 * out of the HMAC-verified token and nowhere else, so a field naming somebody
 * else changes nothing about whose profile is opened or written.
 *
 * **It stores no address and shows no address.** The mail went to the contact
 * address on the record; repeating it on a page reachable by anybody holding a
 * forwarded URL would turn the link into a way of reading it.
 */

export interface PortalSession {
  id: string;
  title: string;
  day: string;
  startsAtLocal: string;
  /** The slides link currently published for this session, if any. */
  slidesUrl?: string;
}

export interface PortalContext {
  speakerId: string;
  name: string;
  title?: string;
  company?: string;
  bio?: string;
  photoURL?: string;
  social?: { linkedin?: string; x?: string; website?: string };
  sessions: PortalSession[];
  /**
   * Accepted call-for-papers submissions still waiting for final details
   * (T249). Usually one, and present before any session exists, which is why
   * the page asks about these rather than about `sessions`.
   */
  submissions: PortalSubmission[];
  /** Where their last submission stands, so the page can say what happens next. */
  state?: {
    status: SpeakerProfileEditDoc['status'];
    submittedAtMs?: number;
    decidedAtMs?: number;
  };
}

const millis = (t: unknown): number | undefined => {
  const v = t as { toMillis?: () => number } | undefined;
  return typeof v?.toMillis === 'function' ? v.toMillis() : undefined;
};

/** One accepted submission, as the self-service page asks about it. */
export interface PortalSubmission {
  id: string;
  /** As submitted, shown beside the box for the final title. */
  title: string;
  abstract: string;
  workshop: boolean;
  details?: { title?: string; description?: string; outline?: string; install?: string };
  /** "Monday 9 November 2026"-style deadline is in the email; this is for "received" wording. */
  receivedAtMs?: number;
}

/** What a link buys, once it has been checked. */
export interface PortalGrant {
  speakerId: string;
  speaker: SpeakerDoc;
  edit?: SpeakerProfileEditDoc;
}

/**
 * The one door. Every read and every write on this feature comes through here.
 *
 * ── Why this is a function and not four lines repeated ──────────────────────
 *
 * It was four lines, in `loadPortal` only, and the save action re-verified the
 * HMAC and then wrote. So "Revoke link" stopped the page and not the writes:
 * whoever held an old token could keep replacing that speaker's bio, company,
 * photo link and slides links for the rest of the token's 180 days, and every
 * submission put attacker-chosen text in front of an organizer with a button
 * that publishes it to the website and the app. Revocation is the only control
 * a 180-day capability has, and it covered the read half.
 *
 * So the check is one function, and the actions take the raw token rather than
 * a speaker id — a future action cannot forget a step it has no way to skip.
 *
 * Returns null for a bad token, an expired one, a revoked one and a speaker who
 * is no longer on the list — deliberately without distinguishing them, because
 * three of the four would otherwise answer "is this person still speaking?" to
 * anybody holding an old URL.
 */
export async function openPortal(rawToken: string): Promise<PortalGrant | null> {
  const payload = readSpeakerToken(rawToken);
  if (!payload) return null;

  const [speakerSnap, editSnap] = await Promise.all([
    db().collection(COLLECTIONS.speakers).doc(payload.sid).get(),
    db().collection(COLLECTIONS.speakerProfileEdits).doc(payload.sid).get(),
  ]);
  if (!speakerSnap.exists) return null;

  const edit = editSnap.data() as SpeakerProfileEditDoc | undefined;
  const speaker = speakerSnap.data() as SpeakerDoc;

  const opens = portalLinkOpens({
    iat: payload.iat,
    linksValidFrom: edit?.linksValidFrom,
    speakerEventId: speaker.eventId,
    eventId: EVENT_ID,
  });
  if (!opens) return null;

  return { speakerId: payload.sid, speaker, edit };
}

/** Verify a link and load everything the page shows. */
export async function loadPortal(rawToken: string): Promise<PortalContext | null> {
  const grant = await openPortal(rawToken);
  if (!grant) return null;
  const { speaker, edit } = grant;

  const sessionIds = speaker.sessionIds ?? [];
  const docs = sessionIds.length
    ? await db().getAll(
        ...sessionIds.slice(0, 20).map((id) => db().collection(COLLECTIONS.sessions).doc(id)),
      )
    : [];

  const sessions: PortalSession[] = docs
    .filter((d) => d.exists)
    .map((d) => {
      const s = d.data() as SessionDoc;
      return {
        id: d.id,
        title: s.title,
        day: s.day,
        startsAtLocal: s.startsAtLocal,
        slidesUrl: s.slidesUrl,
      };
    })
    .sort((a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal));

  const submissions = await portalSubmissions(edit?.submissionIds ?? []);

  return {
    speakerId: grant.speakerId,
    submissions,
    name: speaker.name,
    title: speaker.title,
    company: speaker.company,
    bio: speaker.bio,
    photoURL: speaker.photoURL,
    social: speaker.social,
    sessions,
    state: edit
      ? {
          status: edit.status,
          submittedAtMs: millis(edit.submittedAt),
          decidedAtMs: millis(edit.decidedAt),
        }
      : undefined,
  };
}

/**
 * The accepted submissions an edit document names, still accepted and still
 * in this event. A submission undone or withdrawn since drops off the page.
 */
async function portalSubmissions(ids: string[]): Promise<PortalSubmission[]> {
  if (ids.length === 0) return [];
  const docs = await db().getAll(
    ...ids.slice(0, 10).map((id) => db().collection(COLLECTIONS.submissions).doc(id)),
  );
  return docs
    .filter((d) => d.exists)
    .map((d) => ({ id: d.id, sub: d.data() as SubmissionDoc }))
    .filter(({ sub }) => sub.eventId === EVENT_ID && sub.status === 'accepted')
    .map(({ id, sub }) => ({
      id,
      title: sub.title,
      abstract: sub.abstract,
      workshop: sub.sessionType === 'workshop',
      details: sub.details
        ? {
            title: sub.details.title,
            description: sub.details.description,
            outline: sub.details.outline,
            install: sub.details.install,
          }
        : undefined,
      receivedAtMs: millis(sub.details?.receivedAt),
    }));
}

/** What the speaker typed for one submission. */
export interface DetailsInput {
  title: string;
  description: string;
  outline?: string;
  install?: string;
}

const DETAIL_MAX = 5000;

/**
 * The final title and description, and for a workshop the outline and the
 * install list. All required: they are what E2 asked for, and a half-filled
 * set would stop E3 from nudging someone who has not finished.
 */
function checkDetails(sub: PortalSubmission, input: DetailsInput | undefined): string[] {
  const label = `“${sub.title}”`;
  if (!input) return [`Send the final title and description for ${label}.`];
  const errors: string[] = [];
  if (input.title.trim().length < 3) errors.push(`Give ${label} its final title.`);
  if (input.description.trim().length < 40) errors.push(`Write a session description for ${label}.`);
  if (sub.workshop) {
    if (!input.outline?.trim()) errors.push(`Add the workshop outline for ${label}.`);
    if (!input.install?.trim()) {
      errors.push(`Say what attendees must install or bring for ${label}, or write "nothing".`);
    }
  }
  for (const v of [input.title, input.description, input.outline ?? '', input.install ?? '']) {
    if (v.length > DETAIL_MAX) errors.push(`One of the boxes for ${label} is too long.`);
  }
  return errors;
}

/**
 * Record that the page was opened.
 *
 * Only ever moves `sent` to `opened`, so a speaker re-reading a profile they
 * already submitted does not reset the organizer's tracker to a stage they had
 * already passed. A speaker who was never sent a link but has one — an
 * organizer pasting it into their own message — gets a document created at
 * `opened`, because the tracker's job is to show what has happened rather than
 * what was supposed to.
 *
 * Failures are swallowed. This is a courtesy for the chase list, and a page
 * that refused to render because a tracking write lost a race would be a page
 * that refused to render.
 */
export async function markOpened(speakerId: string): Promise<void> {
  try {
    const ref = db().collection(COLLECTIONS.speakerProfileEdits).doc(speakerId);
    const existing = (await ref.get()).data() as SpeakerProfileEditDoc | undefined;
    if (existing && existing.status !== 'sent') return;

    await ref.set(
      {
        eventId: EVENT_ID,
        speakerId,
        status: 'opened',
        openedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );
  } catch (err) {
    console.error('[speaker-portal] could not record that the link was opened', err);
  }
}

export type SubmitOutcome = 'saved' | 'invalid' | 'error' | 'revoked';

/**
 * Hold what a speaker sent, for an organizer to approve.
 *
 * ⚠️ It takes the raw token, not a speaker id, and it opens the link itself.
 * The action used to verify the HMAC and hand over `payload.sid`, which meant a
 * revoked link still wrote — see `openPortal`. Passing the token is what makes
 * that impossible to get wrong again: there is no speaker id to pass.
 *
 * ⚠️ `draft` is written as a whole map, not merged into the previous one.
 * Nested maps merge key by key under `merge: true`, so a second submission that
 * cleared a field would silently keep the first submission's value for it —
 * AGENTS.md gotcha 9, and the nested form of it that was found live in
 * `apps/web/src/lib/submissions.ts`. `FieldValue.delete()` first, then the new
 * map, is the only ordering that actually replaces it.
 */
export async function recordDraft(
  rawToken: string,
  input: DraftInput,
  /** Submission id → what was typed for it. Only ids on the edit document are read. */
  details: ReadonlyMap<string, DetailsInput> = new Map(),
): Promise<{ outcome: SubmitOutcome; errors: string[] }> {
  try {
    const grant = await openPortal(rawToken);
    /*
     * One answer for a forged token, an expired one, a revoked one and a
     * speaker who has come off the programme, the same as the page gives. The
     * caller turns it into the 404 the page would have shown.
     */
    if (!grant) return { outcome: 'revoked', errors: [] };

    const { speakerId, speaker, edit: existing } = grant;

    const { draft, errors } = normaliseDraft(input, speaker.sessionIds ?? []);
    /*
     * The submissions come from the edit document, never from the form: a
     * field naming another submission id is simply not looked at.
     */
    const subs = await portalSubmissions(existing?.submissionIds ?? []);
    for (const sub of subs) errors.push(...checkDetails(sub, details.get(sub.id)));
    if (errors.length) return { outcome: 'invalid', errors };

    const ref = db().collection(COLLECTIONS.speakerProfileEdits).doc(speakerId);

    if (existing?.draft) await ref.update({ draft: FieldValue.delete() });

    await ref.set(
      {
        eventId: EVENT_ID,
        speakerId,
        status: 'submitted',
        draft,
        submittedAt: FieldValue.serverTimestamp(),
        /*
         * Cleared, because they are about a decision that is no longer the
         * current one. Leaving "turned down on the 4th" beside a submission
         * made on the 6th is a panel that reads as already answered.
         */
        decidedAt: FieldValue.delete(),
        decidedBy: FieldValue.delete(),
        note: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );

    /*
     * Session details land on the submission at once, where the inbox reads
     * "details received" and E3 stops. They publish nothing: the session is
     * still written in Session Manager, and the profile half above still
     * waits for an organizer.
     */
    const now = Timestamp.now();
    for (const sub of subs) {
      const d = details.get(sub.id)!;
      await db()
        .collection(COLLECTIONS.submissions)
        .doc(sub.id)
        .update({
          details: {
            title: d.title.trim(),
            description: d.description.trim(),
            ...(sub.workshop ? { outline: d.outline?.trim() ?? '', install: d.install?.trim() ?? '' } : {}),
            receivedAt: now,
          },
          updatedAt: now,
        });
    }

    return { outcome: 'saved', errors: [] };
  } catch (err) {
    console.error('[speaker-portal] could not record the profile', err);
    return { outcome: 'error', errors: [] };
  }
}
