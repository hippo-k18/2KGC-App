/**
 * Tests for `firestore.rules`, which is the entire security boundary of this app —
 * there is no server in the read path.
 *
 * Each test is named after the guarantee it protects, not the code path it walks,
 * because the point of the suite is to be a list of sentences you could say to an
 * attendee about what the app does with their data.
 *
 * Run with: npm run test:rules
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  increment,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const A = 'attendeeA';
const B = 'attendeeB';
const ORG = 'organizerU';

let env: RulesTestEnvironment;

/** A ticket holder. The `registered` claim is what the gate actually checks. */
const attendee = (uid: string) => ({
  registered: true,
  roles: ['attendee'],
  email: `${uid}@kgc.test`,
  email_verified: true,
});

/**
 * A project id unique to this process, not the fixed `kgc-rules-test`.
 *
 * `beforeEach` calls `clearFirestore()`, which wipes everything under the project
 * id — so two runs of this suite against the same emulator delete each other's
 * fixtures mid-test. That is not hypothetical: with several agents working in one
 * tree it produced 11 failures and then 134 passes on consecutive runs with no
 * change in between, every one of them passing in isolation. A suite that is the
 * only thing standing between this file and 1,000 attendees' data must not be a
 * coin flip, and a false green is the worse half of that.
 *
 * The emulator creates project namespaces on demand, so this costs nothing.
 */
const PROJECT_ID = `kgc-rules-test-${process.pid}`;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
    },
  });
});

afterAll(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  // Fixtures are written with rules disabled so the suite tests reads and writes
  // against real data rather than against an empty database, where almost
  // everything fails for the wrong reason.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Four registrations, because "is this row mine" is the whole predicate and
    // every shape it has to answer for is here: the caller's own, somebody
    // else's, one reached through an alternate address, and one written before
    // `altEmails` existed at all.
    await setDoc(doc(db, 'registrations/reg_001'), {
      email: `${A}@kgc.test`, altEmails: [], name: 'A', ticketType: 'All Access',
      status: 'active', qrSecret: 'secret-belonging-to-A', claimCode: 'AAAAAA',
    });
    await setDoc(doc(db, 'registrations/reg_002'), {
      email: `${B}@kgc.test`, altEmails: [], name: 'B', ticketType: 'Standard',
      status: 'active', qrSecret: 'secret-belonging-to-B', claimCode: 'BBBBBB',
    });
    // Registered under an assistant's address, with the attendee's own listed as
    // an alternate — the case the `altEmails` field exists for. Stored lowercased,
    // which is a requirement rather than a habit: rules cannot map over a list, so
    // alternates are compared verbatim and only `normaliseEmail()` may write them.
    await setDoc(doc(db, 'registrations/reg_alias'), {
      email: 'assistant@kgc.test', altEmails: [`${A}@kgc.test`.toLowerCase()],
      status: 'active', qrSecret: 'secret-reached-by-alias',
    });
    // The same alternate, stored with the capital letter it was typed with. It
    // must NOT match, and the test that says so is the documentation for why the
    // importer has to normalise.
    await setDoc(doc(db, 'registrations/reg_alias_mixedcase'), {
      email: 'assistant2@kgc.test', altEmails: [`${A}@kgc.test`],
      status: 'active', qrSecret: 'secret-behind-a-capital-letter',
    });
    // No `altEmails` key at all. Dereferencing an absent field throws in rules,
    // which Firestore reports as permission-denied — so without a default this
    // shape is a badge that will not load for the oldest registrations only.
    await setDoc(doc(db, 'registrations/reg_legacy'), {
      email: `${A}@kgc.test`, status: 'active', qrSecret: 'secret-from-before-altEmails',
    });
    // A cancelled ticket, so "you may not revive your own registration" is
    // testable against a status that is genuinely not `active`.
    await setDoc(doc(db, 'registrations/reg_cancelled'), {
      email: `${A}@kgc.test`, altEmails: [], status: 'cancelled',
      qrSecret: 'secret-of-a-cancelled-ticket',
    });

    // Check-in. `checkInLists/{listId}/checkIns/{registrationId}` — keyed by
    // registration, which is what makes a second scan a create that fails.
    await setDoc(doc(db, 'checkInLists/event-door'), {
      eventId: 'kgc-2027', name: 'KGC 2027 — Main Door', kind: 'event',
    });
    await setDoc(doc(db, 'checkInLists/event-door/checkIns/reg_001'), {
      registrationId: 'reg_001', stationId: 'dev_desk1', operatorUid: ORG,
    });
    await setDoc(doc(db, 'checkInLists/event-door/checkIns/reg_002'), {
      registrationId: 'reg_002', stationId: 'dev_desk1', operatorUid: ORG,
    });
    // A check-in naming a registration that has since been deleted, so "the
    // ownership lookup found nothing" is exercised rather than assumed.
    await setDoc(doc(db, 'checkInLists/event-door/checkIns/reg_deleted'), {
      registrationId: 'reg_deleted', stationId: 'dev_desk1',
    });
    await setDoc(doc(db, 'scanEvents/dev_desk1_scan-1'), {
      eventId: 'kgc-2027', deviceId: 'dev_desk1', clientScanId: 'scan-1',
      qrSecret: 'secret-belonging-to-A', listId: 'event-door', result: 'ok',
    });
    await setDoc(doc(db, 'checkInStations/dev_desk1'), {
      eventId: 'kgc-2027', label: 'Front desk 1', deviceId: 'dev_desk1',
    });
    await setDoc(doc(db, 'sessions/s1'), { title: 'Keynote', status: 'published' });
    await setDoc(doc(db, 'sessions/draft1'), { title: 'Unannounced keynote', status: 'draft' });
    await setDoc(doc(db, 'speakers/sp1'), { name: 'A Speaker' });
    await setDoc(doc(db, 'tracks/t1'), { name: 'Graph Data Science' });
    await setDoc(doc(db, 'sponsors/sp'), { name: 'Sponsor', tier: 'gold' });
    await setDoc(doc(db, 'sponsors/sp/leads/' + B), { uid: B, email: 'b@kgc.test' });
    await setDoc(doc(db, 'announcements/a1'), { title: 'Hello' });
    // The exhibitor hall in both of its shapes: the server-only record with the
    // booking contact and the pass allocation on it, and the slim projection the
    // app is allowed to read. Two documents rather than one, because the whole
    // guarantee is that the first never reaches a client and the second does.
    await setDoc(doc(db, 'exhibitors/ex1'), {
      eventId: 'kgc-2027', name: 'Graphwise', boothNumber: 'E01',
      contactName: 'Priya Raman', contactEmail: 'priya@graphwise.example.invalid',
      passesAllocated: 4, passesUsed: 4, status: 'confirmed',
    });
    await setDoc(doc(db, 'booths/E01'), {
      eventId: 'kgc-2027', number: 'E01', size: '6m × 2m', zone: 'Catering aisle',
      exhibitorId: 'ex1', exhibitorName: 'Graphwise', orderId: 'ord_1', status: 'assigned',
    });
    await setDoc(doc(db, 'exhibitorListings/ex1'), {
      eventId: 'kgc-2027', exhibitorId: 'ex1', name: 'Graphwise', boothNumber: 'E01',
      description: 'Graph database tooling.',
    });
    // A published survey and a draft one, so the `status` predicate is exercised
    // in both directions on both verbs — and one response, belonging to A, so
    // "somebody else may not read mine" is tested against a document that exists.
    await setDoc(doc(db, 'surveys/sv1'), {
      eventId: 'kgc-2027', title: 'Opening session — your feedback',
      questions: [{ id: 'q1', prompt: 'How useful?', kind: 'rating', required: false }],
      status: 'published', responseCount: 1,
    });
    await setDoc(doc(db, 'surveys/svDraft'), {
      eventId: 'kgc-2027', title: 'Unasked questions',
      questions: [{ id: 'q1', prompt: 'Draft', kind: 'text', required: false }],
      status: 'draft', responseCount: 0,
    });
    await setDoc(doc(db, `surveys/sv1/responses/${A}`), {
      uid: A, answers: { q1: 5 },
    });
    /*
     * Consent. A published form at version 2 and a draft one, plus two
     * signatures against the published form: A's, written in the app, and one
     * written through the website's capability link on behalf of a speaker who
     * has no account at all.
     *
     * The second one is not decoration. It has no `uid` field, and a rule that
     * dereferenced `resource.data.uid` rather than reading it with a default
     * would throw on it — which Firestore reports as permission-denied, so the
     * symptom would be A's own signature becoming unreadable the moment a
     * speaker signed the same form.
     */
    await setDoc(doc(db, 'consentForms/cf_photo'), {
      eventId: 'kgc-2027', title: 'Photography and recording release',
      body: 'You agree to be photographed. Version two of the wording.',
      version: 2, bodyHash: 'hash-of-version-two', audience: 'attendee',
      required: true, status: 'published',
    });
    await setDoc(doc(db, 'consentForms/cf_draft'), {
      eventId: 'kgc-2027', title: 'Volunteer waiver',
      body: 'Still being argued about.',
      version: 1, bodyHash: 'hash-of-the-draft', audience: 'volunteer',
      required: false, status: 'draft',
    });
    await setDoc(doc(db, `consentForms/cf_photo/responses/${A}_v2`), {
      formId: 'cf_photo', formVersion: 2, bodyHash: 'hash-of-version-two',
      audience: 'attendee', signatory: A, uid: A, email: `${A}@kgc.test`,
      signedName: 'Attendee A', agreed: true, signedAt: new Date(), channel: 'app',
    });
    await setDoc(doc(db, 'consentForms/cf_photo/responses/spk_alpha_v2'), {
      formId: 'cf_photo', formVersion: 2, bodyHash: 'hash-of-version-two',
      audience: 'attendee', signatory: 'spk_alpha', email: 'speaker@kgc.test',
      signedName: 'A Speaker', agreed: true, signedAt: new Date(), channel: 'link',
      ip: '203.0.113.9', userAgent: 'Mozilla/5.0',
    });
    /*
     * The call for abstracts, one document in each of the five collections it
     * adds. None of them may reach a client, and an assertion made against a
     * document that is not there passes for the wrong reason — the emulator
     * denies a read of a missing document just as firmly as a forbidden one.
     *
     * The identity document is the one to look at. It is a subcollection
     * document holding the name, affiliation and address of somebody whose
     * abstract is sitting anonymously in `submissions/sub_001`, so any client
     * able to read it — directly or through a collection-group query — has
     * undone blind review for the whole call in one request.
     */
    await setDoc(doc(db, 'calls/kgc-2027-abstracts'), {
      eventId: 'kgc-2027', title: 'KGC 2027 — call for abstracts',
      instructions: 'Tell us about the graph you built.', status: 'published',
      formVersion: 2, blindReview: 'single-blind', reviewsPerSubmission: 3,
    });
    await setDoc(doc(db, 'submissions/sub_001'), {
      eventId: 'kgc-2027', callId: 'kgc-2027-abstracts',
      title: 'Ontology reuse at scale', abstract: 'An unpublished abstract.',
      trackId: 't1', status: 'under-review', formVersion: 2,
      submitterTokenHash: 'hash-of-the-submitter-nonce',
      reviewsAssigned: 1, reviewsSubmitted: 0,
    });
    await setDoc(doc(db, 'submissions/sub_001/identity/author'), {
      eventId: 'kgc-2027', submissionId: 'sub_001', callId: 'kgc-2027-abstracts',
      name: 'Amara Okafor', email: 'amara@example.invalid',
      affiliation: 'A university', coAuthors: [],
    });
    await setDoc(doc(db, 'submissions/sub_001/reviews/rev_001'), {
      eventId: 'kgc-2027', submissionId: 'sub_001', callId: 'kgc-2027-abstracts',
      reviewerId: 'rev_001', status: 'assigned', conflict: false,
    });
    await setDoc(doc(db, 'reviewers/rev_001'), {
      eventId: 'kgc-2027', name: 'A Reviewer', email: 'reviewer@example.invalid',
      trackIds: ['t1'], status: 'accepted',
      inviteTokenHash: 'hash-of-the-reviewer-nonce',
      maxAssignments: 8, assignedCount: 1,
    });
    await setDoc(doc(db, `users/${A}`), {
      email: `${A}@kgc.test`, name: 'A', roles: ['attendee'], visibleInDirectory: true,
    });
    await setDoc(doc(db, `users/${B}`), {
      email: `${B}@kgc.test`, name: 'B', roles: ['attendee'], visibleInDirectory: true,
    });
    await setDoc(doc(db, `directory/${A}`), { uid: A, name: 'A' });
    await setDoc(doc(db, 'communityPosts/p1'), {
      authorId: A, title: 'T', body: 'B', status: 'visible', replyCount: 0, reactionCount: 0,
    });
    // Two replies with different authors, because most of what can go wrong
    // with a reply is somebody acting on one that is not theirs.
    await setDoc(doc(db, 'communityPosts/p1/replies/r1'), { authorId: A, body: 'mine' });
    await setDoc(doc(db, 'communityPosts/p1/replies/r2'), { authorId: B, body: 'theirs' });
    await setDoc(doc(db, 'communityPosts/p1/reactions/' + A), { uid: A, emoji: '👍' });
    await setDoc(doc(db, 'sessions/s1/questions/q1'), {
      authorId: A, body: 'Q?', upvoteCount: 0, answered: false, state: 'pending',
    });
    // `PollDoc.options` is `{id, label}[]` and `tallies` is `Record<id, number>`
    // — the tally key set is what a ballot's `optionIds` are validated against,
    // so a fixture shaped as two bare arrays tested a rule that cannot exist.
    await setDoc(doc(db, 'sessions/s1/polls/openPoll'), {
      question: 'Pick',
      options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      open: true, tallies: { a: 0, b: 0 }, totalVotes: 0,
    });
    await setDoc(doc(db, 'sessions/s1/polls/closedPoll'), {
      question: 'Done',
      options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      open: false, tallies: { a: 1, b: 1 }, totalVotes: 2,
    });
    await setDoc(doc(db, `sessions/s1/polls/openPoll/votes/${A}`), {
      uid: A, optionIds: ['a'],
    });
    // The private per-user subcollections, so "another attendee cannot read
    // this" is tested against a document that exists.
    await setDoc(doc(db, `users/${A}/savedSessions/s1`), { sessionId: 's1', remind: true });
    await setDoc(doc(db, `users/${A}/savedContacts/${B}`), { contactUid: B });
    await setDoc(doc(db, `users/${A}/notifications/n1`), {
      type: 'announcement', title: 'Room change', body: 'Keynote moved to Hall B', read: false,
    });
    await setDoc(doc(db, `users/${A}/fcmTokens/tok1`), { token: 'tok1', platform: 'ios' });
    // One attendee's own seat at a round table. The plan it is projected from
    // (`gatherings/{id}`) is deliberately absent from this file and from the
    // rules: it carries every other name at the table and the organizer's notes.
    await setDoc(doc(db, `users/${A}/gatherings/g1`), {
      eventId: 'kgc-2027', gatheringId: 'g1', kind: 'round-table',
      title: 'Ontologies over lunch', roomName: 'Bloomberg 165', day: '2027-05-04',
      startsAtLocal: '12:30', endsAtLocal: '13:30', seatName: 'A', status: 'confirmed',
    });
    // The two settings bags that decide the shape of the rule: one is the
    // emergency card every phone may read, the other holds a code read out from
    // the stage and a note written for the check-in desk. They are two documents
    // in one collection, which is the whole reason the key is in the predicate.
    await setDoc(doc(db, 'settings/logistics'), {
      eventId: 'kgc-2027',
      values: {
        emergencyNumber: '911', assemblyPoint: 'The Tata plaza, by the flagpole',
        onSiteLead: 'Tim', planReady: true,
      },
    });
    await setDoc(doc(db, 'settings/access'), {
      eventId: 'kgc-2027',
      values: { eventCode: 'KGC-2027-DOORS', staffNote: 'Press passes at desk 2.' },
    });
    await setDoc(doc(db, 'settings/branding'), {
      eventId: 'kgc-2027', values: { tagline: 'The knowledge graph event of the year' },
    });
    // Thread id is the two uids sorted and joined with '_'. Both sides start
    // with something unread, so "you may not zero the OTHER person's badge" is
    // testable at all — from zero it is indistinguishable from leaving it alone.
    await setDoc(doc(db, `threads/${A}_${B}`), {
      participantIds: [A, B], unread: { [A]: 3, [B]: 2 },
    });
    await setDoc(doc(db, `threads/${A}_${B}/messages/m1`), { senderId: A, body: 'hi' });
  });
});

const unauth = () => env.unauthenticatedContext().firestore();
const noClaim = () => env.authenticatedContext('randomUser', {}).firestore();
const asA = () => env.authenticatedContext(A, attendee(A)).firestore();
const asB = () => env.authenticatedContext(B, attendee(B)).firestore();
const asOrg = () =>
  env.authenticatedContext(ORG, {
    registered: true, roles: ['attendee', 'organizer'],
    email: `${ORG}@kgc.test`, email_verified: true,
  }).firestore();
/** An `organizer` role with no ticket behind it — a claim set that should never exist. */
const asOrgNoTicket = () =>
  env.authenticatedContext('orgNoTicket', {
    roles: ['organizer'], email: 'orgNoTicket@kgc.test',
  }).firestore();

/**
 * Signed in with a ticket holder's address, but holding no ticket.
 *
 * This is the account anybody can make: sign-up is open, and knowing somebody's
 * email address is not a secret. It exists because the registration and check-in
 * rules match on the address, so the `registered` claim is the *only* thing
 * standing between "I know Amara's email" and "I have Amara's badge secret".
 * Mutation testing found that gap: dropping `isRegistered()` from the ownership
 * predicate broke nothing, because no context in this file combined a matching
 * address with a missing claim.
 */
const asImposter = () =>
  env.authenticatedContext('imposter', {
    email: `${A}@kgc.test`, email_verified: true,
  }).firestore();

describe('the gate', () => {
  it('refuses an unauthenticated reader', async () => {
    await assertFails(getDoc(doc(unauth(), 'sessions/s1')));
  });

  it('refuses a signed-in user who is not a ticket holder', async () => {
    // The likeliest real breach: anyone can create a Firebase account.
    await assertFails(getDoc(doc(noClaim(), 'sessions/s1')));
    await assertFails(getDocs(collection(noClaim(), 'speakers')));
    await assertFails(getDoc(doc(noClaim(), 'announcements/a1')));
  });

  it('refuses an organizer role that has no ticket behind it', async () => {
    // `registered` and `roles` are minted together by the sign-in function, so
    // a token holding `organizer` without `registered` did not come from it.
    // The prize for that combination was `/users` — the attendee table, with
    // everybody's email address in it.
    await assertFails(getDocs(collection(asOrgNoTicket(), 'users')));
    await assertFails(getDoc(doc(asOrgNoTicket(), `users/${A}`)));
    await assertFails(getDoc(doc(asOrgNoTicket(), 'sessions/draft1')));
    await assertFails(updateDoc(doc(asOrgNoTicket(), 'sessions/s1'), { title: 'Cancelled' }));
  });

  it('admits a ticket holder to event content', async () => {
    await assertSucceeds(getDoc(doc(asA(), 'sessions/s1')));
    await assertSucceeds(getDocs(collection(asA(), 'speakers')));
    await assertSucceeds(getDocs(collection(asA(), 'tracks')));
    await assertSucceeds(getDocs(collection(asA(), 'sponsors')));
    await assertSucceeds(getDocs(collection(asA(), 'announcements')));
  });
});

describe('profiles and the directory', () => {
  it('hides a full profile from other attendees', async () => {
    // Other attendees get the `directory` projection, never `users`.
    await assertFails(getDoc(doc(asB(), `users/${A}`)));
  });

  it('lets you read your own profile', async () => {
    await assertSucceeds(getDoc(doc(asA(), `users/${A}`)));
  });

  it('lets an organizer read a profile', async () => {
    await assertSucceeds(getDoc(doc(asOrg(), `users/${A}`)));
  });

  it('refuses writes to another attendee’s profile', async () => {
    await assertFails(updateDoc(doc(asB(), `users/${A}`), { name: 'hacked' }));
  });

  it('refuses self-promotion via the roles field', async () => {
    await assertFails(updateDoc(doc(asA(), `users/${A}`), { roles: ['organizer'] }));
  });

  it('refuses a change of email on your own profile', async () => {
    await assertFails(updateDoc(doc(asA(), `users/${A}`), { email: 'x@kgc.test' }));
  });

  it('allows the profile fields onboarding actually edits', async () => {
    await assertSucceeds(
      updateDoc(doc(asA(), `users/${A}`), { name: 'A Real Name', company: 'Acme' }),
    );
  });

  it('refuses a malicious photoURL on your own profile', async () => {
    // The same beacon risk `mirrorDirectory` guards against on the way into
    // `directory/{uid}`, closed here at the source on `users/{uid}` itself —
    // see the docblock on `isFirebaseStorageUrl()` in firestore.rules.
    await assertFails(
      updateDoc(doc(asA(), `users/${A}`), { photoURL: 'https://attacker.example/beacon.png' }),
    );
  });

  it('accepts a genuine Firebase Storage photoURL on your own profile', async () => {
    await assertSucceeds(
      updateDoc(doc(asA(), `users/${A}`), {
        photoURL: 'https://firebasestorage.googleapis.com/v0/b/kgc-conference-app-and-website.appspot.com/o/avatars%2Fa?alt=media',
      }),
    );
  });

  it('lets an unrelated profile edit through even if photoURL was already invalid', async () => {
    // The photoURL check is gated on THIS write actually touching the field —
    // an attendee whose photoURL predates this rule must still be able to
    // rename themselves without being blocked by a field they never touched.
    const db = env.authenticatedContext('legacy-photo', attendee('legacy-photo')).firestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/legacy-photo'), {
        email: 'legacy-photo@kgc.test', roles: ['attendee'],
        photoURL: 'https://attacker.example/beacon.png',
      });
    });
    await assertSucceeds(updateDoc(doc(db, 'users/legacy-photo'), { name: 'Renamed' }));
  });

  it('refuses replacing an already-valid photoURL with a malicious one', async () => {
    const db = env.authenticatedContext('has-photo', attendee('has-photo')).firestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/has-photo'), {
        email: 'has-photo@kgc.test', roles: ['attendee'],
        photoURL: 'https://firebasestorage.googleapis.com/v0/b/kgc-conference-app-and-website.appspot.com/o/avatars%2Fold?alt=media',
      });
    });
    await assertFails(
      updateDoc(doc(db, 'users/has-photo'), { photoURL: 'https://attacker.example/beacon.png' }),
    );
  });

  it('lets you replace an invalid legacy photoURL with a genuine one', async () => {
    const db = env.authenticatedContext('legacy-photo-2', attendee('legacy-photo-2')).firestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/legacy-photo-2'), {
        email: 'legacy-photo-2@kgc.test', roles: ['attendee'],
        photoURL: 'https://attacker.example/beacon.png',
      });
    });
    await assertSucceeds(
      updateDoc(doc(db, 'users/legacy-photo-2'), {
        photoURL: 'https://firebasestorage.googleapis.com/v0/b/kgc-conference-app-and-website.appspot.com/o/avatars%2Ffixed?alt=media',
      }),
    );
  });

  it('lets an attendee with no profile yet save a privacy switch', async () => {
    // `me/index.tsx` writes this with `setDoc(..., {merge: true})`, and a merge
    // onto a document that does not exist is a CREATE carrying two fields. The
    // create rule demanded `email` and `roles`, so the privacy toggle failed
    // outright for every attendee the seed had not written a profile for —
    // which is every real attendee.
    await assertSucceeds(
      setDoc(
        doc(env.authenticatedContext('newcomer', attendee('newcomer')).firestore(),
          'users/newcomer'),
        { visibleInDirectory: false, updatedAt: new Date() },
        { merge: true },
      ),
    );
  });

  /**
   * `mustChangePassword` is the flag that keeps the temporary password from
   * becoming somebody's permanent credential: the server stamps it true on an
   * account provisioned with that password, and the app refuses to render any
   * route until the attendee has cleared it. The rule therefore has to let a
   * client write it — and let it travel one way only.
   */
  it('lets an attendee clear mustChangePassword on their own profile', async () => {
    await assertSucceeds(
      updateDoc(
        doc(env.authenticatedContext(A, attendee(A)).firestore(), `users/${A}`),
        { mustChangePassword: false, updatedAt: new Date() },
      ),
    );
  });

  it('refuses to let a client raise mustChangePassword', async () => {
    // A client that could set it true could strand itself behind a prompt with
    // nothing to satisfy — and, on any future screen that writes another user's
    // document, strand somebody else.
    await assertFails(
      updateDoc(
        doc(env.authenticatedContext(A, attendee(A)).firestore(), `users/${A}`),
        { mustChangePassword: true, updatedAt: new Date() },
      ),
    );
  });

  it('refuses to let one attendee clear the flag on another profile', async () => {
    await assertFails(
      updateDoc(
        doc(env.authenticatedContext(B, attendee(B)).firestore(), `users/${A}`),
        { mustChangePassword: false, updatedAt: new Date() },
      ),
    );
  });

  it('still refuses an unrelated field alongside a legitimate flag clear', async () => {
    // The allowlist is what stops `mustChangePassword` becoming a carrier for
    // a write that would otherwise be rejected.
    await assertFails(
      updateDoc(
        doc(env.authenticatedContext(A, attendee(A)).firestore(), `users/${A}`),
        { mustChangePassword: false, roles: ['organizer'], updatedAt: new Date() },
      ),
    );
  });

  it('still pins roles on a profile created client-side', async () => {
    // The relaxation above must not become a way to arrive as an organizer.
    const db = env.authenticatedContext('newcomer', attendee('newcomer')).firestore();
    await assertFails(
      setDoc(doc(db, 'users/newcomer'), {
        email: 'newcomer@kgc.test', name: 'N', roles: ['organizer'],
      }),
    );
    await assertFails(
      setDoc(doc(db, 'users/newcomer'), {
        email: 'someone.else@kgc.test', name: 'N', roles: ['attendee'],
      }),
    );
  });

  it('refuses a malicious photoURL on a profile created client-side', async () => {
    const db = env.authenticatedContext('newcomer', attendee('newcomer')).firestore();
    await assertFails(
      setDoc(doc(db, 'users/newcomer'), {
        email: 'newcomer@kgc.test', name: 'N', photoURL: 'https://attacker.example/beacon.png',
      }),
    );
  });

  it('refuses deletion of a profile by anyone', async () => {
    await assertFails(deleteDoc(doc(asA(), `users/${A}`)));
    await assertFails(deleteDoc(doc(asOrg(), `users/${A}`)));
  });

  it('lets anyone registered read the directory projection', async () => {
    await assertSucceeds(getDocs(collection(asB(), 'directory')));
  });

  it('lets you opt yourself OUT by deleting your own entry', async () => {
    // The privacy switch. Until the mirrorDirectory trigger exists the client
    // does this, so it has to be permitted — and has to be permitted only for
    // your own entry.
    await assertSucceeds(deleteDoc(doc(asA(), `directory/${A}`)));
  });

  it('lets you opt yourself back IN', async () => {
    await assertSucceeds(
      setDoc(doc(asB(), `directory/${B}`), {
        eventId: 'kgc-2027', uid: B, name: 'B', interests: [],
      }),
    );
  });

  it('refuses to let you delete somebody else from the directory', async () => {
    await assertFails(deleteDoc(doc(asB(), `directory/${A}`)));
  });

  it('refuses a directory entry written under someone else’s uid', async () => {
    await assertFails(
      setDoc(doc(asB(), `directory/${A}`), { eventId: 'kgc-2027', uid: A, name: 'spoof' }),
    );
    // …including one at your own path but claiming another uid inside.
    await assertFails(
      setDoc(doc(asB(), `directory/${B}`), { eventId: 'kgc-2027', uid: A, name: 'spoof' }),
    );
  });

  it('refuses a directory entry with no name', async () => {
    // Not pedantry: `directory.ts` sorts on `name.localeCompare` inside the
    // snapshot success callback, which is NOT covered by the error handler. A
    // nameless entry white-screens the People tab for all 1,000 attendees.
    await assertFails(
      setDoc(doc(asB(), `directory/${B}`), { eventId: 'kgc-2027', uid: B }),
    );
  });

  it('refuses a directory name that is not a string', async () => {
    await assertFails(
      setDoc(doc(asB(), `directory/${B}`), { eventId: 'kgc-2027', uid: B, name: 12345 }),
    );
  });

  it('refuses an oversized directory entry', async () => {
    // The whole directory is fetched by every device; the budget is ~450 bytes
    // each. One attendee must not be able to blow it for everyone.
    await assertFails(
      setDoc(doc(asB(), `directory/${B}`), {
        eventId: 'kgc-2027', uid: B, name: 'x'.repeat(500),
      }),
    );
  });

  it('refuses interests that are not a bounded list', async () => {
    await assertFails(
      setDoc(doc(asB(), `directory/${B}`), {
        eventId: 'kgc-2027', uid: B, name: 'B', interests: 7,
      }),
    );
    await assertFails(
      setDoc(doc(asB(), `directory/${B}`), {
        eventId: 'kgc-2027', uid: B, name: 'B',
        interests: Array.from({ length: 40 }, (_, i) => `t${i}`),
      }),
    );
  });

  it('refuses a client-supplied photo URL in the directory', async () => {
    // Rendered by `avatar.tsx` in every attendee's list — an attacker-controlled
    // URL is a beacon that harvests 1,000 IP addresses. Only the mirror trigger
    // sets this, from the profile.
    await assertFails(
      setDoc(doc(asB(), `directory/${B}`), {
        eventId: 'kgc-2027', uid: B, name: 'B',
        photoURL: 'https://attacker.example/beacon.png',
      }),
    );
  });

  it('refuses smuggling extra fields into the directory projection', async () => {
    // The projection is a closed field set — it must not become a channel for
    // arbitrary data readable by all 1,000 attendees.
    await assertFails(
      setDoc(doc(asB(), `directory/${B}`), {
        eventId: 'kgc-2027', uid: B, name: 'B', email: 'b@kgc.test',
      }),
    );
  });
});

describe('private per-user storage', () => {
  it('hides your personal agenda from another attendee', async () => {
    // Which sessions you attend is a map of what you work on and who you are
    // avoiding. It is nobody's but yours.
    await assertFails(getDoc(doc(asB(), `users/${A}/savedSessions/s1`)));
    await assertFails(getDocs(collection(asB(), `users/${A}/savedSessions`)));
    await assertSucceeds(getDocs(collection(asA(), `users/${A}/savedSessions`)));
  });

  it('hides your saved contacts from another attendee', async () => {
    await assertFails(getDoc(doc(asB(), `users/${A}/savedContacts/${B}`)));
    await assertFails(getDocs(collection(asB(), `users/${A}/savedContacts`)));
  });

  it('hides your notifications from another attendee', async () => {
    await assertFails(getDoc(doc(asB(), `users/${A}/notifications/n1`)));
    await assertFails(getDocs(collection(asB(), `users/${A}/notifications`)));
  });

  it('hides your push tokens from another attendee', async () => {
    // A device token is a handle for sending a notification to somebody's
    // pocket, so leaking one is worse than leaking most of the profile.
    await assertFails(getDoc(doc(asB(), `users/${A}/fcmTokens/tok1`)));
    await assertFails(getDocs(collection(asB(), `users/${A}/fcmTokens`)));
  });

  it('refuses writes into another attendee’s private storage', async () => {
    await assertFails(
      setDoc(doc(asB(), `users/${A}/savedSessions/draft1`), { sessionId: 'draft1' }),
    );
    await assertFails(
      setDoc(doc(asB(), `users/${A}/fcmTokens/spoof`), { token: 'spoof', platform: 'ios' }),
    );
  });

  it('lets marking a notification read do only that', async () => {
    // "Read" is a one-bit acknowledgement. If it could carry the rest of the
    // document with it, an attendee could rewrite the body of an announcement
    // the server sent them and then screenshot it.
    await assertSucceeds(
      updateDoc(doc(asA(), `users/${A}/notifications/n1`), { read: true }),
    );
    await assertFails(
      updateDoc(doc(asA(), `users/${A}/notifications/n1`), {
        read: true, body: 'Keynote cancelled, go home',
      }),
    );
    await assertFails(deleteDoc(doc(asA(), `users/${A}/notifications/n1`)));
  });

  it('refuses an unregistered account using it as free storage', async () => {
    // These three paths gated on "is this your own uid" and nothing else, and
    // anyone can create a Firebase account. Storage billed to the conference by
    // people who never bought a ticket.
    const db = noClaim();
    await assertFails(
      setDoc(doc(db, 'users/randomUser/savedSessions/s1'), { sessionId: 's1' }),
    );
    await assertFails(
      setDoc(doc(db, 'users/randomUser/savedContacts/x'), { contactUid: 'x' }),
    );
    await assertFails(
      setDoc(doc(db, 'users/randomUser/fcmTokens/t'), { token: 't', platform: 'ios' }),
    );
  });

  it('still lets a ticket holder save a session and a contact', async () => {
    await assertSucceeds(
      setDoc(doc(asA(), 'users/' + A + '/savedSessions/s1'), {
        sessionId: 's1', savedAt: new Date(), remind: true,
      }),
    );
    await assertSucceeds(deleteDoc(doc(asA(), `users/${A}/savedSessions/s1`)));
    await assertSucceeds(
      setDoc(doc(asA(), `users/${A}/savedContacts/${B}`), {
        contactUid: B, note: 'met at the poster session', savedAt: new Date(),
      }),
    );
    // …but not as a place to keep a megabyte of unrelated data.
    await assertFails(
      setDoc(doc(asA(), `users/${A}/savedContacts/${B}`), {
        contactUid: B, note: 'x'.repeat(2000), savedAt: new Date(),
      }),
    );
    await assertFails(
      setDoc(doc(asA(), `users/${A}/savedSessions/s1`), {
        sessionId: 's1', payload: 'x'.repeat(500),
      }),
    );
  });
});

describe('the ticket list', () => {
  // The ticket list used to be closed to clients outright. It cannot stay that
  // way: `qrSecret` lives here and it *is* the badge, and there is no server in
  // the read path to hand it over — no Cloud Functions, Spark plan, rules only.
  // So the invariant narrowed from "nobody may read this" to "only the holder
  // may read their own row, and nobody may enumerate it". Every way of asking
  // for somebody else's row is below, because the guest list is the
  // commercially sensitive asset in this database.
  it('is not enumerable by anyone, including organizers', async () => {
    await assertFails(getDocs(collection(asA(), 'registrations')));
    await assertFails(getDocs(collection(asOrg(), 'registrations')));
  });

  it('lets a ticket holder read their own registration', async () => {
    await assertSucceeds(getDoc(doc(asA(), 'registrations/reg_001')));
  });

  it('hides one attendee’s registration from another', async () => {
    await assertFails(getDoc(doc(asA(), 'registrations/reg_002')));
    await assertFails(getDoc(doc(asB(), 'registrations/reg_001')));
  });

  it('hides a registration from an organizer client too', async () => {
    // The console reads registrations with the Admin SDK, which bypasses rules.
    // An organizer holding a browser tab is still a client, and $1,199-a-seat
    // contact details are not something a role should hand over.
    await assertFails(getDoc(doc(asOrg(), 'registrations/reg_001')));
  });

  it('refuses an unauthenticated reader and one with no ticket', async () => {
    await assertFails(getDoc(doc(unauth(), 'registrations/reg_001')));
    await assertFails(getDoc(doc(noClaim(), 'registrations/reg_001')));
  });

  it('refuses an account that knows a ticket holder’s address but holds no ticket', async () => {
    // Sign-up is open and an email address is not a secret, so this account is
    // free to create. The `registered` claim is the only thing between it and
    // somebody else's badge secret — matching on the address alone is not
    // authentication, it is a lookup key.
    await assertFails(getDoc(doc(asImposter(), 'registrations/reg_001')));
    await assertFails(
      getDocs(
        query(collection(asImposter(), 'registrations'), where('email', '==', `${A}@kgc.test`)),
      ),
    );
    await assertFails(
      updateDoc(doc(asImposter(), 'registrations/reg_001'), { claimedByUid: 'imposter' }),
    );
    await assertFails(getDoc(doc(asImposter(), 'checkInLists/event-door/checkIns/reg_001')));
  });

  it('lets a holder find their registration by their own address', async () => {
    // This is how the badge screen finds it: the document id is
    // `reg_` + sha256(email) and the app does not hash, so it queries. The rule
    // is satisfied for every document the filter can return.
    await assertSucceeds(
      getDocs(query(collection(asA(), 'registrations'), where('email', '==', `${A}@kgc.test`))),
    );
  });

  it('refuses a query filtered to somebody else’s address', async () => {
    // The membership oracle that matters. Without this the collection is a way
    // to ask "does this person hold a ticket" about anybody.
    await assertFails(
      getDocs(query(collection(asA(), 'registrations'), where('email', '==', `${B}@kgc.test`))),
    );
  });

  it('recognises an alternate address the registration lists', async () => {
    await assertSucceeds(getDoc(doc(asA(), 'registrations/reg_alias')));
    await assertFails(getDoc(doc(asB(), 'registrations/reg_alias')));
  });

  it('matches the primary address whatever case it was stored in', async () => {
    // The fixture stores `attendeeA@kgc.test` with a capital A while the token
    // carries the lowercased form. Comparing one folded side against one verbatim
    // side is a badge that works for most people and refuses for whoever typed a
    // capital letter — which is exactly how this rule failed first time.
    await assertSucceeds(getDoc(doc(asA(), 'registrations/reg_001')));
  });

  it('does not match an alternate address stored in the wrong case', async () => {
    // Not a nice property, but a true one, and it belongs in the test file rather
    // than in a surprise at a door: rules cannot fold the case of a list's
    // entries, so `altEmails` must be written already normalised.
    await assertFails(getDoc(doc(asA(), 'registrations/reg_alias_mixedcase')));
  });

  it('still works on a registration written before altEmails existed', async () => {
    // An absent field dereferenced in rules throws, and Firestore reports that
    // as permission-denied — so the failure mode is a badge that loads for
    // recent registrations and not for imported ones.
    await assertSucceeds(getDoc(doc(asA(), 'registrations/reg_legacy')));
  });

  it('lets the holder attach their registration to their own account', async () => {
    await assertSucceeds(
      updateDoc(doc(asA(), 'registrations/reg_001'), { claimedByUid: A }),
    );
  });

  it('refuses claiming a registration for a different account', async () => {
    await assertFails(updateDoc(doc(asA(), 'registrations/reg_001'), { claimedByUid: B }));
  });

  it('refuses claiming somebody else’s registration', async () => {
    await assertFails(updateDoc(doc(asA(), 'registrations/reg_002'), { claimedByUid: A }));
  });

  it('refuses rotating the badge secret under cover of a claim', async () => {
    // `qrSecret` may already be printed on a badge in somebody's hand. The
    // claim allowlist is what stops a client invalidating it.
    await assertFails(
      updateDoc(doc(asA(), 'registrations/reg_001'), {
        claimedByUid: A,
        qrSecret: 'a-secret-of-my-own-choosing',
      }),
    );
  });

  it('refuses reviving a cancelled ticket, or upgrading one, while claiming it', async () => {
    // A cancelled ticket is the scanner's `cancelled` verdict and a trip to the
    // registration desk. Claiming it in the app must not be a way to make it
    // `active` again, and must not be a way to promote Standard to All Access.
    await assertFails(
      updateDoc(doc(asA(), 'registrations/reg_cancelled'), { claimedByUid: A, status: 'active' }),
    );
    await assertFails(
      updateDoc(doc(asA(), 'registrations/reg_001'), {
        claimedByUid: A,
        ticketType: 'All Access (VIP)',
      }),
    );
  });

  it('refuses minting or deleting a registration from a client', async () => {
    await assertFails(
      setDoc(doc(asA(), 'registrations/reg_selfissued'), {
        email: `${A}@kgc.test`, status: 'active', qrSecret: 'mine',
      }),
    );
    await assertFails(deleteDoc(doc(asA(), 'registrations/reg_001')));
    await assertFails(deleteDoc(doc(asOrg(), 'registrations/reg_001')));
  });
});

describe('check-in', () => {
  // The rule that matters most on this path is that there is no client write
  // rule at all. The console writes check-ins with the Admin SDK, which bypasses
  // rules, so denying every client write costs nothing and closes the question
  // of whether attendance is self-assertable.
  it('refuses an attendee checking themselves in', async () => {
    await assertFails(
      setDoc(doc(asA(), 'checkInLists/event-door/checkIns/reg_003'), {
        registrationId: 'reg_003', stationId: 'dev_mine',
      }),
    );
  });

  it('refuses an attendee overwriting their own check-in record', async () => {
    // Their own document, which they are allowed to read. Reading it is not a
    // licence to move the time or the desk it says they arrived at.
    await assertFails(
      setDoc(doc(asA(), 'checkInLists/event-door/checkIns/reg_001'), {
        registrationId: 'reg_001', stationId: 'dev_mine',
      }),
    );
    await assertFails(
      updateDoc(doc(asA(), 'checkInLists/event-door/checkIns/reg_001'), { stationId: 'dev_mine' }),
    );
  });

  it('refuses an attendee un-checking themselves in', async () => {
    await assertFails(deleteDoc(doc(asA(), 'checkInLists/event-door/checkIns/reg_001')));
  });

  it('refuses an organizer client writing a check-in as well', async () => {
    // An organizer is a client with a role, not a server. If the console ever
    // stops using the Admin SDK this test is the thing that will notice.
    await assertFails(
      setDoc(doc(asOrg(), 'checkInLists/event-door/checkIns/reg_003'), {
        registrationId: 'reg_003', stationId: 'dev_desk1',
      }),
    );
    await assertFails(deleteDoc(doc(asOrg(), 'checkInLists/event-door/checkIns/reg_001')));
  });

  it('lets an attendee read their own check-in', async () => {
    await assertSucceeds(getDoc(doc(asA(), 'checkInLists/event-door/checkIns/reg_001')));
  });

  it('hides one attendee’s check-in from another', async () => {
    // Attendance is a personal fact. Who arrived, and when, is not something the
    // person next to them gets to look up.
    await assertFails(getDoc(doc(asA(), 'checkInLists/event-door/checkIns/reg_002')));
    await assertFails(getDoc(doc(asB(), 'checkInLists/event-door/checkIns/reg_001')));
  });

  it('refuses an unauthenticated read of a check-in, and one with no ticket', async () => {
    await assertFails(getDoc(doc(unauth(), 'checkInLists/event-door/checkIns/reg_001')));
    await assertFails(getDoc(doc(noClaim(), 'checkInLists/event-door/checkIns/reg_001')));
  });

  it('refuses a check-in whose registration no longer exists', async () => {
    // The ownership lookup returns nothing, and nothing is not a match. A
    // deleted registration must not become a check-in anyone can read.
    await assertFails(getDoc(doc(asA(), 'checkInLists/event-door/checkIns/reg_deleted')));
  });

  it('refuses an attendee listing the door list', async () => {
    // The list is the attendance record of every attendee, and there is no field
    // on a check-in to filter it down to the caller — so `list` is organizer-only
    // even though `get` is not. `list` and `get` are separate rules here on
    // purpose.
    await assertFails(getDocs(collection(asA(), 'checkInLists/event-door/checkIns')));
  });

  it('lets an organizer read the door list and each check-in on it', async () => {
    await assertSucceeds(getDocs(collection(asOrg(), 'checkInLists/event-door/checkIns')));
    await assertSucceeds(getDoc(doc(asOrg(), 'checkInLists/event-door/checkIns/reg_001')));
  });

  it('keeps the door plan itself organizer-only', async () => {
    // The badge reaches its own check-in through a constant id, so an attendee
    // never needs to know which meals and workshops gate on attendance.
    await assertFails(getDoc(doc(asA(), 'checkInLists/event-door')));
    await assertFails(getDocs(collection(asA(), 'checkInLists')));
    await assertSucceeds(getDoc(doc(asOrg(), 'checkInLists/event-door')));
  });

  it('refuses a client creating or renaming a check-in list', async () => {
    await assertFails(
      setDoc(doc(asOrg(), 'checkInLists/my-own-door'), {
        eventId: 'kgc-2027', name: 'Mine', kind: 'event',
      }),
    );
    await assertFails(updateDoc(doc(asOrg(), 'checkInLists/event-door'), { name: 'Renamed' }));
  });

  it('keeps the raw scan log away from attendees', async () => {
    // Every entry holds a `qrSecret` in plaintext, which is a badge credential
    // for whoever it belongs to.
    await assertFails(getDoc(doc(asA(), 'scanEvents/dev_desk1_scan-1')));
    await assertFails(getDocs(collection(asA(), 'scanEvents')));
    await assertSucceeds(getDoc(doc(asOrg(), 'scanEvents/dev_desk1_scan-1')));
  });

  it('refuses a client appending to the scan log', async () => {
    // A forged scan event is a forged audit trail. The append-only log is
    // append-only from the Admin SDK, and from nowhere else.
    await assertFails(
      setDoc(doc(asA(), 'scanEvents/dev_mine_scan-1'), {
        eventId: 'kgc-2027', deviceId: 'dev_mine', clientScanId: 'scan-1',
        qrSecret: 'secret-belonging-to-A', listId: 'event-door', result: 'ok',
      }),
    );
    await assertFails(
      setDoc(doc(asOrg(), 'scanEvents/dev_mine_scan-2'), {
        eventId: 'kgc-2027', deviceId: 'dev_mine', clientScanId: 'scan-2',
        qrSecret: 'x', listId: 'event-door', result: 'ok',
      }),
    );
    await assertFails(deleteDoc(doc(asOrg(), 'scanEvents/dev_desk1_scan-1')));
  });

  it('keeps the scan desks organizer-only and client-immutable', async () => {
    await assertFails(getDoc(doc(asA(), 'checkInStations/dev_desk1')));
    await assertSucceeds(getDoc(doc(asOrg(), 'checkInStations/dev_desk1')));
    await assertFails(
      setDoc(doc(asOrg(), 'checkInStations/dev_mine'), {
        eventId: 'kgc-2027', label: 'Mine', deviceId: 'dev_mine',
      }),
    );
    await assertFails(
      updateDoc(doc(asOrg(), 'checkInStations/dev_desk1'), { label: 'Renamed' }),
    );
  });
});

describe('server-owned counters', () => {
  // Each of these asserts the organizer branch as well as the attendee one. An
  // organizer is a client with a role, not a server, and the organizer branch
  // used to be an unlisted `if isOrganizer()` — so three tests that only ever
  // tried the attendee path reported a guarantee the file did not make.
  it('refuses a client nudge to replyCount', async () => {
    await assertFails(updateDoc(doc(asA(), 'communityPosts/p1'), { replyCount: 1 }));
    await assertFails(updateDoc(doc(asOrg(), 'communityPosts/p1'), { replyCount: 1 }));
  });

  // `replyCount` is server-owned and there is no server, so the board counts the
  // subcollection itself with an aggregation query. That query is governed by
  // `list`, not `get` — a distinction that has already cost this app its entire
  // inbox once, when a predicate reading `resource.data` passed on a single
  // document and evaluated against null across a collection. The count the board
  // now depends on is therefore asserted here rather than assumed.
  it('lets an attendee count the replies on a post', async () => {
    const snap = await assertSucceeds(
      getCountFromServer(collection(asA(), 'communityPosts/p1/replies')),
    );
    expect(snap.data().count).toBe(2);
  });

  it('refuses a reply count to someone without a ticket', async () => {
    await assertFails(getCountFromServer(collection(noClaim(), 'communityPosts/p1/replies')));
  });

  // The same argument, for the two counts `app/src/lib/data/counts.ts` added
  // beside the reply one. `upvoteCount` and `reactionCount` are frozen at their
  // seeded values with no trigger to move them, so the Q&A board and the
  // community board now count these subcollections themselves — and one of them
  // is also the Q&A sort key, so a denial does not merely blank a number, it
  // reorders the board. That permission was established by an emulator probe;
  // this is the test that keeps it.
  it('lets an attendee count the upvotes on a question', async () => {
    await assertSucceeds(
      getCountFromServer(collection(asA(), 'sessions/s1/questions/q1/upvotes')),
    );
  });

  it('refuses an upvote count to someone without a ticket', async () => {
    await assertFails(
      getCountFromServer(collection(noClaim(), 'sessions/s1/questions/q1/upvotes')),
    );
  });

  it('lets an attendee count the reactions on a post', async () => {
    const snap = await assertSucceeds(
      getCountFromServer(collection(asA(), 'communityPosts/p1/reactions')),
    );
    expect(snap.data().count).toBe(1);
  });

  it('refuses a reaction count to someone without a ticket', async () => {
    await assertFails(getCountFromServer(collection(noClaim(), 'communityPosts/p1/reactions')));
  });

  it('refuses a client nudge to reactionCount', async () => {
    await assertFails(updateDoc(doc(asA(), 'communityPosts/p1'), { reactionCount: 1 }));
    await assertFails(updateDoc(doc(asOrg(), 'communityPosts/p1'), { reactionCount: 1 }));
  });

  it('refuses a client nudge to upvoteCount', async () => {
    // 500 scripted calls would otherwise put your own question on the keynote screen.
    await assertFails(
      updateDoc(doc(asA(), 'sessions/s1/questions/q1'), { upvoteCount: 500 }),
    );
    await assertFails(
      updateDoc(doc(asOrg(), 'sessions/s1/questions/q1'), { upvoteCount: 500 }),
    );
  });

  it('refuses a client write to poll tallies', async () => {
    await assertFails(
      updateDoc(doc(asOrg(), 'sessions/s1/polls/openPoll'), { tallies: [99, 0] }),
    );
    await assertFails(
      updateDoc(doc(asOrg(), 'sessions/s1/polls/openPoll'), { totalVotes: 99 }),
    );
  });

  it('refuses a new post that arrives pre-counted', async () => {
    await assertFails(
      setDoc(doc(asA(), 'communityPosts/p2'), {
        authorId: A, title: 'T', body: 'B', replyCount: 7, reactionCount: 0,
      }),
    );
  });

  it('still lets an author edit their own words', async () => {
    await assertSucceeds(
      updateDoc(doc(asA(), 'communityPosts/p1'), { body: 'edited' }),
    );
  });
});

describe('the community board', () => {
  it('refuses an attendee editing someone else’s post', async () => {
    await assertFails(updateDoc(doc(asB(), 'communityPosts/p1'), { body: 'not what I said' }));
    await assertFails(updateDoc(doc(asB(), 'communityPosts/p1'), { title: 'FREE IPADS' }));
  });

  it('refuses a post signed with someone else’s name', async () => {
    await assertFails(
      setDoc(doc(asB(), 'communityPosts/p2'), {
        authorId: A, title: 'Ride share', body: 'Meet me at 2am',
        replyCount: 0, reactionCount: 0,
      }),
    );
  });

  it('refuses a reply signed with someone else’s name', async () => {
    await assertFails(
      setDoc(doc(asB(), 'communityPosts/p1/replies/r3'), { authorId: A, body: 'forged' }),
    );
  });

  it('refuses a reaction written as another user', async () => {
    await assertFails(
      setDoc(doc(asB(), `communityPosts/p1/reactions/${A}`), { uid: A, emoji: '👎' }),
    );
    // Own path, someone else's name inside — the same lie, told the other way.
    await assertFails(
      setDoc(doc(asB(), `communityPosts/p1/reactions/${B}`), { uid: A, emoji: '👎' }),
    );
    await assertFails(deleteDoc(doc(asB(), `communityPosts/p1/reactions/${A}`)));
  });

  it('lets an organizer hide a post but not re-sign it', async () => {
    await assertSucceeds(
      updateDoc(doc(asOrg(), 'communityPosts/p1'), { status: 'hidden' }),
    );
    // Putting an attendee's name above a post they did not write is the worst
    // thing a moderation branch can be made to do, and an unlisted
    // `if isOrganizer()` allowed exactly that.
    await assertFails(updateDoc(doc(asOrg(), 'communityPosts/p1'), { authorId: B }));
  });

  it('lets an organizer moderate a reply', async () => {
    // Nothing could touch a reply before this: an abusive one under a
    // legitimate post had no answer short of the Admin SDK. `status` is not on
    // `CommunityReplyDoc` yet, so the branch has to tolerate adding the field.
    await assertSucceeds(
      updateDoc(doc(asOrg(), 'communityPosts/p1/replies/r2'), { status: 'hidden' }),
    );
    await assertSucceeds(deleteDoc(doc(asOrg(), 'communityPosts/p1/replies/r2')));
  });

  it('lets an author retract their own reply and nobody else’s', async () => {
    await assertFails(deleteDoc(doc(asB(), 'communityPosts/p1/replies/r1')));
    await assertSucceeds(deleteDoc(doc(asA(), 'communityPosts/p1/replies/r1')));
  });

  it('refuses an attendee editing another author’s reply', async () => {
    await assertFails(
      updateDoc(doc(asB(), 'communityPosts/p1/replies/r1'), { body: 'changed' }),
    );
  });
});

describe('private messages', () => {
  const thread = `${A}_${B}`;

  it('hides a thread from someone not in it', async () => {
    await assertFails(getDoc(doc(asOrg(), `threads/${thread}`)));
  });

  it('hides the messages inside it too', async () => {
    await assertFails(getDocs(collection(asOrg(), `threads/${thread}/messages`)));
  });

  // A conversation nobody has spoken in yet, which is the ordinary case: 47 of
  // the 50 demo attendees have no thread with you, so this is what "Say Hi" from
  // the directory opens. It used to be denied — `get()` on the absent parent
  // returned null and `null.data` errored — and the error states then presented
  // that as "the server refused to send this conversation", with a Sign out
  // button, on the flagship flow of the demo.
  const unstarted = `${A}_unknownPerson`;

  it('opens a conversation nobody has started yet', async () => {
    await assertSucceeds(getDocs(collection(asA(), `threads/${unstarted}/messages`)));
  });

  it('lets an outsider read an unstarted conversation, which is empty', async () => {
    // Not a leak, and worth stating rather than leaving as an accident: there are
    // no documents to return. Denying it would cost the line above, which is the
    // path every attendee actually walks.
    const snap = await assertSucceeds(
      getDocs(collection(asOrg(), `threads/${unstarted}/messages`)),
    );
    expect(snap.empty).toBe(true);
  });

  it('refuses a message into a conversation that has no thread', async () => {
    // The reason `create` does not get the same tolerance as `read`. Without
    // this, anyone could park a message carrying their own senderId inside any
    // future conversation between any two people, waiting for one of them to
    // open it. Denied even for a participant, which is why the client must write
    // the thread document before the first message in it.
    await assertFails(
      setDoc(doc(asA(), `threads/${unstarted}/messages/m1`), { senderId: A, body: 'hi' }),
    );
    await assertFails(
      setDoc(doc(asOrg(), `threads/${unstarted}/messages/m1`), { senderId: ORG, body: 'hi' }),
    );
  });

  it('refuses a message written by an outsider', async () => {
    await assertFails(
      setDoc(doc(asOrg(), `threads/${thread}/messages/m2`), { senderId: ORG, body: 'x' }),
    );
  });

  it('works when a uid contains the id separator', async () => {
    /*
     * The regression that broke every message in the app. The rule used to
     * prove membership with `threadId.split('_')`, documented as safe because
     * "Firebase uids are alphanumeric" — while this repo's own seeded accounts
     * are `demo_000` and `demo_001`. `demo_000_demo_001` split to four pieces
     * and contained neither participant, so every read and send was denied.
     * The inbox kept working (it reads `participantIds`), so it looked as
     * though the messages had been deleted rather than as though a rule was
     * wrong. Nothing may parse a thread id again.
     */
    const U1 = 'demo_000';
    const U2 = 'demo_001';
    const t = `${U1}_${U2}`;
    const claims = (uid: string) => ({
      registered: true, roles: ['attendee'],
      email: `${uid}@kgc.test`, email_verified: true,
    });
    const one = env.authenticatedContext(U1, claims(U1)).firestore();

    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `threads/${t}`), {
        participantIds: [U1, U2], unread: { [U1]: 0, [U2]: 0 },
      });
      await setDoc(doc(ctx.firestore(), `threads/${t}/messages/m1`), {
        senderId: U2, body: 'hello',
      });
    });

    await assertSucceeds(getDoc(doc(one, `threads/${t}`)));
    await assertSucceeds(getDocs(collection(one, `threads/${t}/messages`)));
    await assertSucceeds(
      setDoc(doc(one, `threads/${t}/messages/m2`), { senderId: U1, body: 'hi back' }),
    );
    // And an outsider still cannot get in, separator or no separator.
    const outsider = env.authenticatedContext('demo_009', claims('demo_009')).firestore();
    await assertFails(getDocs(collection(outsider, `threads/${t}/messages`)));
  });

  it('lets a participant create the thread on first contact', async () => {
    const U1 = 'demo_000';
    const U2 = 'demo_007';
    const claims = (uid: string) => ({
      registered: true, roles: ['attendee'],
      email: `${uid}@kgc.test`, email_verified: true,
    });
    const one = env.authenticatedContext(U1, claims(U1)).firestore();

    await assertSucceeds(
      setDoc(doc(one, `threads/${U1}_${U2}`), {
        participantIds: [U1, U2], unread: { [U1]: 0, [U2]: 0 },
      }),
    );
    // The id must be the one those two participants produce.
    await assertFails(
      setDoc(doc(one, 'threads/not_their_id'), {
        participantIds: [U1, U2], unread: { [U1]: 0, [U2]: 0 },
      }),
    );
  });

  it('lets a participant read and send', async () => {
    await assertSucceeds(getDoc(doc(asA(), `threads/${thread}`)));
    await assertSucceeds(
      setDoc(doc(asB(), `threads/${thread}/messages/m3`), { senderId: B, body: 'hello' }),
    );
  });

  it('lets a participant LIST their own threads', async () => {
    // The inbox query. Distinct from `get` and it broke in a way `get` did not:
    // on a `list` the {threadId} wildcard is not bound, so a path-based
    // membership check evaluates against null and denies the whole query.
    await assertSucceeds(
      getDocs(
        query(collection(asA(), 'threads'), where('participantIds', 'array-contains', A)),
      ),
    );
  });

  it('refuses a threads query that is not scoped to the caller', async () => {
    // Rules filter documents, not queries — an unscoped list must be rejected
    // outright rather than silently returning everyone's conversations.
    await assertFails(getDocs(collection(asA(), 'threads')));
    await assertFails(
      getDocs(
        query(collection(asA(), 'threads'), where('participantIds', 'array-contains', B)),
      ),
    );
  });

  it('refuses a message forged in someone else’s name', async () => {
    await assertFails(
      setDoc(doc(asB(), `threads/${thread}/messages/m4`), { senderId: A, body: 'forged' }),
    );
  });

  it('refuses rewriting who is in the thread', async () => {
    await assertFails(
      updateDoc(doc(asA(), `threads/${thread}`), { participantIds: [A, ORG] }),
    );
  });

  it('makes sent messages immutable', async () => {
    await assertFails(
      updateDoc(doc(asA(), `threads/${thread}/messages/m1`), { body: 'changed' }),
    );
    await assertFails(deleteDoc(doc(asA(), `threads/${thread}/messages/m1`)));
  });

  it('refuses a thread whose id does not match its participants', async () => {
    await assertFails(
      setDoc(doc(asA(), `threads/${A}_${ORG}`), { participantIds: [A, B] }),
    );
  });

  it('refuses a thread minted between two other people', async () => {
    // Nothing stops you computing somebody else's thread id — they are two
    // uids and a underscore. Being in the path is what has to be checked.
    await assertFails(
      setDoc(doc(asA(), `threads/${B}_${ORG}`), {
        participantIds: [B, ORG], unread: { [B]: 0, [ORG]: 0 },
      }),
    );
  });

  it('lets the first message in a conversation be sent at all', async () => {
    // A thread that does not exist yet must read as "not found", not as
    // "permission denied". `resource` is null on a missing document and the
    // membership check dereferenced it, so reading a conversation before it
    // existed threw — and `sendMessage()` read the thread before creating it,
    // which made every FIRST message between two people impossible.
    await assertSucceeds(getDoc(doc(asA(), `threads/${A}_${ORG}`)));
    /*
     * A `get` on a thread that does not exist is allowed for any registered
     * attendee, including one who is not a participant. This is a deliberate
     * trade, not an oversight.
     *
     * The only way to decide membership on a missing document is to parse the
     * id, and parsing the id is precisely the bug this block was rewritten to
     * remove — it assumed uids never contain the separator, which this repo's
     * own accounts violate. Rather than reintroduce that assumption in a
     * narrower place, the empty read is permitted: it returns no data, and all
     * an outsider can learn is that two people have not spoken. A thread that
     * *does* exist is still hidden, which is the guarantee that matters.
     */
    await assertSucceeds(getDoc(doc(asB(), `threads/${A}_${ORG}`)));
    // The moment it exists, an outsider is locked out again.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `threads/${A}_${ORG}`), {
        participantIds: [A, ORG], unread: { [A]: 0, [ORG]: 0 },
      });
    });
    await assertFails(getDoc(doc(asB(), `threads/${A}_${ORG}`)));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), `threads/${A}_${ORG}`));
    });
    // …and the write that follows, in the shape `messages.ts` now sends it:
    // one merged `setDoc` that creates the thread and its summary together.
    await assertSucceeds(
      setDoc(
        doc(asA(), `threads/${A}_${ORG}`),
        {
          eventId: 'kgc-2027',
          participantIds: [A, ORG].sort(),
          lastMessage: 'hello',
          lastSenderId: A,
          unread: { [A]: 0, [ORG]: increment(1) },
        },
        { merge: true },
      ),
    );
  });

  it('lets the same merge write update a thread that already exists', async () => {
    // The second send down the same path is an update, not a create, and it
    // rewrites `eventId` and `participantIds` to the values already there.
    // `diff()` reports only the keys whose values actually change, so the
    // allowlist still sees a summary write — and `increment` is resolved before
    // the rule reads `unread`, which is what keeps the +1 bound honest.
    await assertSucceeds(
      setDoc(
        doc(asA(), `threads/${thread}`),
        {
          participantIds: [A, B],
          lastMessage: 'again', lastSenderId: A,
          unread: { [A]: 0, [B]: increment(1) },
        },
        { merge: true },
      ),
    );
    await assertFails(
      setDoc(
        doc(asA(), `threads/${thread}`),
        { unread: { [A]: 0, [B]: increment(900) } },
        { merge: true },
      ),
    );
  });

  it('lets a device clear its own side with a dot path', async () => {
    // `markThreadRead` writes `unread.{uid}` rather than the whole map, so a
    // stale copy of the other person's count cannot be written back. The rule
    // sees one changed top-level key either way.
    await assertSucceeds(
      updateDoc(doc(asA(), `threads/${thread}`), { [`unread.${A}`]: 0 }),
    );
    await assertFails(
      updateDoc(doc(asA(), `threads/${thread}`), { [`unread.${B}`]: 0 }),
    );
  });

  it('lets a message move the other side’s unread by exactly one', async () => {
    await assertSucceeds(
      updateDoc(doc(asA(), `threads/${thread}`), {
        lastMessage: 'hi', lastSenderId: A, unread: { [A]: 0, [B]: 3 },
      }),
    );
  });

  it('lets you clear your own unread count', async () => {
    // `markThreadRead` — your side to zero, the other side untouched.
    await assertSucceeds(
      updateDoc(doc(asA(), `threads/${thread}`), { unread: { [A]: 0, [B]: 2 } }),
    );
  });

  it('refuses inflating the other side’s unread badge', async () => {
    await assertFails(
      updateDoc(doc(asA(), `threads/${thread}`), { unread: { [A]: 0, [B]: 999999 } }),
    );
    await assertFails(
      updateDoc(doc(asA(), `threads/${thread}`), { unread: { [A]: 0, [B]: 5 } }),
    );
  });

  it('refuses zeroing the other side to hide a message', async () => {
    // The other half of the same field: clearing somebody's badge is how you
    // make a message they have not read look like one they have.
    await assertFails(
      updateDoc(doc(asA(), `threads/${thread}`), { unread: { [A]: 0, [B]: 0 } }),
    );
    // Dropping their key entirely is the same thing with fewer characters.
    await assertFails(
      updateDoc(doc(asA(), `threads/${thread}`), { unread: { [A]: 0 } }),
    );
    // And no third party may be given a counter in a two-person thread.
    await assertFails(
      updateDoc(doc(asA(), `threads/${thread}`), {
        unread: { [A]: 0, [B]: 2, [ORG]: 1 },
      }),
    );
  });

  it('refuses misattributing the last message to the other person', async () => {
    // The inbox row renders `lastSenderId`. Setting it to the person you are
    // talking to makes your own words appear to be theirs.
    await assertFails(
      updateDoc(doc(asA(), `threads/${thread}`), {
        lastMessage: 'something regrettable', lastSenderId: B,
      }),
    );
  });
});

describe('polls and Q&A', () => {
  it('refuses a vote cast in someone else’s name', async () => {
    await assertFails(
      setDoc(doc(asA(), `sessions/s1/polls/openPoll/votes/${B}`), {
        uid: B, optionIds: ['a'],
      }),
    );
  });

  it('accepts your own vote while the poll is open', async () => {
    await assertSucceeds(
      setDoc(doc(asA(), `sessions/s1/polls/openPoll/votes/${A}`), {
        uid: A, optionIds: ['b'],
      }),
    );
  });

  it('refuses a vote once the poll is closed', async () => {
    await assertFails(
      setDoc(doc(asA(), `sessions/s1/polls/closedPoll/votes/${A}`), {
        uid: A, optionIds: ['a'],
      }),
    );
  });

  it('keeps a ballot secret from other attendees', async () => {
    // Secret by rule, not by nobody having written the test: a poll on "should
    // we adopt X" is read by the room, and who voted which way is not theirs.
    await assertFails(getDoc(doc(asB(), `sessions/s1/polls/openPoll/votes/${A}`)));
    await assertFails(getDocs(collection(asB(), 'sessions/s1/polls/openPoll/votes')));
    await assertSucceeds(getDoc(doc(asA(), `sessions/s1/polls/openPoll/votes/${A}`)));
    await assertSucceeds(getDoc(doc(asOrg(), `sessions/s1/polls/openPoll/votes/${A}`)));
  });

  it('refuses a ballot naming an option the poll does not have', async () => {
    // `tallyPoll` counts what it is given, so a fabricated id invents a row on
    // the live result screen that nobody was ever offered.
    await assertFails(
      setDoc(doc(asA(), `sessions/s1/polls/openPoll/votes/${A}`), {
        uid: A, optionIds: ['write-in'],
      }),
    );
    await assertFails(
      setDoc(doc(asA(), `sessions/s1/polls/openPoll/votes/${A}`), {
        uid: A, optionIds: ['a', 'write-in'],
      }),
    );
  });

  it('refuses a ballot that is empty, absent or absurd', async () => {
    await assertFails(
      setDoc(doc(asA(), `sessions/s1/polls/openPoll/votes/${A}`), { uid: A, optionIds: [] }),
    );
    await assertFails(
      setDoc(doc(asA(), `sessions/s1/polls/openPoll/votes/${A}`), { uid: A }),
    );
    await assertFails(
      setDoc(doc(asA(), `sessions/s1/polls/openPoll/votes/${A}`), {
        uid: A, optionIds: Array.from({ length: 5000 }, (_, i) => `o${i}`),
      }),
    );
    // Nor the same real option 200 times, which is the same attack in range.
    await assertFails(
      setDoc(doc(asA(), `sessions/s1/polls/openPoll/votes/${A}`), {
        uid: A, optionIds: Array.from({ length: 200 }, () => 'a'),
      }),
    );
  });

  it('refuses an attendee creating or deleting a poll', async () => {
    await assertFails(
      setDoc(doc(asA(), 'sessions/s1/polls/mine'), {
        question: 'Who is best?',
        options: [{ id: 'a', label: 'Me' }],
        open: true, tallies: { a: 0 }, totalVotes: 0,
      }),
    );
    await assertFails(deleteDoc(doc(asA(), 'sessions/s1/polls/openPoll')));
  });

  it('refuses an upvote whose uid does not match the writer', async () => {
    // Wrong uid inside the document…
    await assertFails(
      setDoc(doc(asA(), `sessions/s1/questions/q1/upvotes/${A}`), { uid: B }),
    );
    // …and wrong uid in the path, which is the same lie told the other way.
    await assertFails(
      setDoc(doc(asA(), `sessions/s1/questions/q1/upvotes/${B}`), { uid: B }),
    );
  });

  it('keeps one upvote per person, by construction', async () => {
    // The invariant is that an upvote cannot be cast TWICE, which is `update:
    // if false` on a uid-keyed document — a second `setDoc` at the same path is
    // an update. Writing to someone else's path is a different guarantee and is
    // already covered above.
    await assertSucceeds(
      setDoc(doc(asA(), `sessions/s1/questions/q1/upvotes/${A}`), { uid: A }),
    );
    await assertFails(
      setDoc(doc(asA(), `sessions/s1/questions/q1/upvotes/${A}`), { uid: A, again: true }),
    );
    await assertFails(
      updateDoc(doc(asA(), `sessions/s1/questions/q1/upvotes/${A}`), { weight: 500 }),
    );
  });

  it('refuses a question that arrives pre-approved', async () => {
    // Moderation state is not the author's to set. `approved` puts the question
    // straight onto the keynote screen with no moderator in the loop.
    await assertFails(
      setDoc(doc(asA(), 'sessions/s1/questions/q2'), {
        authorId: A, body: 'Plug for my startup', upvoteCount: 0, answered: false,
        state: 'approved',
      }),
    );
    // …and it is not omittable either, which would leave the field undefined.
    await assertFails(
      setDoc(doc(asA(), 'sessions/s1/questions/q3'), {
        authorId: A, body: 'Q', upvoteCount: 0, answered: false,
      }),
    );
  });

  it('accepts a question asked the way the app asks one', async () => {
    await assertSucceeds(
      setDoc(doc(asA(), 'sessions/s1/questions/q4'), {
        authorId: A, body: 'How does this scale?', upvoteCount: 0, answered: false,
        state: 'pending',
      }),
    );
  });

  it('refuses a question posted in someone else’s name', async () => {
    await assertFails(
      setDoc(doc(asB(), 'sessions/s1/questions/q5'), {
        authorId: A, body: 'Something regrettable', upvoteCount: 0, answered: false,
        state: 'pending',
      }),
    );
  });

  it('refuses an attendee deleting another author’s question', async () => {
    await assertFails(deleteDoc(doc(asB(), 'sessions/s1/questions/q1')));
    // The author and the organizer may.
    await assertSucceeds(deleteDoc(doc(asA(), 'sessions/s1/questions/q1')));
  });

  it('refuses an attendee editing another author’s question', async () => {
    await assertFails(
      updateDoc(doc(asB(), 'sessions/s1/questions/q1'), { body: 'something worse' }),
    );
    await assertSucceeds(
      updateDoc(doc(asA(), 'sessions/s1/questions/q1'), { body: 'asked more clearly' }),
    );
  });

  it('lets an organizer moderate a question but not re-sign it', async () => {
    await assertSucceeds(
      updateDoc(doc(asOrg(), 'sessions/s1/questions/q1'), { state: 'approved' }),
    );
    // Framing an attendee as the author of a question they never asked.
    await assertFails(
      updateDoc(doc(asOrg(), 'sessions/s1/questions/q1'), { authorId: B }),
    );
  });
});

describe('embargoed content', () => {
  it('hides a draft session from attendees', async () => {
    // An unannounced keynote and its speaker must not be on the wire before the
    // programme is published.
    await assertFails(getDoc(doc(asA(), 'sessions/draft1')));
  });

  it('lets an organizer read a draft', async () => {
    await assertSucceeds(getDoc(doc(asOrg(), 'sessions/draft1')));
  });

  it('refuses a sessions list that is not filtered to published', async () => {
    // Rules filter documents, not queries — an unfiltered list must be rejected
    // outright rather than quietly returning drafts.
    await assertFails(getDocs(collection(asA(), 'sessions')));
    await assertSucceeds(
      getDocs(query(collection(asA(), 'sessions'), where('status', '==', 'published'))),
    );
  });
});

describe('soft delete', () => {
  it('refuses to hard-delete a session, even for an organizer', async () => {
    // Attendees have it saved and Firestore has no server-side cascade.
    await assertFails(deleteDoc(doc(asOrg(), 'sessions/s1')));
  });

  it('refuses to hard-delete a community post', async () => {
    await assertFails(deleteDoc(doc(asA(), 'communityPosts/p1')));
    await assertFails(deleteDoc(doc(asOrg(), 'communityPosts/p1')));
  });
});

describe('sponsor leads', () => {
  it('hides one attendee’s lead from another', async () => {
    // Both halves matter. Reading B's lead as A fails under an owner-only rule
    // too, so on its own that assertion does not pin the rule that is actually
    // written — leads are organizer-only, and not even the person who submitted
    // one can read it back. The second line is what says so.
    await assertFails(getDoc(doc(asA(), `sponsors/sp/leads/${B}`)));
    await assertFails(getDoc(doc(asB(), `sponsors/sp/leads/${B}`)));
    await assertFails(
      getDocs(query(collection(asA(), 'sponsors/sp/leads'), where('uid', '==', A))),
    );
  });

  it('refuses a lead submitted under someone else’s uid', async () => {
    await assertFails(
      setDoc(doc(asB(), `sponsors/sp/leads/${A}`), { uid: A, email: `${A}@kgc.test` }),
    );
  });

  it('lets an attendee submit their own', async () => {
    await assertSucceeds(
      setDoc(doc(asA(), `sponsors/sp/leads/${A}`), { uid: A, email: `${A}@kgc.test` }),
    );
  });

  it('lets the organizer read them', async () => {
    await assertSucceeds(getDoc(doc(asOrg(), `sponsors/sp/leads/${B}`)));
  });
});

describe('event content is organizer-only', () => {
  it('refuses an attendee editing the agenda', async () => {
    await assertFails(updateDoc(doc(asA(), 'sessions/s1'), { title: 'Cancelled' }));
    await assertFails(setDoc(doc(asA(), 'speakers/sp2'), { name: 'Me' }));
    await assertFails(setDoc(doc(asA(), 'announcements/a2'), { title: 'Free pizza' }));
  });

  it('refuses an attendee editing the tracks', async () => {
    await assertFails(updateDoc(doc(asA(), 'tracks/t1'), { name: 'Renamed' }));
    await assertFails(setDoc(doc(asA(), 'tracks/t2'), { name: 'My track' }));
    await assertFails(deleteDoc(doc(asA(), 'tracks/t1')));
  });

  it('refuses an attendee editing the sponsors', async () => {
    // Sponsors paid for what this says about them, and `website` is rendered
    // as a tappable link for every attendee.
    await assertFails(
      updateDoc(doc(asA(), 'sponsors/sp'), { website: 'https://attacker.example' }),
    );
    await assertFails(setDoc(doc(asA(), 'sponsors/sp2'), { name: 'Me', tier: 'gold' }));
    await assertFails(deleteDoc(doc(asA(), 'sponsors/sp')));
  });

  it('lets an organizer edit it', async () => {
    // `room` is not a field on `SessionDoc` — rooms are their own collection and
    // the session caches `roomId`/`roomName`. Writing a field the model does not
    // have proved the rule allows arbitrary keys, not that it allows the edit an
    // organizer actually makes.
    await assertSucceeds(
      updateDoc(doc(asOrg(), 'sessions/s1'), { title: 'Keynote (moved)', roomId: 'r1' }),
    );
  });
});

/**
 * The money collections are server-only, and the rules say so by saying nothing.
 *
 * `orders`, `ticketTypes`, `emailLog` and `auditLog` have no `match` block in
 * `firestore.rules` at all, so Firestore's default deny covers them. That is the
 * correct design — every one of them is written by the Admin SDK, which bypasses
 * rules entirely — but "secure because nobody wrote a rule" is a property that a
 * future edit can remove without anyone noticing.
 *
 * So it is asserted here. Each of these holds something that must never reach a
 * client: what people paid and their billing details, the prices the website
 * charges against, attendees' email addresses alongside their claim codes, and
 * the record of which organizer refunded what.
 */
describe('the money collections are closed to every client', () => {
  const closed = [
    ['orders', 'ord_1'],
    ['ticketTypes', 'main-conference'],
    ['emailLog', 'mail_1'],
    ['auditLog', 'audit_1'],
  ] as const;

  for (const [collectionName, id] of closed) {
    it(`refuses every client a read of ${collectionName}`, async () => {
      // An organizer too. An organizer is a client with a role, not a server —
      // the dashboard reads these with the Admin SDK, not from a browser.
      await assertFails(getDoc(doc(unauth(), `${collectionName}/${id}`)));
      await assertFails(getDoc(doc(noClaim(), `${collectionName}/${id}`)));
      await assertFails(getDoc(doc(asA(), `${collectionName}/${id}`)));
      await assertFails(getDoc(doc(asOrg(), `${collectionName}/${id}`)));
    });

    it(`refuses every client a write to ${collectionName}`, async () => {
      await assertFails(setDoc(doc(asA(), `${collectionName}/${id}`), { eventId: 'kgc-2027' }));
      await assertFails(setDoc(doc(asOrg(), `${collectionName}/${id}`), { eventId: 'kgc-2027' }));
    });
  }

  it('refuses an attendee a listing of who bought what', async () => {
    // The one that matters most: a `list` on `orders` is the entire buyer
    // database — names, addresses, companies and amounts — in one query.
    await assertFails(getDocs(collection(asA(), 'orders')));
    await assertFails(getDocs(collection(asOrg(), 'orders')));
  });
});


/**
 * The call for abstracts, which is closed to every client for a different
 * reason than the money is.
 *
 * `calls`, `submissions`, `submissions/{id}/identity`,
 * `submissions/{id}/reviews/{reviewerId}` and `reviewers` have no `match` block
 * either (`CFA-PLAN.md` §2), and the same argument applies — a collection that
 * is safe only because nobody has written a rule for it needs a test saying so,
 * or the day somebody adds one is the day nothing notices.
 *
 * What is different is that closing it costs nothing. The three kinds of person
 * this feature serves cannot be authenticated by Firestore at all: a
 * prospective speaker holds no ticket, so `isRegistered()` is false and must
 * stay false; an external reviewer is in the same position; and the organizer
 * reads all of it through the dashboard's Admin SDK. Every write is a server
 * action behind an HMAC capability token — `CFA-PLAN.md` §3.
 *
 * `get` and `list` are asserted separately throughout. They are different rules
 * and this suite has already been bitten once by treating them as one.
 */
describe('the call for abstracts is closed to every client', () => {
  // [what it holds, the collection path, a document id in it]
  const closed = [
    ['calls', 'calls', 'kgc-2027-abstracts'],
    ['submissions', 'submissions', 'sub_001'],
    ['submission identities', 'submissions/sub_001/identity', 'author'],
    ['reviews', 'submissions/sub_001/reviews', 'rev_001'],
    ['reviewers', 'reviewers', 'rev_001'],
  ] as const;

  for (const [label, path, id] of closed) {
    it(`refuses every client a get of ${label}`, async () => {
      // The organizer too. An organizer is a client with a role, not a server;
      // the dashboard reads these with the Admin SDK, not from a browser tab.
      await assertFails(getDoc(doc(unauth(), `${path}/${id}`)));
      await assertFails(getDoc(doc(noClaim(), `${path}/${id}`)));
      await assertFails(getDoc(doc(asA(), `${path}/${id}`)));
      await assertFails(getDoc(doc(asOrg(), `${path}/${id}`)));
    });

    it(`refuses every client a list of ${label}`, async () => {
      await assertFails(getDocs(collection(unauth(), path)));
      await assertFails(getDocs(collection(noClaim(), path)));
      await assertFails(getDocs(collection(asA(), path)));
      await assertFails(getDocs(collection(asOrg(), path)));
    });

    it(`refuses every client a write to ${label}`, async () => {
      await assertFails(setDoc(doc(asA(), `${path}/${id}`), { eventId: 'kgc-2027' }));
      await assertFails(setDoc(doc(asOrg(), `${path}/${id}`), { eventId: 'kgc-2027' }));
      await assertFails(deleteDoc(doc(asOrg(), `${path}/${id}`)));
    });
  }

  it('lets nobody rejoin an anonymous abstract to its author', async () => {
    // The identity split IS the blind review: name, affiliation and address live
    // in `submissions/{id}/identity` precisely so that a reviewer can be handed
    // the abstract without them. A collection-group query undoes that for the
    // whole call in one request — it reaches every subcollection of that name at
    // once, so a rule granting `submissions/{id}/identity` for one submission
    // would have granted the lot.
    await assertFails(getDocs(collectionGroup(asA(), 'identity')));
    await assertFails(getDocs(collectionGroup(asOrg(), 'identity')));
    // And a filter naming one address does not open it either. That shape is
    // permitted elsewhere in this file — the ticket list, the consent register —
    // because there the filter names the *caller*. Here it names somebody else.
    await assertFails(
      getDocs(query(collectionGroup(asA(), 'identity'), where('email', '==', 'amara@example.invalid'))),
    );
  });

  it('lets nobody read a submission it has not been sent', async () => {
    // An unreviewed abstract is unpublished work somebody sent to a committee.
    // The submitter reaches their own through a capability link and a server
    // action, and holds no Firebase identity at all — so the honest client-side
    // rule is the absent one, and this is what it means in practice.
    await assertFails(getDoc(doc(unauth(), 'submissions/sub_001')));
    await assertFails(getDocs(collection(unauth(), 'submissions')));
  });

  it('lets nobody enumerate what a reviewer was assigned', async () => {
    // Both verbs again, and the collection group again, because a reviewer's
    // queue is inherently a query across every submission — it is the one read
    // in this feature that *has* to be a collection group, so it is the one most
    // likely to be granted by somebody adding a rule for it.
    await assertFails(getDocs(collectionGroup(asA(), 'reviews')));
    await assertFails(getDocs(collectionGroup(asOrg(), 'reviews')));
    await assertFails(
      getDocs(query(collectionGroup(asOrg(), 'reviews'), where('reviewerId', '==', 'rev_001'))),
    );
  });
});


describe('the exhibitor hall', () => {
  // The projection exists because rules filter documents and not fields. Every
  // test below is one half of that argument: the slim listing is readable by a
  // ticket holder, and the record it was projected from is readable by nobody.

  it('lets a ticket holder read one exhibitor listing', async () => {
    await assertSucceeds(getDoc(doc(asA(), 'exhibitorListings/ex1')));
  });

  it('lets a ticket holder list the whole hall', async () => {
    // `list` and `get` are separate rules and this one is deliberately open to
    // both — an exhibitor hall that cannot be enumerated is not a listing. The
    // predicate is bare `isRegistered()` for exactly that reason: anything
    // reading `resource.data` would evaluate against null here and deny the
    // query while the single-document read above kept working.
    await assertSucceeds(getDocs(collection(asA(), 'exhibitorListings')));
    await assertSucceeds(
      getDocs(query(collection(asA(), 'exhibitorListings'), where('eventId', '==', 'kgc-2027'))),
    );
  });

  it('refuses the hall to somebody signed in without a ticket', async () => {
    // Anybody can create a Firebase account; the `registered` claim is minted
    // only for ticket holders, and it is the gate on both verbs.
    await assertFails(getDoc(doc(noClaim(), 'exhibitorListings/ex1')));
    await assertFails(getDocs(collection(noClaim(), 'exhibitorListings')));
    await assertFails(getDoc(doc(unauth(), 'exhibitorListings/ex1')));
    await assertFails(getDocs(collection(unauth(), 'exhibitorListings')));
  });

  it('lets no client write a listing, organizers included', async () => {
    // Server-written. A client that could write this could put an
    // attacker-controlled `logoURL` in front of a thousand devices — the beacon
    // `directory/{uid}` refuses `photoURL` for.
    await assertFails(setDoc(doc(asA(), 'exhibitorListings/ex2'), {
      eventId: 'kgc-2027', exhibitorId: 'ex2', name: 'Mine now',
    }));
    await assertFails(setDoc(doc(asOrg(), 'exhibitorListings/ex2'), {
      eventId: 'kgc-2027', exhibitorId: 'ex2', name: 'Mine now',
    }));
    await assertFails(
      updateDoc(doc(asOrg(), 'exhibitorListings/ex1'), { name: 'Renamed' }),
    );
    await assertFails(deleteDoc(doc(asOrg(), 'exhibitorListings/ex1')));
  });

  it('keeps the exhibitor record itself closed to every client', async () => {
    // This is the document the projection exists to keep off the wire: it
    // carries `contactName`, `contactEmail`, `passesAllocated`, `passesUsed` and
    // a `status` that names spaces nobody has paid for. A `list` of it is every
    // exhibitor's booking contact in one query.
    await assertFails(getDoc(doc(asA(), 'exhibitors/ex1')));
    await assertFails(getDocs(collection(asA(), 'exhibitors')));
    await assertFails(getDoc(doc(asOrg(), 'exhibitors/ex1')));
    await assertFails(getDocs(collection(asOrg(), 'exhibitors')));
    await assertFails(setDoc(doc(asOrg(), 'exhibitors/ex2'), { eventId: 'kgc-2027', name: 'X' }));
  });

  it('keeps the floor plan closed to every client', async () => {
    // Not opened, and deliberately so: a booth holds an order id, the ticket
    // type it was sold as, who assigned it and whether it is `held` — promised
    // in a sales conversation and unpaid. The app needs the booth *number*, and
    // that is denormalised onto the listing above.
    await assertFails(getDoc(doc(asA(), 'booths/E01')));
    await assertFails(getDocs(collection(asA(), 'booths')));
    await assertFails(getDoc(doc(asOrg(), 'booths/E01')));
    await assertFails(getDocs(collection(asOrg(), 'booths')));
    await assertFails(setDoc(doc(asOrg(), 'booths/E02'), { eventId: 'kgc-2027', number: 'E02' }));
  });
});

describe('surveys', () => {
  it('lets a ticket holder read a published survey', async () => {
    await assertSucceeds(getDoc(doc(asA(), 'surveys/sv1')));
  });

  it('hides a draft survey from attendees', async () => {
    // A draft is a question an organizer is still deciding whether to ask.
    await assertFails(getDoc(doc(asA(), 'surveys/svDraft')));
  });

  it('lets an organizer read a draft survey', async () => {
    await assertSucceeds(getDoc(doc(asOrg(), 'surveys/svDraft')));
  });

  it('refuses a surveys list that is not filtered to published', async () => {
    // The `sessions` hazard, on a second collection: `resource.data` is null
    // across a query, so the filter is what makes the read permitted at all.
    // Both verbs, because passing one proves nothing about the other.
    await assertFails(getDocs(collection(asA(), 'surveys')));
    await assertFails(
      getDocs(query(collection(asA(), 'surveys'), where('eventId', '==', 'kgc-2027'))),
    );
    // The exact query `useSurveys` issues, both equalities and in that order.
    await assertSucceeds(
      getDocs(
        query(
          collection(asA(), 'surveys'),
          where('eventId', '==', 'kgc-2027'),
          where('status', '==', 'published'),
        ),
      ),
    );
  });

  it('refuses a survey to somebody signed in without a ticket', async () => {
    await assertFails(getDoc(doc(noClaim(), 'surveys/sv1')));
    await assertFails(
      getDocs(query(collection(noClaim(), 'surveys'), where('status', '==', 'published'))),
    );
  });

  it('lets no client author a survey, organizers included', async () => {
    await assertFails(setDoc(doc(asOrg(), 'surveys/sv2'), {
      eventId: 'kgc-2027', title: 'Mine', questions: [], status: 'published', responseCount: 0,
    }));
    await assertFails(updateDoc(doc(asOrg(), 'surveys/sv1'), { title: 'Renamed' }));
    await assertFails(updateDoc(doc(asA(), 'surveys/sv1'), { responseCount: 999 }));
  });
});

describe('survey responses', () => {
  it('lets an attendee answer a survey once', async () => {
    await assertSucceeds(
      setDoc(doc(asB(), `surveys/sv1/responses/${B}`), {
        uid: B, answers: { q1: 4 }, submittedAt: new Date(),
      }),
    );
  });

  it('refuses a second set of answers from the same person', async () => {
    // The whole "you cannot answer twice" guarantee, and it lives here rather
    // than in the screen: `update` is closed, so a response document that
    // already exists cannot be written over however the write is issued.
    await assertFails(
      setDoc(doc(asA(), `surveys/sv1/responses/${A}`), {
        uid: A, answers: { q1: 1 }, submittedAt: new Date(),
      }),
    );
    await assertFails(updateDoc(doc(asA(), `surveys/sv1/responses/${A}`), { answers: { q1: 1 } }));
    await assertFails(deleteDoc(doc(asA(), `surveys/sv1/responses/${A}`)));
  });

  it('refuses answers filed under somebody else', async () => {
    await assertFails(
      setDoc(doc(asB(), `surveys/sv1/responses/${A}`), {
        uid: A, answers: { q1: 1 }, submittedAt: new Date(),
      }),
    );
    // And refuses a response that claims a uid other than the path it is at.
    await assertFails(
      setDoc(doc(asB(), `surveys/sv1/responses/${B}`), {
        uid: A, answers: { q1: 1 }, submittedAt: new Date(),
      }),
    );
  });

  it('refuses answers from somebody signed in without a ticket', async () => {
    await assertFails(
      setDoc(doc(noClaim(), 'surveys/sv1/responses/randomUser'), {
        uid: 'randomUser', answers: { q1: 1 }, submittedAt: new Date(),
      }),
    );
  });

  it('refuses a response carrying anything beyond the three declared fields', async () => {
    // `answers` is a free-form map, so without a closed key set and a cap this
    // is a general-purpose write channel into a collection the organizer's
    // dashboard reads and renders.
    await assertFails(
      setDoc(doc(asB(), `surveys/sv1/responses/${B}`), {
        uid: B, answers: { q1: 4 }, submittedAt: new Date(), eventId: 'kgc-2027',
      }),
    );
    const tooMany: Record<string, number> = {};
    for (let i = 0; i < 31; i += 1) tooMany[`q${i}`] = 1;
    await assertFails(
      setDoc(doc(asB(), `surveys/sv1/responses/${B}`), {
        uid: B, answers: tooMany, submittedAt: new Date(),
      }),
    );
  });

  it('lets somebody read their own answers back and nobody else theirs', async () => {
    // The screen shows a submitted survey back rather than re-offering the form,
    // and this is the read it makes.
    await assertSucceeds(getDoc(doc(asA(), `surveys/sv1/responses/${A}`)));
    await assertFails(getDoc(doc(asB(), `surveys/sv1/responses/${A}`)));
  });

  it('refuses an attendee a listing of what the room answered', async () => {
    // `isSelf(uid)` resolves on a `get` and is false across a `list`, which is
    // the intent: a survey's responses are not the room's to browse. The
    // organizer branch is what the console's aggregate uses.
    await assertFails(getDocs(collection(asA(), 'surveys/sv1/responses')));
    await assertSucceeds(getDocs(collection(asOrg(), 'surveys/sv1/responses')));
  });
});

describe('the emergency card', () => {
  // `settings` had no match block at all until the emergency card needed one,
  // and the shape of the rule it got is the whole point of this block: one key
  // named, not the collection opened. `settings/access` sits in the same
  // collection holding `eventCode` — a string read out from the stage — and
  // `staffNote`, written for the check-in desk. Rules filter documents and not
  // fields, so naming the key IS the filter.

  it('lets a ticket holder read the logistics bag', async () => {
    await assertSucceeds(getDoc(doc(asA(), 'settings/logistics')));
  });

  it('refuses every other settings document to the same ticket holder', async () => {
    await assertFails(getDoc(doc(asA(), 'settings/access')));
    await assertFails(getDoc(doc(asA(), 'settings/branding')));
    // Including an organizer, who is a client with a role and not a server. The
    // dashboard reads these with the Admin SDK and bypasses rules entirely.
    await assertFails(getDoc(doc(asOrg(), 'settings/access')));
  });

  it('refuses a listing of the settings collection to everybody', async () => {
    // ★ The verb that matters, and the one this rule is shaped around. `key` is
    // a path variable: bound on a `get`, unbound across a query, so
    // `key == 'logistics'` is true for the one document and false for the
    // collection — which denies the query outright. That asymmetry is normally
    // the bug (it is how the inbox broke once); here it is load-bearing,
    // because a `list` that succeeded would hand `access` to every phone
    // alongside the card it was asked for.
    await assertFails(getDocs(collection(asA(), 'settings')));
    await assertFails(getDocs(collection(asOrg(), 'settings')));
    // Even filtered to the one key it is allowed to `get`. A query is a query.
    await assertFails(
      getDocs(query(collection(asA(), 'settings'), where('eventId', '==', 'kgc-2027'))),
    );
  });

  it('refuses the emergency card to somebody signed in without a ticket', async () => {
    // The negative case the gate exists for: anyone can create a Firebase
    // account, and this bag names the on-site lead and their mobile number.
    await assertFails(getDoc(doc(noClaim(), 'settings/logistics')));
    await assertFails(getDocs(collection(noClaim(), 'settings')));
    await assertFails(getDoc(doc(unauth(), 'settings/logistics')));
    await assertFails(getDocs(collection(unauth(), 'settings')));
  });

  it('lets no client write a settings bag, organizers included', async () => {
    // Admin SDK only. A client that could write this could put an
    // attacker-chosen phone number on an emergency card.
    await assertFails(setDoc(doc(asA(), 'settings/logistics'), { eventId: 'kgc-2027', values: {} }));
    await assertFails(setDoc(doc(asOrg(), 'settings/logistics'), { eventId: 'kgc-2027', values: {} }));
    await assertFails(updateDoc(doc(asOrg(), 'settings/logistics'), { values: { planReady: false } }));
    await assertFails(deleteDoc(doc(asOrg(), 'settings/logistics')));
    await assertFails(setDoc(doc(asOrg(), 'settings/access'), { eventId: 'kgc-2027', values: {} }));
  });
});

describe('where I am sitting', () => {
  // The seating plan is an organizer's document and stays one. What an attendee
  // gets is a projection under their own uid — the same relationship `directory`
  // has to `users`, and for the same reason: one plan document carries every
  // other name at the table, the organizer's notes, and tables that have been
  // sketched but not agreed.

  it('lets an attendee read their own placement, on both verbs', async () => {
    await assertSucceeds(getDoc(doc(asA(), `users/${A}/gatherings/g1`)));
    // `list` matters here — the screen renders every placement, so a predicate
    // that worked on a `get` and denied the query would leave the section
    // permanently empty and look like "you have no tables".
    await assertSucceeds(getDocs(collection(asA(), `users/${A}/gatherings`)));
  });

  it('refuses one attendee another attendee’s seat', async () => {
    await assertFails(getDoc(doc(asB(), `users/${A}/gatherings/g1`)));
    await assertFails(getDocs(collection(asB(), `users/${A}/gatherings`)));
    // An organizer too. They read the plan itself, with the Admin SDK.
    await assertFails(getDocs(collection(asOrg(), `users/${A}/gatherings`)));
  });

  it('refuses a placement to somebody who is not signed in as its owner', async () => {
    await assertFails(getDoc(doc(unauth(), `users/${A}/gatherings/g1`)));
    await assertFails(getDoc(doc(noClaim(), `users/${A}/gatherings/g1`)));
    // The unregistered signed-in user cannot manufacture one under their own
    // uid either — the write side is closed to every client.
    await assertFails(
      setDoc(doc(noClaim(), 'users/randomUser/gatherings/g1'), { title: 'Top table' }),
    );
  });

  it('lets nobody write a placement, including the person it is about', async () => {
    // Server-written when a writer exists. Self-service seating is a different
    // feature with a capacity check behind it, not a loosening of this rule.
    await assertFails(
      setDoc(doc(asA(), `users/${A}/gatherings/g2`), {
        eventId: 'kgc-2027', gatheringId: 'g2', kind: 'round-table',
        title: 'The good table', status: 'confirmed',
      }),
    );
    await assertFails(updateDoc(doc(asA(), `users/${A}/gatherings/g1`), { title: 'Better table' }));
    await assertFails(deleteDoc(doc(asA(), `users/${A}/gatherings/g1`)));
    await assertFails(
      setDoc(doc(asOrg(), `users/${A}/gatherings/g2`), { eventId: 'kgc-2027', title: 'X' }),
    );
  });

  it('keeps the seating plan itself closed to every client', async () => {
    // `gatherings/{id}` has no match block and must not get one: `attendees` is
    // every name at the table — half of them people with no ticket — and `notes`
    // is where the reason two of them were separated gets written.
    await assertFails(getDocs(collection(asA(), 'gatherings')));
    await assertFails(getDocs(collection(asOrg(), 'gatherings')));
    await assertFails(getDoc(doc(asA(), 'gatherings/g1')));
    await assertFails(setDoc(doc(asOrg(), 'gatherings/g2'), { eventId: 'kgc-2027', title: 'X' }));
  });
});

describe('consent forms and signatures', () => {
  /*
   * The one collection in this file that is a legal record rather than event
   * data, and every test below is named after a sentence somebody might have to
   * say about it in a room where it matters: what was agreed, to which wording,
   * by whom, and that nobody could change it afterwards.
   */
  const signature = (overrides: Record<string, unknown> = {}) => ({
    formId: 'cf_photo',
    formVersion: 2,
    bodyHash: 'hash-of-version-two',
    audience: 'attendee',
    signatory: B,
    uid: B,
    email: `${B}@kgc.test`,
    signedName: 'Attendee B',
    agreed: true,
    signedAt: new Date(),
    channel: 'app',
    ...overrides,
  });

  it('lets a ticket holder read the wording they are being asked to agree to', async () => {
    await assertSucceeds(getDoc(doc(asA(), 'consentForms/cf_photo')));
  });

  it('hides a draft form from attendees and shows it to organizers', async () => {
    // A draft is wording an organizer is still arguing about. Somebody who
    // signed it would have signed something that was never published.
    await assertFails(getDoc(doc(asA(), 'consentForms/cf_draft')));
    await assertSucceeds(getDoc(doc(asOrg(), 'consentForms/cf_draft')));
  });

  it('refuses a consentForms list that is not filtered to published', async () => {
    // The `sessions` and `surveys` hazard on a third collection. Nothing in the
    // app reads consent forms yet — the only client that signs one today is a
    // hypothetical, and the rule is written now rather than when somebody adds
    // the screen and reaches for the loosest thing that works.
    await assertFails(getDocs(collection(asA(), 'consentForms')));
    await assertSucceeds(
      getDocs(query(collection(asA(), 'consentForms'), where('status', '==', 'published'))),
    );
  });

  it('refuses a form to somebody signed in without a ticket', async () => {
    await assertFails(getDoc(doc(noClaim(), 'consentForms/cf_photo')));
    await assertFails(getDoc(doc(unauth(), 'consentForms/cf_photo')));
  });

  it('lets no client publish or reword a form, organizers included', async () => {
    // Forms are authored by the dashboard with the Admin SDK. A client that
    // could edit `body` could change what everybody who already signed agreed
    // to, which is the failure the whole versioning scheme exists to prevent.
    await assertFails(
      setDoc(doc(asOrg(), 'consentForms/cf_mine'), {
        eventId: 'kgc-2027', title: 'Mine', body: 'Anything', version: 1,
        bodyHash: 'h', audience: 'attendee', required: true, status: 'published',
      }),
    );
    await assertFails(updateDoc(doc(asOrg(), 'consentForms/cf_photo'), { body: 'Reworded' }));
    await assertFails(updateDoc(doc(asA(), 'consentForms/cf_photo'), { version: 99 }));
    await assertFails(deleteDoc(doc(asOrg(), 'consentForms/cf_photo')));
  });

  it('lets an attendee sign the published version of a published form', async () => {
    await assertSucceeds(setDoc(doc(asB(), `consentForms/cf_photo/responses/${B}_v2`), signature()));
  });

  it('refuses a second signature at the same version, and any edit to one', async () => {
    // Append-only. The duplicate is refused by the id already existing; the
    // update and the delete are refused by the rules. All three matter: a
    // record that can be revised afterwards records nothing.
    await assertFails(
      setDoc(doc(asA(), `consentForms/cf_photo/responses/${A}_v2`), signature({
        signatory: A, uid: A, email: `${A}@kgc.test`, signedName: 'Someone Else',
      })),
    );
    await assertFails(
      updateDoc(doc(asA(), `consentForms/cf_photo/responses/${A}_v2`), { signedName: 'Not me' }),
    );
    await assertFails(deleteDoc(doc(asA(), `consentForms/cf_photo/responses/${A}_v2`)));
    // And the organizer's browser tab cannot do any of it either. The dashboard
    // reads this subcollection with the Admin SDK and has no write path at all.
    await assertFails(
      updateDoc(doc(asOrg(), `consentForms/cf_photo/responses/${A}_v2`), { agreed: false }),
    );
    await assertFails(deleteDoc(doc(asOrg(), `consentForms/cf_photo/responses/${A}_v2`)));
  });

  it('pins the version signed to the version published', async () => {
    // The reason this path spends a `get()` on the parent form. Without it
    // `formVersion` is whatever the client typed, and a signature could name an
    // older and more permissive wording — or one that never existed — while the
    // register showed it as a signature like any other.
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_photo/responses/${B}_v1`), signature({ formVersion: 1 })),
    );
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_photo/responses/${B}_v9`), signature({ formVersion: 9 })),
    );
    // The id and the field have to agree as well, or one person could hold a
    // second signature by writing the same version to a different id.
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_photo/responses/${B}_v3`), signature()),
    );
  });

  it('refuses a signature against wording that is not the published wording', async () => {
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_photo/responses/${B}_v2`), signature({
        bodyHash: 'hash-of-something-i-made-up',
      })),
    );
  });

  it('refuses signing a draft', async () => {
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_draft/responses/${B}_v1`), signature({
        formId: 'cf_draft', formVersion: 1, bodyHash: 'hash-of-the-draft',
        audience: 'volunteer',
      })),
    );
  });

  it('refuses signing a form that does not exist', async () => {
    // `get()` returns null for a missing document and `null.data` throws, which
    // would be reported as permission-denied anyway — but by accident rather
    // than by decision, and only until somebody reorders the conjunction.
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_nothing/responses/${B}_v2`), signature({
        formId: 'cf_nothing',
      })),
    );
  });

  it('refuses a signature filed under somebody else', async () => {
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_photo/responses/${A}_v2x`), signature({
        signatory: A, uid: A,
      })),
    );
    // Right id, somebody else's name in the document.
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_photo/responses/${B}_v2`), signature({ uid: A })),
    );
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_photo/responses/${B}_v2`), signature({ signatory: A })),
    );
  });

  it('refuses a signature from somebody signed in without a ticket', async () => {
    await assertFails(
      setDoc(doc(noClaim(), 'consentForms/cf_photo/responses/randomUser_v2'), signature({
        signatory: 'randomUser', uid: 'randomUser', email: 'randomUser@kgc.test',
      })),
    );
  });

  it('refuses a recorded refusal, because there is no such thing here', async () => {
    // "I do not agree" is a form that was never submitted. A stored `false`
    // would be a row in the register that reads as a decision somebody made in
    // this system, and nothing in this system asks the question that way.
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_photo/responses/${B}_v2`), signature({ agreed: false })),
    );
  });

  it('refuses a client-written IP address or user agent', async () => {
    // A client that can write its own IP can write any IP, so the field would be
    // a self-reported value dressed as evidence. The website records them on the
    // link channel because the *server* observes them there.
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_photo/responses/${B}_v2`), signature({
        ip: '203.0.113.1',
      })),
    );
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_photo/responses/${B}_v2`), signature({
        userAgent: 'Mozilla/5.0',
      })),
    );
    // And the channel cannot be claimed to be the stronger one either.
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_photo/responses/${B}_v2`), signature({
        channel: 'link',
      })),
    );
  });

  it('refuses a signature missing a field or carrying an unexpected one', async () => {
    const { email: _dropped, ...withoutEmail } = signature();
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_photo/responses/${B}_v2`), withoutEmail),
    );
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_photo/responses/${B}_v2`), signature({
        eventId: 'kgc-2027',
      })),
    );
  });

  it('refuses an empty or absurdly long typed name', async () => {
    // The typed name is the signature. Bounded because it is free text that the
    // organizer's register renders.
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_photo/responses/${B}_v2`), signature({ signedName: '' })),
    );
    await assertFails(
      setDoc(doc(asB(), `consentForms/cf_photo/responses/${B}_v2`), signature({
        signedName: 'x'.repeat(121),
      })),
    );
  });

  it('lets somebody read their own signature back and nobody else theirs', async () => {
    await assertSucceeds(getDoc(doc(asA(), `consentForms/cf_photo/responses/${A}_v2`)));
    await assertFails(getDoc(doc(asB(), `consentForms/cf_photo/responses/${A}_v2`)));
    await assertFails(getDoc(doc(asOrg(), `consentForms/cf_photo/responses/${A}_v2`)));
  });

  it('does not break on a signature that has no uid at all', async () => {
    // The speaker who signed through the capability link. `resource.data.uid`
    // would throw on this document and Firestore would report it as
    // permission-denied — so the failure mode is A's own signature becoming
    // unreadable the moment somebody without an account signed the same form.
    await assertFails(getDoc(doc(asA(), 'consentForms/cf_photo/responses/spk_alpha_v2')));
    await assertSucceeds(getDoc(doc(asA(), `consentForms/cf_photo/responses/${A}_v2`)));
  });

  it('lets nobody enumerate who has and has not signed', async () => {
    // The register is a list of who has agreed to be photographed and who has
    // not, and neither an attendee nor an organizer's browser tab may have it.
    // The dashboard reads it with the Admin SDK, which bypasses rules — if it
    // ever stops doing that, this path needs a rule of its own rather than a
    // loosening of this one.
    await assertFails(getDocs(collection(asA(), 'consentForms/cf_photo/responses')));
    await assertFails(getDocs(collection(asOrg(), 'consentForms/cf_photo/responses')));
  });

  it('lets a signatory query their own signatures and nobody else’s', async () => {
    // Both verbs, because passing one proves nothing about the other — and this
    // one is the reason to say so. The first version of this rule was commented
    // "a `list` cannot be satisfied by any filter here", which was wrong:
    // Firestore evaluates a query against its constraints, exactly as it does
    // for the ticket list, so a filter naming your own uid is permitted and one
    // naming somebody else's is not. The suite caught the claim on its first run.
    await assertSucceeds(
      getDocs(query(collection(asA(), 'consentForms/cf_photo/responses'), where('uid', '==', A))),
    );
    await assertFails(
      getDocs(query(collection(asA(), 'consentForms/cf_photo/responses'), where('uid', '==', B))),
    );
    await assertFails(
      getDocs(query(collection(asOrg(), 'consentForms/cf_photo/responses'), where('uid', '==', A))),
    );
  });
});
