/**
 * The Call for Abstracts write paths on the organizer's side, against a real
 * Firestore emulator: the call document, the form on it, the decisions, and the
 * promotion of an accepted abstract onto the agenda.
 *
 * ── Why this suite exists ───────────────────────────────────────────────────
 *
 * Same reason as `portal.test.ts`: `calls`, `submissions` and `reviewers` have
 * **no `match` block in `firestore.rules` and must never get one**
 * (`CFA-PLAN.md` §2), so `tests/rules` covers none of this and there is nothing
 * underneath these functions to catch what they let through. Every write here
 * is the Admin SDK.
 *
 * The three things it is really watching for:
 *
 *   - an edit to a live call quietly resetting the form or its version, which
 *     would unpin every submission already made from the questions it answered;
 *   - "undo" recorded as a second boolean rather than as a delete, which is how
 *     a submission ends up simultaneously accepted and not;
 *   - promotion adding a *second* speaker document for an author who is already
 *     on the bill, which is the whole reason `speakerId(name, company)` is
 *     derived rather than random.
 *
 * Run with: npm run test:cfa
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  SUBMISSION_IDENTITY_DOC,
  type SessionDoc,
  type SpeakerDoc,
  type SubmissionDoc,
  type SubmissionIdentityDoc,
} from '@kgc/shared';
import { sessionId as deriveSessionId, speakerId } from '@kgc/scripts/src/lib/ids';
import { db } from '@/lib/firestore';
import {
  deleteCallField,
  getCall,
  moveCallField,
  saveCall,
  saveCallField,
  windowOf,
  type SaveCallInput,
} from '@/lib/calls';
import {
  decideSubmission,
  getSubmission,
  promoteSubmission,
  undoDecision,
} from '@/lib/submissions';

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set. These tests write real documents and must ' +
        'never run against the live project. Use: npm run test:cfa',
    );
  }
});

const ACTOR = 'organizer@kgc.test';

async function wipe() {
  await db().recursiveDelete(db().collection(COLLECTIONS.submissions));
  for (const name of [
    COLLECTIONS.calls,
    COLLECTIONS.sessions,
    COLLECTIONS.speakers,
    COLLECTIONS.tracks,
    COLLECTIONS.rooms,
    COLLECTIONS.auditLog,
    COLLECTIONS.emailLog,
  ]) {
    const snap = await db().collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

beforeEach(wipe);

const callInput = (over: Partial<SaveCallInput> = {}): SaveCallInput => ({
  title: 'KGC 2027 Call for Abstracts',
  instructions: 'Tell us what the work is and why it matters.',
  status: 'published',
  opensAtLocal: '2027-01-01T09:00',
  closesAtLocal: '2027-03-31T23:59',
  sessionTypes: ['talk', 'workshop'],
  trackIds: ['graph-ml'],
  blindReview: 'single-blind',
  reviewsPerSubmission: 3,
  reminderDaysBefore: [7, 1],
  notifyEmails: ['programme@knowledgegraph.tech'],
  actor: ACTOR,
  ...over,
});

/** The id `saveCall` mints for the fixture above. */
const CALL_ID = 'kgc-2027-call-for-abstracts';

/** Somewhere inside that call's window, for `windowOf`. */
const DURING = new Date('2027-02-01T17:00:00.000Z');

async function createCall(over: Partial<SaveCallInput> = {}): Promise<string> {
  const result = await saveCall(callInput(over));
  if (!result.ok) throw new Error(`fixture did not save: ${result.error}`);
  return result.id;
}

interface SeedSubmission {
  id?: string;
  status?: SubmissionDoc['status'];
  title?: string;
  trackId?: string;
  sessionType?: SubmissionDoc['sessionType'];
  author?: { name: string; email: string; affiliation?: string; bio?: string };
}

/**
 * A submission as the portal would have left it.
 *
 * Written directly rather than through `saveSubmission`, which lives in the
 * other app and is exercised in `portal.test.ts`. What is under test here is
 * what the dashboard does to a submission that already exists.
 */
async function seedSubmission(over: SeedSubmission = {}): Promise<string> {
  const id = over.id ?? 'sub_0000000000000000000000aa';
  const author = over.author ?? {
    name: 'Ada Okonkwo',
    email: 'ada@acme.test',
    affiliation: 'Acme Graphs',
    bio: 'Principal engineer.',
  };
  const ref = db().collection(COLLECTIONS.submissions).doc(id);
  await ref.set({
    eventId: EVENT_ID,
    callId: CALL_ID,
    title: over.title ?? 'Provenance in enterprise knowledge graphs',
    abstract: 'Three years of running a provenance layer over a graph four business units write to.',
    trackId: over.trackId ?? 'graph-ml',
    sessionType: over.sessionType ?? 'talk',
    answers: {},
    formVersion: 1,
    status: over.status ?? 'submitted',
    submitterTokenHash: 'not-checked-here',
    submittedAt: new Date(),
    reviewsAssigned: 0,
    reviewsSubmitted: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await ref
    .collection(SUBCOLLECTIONS.identity)
    .doc(SUBMISSION_IDENTITY_DOC)
    .set({
      eventId: EVENT_ID,
      submissionId: id,
      callId: CALL_ID,
      ...author,
      coAuthors: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  return id;
}

const raw = async (id: string): Promise<SubmissionDoc> =>
  (await db().collection(COLLECTIONS.submissions).doc(id).get()).data() as SubmissionDoc;

const identityOf = async (id: string): Promise<SubmissionIdentityDoc> =>
  (
    await db()
      .collection(COLLECTIONS.submissions)
      .doc(id)
      .collection(SUBCOLLECTIONS.identity)
      .doc(SUBMISSION_IDENTITY_DOC)
      .get()
  ).data() as SubmissionIdentityDoc;

const speakers = async (): Promise<(SpeakerDoc & { id: string })[]> =>
  (await db().collection(COLLECTIONS.speakers).get()).docs.map((d) => ({
    id: d.id,
    ...(d.data() as SpeakerDoc),
  }));

const emailsSent = async (): Promise<number> =>
  (await db().collection(COLLECTIONS.emailLog).get()).size;

// ---------------------------------------------------------------------------

describe('a call round-trips', () => {
  it('reads back every value it was created with', async () => {
    const id = await createCall();
    expect(id).toBe(CALL_ID);

    const back = await getCall(id);
    expect(back).not.toBeNull();
    expect(back?.title).toBe('KGC 2027 Call for Abstracts');
    expect(back?.instructions).toBe('Tell us what the work is and why it matters.');
    expect(back?.status).toBe('published');
    expect(back?.opensAtLocal).toBe('2027-01-01T09:00');
    expect(back?.closesAtLocal).toBe('2027-03-31T23:59');
    expect(back?.sessionTypes).toEqual(['talk', 'workshop']);
    expect(back?.trackIds).toEqual(['graph-ml']);
    expect(back?.blindReview).toBe('single-blind');
    expect(back?.reviewsPerSubmission).toBe(3);
    expect(back?.reminderDaysBefore).toEqual([7, 1]);
    expect(back?.notifyEmails).toEqual(['programme@knowledgegraph.tech']);
    expect(back?.formVersion).toBe(1);
    expect(back?.form).toEqual([]);
  });

  it('derives the instants from the wall clock the organizer typed, in the event’s zone', async () => {
    const id = await createCall();
    const back = await getCall(id);

    // 09:00 on 1 January in New York is 14:00 UTC — the offset is -05:00 in
    // January. The point of the assertion is that the *instant* is derived here
    // and not taken from a form, so a server running in UTC and a laptop in
    // Europe agree about when the call opens.
    expect(back?.opensAtMs).toBe(Date.parse('2027-01-01T14:00:00.000Z'));
    // 23:59 on 31 March is inside daylight saving, so -04:00.
    expect(back?.closesAtMs).toBe(Date.parse('2027-04-01T03:59:00.000Z'));
    expect(windowOf(back!, DURING).state).toBe('open');
  });

  it('reads back an edit, and does not reset the form when only the dates moved', async () => {
    const id = await createCall();
    const added = await saveCallField({
      callId: id,
      prompt: 'Why this talk, and why now?',
      kind: 'long-text',
      options: [],
      required: true,
      actor: ACTOR,
    });
    expect(added.ok).toBe(true);

    const edited = await saveCall(
      callInput({ id, closesAtLocal: '2027-04-30T23:59', title: 'KGC 2027 Call for Abstracts' }),
    );
    expect(edited.ok).toBe(true);
    // The deadline moved, so the organizer is told in words rather than left to
    // infer it from a date picker.
    if (edited.ok) expect(edited.message).toMatch(/2027-04-30|2027-04-30 23:59/);

    const back = await getCall(id);
    expect(back?.closesAtLocal).toBe('2027-04-30T23:59');
    expect(back?.form).toHaveLength(1);
    expect(back?.form[0].prompt).toBe('Why this talk, and why now?');
    expect(back?.formVersion).toBe(1);
  });

  it('reopens a cancelled call, and the window says so', async () => {
    const id = await createCall();

    const cancelled = await saveCall(callInput({ id, status: 'cancelled' }));
    expect(cancelled.ok).toBe(true);
    expect(windowOf((await getCall(id))!, DURING).state).toBe('cancelled');

    const reopened = await saveCall(
      callInput({ id, status: 'published', closesAtLocal: '2027-05-31T23:59' }),
    );
    expect(reopened.ok).toBe(true);

    const back = await getCall(id);
    expect(back?.status).toBe('published');
    expect(back?.closesAtLocal).toBe('2027-05-31T23:59');
    expect(windowOf(back!, DURING).state).toBe('open');
  });

  it('refuses a second call at an address that is already on a poster', async () => {
    await createCall();
    const again = await saveCall(callInput());
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/already exists/i);
    expect((await db().collection(COLLECTIONS.calls).get()).size).toBe(1);
  });

  it('refuses a call that closes before it opens, rather than writing one that accepts nothing', async () => {
    const result = await saveCall(
      callInput({ opensAtLocal: '2027-03-31T23:59', closesAtLocal: '2027-01-01T09:00' }),
    );
    expect(result.ok).toBe(false);
    expect((await db().collection(COLLECTIONS.calls).get()).size).toBe(0);
  });

  it('refuses the one address the website cannot serve', async () => {
    const result = await saveCall(callInput({ title: 'Token' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/token/i);
    expect((await db().collection(COLLECTIONS.calls).get()).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('the submission form is versioned rather than frozen', () => {
  it('adds a question without bumping the version, because nobody was asked something else', async () => {
    const id = await createCall();
    await saveCallField({
      callId: id,
      prompt: 'Why this talk?',
      kind: 'long-text',
      options: [],
      required: true,
      actor: ACTOR,
    });
    await saveCallField({
      callId: id,
      prompt: 'Anything you need in the room?',
      kind: 'short-text',
      options: [],
      required: false,
      actor: ACTOR,
    });

    const back = await getCall(id);
    expect(back?.formVersion).toBe(1);
    expect(back?.form.map((f) => f.id)).toEqual(['why-this-talk', 'anything-you-need-in-the-room']);
  });

  it('keeps a question’s id when its wording changes, so answers are not orphaned', async () => {
    const id = await createCall();
    await saveCallField({
      callId: id,
      prompt: 'Why this talk?',
      kind: 'long-text',
      options: [],
      required: true,
      actor: ACTOR,
    });

    const reworded = await saveCallField({
      callId: id,
      id: 'why-this-talk',
      prompt: 'Why this talk, and why now?',
      kind: 'long-text',
      options: [],
      required: true,
      actor: ACTOR,
    });
    expect(reworded.ok).toBe(true);

    const back = await getCall(id);
    expect(back?.form[0].id).toBe('why-this-talk');
    expect(back?.form[0].prompt).toBe('Why this talk, and why now?');
    // Rewording is a breaking change, so the version moves and the old wording
    // is archived — that is what lets an earlier submission still be read under
    // the question it was actually asked.
    expect(back?.formVersion).toBe(2);
    expect(back?.priorVersions).toHaveLength(1);
    expect(back?.priorVersions[0].version).toBe(1);
    expect(back?.priorVersions[0].fields[0].prompt).toBe('Why this talk?');
  });

  it('archives the removed question rather than destroying the answers to it', async () => {
    const id = await createCall();
    await saveCallField({
      callId: id,
      prompt: 'Why this talk?',
      kind: 'long-text',
      options: [],
      required: false,
      actor: ACTOR,
    });

    const removed = await deleteCallField({ callId: id, id: 'why-this-talk', actor: ACTOR });
    expect(removed.ok).toBe(true);

    const back = await getCall(id);
    expect(back?.form).toEqual([]);
    expect(back?.formVersion).toBe(2);
    expect(back?.priorVersions[0].fields[0].id).toBe('why-this-talk');
  });

  it('renumbers the whole form on a move, so two questions sharing an order still swap', async () => {
    const id = await createCall();
    for (const prompt of ['First question', 'Second question', 'Third question']) {
      await saveCallField({
        callId: id,
        prompt,
        kind: 'short-text',
        options: [],
        required: false,
        actor: ACTOR,
      });
    }
    // A form written before this screen existed can hold duplicate orders.
    await db()
      .collection(COLLECTIONS.calls)
      .doc(id)
      .update({
        form: (await getCall(id))!.form.map((f) => ({ ...f, order: 0 })),
      });

    const moved = await moveCallField({
      callId: id,
      id: 'third-question',
      direction: 'up',
      actor: ACTOR,
    });
    expect(moved.ok).toBe(true);

    const back = await getCall(id);
    expect(back?.form.map((f) => f.id)).toEqual([
      'first-question',
      'third-question',
      'second-question',
    ]);
    expect(back?.form.map((f) => f.order)).toEqual([0, 10, 20]);
  });
});

// ---------------------------------------------------------------------------

describe('accept, reject and undo', () => {
  it('records an acceptance as a status and a decision, at round one', async () => {
    await createCall();
    const id = await seedSubmission();

    const result = await decideSubmission({ id, accept: true, notify: false, actor: ACTOR });
    expect(result.ok).toBe(true);

    const after = await raw(id);
    expect(after.status).toBe('accepted');
    expect(after.decision?.by).toBe(ACTOR);
    expect(after.decision?.round).toBe(1);
    expect(after.decision?.at).toBeDefined();
  });

  it('records a rejection the same way, and there is no shape that is both', async () => {
    await createCall();
    const id = await seedSubmission();

    await decideSubmission({ id, accept: false, notify: false, actor: ACTOR });

    const after = await raw(id);
    expect(after.status).toBe('rejected');
    expect(after.decision?.round).toBe(1);
  });

  it('counts a second decision as a second round, because the committee met again', async () => {
    await createCall();
    const id = await seedSubmission();

    await decideSubmission({ id, accept: true, notify: false, actor: ACTOR });
    await decideSubmission({ id, accept: false, notify: false, actor: 'chair@kgc.test' });

    const after = await raw(id);
    expect(after.status).toBe('rejected');
    expect(after.decision?.round).toBe(2);
    expect(after.decision?.by).toBe('chair@kgc.test');
  });

  it('tells nobody unless asked to', async () => {
    await createCall();
    const id = await seedSubmission();

    const quiet = await decideSubmission({ id, accept: true, notify: false, actor: ACTOR });
    expect(quiet.ok).toBe(true);
    expect(await emailsSent()).toBe(0);

    const loud = await decideSubmission({ id, accept: true, notify: true, actor: ACTOR });
    expect(loud.ok).toBe(true);
    // `emailLog` records the attempt whether or not a provider is configured,
    // which is how "we sent it" stops being a claim nobody can check.
    expect(await emailsSent()).toBe(1);
  });

  it('refuses to decide on a draft, because nobody offered it', async () => {
    await createCall();
    const id = await seedSubmission({ status: 'draft' });

    const result = await decideSubmission({ id, accept: true, notify: false, actor: ACTOR });
    expect(result.ok).toBe(false);
    expect((await raw(id)).status).toBe('draft');
    expect((await raw(id)).decision).toBeUndefined();
  });

  it('refuses to decide on a submission its author withdrew', async () => {
    await createCall();
    const id = await seedSubmission({ status: 'withdrawn' });

    const result = await decideSubmission({ id, accept: false, notify: false, actor: ACTOR });
    expect(result.ok).toBe(false);
    expect((await raw(id)).status).toBe('withdrawn');
  });

  it('undoes a decision by deleting the field, not by writing a second flag', async () => {
    await createCall();
    const id = await seedSubmission();
    await decideSubmission({ id, accept: true, notify: false, actor: ACTOR });

    const undone = await undoDecision({ id, actor: ACTOR });
    expect(undone.ok).toBe(true);

    const after = await raw(id);
    expect(after.status).toBe('under-review');
    // Absent, not null and not `{ undone: true }`. `undefined` on an update
    // would have written no key at all and left the old decision standing while
    // the screen said "Saved" — AGENTS.md gotcha 9.
    expect('decision' in after).toBe(false);
    expect((await getSubmission(id))?.decision).toBeUndefined();
  });

  it('refuses to undo a decision that was never made', async () => {
    await createCall();
    const id = await seedSubmission();

    const result = await undoDecision({ id, actor: ACTOR });
    expect(result.ok).toBe(false);
    expect((await raw(id)).status).toBe('submitted');
  });

  it('refuses to undo an acceptance that is already on the agenda', async () => {
    await createCall();
    const id = await seedSubmission();
    await decideSubmission({ id, accept: true, notify: false, actor: ACTOR });
    await promoteSubmission({
      submissionId: id,
      startsAtLocal: '2027-05-04T10:00',
      endsAtLocal: '2027-05-04T10:45',
      actor: ACTOR,
    });

    const result = await undoDecision({ id, actor: ACTOR });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/agenda/i);
    expect((await raw(id)).status).toBe('accepted');
  });
});

// ---------------------------------------------------------------------------

describe('promotion onto the agenda', () => {
  const TIMES = { startsAtLocal: '2027-05-04T10:00', endsAtLocal: '2027-05-04T10:45' };

  async function accepted(over: SeedSubmission = {}): Promise<string> {
    await createCall();
    const id = await seedSubmission(over);
    await decideSubmission({ id, accept: true, notify: false, actor: ACTOR });
    return id;
  }

  it('writes the session as a draft, never straight onto a thousand phones', async () => {
    const id = await accepted();

    const result = await promoteSubmission({ submissionId: id, ...TIMES, actor: ACTOR });
    expect(result.ok).toBe(true);

    const sessions = await db().collection(COLLECTIONS.sessions).get();
    expect(sessions.size).toBe(1);
    const session = sessions.docs[0].data() as SessionDoc;
    expect(session.status).toBe('draft');
    expect(session.title).toBe('Provenance in enterprise knowledge graphs');
    expect(session.format).toBe('talk');
    expect(session.trackIds).toEqual(['graph-ml']);
    expect(session.day).toBe('2027-05-04');
  });

  it('links the session back to the submission, so pressing the button twice is harmless', async () => {
    const id = await accepted();
    await promoteSubmission({ submissionId: id, ...TIMES, actor: ACTOR });

    const expected = deriveSessionId('Provenance in enterprise knowledge graphs', '2027-05-04T10:00');
    expect((await raw(id)).sessionId).toBe(expected);

    const again = await promoteSubmission({ submissionId: id, ...TIMES, actor: ACTOR });
    expect(again.ok).toBe(false);
    expect((await db().collection(COLLECTIONS.sessions).get()).size).toBe(1);
  });

  it('creates the speaker at the derived id when the author is new to the bill', async () => {
    const id = await accepted();
    await promoteSubmission({ submissionId: id, ...TIMES, actor: ACTOR });

    const all = await speakers();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(speakerId('Ada Okonkwo', 'Acme Graphs'));
    expect(all[0].name).toBe('Ada Okonkwo');
    expect(all[0].company).toBe('Acme Graphs');
    expect(all[0].contactEmail).toBe('ada@acme.test');
    expect(all[0].sessionIds).toEqual([
      deriveSessionId('Provenance in enterprise knowledge graphs', '2027-05-04T10:00'),
    ]);
    expect((await identityOf(id)).speakerId).toBe(speakerId('Ada Okonkwo', 'Acme Graphs'));
  });

  it('updates the speaker an accepted author already is, rather than adding a second one', async () => {
    const existingId = speakerId('Ada Okonkwo', 'Acme Graphs');
    await db()
      .collection(COLLECTIONS.speakers)
      .doc(existingId)
      .set({
        eventId: EVENT_ID,
        name: 'Ada Okonkwo',
        company: 'Acme Graphs',
        // Authored by somebody, on a screen this button knows nothing about.
        bio: 'A carefully written biography that took an organizer twenty minutes.',
        photoUrl: 'https://example.test/ada.jpg',
        sessionIds: ['opening-keynote-abc123'],
      });

    const id = await accepted();
    const result = await promoteSubmission({ submissionId: id, ...TIMES, actor: ACTOR });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toMatch(/was already a speaker/);

    const all = await speakers();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(existingId);
    // The talk is added; nothing authored elsewhere is overwritten by it.
    expect(all[0].sessionIds).toEqual([
      'opening-keynote-abc123',
      deriveSessionId('Provenance in enterprise knowledge graphs', '2027-05-04T10:00'),
    ]);
    expect(all[0].bio).toBe('A carefully written biography that took an organizer twenty minutes.');
    expect(all[0].photoUrl).toBe('https://example.test/ada.jpg');
  });

  it('treats an author at a different affiliation as a different person', async () => {
    const id = await accepted({
      author: { name: 'Ada Okonkwo', email: 'ada@northwind.test', affiliation: 'Northwind' },
    });
    await db()
      .collection(COLLECTIONS.speakers)
      .doc(speakerId('Ada Okonkwo', 'Acme Graphs'))
      .set({ eventId: EVENT_ID, name: 'Ada Okonkwo', company: 'Acme Graphs', sessionIds: [] });

    await promoteSubmission({ submissionId: id, ...TIMES, actor: ACTOR });

    const all = await speakers();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.id).sort()).toEqual(
      [speakerId('Ada Okonkwo', 'Acme Graphs'), speakerId('Ada Okonkwo', 'Northwind')].sort(),
    );
  });

  it('refuses to promote anything that has not been accepted', async () => {
    await createCall();
    const id = await seedSubmission();

    const result = await promoteSubmission({ submissionId: id, ...TIMES, actor: ACTOR });
    expect(result.ok).toBe(false);
    expect((await db().collection(COLLECTIONS.sessions).get()).size).toBe(0);
    expect(await speakers()).toHaveLength(0);
  });

  it('refuses a session that ends before it starts, rather than writing a negative talk', async () => {
    const id = await accepted();

    const result = await promoteSubmission({
      submissionId: id,
      startsAtLocal: '2027-05-04T10:45',
      endsAtLocal: '2027-05-04T10:00',
      actor: ACTOR,
    });

    expect(result.ok).toBe(false);
    expect((await db().collection(COLLECTIONS.sessions).get()).size).toBe(0);
    expect(await speakers()).toHaveLength(0);
    expect((await raw(id)).sessionId).toBeUndefined();
  });

  it('refuses a room that does not exist rather than writing a session pointing at nothing', async () => {
    const id = await accepted();

    const result = await promoteSubmission({
      submissionId: id,
      ...TIMES,
      roomId: 'no-such-room',
      actor: ACTOR,
    });

    expect(result.ok).toBe(false);
    expect((await db().collection(COLLECTIONS.sessions).get()).size).toBe(0);
  });

  it('carries the room’s name onto the session when one is given', async () => {
    await db()
      .collection(COLLECTIONS.rooms)
      .doc('bloomberg-165')
      .set({ eventId: EVENT_ID, name: 'Bloomberg 165' });
    const id = await accepted();

    const result = await promoteSubmission({
      submissionId: id,
      ...TIMES,
      roomId: 'bloomberg-165',
      actor: ACTOR,
    });
    expect(result.ok).toBe(true);

    const session = (await db().collection(COLLECTIONS.sessions).get()).docs[0].data() as SessionDoc;
    expect(session.roomId).toBe('bloomberg-165');
    expect(session.roomName).toBe('Bloomberg 165');
  });

  it('leaves nothing behind when the session id is already taken', async () => {
    const id = await accepted();
    const taken = deriveSessionId('Provenance in enterprise knowledge graphs', '2027-05-04T10:00');
    await db()
      .collection(COLLECTIONS.sessions)
      .doc(taken)
      .set({ eventId: EVENT_ID, title: 'Something else entirely', status: 'published' });

    const result = await promoteSubmission({ submissionId: id, ...TIMES, actor: ACTOR });

    expect(result.ok).toBe(false);
    // The transaction is what makes this safe: no speaker, no back-reference,
    // and the session that was already there is untouched.
    expect(await speakers()).toHaveLength(0);
    expect((await raw(id)).sessionId).toBeUndefined();
    expect(
      ((await db().collection(COLLECTIONS.sessions).doc(taken).get()).data() as SessionDoc).title,
    ).toBe('Something else entirely');
  });
});
