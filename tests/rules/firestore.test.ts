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

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'kgc-rules-test',
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
    await setDoc(doc(db, 'registrations/reg_001'), { email: `${A}@kgc.test` });
    await setDoc(doc(db, 'sessions/s1'), { title: 'Keynote', status: 'published' });
    await setDoc(doc(db, 'sessions/draft1'), { title: 'Unannounced keynote', status: 'draft' });
    await setDoc(doc(db, 'speakers/sp1'), { name: 'A Speaker' });
    await setDoc(doc(db, 'tracks/t1'), { name: 'Graph Data Science' });
    await setDoc(doc(db, 'sponsors/sp'), { name: 'Sponsor', tier: 'gold' });
    await setDoc(doc(db, 'sponsors/sp/leads/' + B), { uid: B, email: 'b@kgc.test' });
    await setDoc(doc(db, 'announcements/a1'), { title: 'Hello' });
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
  it('is not enumerable by anyone, including organizers', async () => {
    await assertFails(getDocs(collection(asA(), 'registrations')));
    await assertFails(getDocs(collection(asOrg(), 'registrations')));
  });

  it('is not readable document-by-document either', async () => {
    await assertFails(getDoc(doc(asA(), 'registrations/reg_001')));
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
