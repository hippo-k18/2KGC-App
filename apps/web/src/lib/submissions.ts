import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  SUBMISSION_IDENTITY_DOC,
  type CallDoc,
  type CallFormFieldDef,
  type SessionFormat,
  type SubmissionCoAuthor,
  type SubmissionDoc,
  type SubmissionIdentityDoc,
  type SubmissionStatus,
  type TrackDoc,
  publicSiteOrigin,
} from '@kgc/shared';
import {
  callWindow,
  submissionRefusal,
  type CallWindowInput,
} from '@kgc/scripts/src/lib/call-window';
import {
  fieldsAtVersion,
  validateAnswers,
  type AnswerValue,
  type FormFieldDef,
} from '@kgc/scripts/src/lib/question-forms';
import { mintSubmissionToken } from '@kgc/scripts/src/lib/submission-token';
import { sendSubmissionReceipt } from '@kgc/scripts/src/lib/email';
import { db } from './firestore';

/**
 * The public abstract portal's store — reading a call, and writing a submission
 * for somebody who has no account at all.
 *
 * ── Why this exists on the website ──────────────────────────────────────────
 *
 * `isRegistered()` — the `registered` custom claim — is the gate for everything
 * in `firestore.rules`, and it is minted only for ticket holders. A prospective
 * speaker does not have it and must not get it: a call for papers that requires
 * a ticket is not a call for papers, and most people who submit an abstract will
 * never buy one. So `calls`, `submissions` and `submissions/{id}/identity` have
 * **no `match` block at all** and every write here is the Admin SDK, which
 * bypasses rules entirely.
 *
 * That makes this file the whole security boundary for the feature, in the same
 * way `consent/store.ts` is for a speaker release. Four rules, and each one is
 * the reason a specific attack does not work:
 *
 * **The submission id comes from the HMAC token and nowhere else.** A form field
 * naming which submission is being edited would let anybody edit anybody's.
 *
 * **The deadline is checked here, on the call this request just read.** Not on a
 * value rendered into the page, and never by hiding a button: the page and the
 * POST are separate requests, and there is no rule underneath to catch what a
 * stale tab lets through. `CFA-PLAN.md` §4 — *"deadline enforcement is
 * server-side or it is nothing"*.
 *
 * **`formVersion` is stamped from the call, never copied from the request.**
 * Otherwise a submission could claim to have been asked questions nobody ever
 * published, which is precisely what the version exists to rule out.
 *
 * **The author is written to a subcollection**, so that hiding an author from a
 * reviewer is later a decision about which document a screen loads rather than a
 * migration of every submission ever written (`CFA-PLAN.md` §1.1).
 */

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** What the public page needs to render one call. */
export interface PublicCall {
  id: string;
  title: string;
  instructions: string;
  fields: CallFormFieldDef[];
  formVersion: number;
  sessionTypes: SessionFormat[];
  tracks: { id: string; name: string }[];
  closesAtLocal: string;
  timeZone: string;
  /** Null while the call is accepting submissions; the sentence to show otherwise. */
  refusal: string | null;
}

function windowInput(c: CallDoc): CallWindowInput {
  const at = (t: unknown): number => {
    try {
      return (t as Timestamp).toMillis();
    } catch {
      /*
       * A call whose dates cannot be read reports as closed, because
       * `callWindow` treats an inverted or zero window that way. Failing shut is
       * the only safe direction: refusing a submission that should have been
       * allowed is an email to the committee, and accepting one that should have
       * been refused is a decision somebody has to make about a late paper.
       */
      return 0;
    }
  };
  return { status: c.status, opensAtMs: at(c.opensAt), closesAtMs: at(c.closesAt) };
}

/**
 * A call, as the public sees it — or null, which the page turns into a 404.
 *
 * Null covers "no such call", "wrong event" and "still a draft", and it
 * deliberately does not distinguish them. Two of the three would otherwise
 * answer "is this conference running a call this year?" to anybody who guessed a
 * URL, which is a question the committee may not have announced the answer to.
 */
export async function loadCall(callId: string): Promise<PublicCall | null> {
  try {
    const doc = await db().collection(COLLECTIONS.calls).doc(callId).get();
    if (!doc.exists) return null;

    const call = doc.data() as CallDoc;
    if (call.eventId !== EVENT_ID) return null;
    if (call.status === 'draft') return null;

    return { ...(await toPublic(doc.id, call)) };
  } catch (err) {
    // Never throws. A call page that 500s is a call page nobody can submit to,
    // and the failure is the same shape as `data.ts`'s: log, and render nothing
    // rather than something wrong.
    console.error('[submissions] could not load call', callId, err);
    return null;
  }
}

async function toPublic(id: string, call: CallDoc): Promise<PublicCall> {
  const tracks = await trackNames(call.trackIds ?? []);
  return {
    id,
    title: call.title,
    instructions: call.instructions ?? '',
    fields: [...(call.form ?? [])].sort((a, b) => a.order - b.order),
    formVersion: call.formVersion ?? 1,
    sessionTypes: call.sessionTypes ?? [],
    tracks,
    closesAtLocal: call.closesAtLocal ?? '',
    timeZone: call.timeZone ?? 'America/New_York',
    refusal: submissionRefusal(windowInput(call), Date.now()),
  };
}

/**
 * Track names for the picker.
 *
 * `getAll` on the ids the call names, rather than a query over the collection: a
 * call offers a handful of tracks and this needs no index. An id whose document
 * has gone is dropped rather than rendered as a blank option, because an empty
 * entry in a `<select>` is an option somebody eventually picks.
 */
async function trackNames(ids: string[]): Promise<{ id: string; name: string }[]> {
  if (ids.length === 0) return [];
  try {
    const docs = await db().getAll(...ids.map((id) => db().collection(COLLECTIONS.tracks).doc(id)));
    return docs
      .filter((d) => d.exists)
      .map((d) => ({ id: d.id, name: (d.data() as TrackDoc).name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.error('[submissions] could not load tracks', err);
    return [];
  }
}

/** The little a marketing page needs to know about a call that is running. */
export interface OpenCall {
  id: string;
  title: string;
  /** `YYYY-MM-DDTHH:mm` wall clock in `timeZone`. May be blank on a malformed call. */
  closesAtLocal: string;
  timeZone: string;
}

/**
 * The call this conference is currently running for one kind of session, if any.
 *
 * ── Why a marketing page asks this at all ──────────────────────────────────
 *
 * `/call-for-posters` sent submissions to EasyChair, at a URL still naming last
 * year's conference. `CFA-PLAN.md` §6 said that link should stay *"until phase 4
 * is live: half a pipeline is worse than an external one that works"* — and it
 * now is. So the page asks this question and links to `/submit/{callId}` when
 * the answer is yes, which is the same decision made from live data rather than
 * from a constant somebody has to remember to change on the day.
 *
 * ⚠️ **`callWindow` is the only deadline rule in this repo and this must not
 * become a second one.** It lives in `@kgc/scripts` with seventeen tests
 * precisely so the portal, the dashboard and this page agree to the
 * millisecond; a page that advertises a call the server action would refuse is
 * worse than no page. Everything decided here is decided by that function.
 *
 * ── No composite index ──────────────────────────────────────────────────────
 *
 * One equality filter on `eventId`, and the rest in memory — the rule `data.ts`
 * states and the reason it states it: the emulator does not enforce index
 * configuration, so `where(eventId) + where(status)` would pass every local run
 * and fail in production with `failed-precondition`, and this app cannot fix
 * `firestore.indexes.json` when it does. A conference runs a handful of calls.
 *
 * Returns null on any failure, which lands the page on its external fallback —
 * the safe direction, because that link works.
 */
export async function openCallFor(sessionType: SessionFormat): Promise<OpenCall | null> {
  try {
    const snap = await db().collection(COLLECTIONS.calls).where('eventId', '==', EVENT_ID).get();
    const now = Date.now();

    const running = snap.docs
      .map((d) => {
        const call = d.data() as CallDoc;
        return { id: d.id, call, window: windowInput(call) };
      })
      .filter(({ call }) => (call.sessionTypes ?? []).includes(sessionType))
      .filter(({ window }) => callWindow(window, now) === 'open')
      /*
       * The soonest deadline wins if two calls both take this session type. The
       * schema supports concurrent calls (`callId` is on every submission) and
       * no screen offers two, so this only ever picks between a real call and
       * one somebody left running — and pointing at the one closing first is
       * the choice that does not silently drop a submitter past a deadline.
       */
      .sort((a, b) => a.window.closesAtMs - b.window.closesAtMs);

    const first = running[0];
    if (!first) return null;

    return {
      id: first.id,
      title: first.call.title,
      closesAtLocal: first.call.closesAtLocal ?? '',
      timeZone: first.call.timeZone ?? 'America/New_York',
    };
  } catch (err) {
    console.error('[submissions] could not look for an open call', sessionType, err);
    return null;
  }
}

/** One submission and its author, for the page behind a capability link. */
export interface OwnSubmission {
  id: string;
  call: PublicCall;
  title: string;
  abstract: string;
  trackId?: string;
  sessionType?: SessionFormat;
  answers: Record<string, AnswerValue>;
  status: SubmissionStatus;
  /** The questions as they stood when this was answered. */
  fields: FormFieldDef[];
  /** True when the call's form has moved on since. */
  formMoved: boolean;
  author: {
    name: string;
    email: string;
    affiliation?: string;
    bio?: string;
    coAuthors: SubmissionCoAuthor[];
  };
  /** Whether an edit would be accepted right now. The window, not a preference. */
  editable: boolean;
  decided?: 'accepted' | 'rejected';
}

/**
 * The submission a token names, with everything needed to render and edit it.
 *
 * ⚠️ The caller passes a submission id that came out of a **verified** token.
 * This function does no verification of its own and must never be handed an id
 * from a form field or a path segment.
 */
export async function loadOwnSubmission(submissionId: string): Promise<OwnSubmission | null> {
  try {
    const ref = db().collection(COLLECTIONS.submissions).doc(submissionId);
    const [snap, identitySnap] = await Promise.all([
      ref.get(),
      ref.collection(SUBCOLLECTIONS.identity).doc(SUBMISSION_IDENTITY_DOC).get(),
    ]);
    if (!snap.exists) return null;

    const sub = snap.data() as SubmissionDoc;
    if (sub.eventId !== EVENT_ID) return null;

    const callSnap = await db().collection(COLLECTIONS.calls).doc(sub.callId).get();
    if (!callSnap.exists) return null;
    const callDoc = callSnap.data() as CallDoc;
    const call = await toPublic(callSnap.id, callDoc);

    const identity = identitySnap.exists
      ? (identitySnap.data() as SubmissionIdentityDoc)
      : undefined;

    const fields = fieldsAtVersion(
      { version: call.formVersion, fields: call.fields },
      (callDoc.priorVersions ?? []).map((v) => ({
        version: v.version,
        fields: v.fields,
        retiredAt: new Date(0),
      })),
      sub.formVersion ?? 1,
    );

    return {
      id: submissionId,
      call,
      title: sub.title ?? '',
      abstract: sub.abstract ?? '',
      trackId: sub.trackId,
      sessionType: sub.sessionType,
      answers: sub.answers ?? {},
      status: sub.status,
      fields,
      formMoved: (sub.formVersion ?? 1) !== call.formVersion,
      author: {
        name: identity?.name ?? '',
        email: identity?.email ?? '',
        affiliation: identity?.affiliation,
        bio: identity?.bio,
        coAuthors: identity?.coAuthors ?? [],
      },
      /*
       * Editing tracks the window exactly and deliberately is not looser. An
       * author who could keep editing after the close would be submitting after
       * the close in every sense that matters — the reviewers read the current
       * text, not the text as it stood at the deadline.
       */
      editable: call.refusal === null && sub.status !== 'withdrawn',
      decided:
        sub.status === 'accepted' ? 'accepted' : sub.status === 'rejected' ? 'rejected' : undefined,
    };
  } catch (err) {
    console.error('[submissions] could not load submission', submissionId, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface SubmitInput {
  title: string;
  abstract: string;
  trackId?: string;
  sessionType?: string;
  /**
   * Every `q_`-prefixed value the form posted, keyed by field id, with the full
   * array each key carried.
   *
   * Raw rather than already shaped, because whether an answer is a string or an
   * array is a property of the *field definition* and only the call knows that —
   * a `multi-choice` with one box ticked posts a single value and must still be
   * stored as an array, or the export column changes type between two rows.
   */
  answers: Record<string, string[]>;
  authorName: string;
  authorEmail: string;
  affiliation?: string;
  bio?: string;
  coAuthors: SubmissionCoAuthor[];
  /** False saves a draft; true is the finished thing. */
  finish: boolean;
}

export type SubmitOutcome =
  | { ok: true; submissionId: string; token: string; status: SubmissionStatus }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Create a submission, or update one the caller already holds a token for.
 *
 * ── The deadline is refused here, first, before anything is read out of the
 *    request ────────────────────────────────────────────────────────────────
 *
 * The call is fetched, the window is checked against the clock, and a closed
 * call returns before a single field is parsed. A hidden button is not
 * enforcement: this endpoint is reachable with `curl`, and there is no rule
 * underneath it.
 *
 * ── Two levels of validation, and only one of them blocks a draft ──────────
 *
 * A draft is saved with whatever exists — that is the point of a draft, and
 * `CFA-PLAN.md` phase 2 is entirely about the people who start and stop. A
 * *finished* submission has to have a title, an abstract, an author, an address,
 * and an answer to every required question. Refusing a half-written draft would
 * simply mean people did not save.
 */
export async function saveSubmission(
  callId: string,
  input: SubmitInput,
  /** Present only on an edit, and only ever from a verified token. */
  existingId?: string,
): Promise<SubmitOutcome> {
  const callRef = db().collection(COLLECTIONS.calls).doc(callId);
  const callSnap = await callRef.get();
  if (!callSnap.exists) return { ok: false, error: 'That call does not exist.' };

  const call = callSnap.data() as CallDoc;
  if (call.eventId !== EVENT_ID) return { ok: false, error: 'That call does not exist.' };

  const refusal = submissionRefusal(windowInput(call), Date.now());
  if (refusal) return { ok: false, error: refusal };

  const title = input.title.trim();
  const abstract = input.abstract.trim();
  const authorName = input.authorName.trim();
  const authorEmail = input.authorEmail.trim().toLowerCase();

  const fieldErrors: Record<string, string> = {};

  if (input.finish) {
    if (title.length < 3) fieldErrors.title = 'Give your submission a title.';
    if (abstract.length < 40) {
      fieldErrors.abstract =
        'The abstract is too short to be read by a committee. Say what the work is and why it matters.';
    }
    if (authorName.length < 2) fieldErrors.authorName = 'We need a name to put on the programme.';
    if (!authorEmail.includes('@')) {
      fieldErrors.authorEmail = 'We need an address to send the decision to.';
    }
    if ((call.sessionTypes ?? []).length > 0 && !input.sessionType) {
      fieldErrors.sessionType = 'Choose what you are offering this as.';
    }
    if ((call.trackIds ?? []).length > 0 && !input.trackId) {
      fieldErrors.trackId = 'Choose a track.';
    }
  } else if (!authorEmail.includes('@')) {
    /*
     * The one thing a draft cannot do without. The link back to this draft is
     * emailed and there is no account — an address-less draft is a document its
     * author can never reach again.
     */
    fieldErrors.authorEmail = 'We need an address so we can send you the link back to this draft.';
  }

  if (input.trackId && !(call.trackIds ?? []).includes(input.trackId)) {
    fieldErrors.trackId = 'That is not one of this call’s tracks.';
  }
  if (input.sessionType && !(call.sessionTypes ?? []).includes(input.sessionType as SessionFormat)) {
    fieldErrors.sessionType = 'That is not one of this call’s session types.';
  }

  /*
   * The shared validator, the same one the organizer's editor and the checkout
   * form use. A draft is validated too — the answers are cleaned and dropped
   * where they do not apply — but its `errors` are not fatal, because a draft is
   * by definition unfinished.
   */
  /*
   * Shaped against the call's own fields, exactly as `tickets/actions.ts` does
   * it: iterate the definitions rather than the POST keys, so an unknown key
   * cannot invent an answer and a `multi-choice` keeps its array type even when
   * one box was ticked. `''` as the tier — a call has no ticket types, and
   * `appliesToTier` treats a field with no `ticketTypeIds` as asked of
   * everybody, which is every field on a call form.
   */
  const posted: Record<string, AnswerValue | undefined> = {};
  for (const f of call.form ?? []) {
    const values = input.answers[f.id];
    if (!values || values.length === 0) continue;
    posted[f.id] = f.kind === 'multi-choice' ? values : values[0];
  }

  const checked = validateAnswers([...(call.form ?? [])], '', posted);
  if (input.finish) {
    for (const [id, message] of Object.entries(checked.errors)) fieldErrors[id] = message;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: 'Some answers need attention.', fieldErrors };
  }

  const now = Timestamp.now();
  const status: SubmissionStatus = input.finish ? 'submitted' : 'draft';

  try {
    const ref = existingId
      ? db().collection(COLLECTIONS.submissions).doc(existingId)
      : db().collection(COLLECTIONS.submissions).doc(newSubmissionId());

    const existing = existingId ? await ref.get() : undefined;
    if (existingId && !existing?.exists) {
      return { ok: false, error: 'That submission no longer exists.' };
    }
    const before = existing?.exists ? (existing.data() as SubmissionDoc) : undefined;

    if (before && (before.status === 'accepted' || before.status === 'rejected')) {
      return {
        ok: false,
        error: 'A decision has been made on this submission, so it can no longer be edited.',
      };
    }

    const token = mintSubmissionToken(ref.id);

    /*
     * The fields that are always written, typed against the model so that `tsc`
     * fails if a *required* one is ever forgotten — the same insistence
     * `createSessionAction` makes on its create path, and for the same reason: a
     * document malformed from birth surfaces as a screen that renders nothing.
     *
     * The optional ones are added below, on a `Record<string, unknown>`, because
     * `FieldValue.delete()` is a sentinel rather than a value of any modelled
     * field type and no typed shape can hold it.
     */
    const modelled: Pick<
      SubmissionDoc,
      | 'eventId'
      | 'callId'
      | 'title'
      | 'abstract'
      | 'formVersion'
      | 'status'
      | 'submitterTokenHash'
    > = {
      eventId: EVENT_ID,
      callId,
      title,
      abstract,
      /*
       * ⚠️ Stamped from the call this request just read, never copied from the
       * form. A version supplied by the browser would let a submission claim to
       * have been asked questions nobody ever published, which is the one thing
       * the version exists to rule out.
       */
      formVersion: call.formVersion ?? 1,
      status,
      submitterTokenHash: createHash('sha256').update(token).digest('hex'),
    };

    const doc: Record<string, unknown> = {
      ...modelled,
      /*
       * ⚠️ Every question the call asks is named on every write — the answered
       * ones with their value, the emptied ones with a delete. `answers` is a
       * map, and a map under `set(…, { merge: true })` merges **key by key**:
       * an answer simply left out of the write survives, so an author who
       * cleared one would be told "Saved" and would still be carrying the old
       * text into review. That is AGENTS.md gotcha 9 in its nested form —
       * "under merge they merge key by key, so name every key on every write
       * rather than sending a partial map" — and it is the one place in this
       * file where the sentinel was missing.
       *
       * Only the *current* questions are named. Answers to a question that has
       * since been retired are left exactly where they are, which is what lets
       * them still be read under the wording that was actually asked
       * (`calls.ts`, `deleteCallField`).
       */
      answers: answersWrite(call.form ?? [], checked.answers),
      /*
       * ⚠️ `FieldValue.delete()` and never `undefined` — AGENTS.md gotcha 9.
       * Both stores run with `ignoreUndefinedProperties`, so an `undefined` on a
       * merge write stores no key at all: an author who cleared their track on a
       * draft would be told it saved and would still be in the old one. It bites
       * hardest on exactly this kind of field, where the *absence* is meaningful
       * and "cannot be un-set" leaves a record permanently pointing at the wrong
       * thing.
       */
      trackId: input.trackId ?? FieldValue.delete(),
      sessionType: (input.sessionType as SessionFormat | undefined) ?? FieldValue.delete(),
      /*
       * Set the first time the submission leaves `draft` and never restamped.
       * An author fixing a typo after the deadline has not resubmitted, and a
       * `submittedAt` that moved would put them outside the call — the same
       * mistake the Stripe webhook must not make with `purchasedAt`.
       */
      ...(status === 'submitted' && !before?.submittedAt ? { submittedAt: now } : {}),
      ...(before ? {} : { reviewsAssigned: 0, reviewsSubmitted: 0, createdAt: now }),
      updatedAt: now,
    };

    await ref.set(doc, { merge: true });

    const modelledIdentity: Pick<
      SubmissionIdentityDoc,
      'eventId' | 'submissionId' | 'callId' | 'name' | 'email' | 'coAuthors'
    > = {
      eventId: EVENT_ID,
      submissionId: ref.id,
      callId,
      name: authorName,
      email: authorEmail,
      coAuthors: input.coAuthors,
    };

    const identity: Record<string, unknown> = {
      ...modelledIdentity,
      // Gotcha 9 again, and it matters more here: an author correcting an
      // affiliation they typed wrongly is the common case, and clearing one has
      // to actually clear it rather than report "saved" and keep the old value.
      affiliation: input.affiliation?.trim() || FieldValue.delete(),
      bio: input.bio?.trim() || FieldValue.delete(),
      ...(before ? {} : { createdAt: now }),
      updatedAt: now,
    };

    await ref
      .collection(SUBCOLLECTIONS.identity)
      .doc(SUBMISSION_IDENTITY_DOC)
      .set(identity, { merge: true });

    /*
     * The receipt carries the only route back to this submission — there is no
     * account, so losing the mail means asking an organizer to re-send it. Sent
     * on every save rather than only on the first, because the draft mail is
     * also the reminder that a draft exists.
     *
     * Never awaited into a failure: `send()` already swallows everything and
     * logs to `emailLog`, and a submission that saved must not report an error
     * because a receipt did not.
     */
    await sendSubmissionReceipt(db(), {
      to: authorEmail,
      name: authorName,
      callTitle: call.title,
      title: title || 'Untitled',
      link: `${publicSiteOrigin()}/submit/token/${token}`,
      closesAtLabel: `${(call.closesAtLocal ?? '').replace('T', ' ')} (${call.timeZone ?? ''})`,
      draft: status === 'draft',
    });

    return { ok: true, submissionId: ref.id, token, status };
  } catch (err) {
    console.error('[submissions] could not save', err);
    return { ok: false, error: 'Something went wrong and nothing was saved. Please try again.' };
  }
}

/**
 * Withdraw a submission.
 *
 * A status and never a delete. Firestore does not cascade, so deleting the
 * submission would leave an orphaned name, affiliation and address under a path
 * nothing lists — and a call's acceptance rate is a number somebody quotes, so
 * a withdrawal folded into `rejected` would quietly flatter it.
 */
export async function withdrawSubmission(submissionId: string): Promise<boolean> {
  try {
    const ref = db().collection(COLLECTIONS.submissions).doc(submissionId);
    const snap = await ref.get();
    if (!snap.exists) return false;

    const sub = snap.data() as SubmissionDoc;
    if (sub.status === 'accepted' || sub.status === 'rejected') return false;

    await ref.update({ status: 'withdrawn', updatedAt: Timestamp.now() });
    return true;
  } catch (err) {
    console.error('[submissions] could not withdraw', submissionId, err);
    return false;
  }
}

/**
 * The `answers` map as it has to be written, rather than as it came back from
 * the validator.
 *
 * The validator returns only the questions that were answered — that is correct
 * for a map that is being *replaced*, and wrong for one that is being merged.
 * Every question the call currently asks is therefore named here, so that
 * clearing an answer clears it. See the call site for the full reasoning.
 */
function answersWrite(
  fields: CallFormFieldDef[],
  answered: Record<string, AnswerValue>,
): Record<string, AnswerValue | FieldValue> {
  const out: Record<string, AnswerValue | FieldValue> = { ...answered };
  for (const f of fields) {
    // A description is text on the page and never has an answer, so there is
    // nothing to delete and a key under its id would be somebody probing.
    if (f.kind === 'description') continue;
    if (!(f.id in answered)) out[f.id] = FieldValue.delete();
  }
  return out;
}

/**
 * A minted, opaque submission id.
 *
 * Random and never derived from the author's address, unlike `registrations` —
 * which is `reg_` + sha256(email) precisely so that a re-purchase updates rather
 * than duplicates, and which is *why* `/order/{token}` has to exist. An id
 * anybody can compute is a link anybody can attempt to forge, and the whole
 * portal hangs off one.
 */
const newSubmissionId = () => `sub_${randomBytes(12).toString('hex')}`;
