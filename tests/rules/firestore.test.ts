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
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

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
      authorId: A, title: 'T', body: 'B', replyCount: 0, reactionCount: 0,
    });
    await setDoc(doc(db, 'sessions/s1/questions/q1'), {
      authorId: A, body: 'Q?', upvoteCount: 0, answered: false,
    });
    await setDoc(doc(db, 'sessions/s1/polls/openPoll'), {
      question: 'Pick', options: ['a', 'b'], open: true, tallies: [0, 0], totalVotes: 0,
    });
    await setDoc(doc(db, 'sessions/s1/polls/closedPoll'), {
      question: 'Done', options: ['a', 'b'], open: false, tallies: [1, 1], totalVotes: 2,
    });
    // Thread id is the two uids sorted and joined with '_'.
    await setDoc(doc(db, `threads/${A}_${B}`), {
      participantIds: [A, B], unread: { [A]: 0, [B]: 0 },
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
  it('refuses a client nudge to replyCount', async () => {
    await assertFails(updateDoc(doc(asA(), 'communityPosts/p1'), { replyCount: 1 }));
  });

  it('refuses a client nudge to reactionCount', async () => {
    await assertFails(updateDoc(doc(asA(), 'communityPosts/p1'), { reactionCount: 1 }));
  });

  it('refuses a client nudge to upvoteCount', async () => {
    // 500 scripted calls would otherwise put your own question on the keynote screen.
    await assertFails(
      updateDoc(doc(asA(), 'sessions/s1/questions/q1'), { upvoteCount: 500 }),
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
});

describe('polls and Q&A', () => {
  it('refuses a vote cast in someone else’s name', async () => {
    await assertFails(
      setDoc(doc(asA(), `sessions/s1/polls/openPoll/votes/${B}`), { uid: B, choice: 0 }),
    );
  });

  it('accepts your own vote while the poll is open', async () => {
    await assertSucceeds(
      setDoc(doc(asA(), `sessions/s1/polls/openPoll/votes/${A}`), { uid: A, choice: 0 }),
    );
  });

  it('refuses a vote once the poll is closed', async () => {
    await assertFails(
      setDoc(doc(asA(), `sessions/s1/polls/closedPoll/votes/${A}`), { uid: A, choice: 0 }),
    );
  });

  it('refuses an upvote whose uid does not match the writer', async () => {
    await assertFails(
      setDoc(doc(asA(), `sessions/s1/questions/q1/upvotes/${A}`), { uid: B }),
    );
  });

  it('keeps one upvote per person, by construction', async () => {
    await assertSucceeds(
      setDoc(doc(asA(), `sessions/s1/questions/q1/upvotes/${A}`), { uid: A }),
    );
    await assertFails(
      setDoc(doc(asA(), `sessions/s1/questions/q1/upvotes/${B}`), { uid: B }),
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
    await assertFails(getDoc(doc(asA(), `sponsors/sp/leads/${B}`)));
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

  it('lets an organizer edit it', async () => {
    await assertSucceeds(updateDoc(doc(asOrg(), 'sessions/s1'), { room: 'Bloomberg 165' }));
  });
});
