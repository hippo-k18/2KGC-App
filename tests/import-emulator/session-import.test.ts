/**
 * The programme importers against a real Firestore emulator.
 *
 * `tests/programme/session-import-core.test.ts` pins the arithmetic — the
 * timezone derivation, the positional `speakerNames` — on the pure planner.
 * This one exists because a plan is not a write. The things it can catch that
 * the pure test cannot are all shaped the same way: a field that was computed
 * correctly and then not stored, or stored beside the wrong thing.
 *
 * Specifically:
 *
 *  - that `startsAt` lands as a real `Timestamp` built by the copy of
 *    `firebase-admin` that commits it, and not as a `Date` or as a sentinel
 *    from the wrong copy — the class-identity failure `lib/denormalise.ts`
 *    records as an outage;
 *  - that the denormalised caches arrive in the **same document write** as the
 *    ids they mirror, rather than in a follow-up a phone would render between;
 *  - that `speakers/{id}.sessionIds` — the inverse index the attendee's speaker
 *    page renders — is maintained, in both directions, by a re-import;
 *  - that a blank column leaves the stored value alone rather than clearing it.
 *
 * Run with:
 *   firebase emulators:exec --only firestore --config firebase.import-test.json \
 *     "npx vitest run --config vitest.import-emulator.mts"
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { COLLECTIONS, EVENT_ID, type SessionDoc, type SpeakerDoc } from '@kgc/shared';
import { db } from '@/lib/firestore';
import { commitSessionImport } from '@/app/(dash)/content/agenda-center/session-manager/import';
import { commitSpeakerImport } from '@/app/(dash)/content/speaker-center/speaker-manager/import';
import { commitTrackImport } from '@/app/(dash)/content/agenda-center/track-manager/import';

const ACTOR = 'importer@kgc.test';

/** Everything these tests write, so one case cannot leak into the next. */
const COLLECTIONS_UNDER_TEST = [
  COLLECTIONS.sessions,
  COLLECTIONS.speakers,
  COLLECTIONS.tracks,
  COLLECTIONS.rooms,
  COLLECTIONS.auditLog,
];

async function wipe() {
  for (const name of COLLECTIONS_UNDER_TEST) {
    const snap = await db().collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

async function seedRoom(id: string, name: string) {
  await db().collection(COLLECTIONS.rooms).doc(id).set({ eventId: EVENT_ID, name });
}

async function sessionByTitle(title: string): Promise<SessionDoc & { id: string }> {
  const snap = await db().collection(COLLECTIONS.sessions).where('title', '==', title).get();
  expect(snap.size).toBe(1);
  return { id: snap.docs[0].id, ...(snap.docs[0].data() as SessionDoc) };
}

async function speakerByName(name: string): Promise<SpeakerDoc & { id: string }> {
  const snap = await db().collection(COLLECTIONS.speakers).where('name', '==', name).get();
  expect(snap.size).toBe(1);
  return { id: snap.docs[0].id, ...(snap.docs[0].data() as SpeakerDoc) };
}

/** Speakers and tracks first — that is the order the agenda importer requires. */
async function seedProgrammeReferences() {
  const speakers = await commitSpeakerImport({
    actor: ACTOR,
    allowPartial: false,
    text: [
      'Name,Job title,Company,Contact email',
      'Ada Okonkwo,Principal Engineer,Acme Graphs,ada@acme.test',
      'Jae Vance,Researcher,Northwind,jae@northwind.test',
    ].join('\n'),
  });
  expect(speakers.failed).toEqual([]);
  expect(speakers.created).toBe(2);

  const tracks = await commitTrackImport({
    actor: ACTOR,
    allowPartial: false,
    text: ['Track,Colour', 'Graph ML,#2180b2', 'Industry,#c0392b'].join('\n'),
  });
  expect(tracks.failed).toEqual([]);
  expect(tracks.created).toBe(2);

  await seedRoom('bloomberg-165', 'Bloomberg 165');
}

beforeEach(wipe);
afterAll(wipe);

// ---------------------------------------------------------------------------

describe('importing the agenda', () => {
  it('derives the instants and the day key, and stores them beside the wall clock', async () => {
    await seedProgrammeReferences();

    const outcome = await commitSessionImport({
      actor: ACTOR,
      allowPartial: false,
      text: [
        'Day,Start,End,Title,Room,Track,Speakers,Format,Status',
        // 21:00 in New York on 4 May is 01:00 UTC on 5 May. The instant crosses
        // midnight and the day tab must not follow it.
        '2027-05-04,21:00,23:30,Welcome reception,Bloomberg 165,Industry,,Reception,published',
      ].join('\n'),
    });

    expect(outcome.failed).toEqual([]);
    expect(outcome.errors).toEqual([]);
    expect(outcome.created).toBe(1);

    const stored = await sessionByTitle('Welcome reception');
    expect(stored.startsAtLocal).toBe('2027-05-04T21:00');
    expect(stored.day).toBe('2027-05-04');
    expect(stored.timeZone).toBe('America/New_York');
    // A real Timestamp, written by the copy of firebase-admin that committed it.
    expect(typeof stored.startsAt.toDate).toBe('function');
    expect(stored.startsAt.toDate().toISOString()).toBe('2027-05-05T01:00:00.000Z');
    expect(stored.endsAt.toDate().toISOString()).toBe('2027-05-05T03:30:00.000Z');
    expect(stored.format).toBe('social');
    expect(stored.status).toBe('published');
  });

  it('writes the denormalised caches in the same document as the ids they mirror', async () => {
    await seedProgrammeReferences();

    const outcome = await commitSessionImport({
      actor: ACTOR,
      allowPartial: false,
      text: [
        'Day,Start,End,Title,Room,Track,Speakers',
        // Vance is billed first. The order is the committee's, not alphabetical.
        '2027-05-04,09:00,10:00,Knowledge graphs at scale,Bloomberg 165,Industry; Graph ML,Jae Vance; Ada Okonkwo',
      ].join('\n'),
    });
    expect(outcome.failed).toEqual([]);

    const stored = await sessionByTitle('Knowledge graphs at scale');
    const ada = await speakerByName('Ada Okonkwo');
    const jae = await speakerByName('Jae Vance');

    // Positional, in billing order, and index-aligned with the ids.
    expect(stored.speakerIds).toEqual([jae.id, ada.id]);
    expect(stored.speakerNames).toEqual(['Jae Vance', 'Ada Okonkwo']);

    // The primary track is trackIds[0] and nothing else; the cross-listed one
    // contributes an id and no cache.
    expect(stored.trackIds).toEqual(['industry', 'graph-ml']);
    expect(stored.primaryTrackName).toBe('Industry');
    expect(stored.primaryTrackColor).toBe('#c0392b');

    // The app cannot read the rooms collection at all, so this cache is its
    // only wayfinding data.
    expect(stored.roomId).toBe('bloomberg-165');
    expect(stored.roomName).toBe('Bloomberg 165');

    expect(stored.sequence).toBe(0);
    expect(stored.stableGuid).toContain(stored.id);
    // A new session is a draft: an import is a bulk write nobody reviews.
    expect(stored.status).toBe('draft');
  });

  it('maintains speakers.sessionIds in both directions across a re-import', async () => {
    await seedProgrammeReferences();
    const base = 'Day,Start,End,Title,Speakers';

    await commitSessionImport({
      actor: ACTOR,
      allowPartial: false,
      text: [base, '2027-05-04,09:00,10:00,Knowledge graphs at scale,Ada Okonkwo'].join('\n'),
    });

    const session = await sessionByTitle('Knowledge graphs at scale');
    expect((await speakerByName('Ada Okonkwo')).sessionIds).toEqual([session.id]);
    expect((await speakerByName('Jae Vance')).sessionIds).toEqual([]);

    // The same sheet with the speaker swapped: Ada must lose the session as
    // well as Jae gaining it, or her own page keeps showing a talk she is not
    // giving.
    const second = await commitSessionImport({
      actor: ACTOR,
      allowPartial: false,
      text: [base, '2027-05-04,09:00,10:00,Knowledge graphs at scale,Jae Vance'].join('\n'),
    });
    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);

    expect((await speakerByName('Ada Okonkwo')).sessionIds).toEqual([]);
    expect((await speakerByName('Jae Vance')).sessionIds).toEqual([session.id]);
    expect((await sessionByTitle('Knowledge graphs at scale')).id).toBe(session.id);
  });

  it('treats a blank cell as “not filled in”, never as “clear this field”', async () => {
    await seedProgrammeReferences();
    const withRoom = [
      'Day,Start,End,Title,Room,Track,Speakers,Description',
      '2027-05-04,09:00,10:00,Knowledge graphs at scale,Bloomberg 165,Graph ML,Ada Okonkwo,An abstract',
    ].join('\n');
    await commitSessionImport({ actor: ACTOR, allowPartial: false, text: withRoom });

    // The same programme re-exported without the optional columns — the way a
    // truncated export actually arrives.
    await commitSessionImport({
      actor: ACTOR,
      allowPartial: false,
      text: ['Day,Start,End,Title', '2027-05-04,09:00,10:00,Knowledge graphs at scale'].join('\n'),
    });

    const stored = await sessionByTitle('Knowledge graphs at scale');
    expect(stored.roomName).toBe('Bloomberg 165');
    expect(stored.description).toBe('An abstract');
    expect(stored.speakerNames).toEqual(['Ada Okonkwo']);
    expect(stored.primaryTrackName).toBe('Graph ML');
  });

  it('refuses a row naming a speaker that does not exist, and imports the rest', async () => {
    await seedProgrammeReferences();

    const outcome = await commitSessionImport({
      actor: ACTOR,
      allowPartial: true,
      text: [
        'Day,Start,End,Title,Speakers',
        '2027-05-04,09:00,10:00,A real session,Ada Okonkwo',
        '2027-05-04,11:00,12:00,A session with a ghost,Someone Unknown',
      ].join('\n'),
    });

    expect(outcome.created).toBe(1);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0].line).toBe(3);
    expect(outcome.failed[0].message).toMatch(/Import the speaker list first/);
    expect((await db().collection(COLLECTIONS.sessions).get()).size).toBe(1);
  });

  it('records one audit entry for the run, not one per row', async () => {
    await seedProgrammeReferences();
    await db().collection(COLLECTIONS.auditLog).get().then((s) => Promise.all(s.docs.map((d) => d.ref.delete())));

    await commitSessionImport({
      actor: ACTOR,
      allowPartial: false,
      text: [
        'Day,Start,End,Title',
        '2027-05-04,09:00,10:00,One',
        '2027-05-04,11:00,12:00,Two',
      ].join('\n'),
    });

    const audit = await db().collection(COLLECTIONS.auditLog).where('action', '==', 'session.import').get();
    expect(audit.size).toBe(1);
    expect(audit.docs[0].data().after).toMatchObject({ rows: 2, created: 2, updated: 0 });
  });
});

// ---------------------------------------------------------------------------

describe('importing tracks', () => {
  it('rewrites the cached colour on every session whose primary track it is', async () => {
    await seedProgrammeReferences();
    await commitSessionImport({
      actor: ACTOR,
      allowPartial: false,
      text: [
        'Day,Start,End,Title,Track',
        // Only the first is a *primary* Graph ML session; the second merely
        // cross-lists it and caches nothing about it.
        '2027-05-04,09:00,10:00,Primary,Graph ML',
        '2027-05-04,11:00,12:00,Cross-listed,Industry; Graph ML',
      ].join('\n'),
    });
    expect((await sessionByTitle('Primary')).primaryTrackColor).toBe('#2180b2');

    const outcome = await commitTrackImport({
      actor: ACTOR,
      allowPartial: false,
      text: ['Track,Colour', 'Graph ML,#7b2d8e'].join('\n'),
    });

    expect(outcome.updated).toBe(1);
    expect(outcome.fanOutFailures).toEqual([]);
    // One session recoloured, not two: the cross-listed one caches Industry.
    expect(outcome.sessionsRecoloured).toBe(1);
    expect((await sessionByTitle('Primary')).primaryTrackColor).toBe('#7b2d8e');
    expect((await sessionByTitle('Cross-listed')).primaryTrackColor).toBe('#c0392b');
  });

  it('leaves the palette alone when the colour column is missing', async () => {
    await seedProgrammeReferences();

    const outcome = await commitTrackImport({
      actor: ACTOR,
      allowPartial: false,
      text: ['Track,Description', 'Graph ML,Learning over graph structure'].join('\n'),
    });

    expect(outcome.updated).toBe(1);
    const track = await db().collection(COLLECTIONS.tracks).doc('graph-ml').get();
    expect(track.data()!.color).toBe('#2180b2');
    expect(track.data()!.description).toBe('Learning over graph structure');
  });
});

// ---------------------------------------------------------------------------

describe('importing speakers', () => {
  it('matches an existing speaker by name and updates rather than duplicating', async () => {
    await seedProgrammeReferences();

    // The same person with a corrected affiliation. `speakerId()` hashes name
    // and company together, so minting an id here would create a second record
    // for her that nothing would ever merge.
    const outcome = await commitSpeakerImport({
      actor: ACTOR,
      allowPartial: false,
      text: ['Name,Company,Bio', 'Ada Okonkwo,Acme Graphs Ltd,Works on graph storage'].join('\n'),
    });

    expect(outcome.created).toBe(0);
    expect(outcome.updated).toBe(1);
    expect((await db().collection(COLLECTIONS.speakers).get()).size).toBe(2);

    const ada = await speakerByName('Ada Okonkwo');
    expect(ada.company).toBe('Acme Graphs Ltd');
    expect(ada.bio).toBe('Works on graph storage');
    // Untouched by a sheet that did not carry the column.
    expect(ada.contactEmail).toBe('ada@acme.test');
  });
});
