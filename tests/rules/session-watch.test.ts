/**
 * Rules tests for `sessions/{id}/watch/{stream|recording}`.
 *
 * The invariant these exist for: a client holding the wrong ticket cannot read
 * the stream or the recording **at all** — not a redacted version of it, not
 * the URL without the passcode. Rules filter documents, so the document is the
 * unit, and these tests are the proof that it is really the unit.
 *
 * Same stance as `firestore.test.ts`: each test is a sentence you could say to
 * an attendee.
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
import { doc, getDoc, getDocs, collection, setDoc, deleteDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// Unique per process, for the reason given at length in `firestore.test.ts`.
const PROJECT_ID = `kgc-watch-rules-test-${process.pid}`;

/** Holds All Access. May watch the gated keynote. */
const ALL = 'attendeeAll';
/** Holds Main Conference. May not. */
const MAIN = 'attendeeMain';
/** Holds All Access, but signed up as `Mixed.Case@KGC.test`. */
const MIXED = 'attendeeMixed';
/** A ticket holder whose profile has no pointer at all. */
const NOPOINTER = 'attendeeNoPointer';
/** Signed in, no ticket. */
const STRANGER = 'stranger';
const ORG = 'organizerU';

const OPEN_SESSION = 'open-session';
const GATED_SESSION = 'gated-session';
const DRAFT_SESSION = 'draft-session';

let env: RulesTestEnvironment;

const token = (uid: string, email: string, registered: boolean, roles: string[]) => ({
  registered,
  roles,
  email,
  email_verified: true,
});

const CONTEXTS: Record<string, { email: string; registered: boolean; roles: string[] }> = {
  [ALL]: { email: 'all@kgc.test', registered: true, roles: ['attendee'] },
  [MAIN]: { email: 'main@kgc.test', registered: true, roles: ['attendee'] },
  // The address on the token carries capitals. The registration below stores it
  // folded, which is what `normaliseEmail()` does on the way in.
  [MIXED]: { email: 'Mixed.Case@KGC.test', registered: true, roles: ['attendee'] },
  [NOPOINTER]: { email: 'nopointer@kgc.test', registered: true, roles: ['attendee'] },
  [STRANGER]: { email: 'stranger@kgc.test', registered: false, roles: [] },
  [ORG]: { email: 'org@kgc.test', registered: true, roles: ['attendee', 'organizer'] },
};

const as = (uid: string) => {
  const c = CONTEXTS[uid]!;
  return env
    .authenticatedContext(uid, token(uid, c.email, c.registered, c.roles))
    .firestore() as unknown as Firestore;
};

const streamPath = (sessionId: string) => `sessions/${sessionId}/watch/stream`;
const recordingPath = (sessionId: string) => `sessions/${sessionId}/watch/recording`;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const session = { eventId: 'kgc-2027', status: 'published', title: 'x' };
    await setDoc(doc(db, `sessions/${OPEN_SESSION}`), session);
    await setDoc(doc(db, `sessions/${GATED_SESSION}`), { ...session, watchRestricted: true });
    await setDoc(doc(db, `sessions/${DRAFT_SESSION}`), { ...session, status: 'draft' });

    // Registrations, stored the way `normaliseEmail()` stores them: lowercased.
    await setDoc(doc(db, 'registrations/reg_all'), {
      email: 'all@kgc.test', altEmails: [], status: 'active', ticketType: 'All Access',
    });
    await setDoc(doc(db, 'registrations/reg_main'), {
      email: 'main@kgc.test', altEmails: [], status: 'active', ticketType: 'Main Conference',
    });
    await setDoc(doc(db, 'registrations/reg_mixed'), {
      email: 'mixed.case@kgc.test', altEmails: [], status: 'active', ticketType: 'All Access',
    });
    await setDoc(doc(db, 'registrations/reg_cancelled'), {
      email: 'main@kgc.test', altEmails: [], status: 'cancelled', ticketType: 'All Access',
    });
    await setDoc(doc(db, 'registrations/reg_nopointer'), {
      email: 'nopointer@kgc.test', altEmails: [], status: 'active', ticketType: 'All Access',
    });

    // Profiles carrying the pointer the watch rules follow.
    await setDoc(doc(db, `users/${ALL}`), { eventId: 'kgc-2027', registrationId: 'reg_all' });
    await setDoc(doc(db, `users/${MAIN}`), { eventId: 'kgc-2027', registrationId: 'reg_main' });
    await setDoc(doc(db, `users/${MIXED}`), { eventId: 'kgc-2027', registrationId: 'reg_mixed' });
    await setDoc(doc(db, `users/${NOPOINTER}`), { eventId: 'kgc-2027' });
    await setDoc(doc(db, `users/${ORG}`), { eventId: 'kgc-2027' });

    const base = {
      eventId: 'kgc-2027',
      provider: 'youtube',
      source: 'https://youtu.be/dQw4w9WgXcQ',
      watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      embeddable: true,
    };
    await setDoc(doc(db, streamPath(OPEN_SESSION)), {
      ...base, sessionId: OPEN_SESSION, state: 'live', allowedTicketTypes: [],
    });
    await setDoc(doc(db, recordingPath(OPEN_SESSION)), {
      ...base, sessionId: OPEN_SESSION, title: 'Opening keynote', allowedTicketTypes: [],
    });
    await setDoc(doc(db, streamPath(GATED_SESSION)), {
      ...base, sessionId: GATED_SESSION, state: 'live', allowedTicketTypes: ['All Access'],
    });
    await setDoc(doc(db, recordingPath(GATED_SESSION)), {
      ...base, sessionId: GATED_SESSION, title: 'Workshop', allowedTicketTypes: ['All Access'],
    });
    await setDoc(doc(db, streamPath(DRAFT_SESSION)), {
      ...base, sessionId: DRAFT_SESSION, state: 'scheduled', allowedTicketTypes: [],
    });
  });
});

describe('a stream nobody restricted', () => {
  it('is readable by any ticket holder', async () => {
    await assertSucceeds(getDoc(doc(as(MAIN), streamPath(OPEN_SESSION))));
  });

  it('is readable by a ticket holder whose profile has no pointer yet', async () => {
    await assertSucceeds(getDoc(doc(as(NOPOINTER), streamPath(OPEN_SESSION))));
  });

  it('is refused to somebody signed in without a ticket', async () => {
    await assertFails(getDoc(doc(as(STRANGER), streamPath(OPEN_SESSION))));
  });

  it('is refused to a signed-out visitor', async () => {
    const anon = env.unauthenticatedContext().firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(anon, streamPath(OPEN_SESSION))));
  });
});

describe('a stream restricted to one ticket type', () => {
  it('is readable by somebody holding that ticket', async () => {
    await assertSucceeds(getDoc(doc(as(ALL), streamPath(GATED_SESSION))));
  });

  it('is refused to somebody holding a different ticket', async () => {
    await assertFails(getDoc(doc(as(MAIN), streamPath(GATED_SESSION))));
  });

  it('is refused to a ticket holder whose profile has no pointer', async () => {
    await assertFails(getDoc(doc(as(NOPOINTER), streamPath(GATED_SESSION))));
  });

  it('is refused when the ticket was cancelled', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${MAIN}`), {
        eventId: 'kgc-2027', registrationId: 'reg_cancelled',
      });
    });
    await assertFails(getDoc(doc(as(MAIN), streamPath(GATED_SESSION))));
  });

  it('is refused to somebody pointing at a registration that is not theirs', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${MAIN}`), {
        eventId: 'kgc-2027', registrationId: 'reg_all',
      });
    });
    await assertFails(getDoc(doc(as(MAIN), streamPath(GATED_SESSION))));
  });

  it('is refused when the pointer names a registration that does not exist', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${MAIN}`), {
        eventId: 'kgc-2027', registrationId: 'reg_nobody',
      });
    });
    await assertFails(getDoc(doc(as(MAIN), streamPath(GATED_SESSION))));
  });

  /**
   * The case this project has already paid for twice. The token says
   * `Mixed.Case@KGC.test`; the registration says `mixed.case@kgc.test`. Both
   * sides have to be folded or the video plays for everybody except the one
   * attendee who typed a capital letter.
   */
  it('is readable by a holder whose address is capitalised on the token', async () => {
    await assertSucceeds(getDoc(doc(as(MIXED), streamPath(GATED_SESSION))));
  });

  it('is readable when the registration itself was stored with capitals', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'registrations/reg_shouty'), {
        email: 'ALL@KGC.TEST', altEmails: [], status: 'active', ticketType: 'All Access',
      });
      await setDoc(doc(db, `users/${ALL}`), {
        eventId: 'kgc-2027', registrationId: 'reg_shouty',
      });
    });
    await assertSucceeds(getDoc(doc(as(ALL), streamPath(GATED_SESSION))));
  });

  it('is readable through an alternate address on the registration', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'registrations/reg_alt'), {
        email: 'work@kgc.test',
        altEmails: ['main@kgc.test'],
        status: 'active',
        ticketType: 'All Access',
      });
      await setDoc(doc(db, `users/${MAIN}`), {
        eventId: 'kgc-2027', registrationId: 'reg_alt',
      });
    });
    await assertSucceeds(getDoc(doc(as(MAIN), streamPath(GATED_SESSION))));
  });
});

describe('a recording', () => {
  it('is gated on its own, not on the stream beside it', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      // The stream is open to everybody; the recording is not.
      await setDoc(
        doc(db, streamPath(GATED_SESSION)),
        { eventId: 'kgc-2027', sessionId: GATED_SESSION, provider: 'youtube', source: 'x',
          watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
          embeddable: true, state: 'ended', allowedTicketTypes: [] },
      );
    });
    await assertSucceeds(getDoc(doc(as(MAIN), streamPath(GATED_SESSION))));
    await assertFails(getDoc(doc(as(MAIN), recordingPath(GATED_SESSION))));
  });

  it('is readable by the tier it was sold to', async () => {
    await assertSucceeds(getDoc(doc(as(ALL), recordingPath(GATED_SESSION))));
  });
});

describe('the session around it', () => {
  it("hides an unpublished session's stream from attendees", async () => {
    await assertFails(getDoc(doc(as(ALL), streamPath(DRAFT_SESSION))));
  });

  it('shows it to an organizer, who is the person setting it up', async () => {
    await assertSucceeds(getDoc(doc(as(ORG), streamPath(DRAFT_SESSION))));
  });

  it('lets an organizer read a restricted stream without holding that ticket', async () => {
    await assertSucceeds(getDoc(doc(as(ORG), streamPath(GATED_SESSION))));
  });
});

describe('what a client may never do', () => {
  it('cannot list the collection, even the part it is allowed to read', async () => {
    await assertFails(getDocs(collection(as(ALL), `sessions/${OPEN_SESSION}/watch`)));
  });

  it('cannot write a stream, so nobody can point a session at their own video', async () => {
    await assertFails(
      setDoc(doc(as(ALL), streamPath(OPEN_SESSION)), { allowedTicketTypes: [], state: 'live' }),
    );
  });

  it('cannot write one as an organizer either, because the dashboard is the writer', async () => {
    await assertFails(
      setDoc(doc(as(ORG), streamPath(OPEN_SESSION)), { allowedTicketTypes: [], state: 'live' }),
    );
  });

  it('cannot delete one', async () => {
    await assertFails(deleteDoc(doc(as(ORG), streamPath(OPEN_SESSION))));
  });

  it('cannot widen a restriction by rewriting its own ticket type', async () => {
    await assertFails(
      setDoc(doc(as(MAIN), 'registrations/reg_main'), { ticketType: 'All Access' }, { merge: true }),
    );
  });
});

/**
 * The pointer itself. The app writes it on the first badge lookup, which is the
 * only place that holds both halves.
 */
describe('the pointer on the profile', () => {
  it('may be changed by its owner', async () => {
    // A different value from the one seeded, or the write changes no field at
    // all and the allowlist is never consulted — which is how a test for an
    // allowlist entry passes with the entry removed.
    await assertSucceeds(
      setDoc(doc(as(MAIN), `users/${MAIN}`), { registrationId: 'reg_other' }, { merge: true }),
    );
  });

  it('may be written onto a profile that does not exist yet', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), `users/${MAIN}`));
    });
    await assertSucceeds(
      setDoc(doc(as(MAIN), `users/${MAIN}`), { registrationId: 'reg_main' }, { merge: true }),
    );
  });

  it('may not be written onto somebody else', async () => {
    await assertFails(
      setDoc(doc(as(MAIN), `users/${ALL}`), { registrationId: 'reg_main' }, { merge: true }),
    );
  });

  it('may not be written by somebody without a ticket', async () => {
    await assertFails(
      setDoc(
        doc(as(STRANGER), `users/${STRANGER}`),
        { registrationId: 'reg_all' },
        { merge: true },
      ),
    );
  });
});
