import 'server-only';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  TIME_ZONE,
  publicSiteOrigin,
  type BlindReviewMode,
  type CallDoc,
  type CallFormFieldDef,
  type CallFormVersion,
  type PublishStatus,
  type RubricCriterionDef,
  type SessionFormat,
  type WithId,
} from '@kgc/shared';
import {
  callWindow,
  daysUntilClose,
  type CallWindowInput,
  type CallWindowState,
} from '@kgc/scripts/src/lib/call-window';
import {
  fieldId,
  planFormVersion,
  validateField,
  validateForm,
  type FormVersionChange,
} from '@kgc/scripts/src/lib/question-forms';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';
import { fromWallClock } from './time';

/**
 * The call for abstracts, from the organizer's side — the call document itself
 * and the form on it. Submissions are next door in `submissions.ts`, reviewers
 * in `reviewers.ts`.
 *
 * ── Server-owned, and there is nothing underneath ───────────────────────────
 *
 * `calls`, `submissions`, `submissions/{id}/identity`, `.../reviews` and
 * `reviewers` have **no `match` block in `firestore.rules`** and must not get
 * one (`CFA-PLAN.md` §2, and the docblock over `BlindReviewMode` in
 * `models.ts`). Every write is Admin-SDK, through a server action. That is not
 * belt-and-braces, it is the only arrangement that works: the people this
 * feature is for hold no ticket, so `isRegistered()` is false for them and has
 * to stay false, and a rule that admitted them would be admitting everybody.
 *
 * The consequence for this file is that every rule it enforces is the only
 * enforcement there is. The deadline in particular — see `call-window.ts`, which
 * is in `@kgc/scripts` because the public portal has to reach the same verdict.
 *
 * ── The form is versioned, never frozen ─────────────────────────────────────
 *
 * Whova locks its submission form the moment the first submission arrives, and
 * its own research notes call that a known pain point. `CFA-PLAN.md` §1.2 takes
 * the other road: adding a question is always allowed and leaves earlier
 * submissions simply without an answer for it; changing or removing one mints a
 * new version and archives the old fields. Every submission stores the
 * `formVersion` it was answered against, so the answers can always be rendered
 * under the questions that were actually asked.
 *
 * ⚠️ Field ids are assigned once and never regenerated. The id is what an answer
 * is stored under, so rewording a question must not orphan the answers already
 * given to it. `questionForms.ts` does exactly this for registration and this
 * follows it rather than inventing a second scheme.
 */

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** A call flattened for a screen: no Timestamps, no class instances. */
export interface CallRow {
  id: string;
  title: string;
  instructions: string;
  status: PublishStatus;
  timeZone: string;
  opensAtLocal: string;
  closesAtLocal: string;
  opensAtMs: number;
  closesAtMs: number;
  sessionTypes: SessionFormat[];
  trackIds: string[];
  form: CallFormFieldDef[];
  formVersion: number;
  priorVersions: { version: number; fields: CallFormFieldDef[] }[];
  blindReview: BlindReviewMode;
  /** The scoring criteria, in the order reviewers are asked them. */
  rubric: RubricCriterionDef[];
  reviewsPerSubmission: number;
  reminderDaysBefore: number[];
  notifyEmails: string[];
  updatedBy?: string;
}

/** The window state and the countdown, computed once so screens cannot disagree. */
export interface CallWindow {
  state: CallWindowState;
  daysLeft: number;
}

export const windowOf = (call: CallRow, now: Date = new Date()): CallWindow => {
  const input: CallWindowInput = {
    status: call.status,
    opensAtMs: call.opensAtMs,
    closesAtMs: call.closesAtMs,
  };
  return { state: callWindow(input, now.getTime()), daysLeft: daysUntilClose(input, now.getTime()) };
};

function toRow(id: string, c: CallDoc): CallRow {
  return {
    id,
    title: c.title,
    instructions: c.instructions ?? '',
    status: c.status,
    timeZone: c.timeZone ?? TIME_ZONE,
    opensAtLocal: c.opensAtLocal ?? '',
    closesAtLocal: c.closesAtLocal ?? '',
    /*
     * `toMillis()` inside a try, because a document hand-edited in the Firebase
     * console can hold a string where a Timestamp belongs, and a list screen
     * that throws on one bad row shows nothing at all. A zero here reads as
     * "closed", which is the safe direction — see `callWindow`.
     */
    opensAtMs: millis(c.opensAt),
    closesAtMs: millis(c.closesAt),
    sessionTypes: c.sessionTypes ?? [],
    trackIds: c.trackIds ?? [],
    form: [...(c.form ?? [])].sort((a, b) => a.order - b.order),
    formVersion: c.formVersion ?? 1,
    priorVersions: (c.priorVersions ?? []).map((v) => ({ version: v.version, fields: v.fields })),
    blindReview: c.blindReview ?? 'single-blind',
    rubric: [...(c.rubric ?? [])].sort((a, b) => a.order - b.order),
    reviewsPerSubmission: c.reviewsPerSubmission ?? 3,
    reminderDaysBefore: c.reminderDaysBefore ?? [],
    notifyEmails: c.notifyEmails ?? [],
    updatedBy: c.updatedBy,
  };
}

function millis(t: unknown): number {
  try {
    return (t as Timestamp).toMillis();
  } catch {
    return 0;
  }
}

/**
 * Every call for this event, newest deadline first.
 *
 * Sorted in memory rather than by Firestore: there are at most a handful of
 * calls, and `where(eventId) + orderBy(closesAt)` would need a composite index
 * that earns nothing. The emulator does not enforce indexes, so a query that
 * needs one and does not have one works locally and fails in production —
 * AGENTS.md records that shipping twice.
 */
export async function listCalls(): Promise<CallRow[]> {
  try {
    const snap = await db().collection(COLLECTIONS.calls).where('eventId', '==', EVENT_ID).get();
    return snap.docs
      .map((d) => toRow(d.id, d.data() as CallDoc))
      .sort((a, b) => b.closesAtMs - a.closesAtMs || a.title.localeCompare(b.title));
  } catch (err) {
    recordError('calls.list', err);
    return [];
  }
}

export async function getCall(id: string): Promise<CallRow | null> {
  try {
    const doc = await db().collection(COLLECTIONS.calls).doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data() as CallDoc;
    if (data.eventId !== EVENT_ID) return null;
    return toRow(doc.id, data);
  } catch (err) {
    recordError(`calls.get:${id}`, err);
    return null;
  }
}

/** The raw document, for the one caller that needs the Timestamps themselves. */
export async function getCallDoc(id: string): Promise<WithId<CallDoc> | null> {
  const doc = await db().collection(COLLECTIONS.calls).doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as CallDoc;
  if (data.eventId !== EVENT_ID) return null;
  return { ...data, id: doc.id };
}

// ---------------------------------------------------------------------------
// Writing the call
// ---------------------------------------------------------------------------

export type CallResult = { ok: true; id: string; message: string } | { ok: false; error: string };

/**
 * The one call id the website cannot serve.
 *
 * `/submit/token/{token}` is the author's own link and `/submit/{callId}` is the
 * public page. A static route segment beats a dynamic one in Next's router, so
 * `/submit/token` can never reach a call named `token` — the route would resolve
 * and then 404 on a token that is not a token, which reads as "the call page is
 * broken" rather than "that name is taken".
 *
 * Refused at authoring time instead, where the message can say so.
 */
const RESERVED_CALL_IDS = new Set(['token']);

/**
 * `calls/{slug}` — the id is a slug because it goes in a public URL that ends up
 * on a poster and in a mailing. Nothing is derived from it and nothing parses it.
 */
export function callSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  return slug || 'call';
}

export interface SaveCallInput {
  /** Absent when creating. */
  id?: string;
  title: string;
  instructions: string;
  status: PublishStatus;
  /** `YYYY-MM-DDTHH:mm` wall clock in the event's zone. */
  opensAtLocal: string;
  closesAtLocal: string;
  sessionTypes: SessionFormat[];
  trackIds: string[];
  blindReview: BlindReviewMode;
  reviewsPerSubmission: number;
  reminderDaysBefore: number[];
  notifyEmails: string[];
  actor: string;
}

/**
 * Create or update a call.
 *
 * ── The dates are derived here, never taken from the form ───────────────────
 *
 * `opensAtLocal`/`closesAtLocal` are the authoring truth and `opensAt`/`closesAt`
 * follow from them through `fromWallClock`, the same derivation a session's
 * times go through. An organizer decides "30 September, 23:59 in New York", not
 * an instant — and if the offset rules ever change it is the instant that should
 * move, because a call that closes an hour early closes on somebody mid-abstract.
 *
 * ── An open call may be edited, and its window may not be shortened silently ─
 *
 * Nothing here refuses an edit to a live call: extending a deadline is the most
 * common thing an organizer does, and a screen that made them cancel and
 * re-create would lose every submission's `callId`. What it does do is report
 * the change back in words, so "I moved it forward by three weeks" is something
 * the organizer reads rather than infers.
 */
export async function saveCall(input: SaveCallInput): Promise<CallResult> {
  const title = input.title.trim();
  if (title.length < 3) return { ok: false, error: 'Give the call a title.' };
  if (!input.opensAtLocal || !input.closesAtLocal) {
    return { ok: false, error: 'A call needs an opening date and a closing date.' };
  }
  if (input.closesAtLocal <= input.opensAtLocal) {
    return {
      ok: false,
      error:
        'The call closes at or before it opens, so it would never accept anything. ' +
        'Check the two dates.',
    };
  }
  if (input.sessionTypes.length === 0) {
    return {
      ok: false,
      error:
        'Choose at least one session type. It is what a submitter offers their work as, and an ' +
        'accepted submission carries it onto the agenda.',
    };
  }
  if (!Number.isInteger(input.reviewsPerSubmission) || input.reviewsPerSubmission < 1) {
    return { ok: false, error: 'Each submission needs at least one review.' };
  }

  const bad = input.notifyEmails.find((e) => !e.includes('@'));
  if (bad) return { ok: false, error: `“${bad}” is not an email address.` };

  try {
    const id = input.id ?? callSlug(title);
    if (RESERVED_CALL_IDS.has(id)) {
      return {
        ok: false,
        error:
          `A call cannot live at “${id}”. The website already uses that address for authors ` +
          'returning to their own submission. Change the title slightly.',
      };
    }
    const ref = db().collection(COLLECTIONS.calls).doc(id);
    const snap = await ref.get();
    const existing = snap.exists ? (snap.data() as CallDoc) : undefined;

    if (!input.id && existing) {
      return {
        ok: false,
        error:
          `A call already exists at “${id}”. Open it and edit it rather than creating a second ` +
          'one at the same address. Its URL is already on whatever has been sent out.',
      };
    }

    const opensAt = fromWallClock(input.opensAtLocal, TIME_ZONE);
    const closesAt = fromWallClock(input.closesAtLocal, TIME_ZONE);

    await ref.set(
      {
        eventId: EVENT_ID,
        title,
        instructions: input.instructions.trim(),
        status: input.status,
        timeZone: TIME_ZONE,
        opensAtLocal: input.opensAtLocal,
        closesAtLocal: input.closesAtLocal,
        opensAt,
        closesAt,
        sessionTypes: input.sessionTypes,
        trackIds: input.trackIds,
        blindReview: input.blindReview,
        reviewsPerSubmission: input.reviewsPerSubmission,
        reminderDaysBefore: input.reminderDaysBefore,
        notifyEmails: input.notifyEmails,
        // Never written on an update: an edit to the deadline must not silently
        // reset the form or its version.
        ...(existing
          ? {}
          : {
              form: [],
              formVersion: 1,
              priorVersions: [],
              rubric: [],
              createdAt: FieldValue.serverTimestamp(),
            }),
        updatedBy: input.actor,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await appendAudit({
      actor: input.actor,
      action: existing ? 'call.update' : 'call.create',
      targetPath: `${COLLECTIONS.calls}/${id}`,
      targetId: id,
      before: existing
        ? {
            status: existing.status,
            opensAtLocal: existing.opensAtLocal,
            closesAtLocal: existing.closesAtLocal,
            blindReview: existing.blindReview,
          }
        : {},
      after: {
        status: input.status,
        opensAtLocal: input.opensAtLocal,
        closesAtLocal: input.closesAtLocal,
        blindReview: input.blindReview,
      },
    });

    if (!existing) {
      return { ok: true, id, message: `Created “${title}”. Its public address is /submit/${id}.` };
    }

    const moved = existing.closesAtLocal !== input.closesAtLocal;
    return {
      ok: true,
      id,
      message: moved
        ? `Saved. The deadline is now ${input.closesAtLocal.replace('T', ' ')}. It was ${String(
            existing.closesAtLocal,
          ).replace('T', ' ')}. Nobody is told automatically.`
        : 'Saved.',
    };
  } catch (err) {
    recordError('calls.save', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save the call.' };
  }
}

// ---------------------------------------------------------------------------
// The form builder
// ---------------------------------------------------------------------------

export type FieldResult =
  | { ok: true; message: string; changes?: FormVersionChange[] }
  | { ok: false; error: string };

/**
 * Add a question to a call's form, or edit one in place.
 *
 * ── The whole `form` array is rewritten every time ─────────────────────────
 *
 * The same reasoning `questionForms.saveField` records: Firestore cannot update
 * one element of an array by index without a read, and `arrayUnion` on an object
 * compares by deep equality — so editing a prompt with it would append a second
 * copy of the question rather than replace the first, and the public form would
 * then ask it twice.
 *
 * ── The id is assigned once ────────────────────────────────────────────────
 *
 * ⚠️ Derived from the prompt on create, de-duplicated, and then preserved
 * exactly on every edit. The id is the key an answer is stored under; a
 * regenerated one orphans every answer already given. This is the single most
 * breakable thing in this module, and it is the same sentence
 * `questionForms.ts` carries, because it is the same rule.
 */
export async function saveCallField(input: {
  callId: string;
  /** Absent when creating. Present, and preserved exactly, when editing. */
  id?: string;
  prompt: string;
  kind: CallFormFieldDef['kind'];
  options: string[];
  required: boolean;
  helpText?: string;
  maxLength?: number;
  actor: string;
}): Promise<FieldResult> {
  try {
    const ref = db().collection(COLLECTIONS.calls).doc(input.callId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: 'That call does not exist.' };

    const call = snap.data() as CallDoc;
    const before = [...(call.form ?? [])].sort((a, b) => a.order - b.order);
    const index = input.id ? before.findIndex((f) => f.id === input.id) : -1;
    if (input.id && index === -1) {
      return { ok: false, error: 'That question is not on this form.' };
    }

    let id = input.id;
    if (!id) {
      const base = fieldId(input.prompt);
      id = base;
      let n = 2;
      while (before.some((f) => f.id === id)) id = `${base}-${n++}`;
    }

    const field: CallFormFieldDef = {
      id,
      prompt: input.prompt.trim(),
      kind: input.kind,
      required: input.kind === 'description' ? false : input.required,
      order: index >= 0 ? before[index].order : before.length * 10,
      ...(input.kind === 'choice' || input.kind === 'multi-choice'
        ? { options: input.options.map((o) => o.trim()).filter(Boolean) }
        : {}),
      ...(input.helpText?.trim() ? { helpText: input.helpText.trim() } : {}),
      ...(input.maxLength ? { maxLength: input.maxLength } : {}),
    };

    const problem = validateField(field, before);
    if (problem) return { ok: false, error: problem };

    const after = [...before];
    if (index >= 0) after[index] = field;
    else after.push(field);

    const whole = validateForm(after);
    if (whole.length > 0) return { ok: false, error: whole[0].problem };

    return await commitForm({
      ref,
      call,
      before,
      after,
      actor: input.actor,
      created: index < 0,
      subject: field.prompt,
    });
  } catch (err) {
    recordError('calls.saveField', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save the question.' };
  }
}

/**
 * Remove a question.
 *
 * ⚠️ Answers already given to it are **not** deleted — they stay on the
 * submissions, keyed by an id nothing asks any more. Deliberate, and the same
 * decision `questionForms.deleteField` makes: an organizer removing a question
 * mid-call is usually fixing the form, and silently destroying two hundred
 * people's answers as a side effect of that is not recoverable. Removing a
 * question is a breaking change, so it mints a new form version and the old
 * definition is archived — which is what lets those answers still be rendered
 * under the question that was actually asked.
 */
export async function deleteCallField(input: {
  callId: string;
  id: string;
  actor: string;
}): Promise<FieldResult> {
  try {
    const ref = db().collection(COLLECTIONS.calls).doc(input.callId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: 'That call does not exist.' };

    const call = snap.data() as CallDoc;
    const before = [...(call.form ?? [])].sort((a, b) => a.order - b.order);
    const gone = before.find((f) => f.id === input.id);
    if (!gone) return { ok: false, error: 'That question is not on this form.' };

    const after = before.filter((f) => f.id !== input.id);
    const whole = validateForm(after);
    if (whole.length > 0) {
      return {
        ok: false,
        error: `Removing “${gone.prompt}” would break the form: ${whole[0].problem}`,
      };
    }

    return await commitForm({
      ref,
      call,
      before,
      after,
      actor: input.actor,
      created: false,
      subject: gone.prompt,
      removed: true,
    });
  } catch (err) {
    recordError('calls.deleteField', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not remove the question.' };
  }
}

/** Move a question up or down. Order decides what a submitter reads first. */
export async function moveCallField(input: {
  callId: string;
  id: string;
  direction: 'up' | 'down';
  actor: string;
}): Promise<FieldResult> {
  try {
    const ref = db().collection(COLLECTIONS.calls).doc(input.callId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: 'That call does not exist.' };

    const call = snap.data() as CallDoc;
    const before = [...(call.form ?? [])].sort((a, b) => a.order - b.order);
    const i = before.findIndex((f) => f.id === input.id);
    if (i === -1) return { ok: false, error: 'That question is not on this form.' };

    const j = input.direction === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= before.length) return { ok: true, message: 'Already at the end.' };

    const swapped = [...before];
    [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
    /*
     * Renumbered from scratch in tens rather than swapping two `order` values,
     * for the reason `questionForms.moveField` gives: a document written before
     * this screen existed may hold duplicate orders, and swapping two equal
     * numbers moves nothing — which looks exactly like a broken button.
     */
    const after = swapped.map((f, n) => ({ ...f, order: n * 10 }));

    return await commitForm({
      ref,
      call,
      before,
      after,
      actor: input.actor,
      created: false,
      subject: before[i].prompt,
      reordered: true,
    });
  } catch (err) {
    recordError('calls.moveField', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not reorder.' };
  }
}

/**
 * The one write that touches `form`, `formVersion` and `priorVersions`.
 *
 * All three move together or not at all: a version number that was bumped
 * without the old definition being archived names wording nobody kept, which is
 * the failure `consentForms.bodyHash` exists to prevent one layer down.
 *
 * `planFormVersion` decides whether the edit is breaking. Adding a question is
 * not — old submissions simply have no answer for it. Rewording, retyping or
 * removing one is, because the answers already given were given to something
 * else. A batch of edits bumps the version once, not once per change.
 */
async function commitForm(args: {
  ref: FirebaseFirestore.DocumentReference;
  call: CallDoc;
  before: CallFormFieldDef[];
  after: CallFormFieldDef[];
  actor: string;
  created: boolean;
  subject: string;
  removed?: boolean;
  reordered?: boolean;
}): Promise<FieldResult> {
  const currentVersion = args.call.formVersion ?? 1;
  const plan = planFormVersion(args.before, args.after, currentVersion);

  const archive: CallFormVersion[] = [...(args.call.priorVersions ?? [])];
  if (plan.bumped) {
    archive.push({
      version: currentVersion,
      fields: args.before.map((f) => ({ ...f })),
      // A Timestamp built here, in the app that owns this store. ⚠️ Never one
      // built in `@kgc/scripts` — three copies of `firebase-admin` exist and
      // Firestore checks sentinels with `instanceof` (AGENTS.md gotcha 8).
      supersededAt: Timestamp.now(),
    });
  }

  await args.ref.update({
    form: args.after,
    formVersion: plan.version,
    priorVersions: archive,
    updatedBy: args.actor,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await appendAudit({
    actor: args.actor,
    action: 'call.form',
    targetPath: `${args.ref.path}`,
    targetId: args.subject,
    before: { formVersion: currentVersion, questions: args.before.length },
    after: { formVersion: plan.version, questions: args.after.length, bumped: plan.bumped },
  });

  if (args.reordered) return { ok: true, message: 'Reordered.', changes: plan.changes };
  if (args.removed) {
    return {
      ok: true,
      changes: plan.changes,
      message:
        `Removed “${args.subject}”. Answers already given to it stay on the submissions. ` +
        `Nothing was destroyed, and this is now form version ${plan.version}, so they are still ` +
        'readable under the question that was actually asked.',
    };
  }
  if (args.created) {
    return {
      ok: true,
      changes: plan.changes,
      message:
        `Added “${args.subject}”. Submissions already made keep their answers and simply have ` +
        'none for this question, which is something to chase rather than something to reject.',
    };
  }
  return {
    ok: true,
    changes: plan.changes,
    message: plan.bumped
      ? `Saved. That was a change to a question people have already been asked, so this is now ` +
        `form version ${plan.version}; earlier submissions stay pinned to version ${currentVersion} ` +
        'and are read against it.'
      : `Saved “${args.subject}”. Answers already given to it are kept. The question keeps its id.`,
  };
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/**
 * The public address of a call.
 *
 * `publicSiteOrigin()` is what `/order/{token}` and `/consent/{token}` links are
 * built from too — one origin for every link this dashboard mints, so a staging
 * dashboard cannot put a production URL on a poster.
 */
export const callUrl = (callId: string) => `${publicSiteOrigin()}/submit/${callId}`;
