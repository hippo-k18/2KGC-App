/**
 * The public abstract portal's write path, against a real Firestore emulator.
 *
 * ── Why this suite exists ───────────────────────────────────────────────────
 *
 * `calls`, `submissions` and `submissions/{id}/identity` have **no `match` block
 * in `firestore.rules` and must never get one** (`CFA-PLAN.md` §2): the people
 * this feature is for hold no ticket, so `isRegistered()` is false for them and
 * has to stay false. Every write is the Admin SDK, which bypasses rules
 * entirely — so there is no security boundary underneath `saveSubmission` to
 * catch anything it lets through. `tests/rules` cannot cover a single line of
 * this feature. This file is the only thing standing between the portal and a
 * `curl`.
 *
 * Each test is named after the guarantee it protects, in the same spirit as
 * `tests/rules/firestore.test.ts` and `tests/commerce`. Every one of them
 * corresponds to a way this code has been, or could easily be, wrong:
 *
 *   - a form left open across the deadline posting from a page that was honest
 *     when it rendered, and being accepted;
 *   - a submission id in a form field letting anybody edit anybody's abstract;
 *   - a `formVersion` copied out of the request, so a submission claims to have
 *     been asked questions nobody published;
 *   - an author clearing their affiliation, being told "Saved", and still
 *     carrying the old one — AGENTS.md gotcha 9, which typechecks identically
 *     to the correct form.
 *
 * ── What is exercised, and at which level ───────────────────────────────────
 *
 * The deadline and identity cases go through `submitAction` — the real server
 * action, called with a real `FormData`, exactly as a POST from a browser with
 * no JavaScript reaches it. That is the point: the refusal has to happen with
 * the button irrelevant. The cases about what lands in the document call
 * `saveSubmission` directly, because a redirect is not a fixture.
 *
 * Run with: npm run test:cfa
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  SUBMISSION_IDENTITY_DOC,
  type CallFormFieldDef,
  type SubmissionDoc,
  type SubmissionIdentityDoc,
} from '@kgc/shared';
import { db } from '@/lib/firestore';
import {
  loadCall,
  loadOwnSubmission,
  openCallFor,
  saveSubmission,
  type SubmitInput,
} from '@/lib/submissions';
import { submitAction, withdrawAction } from '@/app/submit/actions';

/**
 * Refuse to run against anything real.
 *
 * These tests write submissions and then assert on them. Pointed at the live
 * project by a stray environment variable they would write into the conference's
 * actual call for abstracts, so the guard is a hard failure rather than a
 * warning — the same guard `tests/commerce` carries.
 */
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set. These tests write real documents and must ' +
        'never run against the live project. Use: npm run test:cfa',
    );
  }
});

const HOUR = 60 * 60 * 1000;
const CALL_ID = 'kgc-2027-abstracts';

/** Everything these tests write, so one case cannot leak into the next. */
async function wipe() {
  // Recursive, because a submission owns an `identity` subcollection and a
  // plain delete of the parent would leave the author behind — which is
  // precisely the orphan `withdrawSubmission` exists to avoid creating.
  await db().recursiveDelete(db().collection(COLLECTIONS.submissions));
  for (const name of [COLLECTIONS.calls, COLLECTIONS.tracks, COLLECTIONS.emailLog]) {
    const snap = await db().collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

beforeEach(wipe);
afterEach(() => {
  vi.useRealTimers();
});

interface SeedCall {
  id?: string;
  status?: string;
  opensAt?: Date;
  closesAt?: Date;
  form?: CallFormFieldDef[];
  formVersion?: number;
  sessionTypes?: string[];
  trackIds?: string[];
  eventId?: string;
}

/**
 * A call, written straight to Firestore rather than through `saveCall`.
 *
 * The organizer's writer is exercised next door in `organizer.test.ts`; here
 * the call is a fixture, and building it directly is what lets a window sit
 * exactly on a boundary or the wrong way round — neither of which `saveCall`
 * will produce, because it refuses them.
 */
async function seedCall(over: SeedCall = {}): Promise<string> {
  const id = over.id ?? CALL_ID;
  const now = Date.now();
  await db()
    .collection(COLLECTIONS.calls)
    .doc(id)
    .set({
      eventId: over.eventId ?? EVENT_ID,
      title: 'Call for Abstracts',
      instructions: 'Tell us what the work is.',
      status: over.status ?? 'published',
      timeZone: 'America/New_York',
      opensAtLocal: '2027-01-01T09:00',
      closesAtLocal: '2027-03-31T23:59',
      opensAt: over.opensAt ?? new Date(now - HOUR),
      closesAt: over.closesAt ?? new Date(now + HOUR),
      sessionTypes: over.sessionTypes ?? ['talk', 'workshop'],
      trackIds: over.trackIds ?? ['graph-ml', 'industry'],
      form: over.form ?? [],
      formVersion: over.formVersion ?? 1,
      priorVersions: [],
      blindReview: 'single-blind',
      reviewsPerSubmission: 3,
      reminderDaysBefore: [7, 1],
      notifyEmails: [],
    });
  await db().collection(COLLECTIONS.tracks).doc('graph-ml').set({ eventId: EVENT_ID, name: 'Graph ML' });
  await db().collection(COLLECTIONS.tracks).doc('industry').set({ eventId: EVENT_ID, name: 'Industry' });
  return id;
}

const good = (over: Partial<SubmitInput> = {}): SubmitInput => ({
  title: 'Provenance in enterprise knowledge graphs',
  abstract:
    'A report on three years of running a provenance layer over a knowledge graph that ' +
    'four business units write to, and what it cost.',
  trackId: 'graph-ml',
  sessionType: 'talk',
  answers: {},
  authorName: 'Ada Okonkwo',
  authorEmail: 'ada@acme.test',
  affiliation: 'Acme Graphs',
  bio: 'Principal engineer.',
  coAuthors: [],
  finish: true,
  ...over,
});

/** The same values, as the POST the browser actually sends. */
function formOf(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    callId: CALL_ID,
    title: good().title,
    abstract: good().abstract,
    trackId: 'graph-ml',
    sessionType: 'talk',
    authorName: 'Ada Okonkwo',
    authorEmail: 'ada@acme.test',
    affiliation: 'Acme Graphs',
    bio: 'Principal engineer.',
    coAuthors: '',
    finish: '1',
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v);
  return fd;
}

/**
 * Where a successful action sent the browser.
 *
 * `redirect()` signals by throwing, so a test that does not catch reads as a
 * failure rather than as a success. The digest is Next's own
 * `NEXT_REDIRECT;replace;<url>;307;`.
 */
async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    const returned = await run();
    throw new Error(`Expected a redirect; the action returned ${JSON.stringify(returned)}`);
  } catch (err) {
    const digest = (err as { digest?: unknown }).digest;
    if (typeof digest !== 'string' || !digest.startsWith('NEXT_REDIRECT')) throw err;
    return digest.split(';')[2];
  }
}

const tokenIn = (url: string) => url.replace(/^.*\/submit\/token\//, '').replace(/\?.*$/, '');

const raw = async (id: string): Promise<SubmissionDoc> =>
  (await db().collection(COLLECTIONS.submissions).doc(id).get()).data() as SubmissionDoc;

const identityOf = async (id: string): Promise<SubmissionIdentityDoc | undefined> =>
  (
    await db()
      .collection(COLLECTIONS.submissions)
      .doc(id)
      .collection(SUBCOLLECTIONS.identity)
      .doc(SUBMISSION_IDENTITY_DOC)
      .get()
  ).data() as SubmissionIdentityDoc | undefined;

const count = async (): Promise<number> =>
  (await db().collection(COLLECTIONS.submissions).get()).size;

/** A submission that already exists, for the edit cases. */
async function existing(over: Partial<SubmitInput> = {}) {
  const result = await saveSubmission(CALL_ID, good(over));
  if (!result.ok) throw new Error(`fixture did not save: ${result.error}`);
  return result;
}

// ---------------------------------------------------------------------------

describe('the abstract an author writes is the abstract that comes back', () => {
  it('stores every field the form carried, and reads them all back', async () => {
    await seedCall();

    const out = await saveSubmission(
      CALL_ID,
      good({ coAuthors: [{ name: 'Jae Vance', affiliation: 'Northwind' }] }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const back = await loadOwnSubmission(out.submissionId);
    expect(back).not.toBeNull();
    expect(back?.title).toBe(good().title);
    expect(back?.abstract).toBe(good().abstract);
    expect(back?.trackId).toBe('graph-ml');
    expect(back?.sessionType).toBe('talk');
    expect(back?.status).toBe('submitted');
    expect(back?.author.name).toBe('Ada Okonkwo');
    expect(back?.author.email).toBe('ada@acme.test');
    expect(back?.author.affiliation).toBe('Acme Graphs');
    expect(back?.author.coAuthors).toEqual([{ name: 'Jae Vance', affiliation: 'Northwind' }]);
  });

  it('saves a draft with almost nothing, because a draft that refuses to save is a draft nobody keeps', async () => {
    await seedCall();
    const out = await saveSubmission(CALL_ID, good({ title: '', abstract: '', finish: false }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.status).toBe('draft');
    expect((await raw(out.submissionId)).status).toBe('draft');
  });

  it('refuses a draft with no address, because that is a draft its author can never reach again', async () => {
    await seedCall();
    const out = await saveSubmission(CALL_ID, good({ authorEmail: '', finish: false }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.fieldErrors?.authorEmail).toBeTruthy();
    expect(await count()).toBe(0);
  });

  it('does not restamp submittedAt when the author fixes a typo afterwards', async () => {
    await seedCall();
    const first = await existing();
    if (!first.ok) return;
    const before = (await raw(first.submissionId)).submittedAt;

    await saveSubmission(CALL_ID, good({ title: 'A better title' }), first.submissionId);
    const after = await raw(first.submissionId);

    expect(after.title).toBe('A better title');
    expect((after.submittedAt as { toMillis(): number }).toMillis()).toBe(
      (before as unknown as { toMillis(): number }).toMillis(),
    );
  });

  it('refuses an edit once a decision has been made', async () => {
    await seedCall();
    const first = await existing();
    if (!first.ok) return;
    await db()
      .collection(COLLECTIONS.submissions)
      .doc(first.submissionId)
      .update({ status: 'accepted' });

    const out = await saveSubmission(CALL_ID, good({ title: 'Sneaky rewrite' }), first.submissionId);
    expect(out.ok).toBe(false);
    expect((await raw(first.submissionId)).title).toBe(good().title);
  });
});

// ---------------------------------------------------------------------------

describe('the deadline is refused by the server action, whatever the page rendered', () => {
  it('refuses a submission to a call that has closed', async () => {
    await seedCall({ opensAt: new Date(Date.now() - 2 * HOUR), closesAt: new Date(Date.now() - HOUR) });

    const state = await submitAction({}, formOf());

    expect(state.error).toMatch(/closed/i);
    expect(await count()).toBe(0);
  });

  it('refuses a submission to a call that has not opened yet', async () => {
    await seedCall({ opensAt: new Date(Date.now() + HOUR), closesAt: new Date(Date.now() + 2 * HOUR) });

    const state = await submitAction({}, formOf());

    expect(state.error).toMatch(/not opened yet/i);
    expect(await count()).toBe(0);
  });

  it('refuses a submission to a call that is still a draft', async () => {
    await seedCall({ status: 'draft' });

    const state = await submitAction({}, formOf());

    expect(state.error).toBeTruthy();
    expect(await count()).toBe(0);
  });

  it('refuses a submission to a call that was cancelled', async () => {
    await seedCall({ status: 'cancelled' });

    const state = await submitAction({}, formOf());

    expect(state.error).toMatch(/withdrawn/i);
    expect(await count()).toBe(0);
  });

  it('accepts a submission at the instant the call opens, because the open is inclusive', async () => {
    const opensAt = new Date('2027-01-01T14:00:00.000Z');
    await seedCall({ opensAt, closesAt: new Date('2027-03-31T23:59:00.000Z') });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(opensAt);

    const url = await redirectOf(() => submitAction({}, formOf()));

    expect(url).toContain('/submit/token/');
    expect(await count()).toBe(1);
  });

  it('refuses a submission at the instant the call closes, because the close is exclusive', async () => {
    const closesAt = new Date('2027-03-31T23:59:00.000Z');
    await seedCall({ opensAt: new Date('2027-01-01T14:00:00.000Z'), closesAt });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(closesAt);

    const state = await submitAction({}, formOf());

    expect(state.error).toMatch(/closed/i);
    expect(await count()).toBe(0);
  });

  it('accepts a submission one millisecond before the close', async () => {
    const closesAt = new Date('2027-03-31T23:59:00.000Z');
    await seedCall({ opensAt: new Date('2027-01-01T14:00:00.000Z'), closesAt });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(closesAt.getTime() - 1);

    await redirectOf(() => submitAction({}, formOf()));
    expect(await count()).toBe(1);
  });

  it('fails shut on a call whose window is the wrong way round', async () => {
    const now = Date.now();
    await seedCall({ opensAt: new Date(now + HOUR), closesAt: new Date(now - HOUR) });

    const state = await submitAction({}, formOf());

    expect(state.error).toMatch(/closed/i);
    expect(await count()).toBe(0);
  });

  it('refuses an edit after the close, so a tab left open cannot extend the deadline', async () => {
    await seedCall();
    const first = await existing();
    if (!first.ok) return;

    await db()
      .collection(COLLECTIONS.calls)
      .doc(CALL_ID)
      .update({ closesAt: new Date(Date.now() - HOUR) });

    const state = await submitAction({}, formOf({ token: first.token, title: 'Rewritten late' }));

    expect(state.error).toMatch(/closed/i);
    expect((await raw(first.submissionId)).title).toBe(good().title);
  });

  it('says the call is not there at all when it belongs to another event', async () => {
    await seedCall({ eventId: 'some-other-conference' });

    const state = await submitAction({}, formOf());

    expect(state.error).toBeTruthy();
    expect(await count()).toBe(0);
    expect(await loadCall(CALL_ID)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('a submission token reaches one submission and nothing else', () => {
  it('resolves to its own submission', async () => {
    await seedCall();
    const mine = await existing({ title: 'Mine' });
    const theirs = await existing({ title: 'Theirs', authorEmail: 'other@acme.test' });
    if (!mine.ok || !theirs.ok) return;

    const back = await loadOwnSubmission(mine.submissionId);
    expect(back?.title).toBe('Mine');
    expect(back?.id).toBe(mine.submissionId);
    expect(back?.id).not.toBe(theirs.submissionId);
  });

  it('edits the submission named by the token and not one named by a form field', async () => {
    await seedCall();
    const mine = await existing({ title: 'Mine' });
    const theirs = await existing({ title: 'Theirs', authorEmail: 'other@acme.test' });
    if (!mine.ok || !theirs.ok) return;

    await redirectOf(() =>
      submitAction(
        {},
        formOf({
          token: mine.token,
          // Every plausible spelling of "edit that one instead". None of them
          // is read: the only submission id this action trusts is the `sid`
          // inside a verified HMAC.
          id: theirs.submissionId,
          submissionId: theirs.submissionId,
          sid: theirs.submissionId,
          title: 'Overwritten',
        }),
      ),
    );

    expect((await raw(mine.submissionId)).title).toBe('Overwritten');
    expect((await raw(theirs.submissionId)).title).toBe('Theirs');
  });

  it('mints a new id rather than writing to one the request named', async () => {
    await seedCall();
    const theirs = await existing({ title: 'Theirs' });
    if (!theirs.ok) return;

    const url = await redirectOf(() =>
      submitAction({}, formOf({ id: theirs.submissionId, title: 'Mine' })),
    );

    expect(await count()).toBe(2);
    expect((await raw(theirs.submissionId)).title).toBe('Theirs');
    expect(tokenIn(url)).not.toBe(theirs.token);
  });

  it('refuses a token whose signature has been tampered with', async () => {
    await seedCall();
    const mine = await existing({ title: 'Mine' });
    if (!mine.ok) return;

    const [body, signature] = mine.token.split('.');
    /*
     * A character in the middle, not the last one. A 32-byte HMAC is 43
     * base64url characters and the final character carries only two significant
     * bits, so several values of it decode to the *same* bytes — flipping it is
     * a tamper that verifies about half the time, and a test that passes half
     * the time is worse than none.
     */
    const flipped = `${body}.${signature.slice(0, 5)}${signature[5] === 'A' ? 'B' : 'A'}${signature.slice(6)}`;

    const state = await submitAction({}, formOf({ token: flipped, title: 'Forged' }));

    expect(state.error).toMatch(/not valid/i);
    expect((await raw(mine.submissionId)).title).toBe('Mine');
  });

  it('refuses a token whose body has been swapped for another submission', async () => {
    await seedCall();
    const mine = await existing({ title: 'Mine' });
    const theirs = await existing({ title: 'Theirs', authorEmail: 'other@acme.test' });
    if (!mine.ok || !theirs.ok) return;

    // The signature from one link, the payload naming the other. This is the
    // attack the HMAC exists to refuse, and it is the one a naive `atob` +
    // `JSON.parse` would let straight through.
    const forged = `${theirs.token.split('.')[0]}.${mine.token.split('.')[1]}`;

    const state = await submitAction({}, formOf({ token: forged, title: 'Forged' }));

    expect(state.error).toMatch(/not valid/i);
    expect((await raw(theirs.submissionId)).title).toBe('Theirs');
  });

  it('refuses a token signed with a different secret', async () => {
    await seedCall();
    const mine = await existing({ title: 'Mine' });
    if (!mine.ok) return;

    const body = Buffer.from(
      JSON.stringify({ t: 'sub', sid: mine.submissionId, iat: Date.now() }),
      'utf8',
    ).toString('base64url');
    const forged = `${body}.${createHmac('sha256', 'a-secret-this-deployment-does-not-have')
      .update(body)
      .digest('base64url')}`;

    const state = await submitAction({}, formOf({ token: forged, title: 'Forged' }));

    expect(state.error).toMatch(/not valid/i);
    expect((await raw(mine.submissionId)).title).toBe('Mine');
  });

  it('refuses a correctly signed token of another family, so an order link is not a submission link', async () => {
    await seedCall();
    const mine = await existing({ title: 'Mine' });
    if (!mine.ok) return;

    // Signed with the real secret — every token family in `@kgc/scripts` falls
    // back to `WEB_ORDER_SECRET`, so under a shared key the signature alone
    // cannot say which family a body belongs to. `t` is what keeps them apart.
    const body = Buffer.from(
      JSON.stringify({ t: 'ord', sid: mine.submissionId, iat: Date.now() }),
      'utf8',
    ).toString('base64url');
    const forged = `${body}.${createHmac('sha256', process.env.WEB_ORDER_SECRET as string)
      .update(body)
      .digest('base64url')}`;

    const state = await submitAction({}, formOf({ token: forged, title: 'Forged' }));

    expect(state.error).toMatch(/not valid/i);
    expect((await raw(mine.submissionId)).title).toBe('Mine');
  });

  it('refuses a valid token whose submission has been deleted rather than creating it again', async () => {
    await seedCall();
    const mine = await existing({ title: 'Mine' });
    if (!mine.ok) return;
    await db().recursiveDelete(db().collection(COLLECTIONS.submissions).doc(mine.submissionId));

    const state = await submitAction({}, formOf({ token: mine.token }));

    expect(state.error).toMatch(/no longer exists/i);
    expect(await count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('the form version on a submission is the one the call was at', () => {
  it('ignores a formVersion supplied by the request', async () => {
    await seedCall({ formVersion: 2 });

    const url = await redirectOf(() =>
      submitAction({}, formOf({ formVersion: '99', 'q_formVersion': '99' })),
    );

    const snap = await db().collection(COLLECTIONS.submissions).get();
    expect(snap.size).toBe(1);
    expect((snap.docs[0].data() as SubmissionDoc).formVersion).toBe(2);
    expect(url).toContain('/submit/token/');
  });

  it('stamps the version the call is at, not the one it started at', async () => {
    await seedCall({ formVersion: 1 });
    const first = await existing({ title: 'First' });
    if (!first.ok) return;
    expect((await raw(first.submissionId)).formVersion).toBe(1);

    await db().collection(COLLECTIONS.calls).doc(CALL_ID).update({ formVersion: 4 });
    const second = await saveSubmission(CALL_ID, good({ title: 'Second' }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect((await raw(second.submissionId)).formVersion).toBe(4);
    // The first is untouched: a version bump is not a rewrite of what people
    // were already asked.
    expect((await raw(first.submissionId)).formVersion).toBe(1);
  });

  it('stores only answers to questions the call actually asks', async () => {
    await seedCall({
      form: [
        { id: 'why', prompt: 'Why this talk?', kind: 'short-text', required: false, order: 0 },
      ] as CallFormFieldDef[],
    });

    const out = await saveSubmission(
      CALL_ID,
      good({ answers: { why: ['Because'], 'not-a-question': ['injected'] } }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    expect((await raw(out.submissionId)).answers).toEqual({ why: 'Because' });
  });
});

// ---------------------------------------------------------------------------

describe('a field an author clears is actually cleared', () => {
  it('does not silently keep an affiliation the author deleted', async () => {
    await seedCall();
    const first = await existing({ affiliation: 'Acme Graphs' });
    if (!first.ok) return;
    expect((await identityOf(first.submissionId))?.affiliation).toBe('Acme Graphs');

    await redirectOf(() => submitAction({}, formOf({ token: first.token, affiliation: '' })));

    const after = await identityOf(first.submissionId);
    expect(after).toBeDefined();
    expect('affiliation' in (after as object)).toBe(false);
    expect((await loadOwnSubmission(first.submissionId))?.author.affiliation).toBeUndefined();
  });

  it('does not silently keep a bio the author deleted', async () => {
    await seedCall();
    const first = await existing({ bio: 'Principal engineer.' });
    if (!first.ok) return;

    await redirectOf(() => submitAction({}, formOf({ token: first.token, bio: '' })));

    expect('bio' in ((await identityOf(first.submissionId)) as object)).toBe(false);
  });

  it('does not leave an author in a track they removed', async () => {
    await seedCall();
    const first = await existing({ trackId: 'graph-ml' });
    if (!first.ok) return;

    // A draft, because a finished submission to a call that offers tracks has
    // to name one. Clearing it is exactly the case gotcha 9 bites hardest on:
    // a record permanently pointing at the wrong thing.
    const out = await saveSubmission(
      CALL_ID,
      good({ trackId: undefined, finish: false }),
      first.submissionId,
    );
    expect(out.ok).toBe(true);

    expect('trackId' in (await raw(first.submissionId))).toBe(false);
  });

  it('does not leave an author offering a session type they removed', async () => {
    await seedCall();
    const first = await existing({ sessionType: 'talk' });
    if (!first.ok) return;

    const out = await saveSubmission(
      CALL_ID,
      good({ sessionType: undefined, finish: false }),
      first.submissionId,
    );
    expect(out.ok).toBe(true);

    expect('sessionType' in (await raw(first.submissionId))).toBe(false);
  });

  it('does not keep an answer the author emptied', async () => {
    await seedCall({
      form: [
        { id: 'why', prompt: 'Why this talk?', kind: 'short-text', required: false, order: 0 },
        { id: 'needs', prompt: 'Anything you need?', kind: 'long-text', required: false, order: 10 },
      ] as CallFormFieldDef[],
    });

    const first = await saveSubmission(
      CALL_ID,
      good({ answers: { why: ['Because'], needs: ['A whiteboard'] } }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect((await raw(first.submissionId)).answers).toEqual({
      why: 'Because',
      needs: 'A whiteboard',
    });

    /*
     * The author deletes the second answer and saves. `answers` is a map, and a
     * map under `set(…, { merge: true })` merges key by key — so an answer left
     * out of the write survives unless it is explicitly deleted. AGENTS.md
     * gotcha 9 names this case in as many words: "Nested maps need the same
     * care: under merge they merge key by key, so name every key on every write
     * rather than sending a partial map."
     */
    await redirectOf(() =>
      submitAction({}, formOf({ token: first.token, q_why: 'Because', q_needs: '' })),
    );

    expect((await raw(first.submissionId)).answers).toEqual({ why: 'Because' });
  });

  it('keeps an answer to a question the organizers have since withdrawn', async () => {
    await seedCall({
      form: [
        { id: 'why', prompt: 'Why this talk?', kind: 'short-text', required: false, order: 0 },
        { id: 'needs', prompt: 'Anything you need?', kind: 'short-text', required: false, order: 10 },
      ] as CallFormFieldDef[],
    });
    const first = await saveSubmission(
      CALL_ID,
      good({ answers: { why: 'Because'.split('|'), needs: ['A whiteboard'] } }),
    );
    if (!first.ok) return;

    // The committee removes the second question. `calls.ts` archives it rather
    // than destroying the answers, and this is the half of that promise that
    // lives on the portal: a later edit must not quietly finish the job.
    await db()
      .collection(COLLECTIONS.calls)
      .doc(CALL_ID)
      .update({
        form: [
          { id: 'why', prompt: 'Why this talk?', kind: 'short-text', required: false, order: 0 },
        ],
        formVersion: 2,
      });

    await redirectOf(() =>
      submitAction({}, formOf({ token: first.token, q_why: 'Because, still' })),
    );

    expect((await raw(first.submissionId)).answers).toEqual({
      why: 'Because, still',
      needs: 'A whiteboard',
    });
  });
});

// ---------------------------------------------------------------------------

describe('withdrawing', () => {
  it('changes the status and deletes nothing, so no author is left orphaned', async () => {
    await seedCall();
    const mine = await existing();
    if (!mine.ok) return;

    const fd = new FormData();
    fd.set('token', mine.token);
    await redirectOf(() => withdrawAction(fd));

    expect((await raw(mine.submissionId)).status).toBe('withdrawn');
    expect(await identityOf(mine.submissionId)).toBeDefined();
    expect(await count()).toBe(1);
  });

  it('cannot be done to somebody else’s submission with a forged token', async () => {
    await seedCall();
    const theirs = await existing();
    if (!theirs.ok) return;

    const fd = new FormData();
    fd.set('token', `${theirs.token.split('.')[0]}.not-a-signature`);
    const url = await redirectOf(() => withdrawAction(fd));

    expect(url).toBe('/');
    expect((await raw(theirs.submissionId)).status).toBe('submitted');
  });
});

// ---------------------------------------------------------------------------

/**
 * `openCallFor` — how `/call-for-posters` decides where its button goes.
 *
 * `CFA-PLAN.md` §6 held the poster page's EasyChair link in place *"until phase
 * 4 is live: half a pipeline is worse than an external one that works"*. It is
 * live, so the page now asks this function on every request and links to
 * `/submit/{callId}` when the answer is a call. Everything below is a way that
 * decision could be wrong in a direction that costs somebody a submission.
 *
 * ⚠️ It must agree with `loadCall`'s refusal to the millisecond, because both
 * read `callWindow` and a page that advertises a call the server action would
 * refuse is worse than a page that sends people to EasyChair.
 */
describe('the poster page’s choice of submission link', () => {
  it('finds nothing when there are no calls at all — the branch that renders today', async () => {
    expect(await openCallFor('poster')).toBeNull();
  });

  it('finds an open call that accepts posters', async () => {
    await seedCall({ sessionTypes: ['talk', 'poster'] });

    const open = await openCallFor('poster');
    expect(open?.id).toBe(CALL_ID);
    expect(open?.closesAtLocal).toBe('2027-03-31T23:59');
    expect(open?.timeZone).toBe('America/New_York');
  });

  it('ignores an open call that does not take posters, so a poster is not sent to a talks-only call', async () => {
    await seedCall({ sessionTypes: ['talk', 'workshop'] });
    expect(await openCallFor('poster')).toBeNull();
  });

  it('ignores a draft call, which nobody outside the dashboard may know exists', async () => {
    await seedCall({ status: 'draft', sessionTypes: ['poster'] });
    expect(await openCallFor('poster')).toBeNull();
  });

  it('ignores a cancelled call', async () => {
    await seedCall({ status: 'cancelled', sessionTypes: ['poster'] });
    expect(await openCallFor('poster')).toBeNull();
  });

  it('ignores a call that has closed, so the page falls back rather than collecting a refused write', async () => {
    await seedCall({
      sessionTypes: ['poster'],
      opensAt: new Date(Date.now() - 2 * HOUR),
      closesAt: new Date(Date.now() - HOUR),
    });
    expect(await openCallFor('poster')).toBeNull();
  });

  it('ignores a call that has not opened yet', async () => {
    await seedCall({
      sessionTypes: ['poster'],
      opensAt: new Date(Date.now() + HOUR),
      closesAt: new Date(Date.now() + 2 * HOUR),
    });
    expect(await openCallFor('poster')).toBeNull();
  });

  it('ignores another event’s call', async () => {
    await seedCall({ eventId: 'kgc-2028', sessionTypes: ['poster'] });
    expect(await openCallFor('poster')).toBeNull();
  });

  it('picks the call closing first when two are running', async () => {
    await seedCall({
      id: 'closes-later',
      sessionTypes: ['poster'],
      closesAt: new Date(Date.now() + 10 * HOUR),
    });
    await seedCall({
      id: 'closes-sooner',
      sessionTypes: ['poster'],
      closesAt: new Date(Date.now() + HOUR),
    });

    expect((await openCallFor('poster'))?.id).toBe('closes-sooner');
  });
});
