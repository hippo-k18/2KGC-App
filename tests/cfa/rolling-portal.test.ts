/**
 * Min's rolling review on the public side (T249), against the emulator: the
 * form that changes with talk or workshop, E1, the page copy's dates, a
 * rejection nobody has been told about, and the speaker's final details.
 *
 * Emails are captured to files (`EMAIL_CAPTURE_DIR`), so the assertions read
 * what was actually written rather than that a send was attempted.
 *
 * Run with: npm run test:cfa
 */
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  COLLECTIONS,
  EVENT_ID,
  type CallCfpSettings,
  type CallFormFieldDef,
  type SubmissionDoc,
} from '@kgc/shared';
import { mintSpeakerToken } from '@kgc/scripts/src/lib/speaker-token';
import { db } from '@/lib/firestore';
import { loadCall, loadOwnSubmission, saveSubmission, type SubmitInput } from '@/lib/submissions';
import { loadPortal, recordDraft } from '@/lib/speaker-portal';
import { saveSpeakerProfileAction } from '@/app/speaker/[token]/actions';

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:cfa');
  }
});

const CALL_ID = 'call-for-speakers-kgc-2027';
const HOUR = 60 * 60 * 1000;
let outbox = '';

async function wipe() {
  await db().recursiveDelete(db().collection(COLLECTIONS.submissions));
  for (const name of [
    COLLECTIONS.calls,
    COLLECTIONS.tracks,
    COLLECTIONS.emailLog,
    COLLECTIONS.emailBodies,
    COLLECTIONS.speakers,
    COLLECTIONS.speakerProfileEdits,
    // The receipt caps count per address per hour; each test starts fresh.
    COLLECTIONS.rateLimits,
  ]) {
    const snap = await db().collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

beforeEach(async () => {
  await wipe();
  outbox = mkdtempSync(path.join(tmpdir(), 't249-portal-'));
  process.env.EMAIL_CAPTURE_DIR = outbox;
});

interface Captured {
  from: string;
  to: string;
  subject: string;
  template: string;
  text: string;
  html: string;
}
const mail = (): Captured[] =>
  readdirSync(outbox)
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(outbox, f), 'utf8')) as Captured);

const FORM: CallFormFieldDef[] = [
  { id: 'audience-level', prompt: 'Audience level', kind: 'choice', options: ['Beginner', 'Expert'], required: true, order: 0 },
  { id: 'workshop-outline', prompt: 'Workshop outline', kind: 'long-text', required: true, order: 10, sessionTypes: ['workshop'] },
];

async function seedCall(
  cfp: CallCfpSettings | null = {},
  instructions = 'Plain.',
  /** Call-level settings on top, e.g. `askTalkLength` (T276). */
  extra: Record<string, unknown> = {},
): Promise<void> {
  const now = Date.now();
  await db()
    .collection(COLLECTIONS.calls)
    .doc(CALL_ID)
    .set({
      eventId: EVENT_ID,
      title: 'Call for Speakers. KGC 2027',
      instructions,
      status: 'published',
      timeZone: 'America/New_York',
      opensAtLocal: '2026-10-01T00:00',
      closesAtLocal: '2027-02-28T23:59',
      opensAt: new Date(now - HOUR),
      closesAt: new Date(now + HOUR),
      sessionTypes: ['talk', 'workshop'],
      trackIds: ['metadata'],
      form: FORM,
      formVersion: 3,
      priorVersions: [],
      blindReview: 'single-blind',
      reviewsPerSubmission: 3,
      reminderDaysBefore: [],
      notifyEmails: [],
      ...(cfp ? { cfp } : {}),
      ...extra,
    });
  await db().collection(COLLECTIONS.tracks).doc('metadata').set({ eventId: EVENT_ID, name: 'Metadata' });
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

const talk = (over: Partial<SubmitInput> = {}): SubmitInput => ({
  title: 'Lineage at scale',
  abstract: words(180),
  trackId: 'metadata',
  sessionType: 'talk',
  durationMinutes: '25',
  answers: { 'audience-level': ['Expert'] },
  authorName: 'Ada Lovelace',
  authorEmail: 'ada@acme.test',
  affiliation: 'Analytical Engines',
  coAuthors: [],
  finish: true,
  ...over,
});

const raw = async (id: string) =>
  (await db().collection(COLLECTIONS.submissions).doc(id).get()).data() as SubmissionDoc;

describe('the form changes with talk or workshop', () => {
  it('asks a workshop its outline and does not ask a talk', async () => {
    await seedCall({}, 'Plain.', { askTalkLength: true });
    const asWorkshop = await saveSubmission(CALL_ID, talk({ sessionType: 'workshop', durationMinutes: undefined }));
    expect(asWorkshop.ok).toBe(false);
    if (!asWorkshop.ok) expect(asWorkshop.fieldErrors?.['workshop-outline']).toBeTruthy();

    const asTalk = await saveSubmission(CALL_ID, talk({ answers: { 'audience-level': ['Expert'], 'workshop-outline': ['x'] } }));
    expect(asTalk.ok).toBe(true);
    if (!asTalk.ok) return;
    const doc = await raw(asTalk.submissionId);
    expect(doc.durationMinutes).toBe(25);
    // The talk was not asked the workshop question, so the answer is not kept.
    expect(doc.answers['workshop-outline']).toBeUndefined();
  });

  it('needs a talk length from the offered ones, 150 to 300 words, and an organisation', async () => {
    await seedCall({}, 'Plain.', { askTalkLength: true });
    const r = await saveSubmission(
      CALL_ID,
      talk({ durationMinutes: '30', abstract: words(149), affiliation: '' }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors?.durationMinutes).toMatch(/how long/);
    expect(r.fieldErrors?.abstract).toMatch(/149 words/);
    expect(r.fieldErrors?.affiliation).toBeTruthy();
    expect((await saveSubmission(CALL_ID, talk({ abstract: words(301) }))).ok).toBe(false);
  });

  it('leaves a call without the settings exactly as it was', async () => {
    await seedCall(null);
    const r = await saveSubmission(CALL_ID, talk({ abstract: words(20), affiliation: '', durationMinutes: undefined }));
    expect(r.ok).toBe(true);
  });
});

describe('E1', () => {
  it('goes once, on the first finished submission, with no brackets', async () => {
    await seedCall({ decisionDate: '2027-03-14' });
    const first = await saveSubmission(CALL_ID, talk());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const sent = mail();
    expect(sent).toHaveLength(1);
    expect(sent[0].template).toBe('cfp-received');
    expect(sent[0].subject).toBe('We received your KGC 2027 submission');
    // No length: the call does not ask for one (T276).
    expect(sent[0].text).toContain('Lineage at scale\nPresentation Talks & Keynotes\n');
    // The owner's copy (T275), from contact@, and no date in it any more.
    expect(sent[0].text).toContain('Thank you for submitting your proposal to the Knowledge Graph Conference (KGC)!');
    expect(sent[0].text).toContain('Best,\nThe KGC Team');
    expect(sent[0].text).not.toContain('Sunday 14 March 2027');
    expect(sent[0].from).toBe('Knowledge Graph Conference <contact@knowledgegraph.tech>');
    expect(sent[0].text).not.toMatch(/\[|—/);

    // The Email Log (T274) keeps it exactly as sent, from contact@ (T275), with the T276 type line.
    const rows = await db().collection(COLLECTIONS.emailLog).where('template', '==', 'cfp-received').get();
    expect(rows.size).toBe(1);
    expect(rows.docs[0].data().hasBody).toBe(true);
    const body = (await db().collection(COLLECTIONS.emailBodies).doc(rows.docs[0].id).get()).data()!;
    expect(body.from).toBe('Knowledge Graph Conference <contact@knowledgegraph.tech>');
    expect(body.replyTo).toBe('contact@knowledgegraph.tech');
    expect(body.text).toBe(sent[0].text);
    expect(body.html).toBe(sent[0].html);

    // A submitted one cannot be edited (T276), so nothing is acknowledged again.
    const again = await saveSubmission(CALL_ID, talk({ title: 'Lineage at scale, revised' }), first.submissionId);
    expect(again.ok).toBe(false);
    expect(mail()).toHaveLength(1);
  });

  it('reads the same while the decision date is unset', async () => {
    await seedCall({});
    await saveSubmission(CALL_ID, talk());
    expect(mail()[0].text).toContain('we will only follow up with submissions that are accepted');
  });
});

describe('the page copy', () => {
  const copy = 'Rolling review.\n\n- Every submission gets a decision by [DECISION DATE] at the latest.\n\nSubmissions close [CLOSE DATE].';

  it('fills set dates and drops sentences with unset ones', async () => {
    await seedCall({ decisionDate: '2027-03-14' }, copy);
    const call = await loadCall(CALL_ID);
    expect(call?.instructions).toContain('by Sunday 14 March 2027 at the latest.');
    expect(call?.instructions).not.toContain('Submissions close');
    expect(call?.instructions).not.toMatch(/\[/);
    expect(call?.cfp?.closeDay).toBeUndefined();
  });
});

describe('a rejection nobody has been told about', () => {
  it('reads as submitted to its author until E4 goes, closed like any other, and stays rejected', async () => {
    await seedCall({});
    const r = await saveSubmission(CALL_ID, talk());
    if (!r.ok) throw new Error(r.error);
    await db().collection(COLLECTIONS.submissions).doc(r.submissionId).update({ status: 'rejected' });

    const own = await loadOwnSubmission(r.submissionId);
    expect(own?.status).toBe('submitted');
    expect(own?.decided).toBeUndefined();
    // Exactly what any submitted one shows (T276): closed, still withdrawable.
    expect(own?.editable).toBe(false);
    expect(own?.withdrawable).toBe(true);
    expect(own?.submittedOn).toBeTruthy();

    const edit = await saveSubmission(CALL_ID, talk({ title: 'Edited' }), r.submissionId);
    expect(edit.ok).toBe(false);
    // Refused with the words any submitted one gets, never a word about a decision.
    if (!edit.ok) expect(edit.error).not.toMatch(/decision|reject/i);
    expect((await raw(r.submissionId)).status).toBe('rejected');
    expect((await raw(r.submissionId)).title).toBe('Lineage at scale');

    await db()
      .collection(COLLECTIONS.submissions)
      .doc(r.submissionId)
      .update({ closeDecision: { version: 'declined', sentAt: new Date(), by: 'x' } });
    expect((await loadOwnSubmission(r.submissionId))?.decided).toBe('rejected');
  });
});

describe('the T276 form', () => {
  const identity = async (id: string) =>
    (await db().collection(COLLECTIONS.submissions).doc(id).collection('identity').doc('author').get()).data();

  it('does not ask a CFP call for a track or a length unless ticked, and stores neither', async () => {
    await seedCall({});
    const call = await loadCall(CALL_ID);
    expect(call?.askTrack).toBe(false);
    expect(call?.askTalkLength).toBe(false);
    expect(call?.tracks).toEqual([]);

    // Posted anyway, by a stale tab or a script: ignored, not refused.
    const r = await saveSubmission(CALL_ID, talk({ trackId: 'metadata', durationMinutes: '25' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = await raw(r.submissionId);
    expect('trackId' in doc).toBe(false);
    expect('durationMinutes' in doc).toBe(false);

    // Nothing is required either: no track, no length, still submits.
    const bare = await saveSubmission(CALL_ID, talk({ trackId: undefined, durationMinutes: undefined, authorEmail: 'b@acme.test' }));
    expect(bare.ok).toBe(true);
  });

  it('keeps a track and length given before the questions were dropped', async () => {
    await seedCall({}, 'Plain.', { askTrack: true, askTalkLength: true });
    const r = await saveSubmission(CALL_ID, talk({ finish: false }));
    if (!r.ok) throw new Error(r.error);
    expect((await raw(r.submissionId)).trackId).toBe('metadata');

    await db().collection(COLLECTIONS.calls).doc(CALL_ID).update({ askTrack: false, askTalkLength: false });
    const done = await saveSubmission(CALL_ID, talk({ trackId: undefined, durationMinutes: undefined }), r.submissionId);
    expect(done.ok).toBe(true);
    const doc = await raw(r.submissionId);
    expect(doc.trackId).toBe('metadata');
    expect(doc.durationMinutes).toBe(25);
  });

  it('asks for a track again when ticked', async () => {
    await seedCall({}, 'Plain.', { askTrack: true });
    const r = await saveSubmission(CALL_ID, talk({ trackId: undefined }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.trackId).toBeTruthy();
  });

  it('stores the phone with the author and the link on the submission', async () => {
    await seedCall({});
    const r = await saveSubmission(CALL_ID, talk({ phone: ' +1 (212) 555-0100 ', resourceLink: 'github.com/acme/lineage' }));
    if (!r.ok) throw new Error(r.error);
    const doc = await raw(r.submissionId);
    expect(doc.resourceLink).toBe('https://github.com/acme/lineage');
    // Contact data lives with the email, never on the document reviewers read.
    expect('phone' in doc).toBe(false);
    expect((await identity(r.submissionId))?.phone).toBe('+1 (212) 555-0100');
    expect((await loadOwnSubmission(r.submissionId))?.author.phone).toBe('+1 (212) 555-0100');
  });

  it('refuses a phone with letters and a link that is not one address', async () => {
    await seedCall({});
    const r = await saveSubmission(CALL_ID, talk({ phone: 'call my office', resourceLink: 'see my slides' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors?.phone).toBeTruthy();
    expect(r.fieldErrors?.resourceLink).toBeTruthy();
  });

  it('clears a phone and a link the author deleted from a draft', async () => {
    await seedCall({});
    const r = await saveSubmission(CALL_ID, talk({ phone: '212 555 0100', resourceLink: 'https://example.org', finish: false }));
    if (!r.ok) throw new Error(r.error);
    await saveSubmission(CALL_ID, talk({ finish: false }), r.submissionId);
    expect('resourceLink' in (await raw(r.submissionId))).toBe(false);
    expect('phone' in ((await identity(r.submissionId)) ?? {})).toBe(false);
  });

  it('takes each of the six types the call offers, with the new ones by their ids', async () => {
    await seedCall({}, 'Plain.', { sessionTypes: ['talk', 'workshop', 'panel', 'hcls', 'poster', 'demo'] });
    for (const sessionType of ['panel', 'hcls', 'poster', 'demo']) {
      const r = await saveSubmission(CALL_ID, talk({ sessionType, authorEmail: `${sessionType}@acme.test` }));
      expect(r.ok).toBe(true);
      if (r.ok) expect((await raw(r.submissionId)).sessionType).toBe(sessionType);
    }
    expect((await loadCall(CALL_ID))?.sessionTypes).toEqual(['talk', 'workshop', 'panel', 'hcls', 'poster', 'demo']);

    // A type the call does not offer is refused.
    await db().collection(COLLECTIONS.calls).doc(CALL_ID).update({ sessionTypes: ['talk', 'workshop'] });
    const off = await saveSubmission(CALL_ID, talk({ sessionType: 'hcls', authorEmail: 'x@acme.test' }));
    expect(off.ok).toBe(false);
  });

  it('prints the type by its name in E1', async () => {
    await seedCall({}, 'Plain.', { sessionTypes: ['talk', 'hcls'] });
    const r = await saveSubmission(CALL_ID, talk({ sessionType: 'hcls', authorEmail: 'hcls-e1@acme.test' }));
    expect(r.ok).toBe(true);
    expect(mail()[0].text).toContain('Lineage at scale\nHealth Care and Life Sciences (HCLS) Symposium');
  });
});

async function accepted(sessionType: 'talk' | 'workshop') {
  await seedCall({});
  const r = await saveSubmission(
    CALL_ID,
    talk(
      sessionType === 'workshop'
        ? { sessionType, durationMinutes: undefined, answers: { 'audience-level': ['Expert'], 'workshop-outline': ['Plan'] } }
        : {},
    ),
  );
  if (!r.ok) throw new Error(r.error);
  await db().collection(COLLECTIONS.submissions).doc(r.submissionId).update({ status: 'accepted' });
  await db().collection(COLLECTIONS.speakers).doc('ada').set({ eventId: EVENT_ID, name: 'Ada Lovelace', sessionIds: [], unlisted: true });
  await db()
    .collection(COLLECTIONS.speakerProfileEdits)
    .doc('ada')
    .set({ eventId: EVENT_ID, speakerId: 'ada', status: 'sent', submissionIds: [r.submissionId] });
  return { id: r.submissionId, token: mintSpeakerToken('ada') };
}

describe('the speaker sends final details', () => {

  it('shows the accepted submission and writes the details onto it', async () => {
    const { id, token } = await accepted('talk');
    const ctx = await loadPortal(token);
    expect(ctx?.submissions.map((s) => s.id)).toEqual([id]);

    const out = await recordDraft(
      token,
      { bio: 'Ada writes programs.' },
      new Map([[id, { title: 'Lineage at scale, final', description: words(30) }]]),
    );
    expect(out.outcome).toBe('saved');
    const doc = await raw(id);
    expect(doc.details?.title).toBe('Lineage at scale, final');
    expect(doc.details?.receivedAt).toBeTruthy();
  });

  it('needs the outline and install list from a workshop', async () => {
    const { id, token } = await accepted('workshop');
    const out = await recordDraft(token, {}, new Map([[id, { title: 'Hands on', description: words(30) }]]));
    expect(out.outcome).toBe('invalid');
    expect(out.errors.join(' ')).toMatch(/outline/);
    expect(out.errors.join(' ')).toMatch(/install/);
    expect((await raw(id)).details).toBeUndefined();
  });
});

/**
 * T250 F1: `detail:__proto__:title` wrote onto `Object.prototype` before the
 * token was even checked, and every page then answered 500. The posts below
 * are T250's curl, as FormData.
 */
describe('the speaker form cannot pollute Object.prototype', () => {
  async function post(fd: FormData): Promise<string> {
    try {
      await saveSpeakerProfileAction(fd);
      return 'returned';
    } catch (err) {
      const digest = (err as { digest?: string }).digest ?? '';
      if (!digest.startsWith('NEXT_REDIRECT')) throw err;
      return digest.split(';')[2];
    }
  }
  const clean = () => {
    const probe = {} as Record<string, unknown>;
    expect(probe.title).toBeUndefined();
    expect(probe.description).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'title')).toBe(false);
  };

  it('refuses a garbage token before reading a field', async () => {
    const fd = new FormData();
    fd.set('token', 'not-a-real-token');
    fd.set('detail:__proto__:title', 'PWNED');
    fd.set('detail:__proto__:description', 'PWNED-D');
    fd.set('detail:constructor:title', 'PWNED');
    fd.set('slides:__proto__', 'PWNED');
    expect(await post(fd)).toBe('/speaker/not-a-real-token');
    clean();
  });

  it('ignores reserved and foreign ids even with a valid token', async () => {
    const { id, token } = await accepted('talk');
    const fd = new FormData();
    fd.set('token', token);
    fd.set('detail:__proto__:title', 'PWNED');
    fd.set('detail:prototype:title', 'PWNED');
    fd.set('detail:sub_somebody_else:title', 'PWNED');
    fd.set(`detail:${id}:title`, 'Final title');
    fd.set(`detail:${id}:description`, words(30));
    expect(await post(fd)).toMatch(/\?r=saved$/);
    clean();
    expect((await raw(id)).details?.title).toBe('Final title');
  });
});
