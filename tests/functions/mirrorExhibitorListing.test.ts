/**
 * Integration test for `mirrorExhibitorListing` and `onBoothAssignmentWrite`
 * (functions/SPEC.md #11 and #12), run against the real Firestore + Functions
 * emulators. See onReplyWrite.test.ts for why these are integration tests
 * rather than unit tests calling the trigger directly.
 *
 * Unlike mirrorDirectory.test.ts, this works on exhibitor and booth documents
 * this file creates and deletes itself rather than mutating seeded ones. The
 * seeded exhibitors are what `npm run smoke` and the organizer screens read,
 * and flipping a seeded status to `cancelled` mid-suite would delete a listing
 * another run expects to be there. Ids are prefixed `test-exh-` so they cannot
 * collide with `seed-exhibitor-N`.
 *
 * Run with: npm run test:functions
 */
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import type { DocumentData, DocumentReference, Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectToEmulator } from './lib/emulator.js';

const CONFIRMED = 'test-exh-confirmed';
const PROVISIONAL = 'test-exh-provisional';
const WITHDRAWN = 'test-exh-withdrawn';
const BOOTH_ASSIGNED = 'test-booth-Z01';
const BOOTH_HELD = 'test-booth-Z02';

let db: Firestore;

function exhibitorRef(id: string): DocumentReference {
  return db.collection(COLLECTIONS.exhibitors).doc(id);
}

function listingRef(id: string): DocumentReference {
  return db.collection(COLLECTIONS.exhibitorListings).doc(id);
}

async function listing(id: string): Promise<DocumentData | null> {
  const snap = await listingRef(id).get();
  return snap.exists ? (snap.data() ?? null) : null;
}

/** Waits for the trigger to converge on a listing existing, or not existing. */
async function waitForListing(id: string, present: boolean): Promise<DocumentData | null> {
  await expect
    .poll(async () => ((await listing(id)) !== null) === present, {
      timeout: 15_000,
      interval: 300,
    })
    .toBe(true);
  return listing(id);
}

const base = () => ({ eventId: EVENT_ID, createdAt: new Date(), updatedAt: new Date() });

beforeAll(async () => {
  db = connectToEmulator();

  // Left over from an interrupted run — the triggers are idempotent, but a
  // stale listing would make the "provisional publishes nothing" case pass for
  // the wrong reason.
  await Promise.all(
    [CONFIRMED, PROVISIONAL, WITHDRAWN].flatMap((id) => [
      exhibitorRef(id).delete(),
      listingRef(id).delete(),
    ]),
  );
  await Promise.all(
    [BOOTH_ASSIGNED, BOOTH_HELD].map((id) => db.collection(COLLECTIONS.booths).doc(id).delete()),
  );
}, 20_000);

afterAll(async () => {
  await Promise.all(
    [CONFIRMED, PROVISIONAL, WITHDRAWN].map((id) => exhibitorRef(id).delete()),
  );
  await Promise.all(
    [BOOTH_ASSIGNED, BOOTH_HELD].map((id) => db.collection(COLLECTIONS.booths).doc(id).delete()),
  );
  // The exhibitor deletes above fire the trigger, which removes the listings;
  // deleted here too so an aborted trigger cannot leak a document into the next
  // run's baseline.
  await Promise.all([CONFIRMED, PROVISIONAL, WITHDRAWN].map((id) => listingRef(id).delete()));
}, 20_000);

describe('mirrorExhibitorListing', () => {
  it('publishes a listing for a confirmed exhibitor, carrying no contact details and no pass counts', async () => {
    await exhibitorRef(CONFIRMED).set({
      ...base(),
      name: 'Test Graph Systems',
      boothNumber: 'FREE-TEXT-99',
      description: 'Graph tooling, for the test suite.',
      website: 'https://example.invalid/test-graph',
      contactName: 'Dana Whitfield',
      contactEmail: 'dana@example.invalid',
      passesAllocated: 4,
      passesUsed: 3,
      status: 'confirmed',
    });

    const entry = await waitForListing(CONFIRMED, true);

    expect(entry?.exhibitorId).toBe(CONFIRMED);
    expect(entry?.name).toBe('Test Graph Systems');
    expect(entry?.description).toBe('Graph tooling, for the test suite.');
    expect(entry?.website).toBe('https://example.invalid/test-graph');

    // The whole reason the projection exists. A regression here is the one that
    // hands a thousand phones a harvestable address list.
    expect(entry?.contactName).toBeUndefined();
    expect(entry?.contactEmail).toBeUndefined();
    expect(entry?.passesAllocated).toBeUndefined();
    expect(entry?.passesUsed).toBeUndefined();
    expect(entry?.status).toBeUndefined();

    // Exactly the fields ExhibitorListingDoc names, and nothing else. Written as
    // a set comparison rather than field-by-field so a newly added field on
    // ExhibitorDoc that leaks through fails this test rather than passing it.
    expect(new Set(Object.keys(entry ?? {}))).toEqual(
      new Set(['eventId', 'exhibitorId', 'name', 'description', 'website', 'createdAt', 'updatedAt']),
    );
  }, 25_000);

  it('publishes nothing at all for a provisional exhibitor', async () => {
    await exhibitorRef(PROVISIONAL).set({
      ...base(),
      name: 'Test Provisional Ltd',
      description: 'A space promised in a sales conversation nobody has paid for.',
      status: 'provisional',
    });

    /*
     * A settle-then-assert, not a poll. `expect.poll(...).toBeNull()` passes on
     * its first read — which is also what the world looks like one millisecond
     * before the trigger wrongly creates the document. The only assertion worth
     * making is that nothing appeared after the trigger has had time to run;
     * every other case in this file converges in well under two seconds.
     */
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await listing(PROVISIONAL)).toBeNull();
  }, 20_000);

  it('deletes the listing when a confirmed exhibitor is cancelled', async () => {
    await exhibitorRef(WITHDRAWN).set({
      ...base(),
      name: 'Test Withdrawn Systems',
      status: 'confirmed',
    });
    await waitForListing(WITHDRAWN, true);

    await exhibitorRef(WITHDRAWN).update({ status: 'cancelled', updatedAt: new Date() });

    // The security property: a company that pulled out must stop being published
    // on the next fetch, and the record must leave the server rather than travel
    // with a flag on it.
    await waitForListing(WITHDRAWN, false);
  }, 30_000);

  it('deletes the listing when the exhibitor document itself is deleted', async () => {
    await exhibitorRef(WITHDRAWN).set({ ...base(), name: 'Test Withdrawn Systems', status: 'confirmed' });
    await waitForListing(WITHDRAWN, true);

    await exhibitorRef(WITHDRAWN).delete();
    await waitForListing(WITHDRAWN, false);
  }, 30_000);

  it('is idempotent on replay — an unchanged rewrite does not touch the listing', async () => {
    const before = await waitForListing(CONFIRMED, true);
    expect(before).not.toBeNull();

    // The same payload written again. `updatedAt` moves on the *exhibitor*, so
    // the trigger genuinely fires; the projection is what must not move.
    await exhibitorRef(CONFIRMED).set({
      ...base(),
      name: 'Test Graph Systems',
      boothNumber: 'FREE-TEXT-99',
      description: 'Graph tooling, for the test suite.',
      website: 'https://example.invalid/test-graph',
      contactName: 'Dana Whitfield',
      contactEmail: 'dana@example.invalid',
      passesAllocated: 4,
      passesUsed: 3,
      status: 'confirmed',
    });

    // Two seconds is well past the observed trigger latency in this suite, so a
    // write that was going to happen has happened.
    await new Promise((r) => setTimeout(r, 2_000));

    const after = await listing(CONFIRMED);
    expect(after).toEqual(before);
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  }, 25_000);
});

describe('boothNumber resolution', () => {
  it('never publishes the exhibitor\'s free-text boothNumber', async () => {
    const entry = await waitForListing(CONFIRMED, true);
    // The exhibitor carries `FREE-TEXT-99` and holds no assigned booth, so the
    // listing carries no number at all — audit C's split-brain, closed.
    expect(entry?.boothNumber).toBeUndefined();
  }, 20_000);

  it('publishes the number of an assigned booth, and re-projects on the booth write alone', async () => {
    await db.collection(COLLECTIONS.booths).doc(BOOTH_ASSIGNED).set({
      ...base(),
      number: 'Z01',
      size: '3m × 2m',
      zone: 'Test aisle',
      status: 'assigned',
      exhibitorId: CONFIRMED,
      exhibitorName: 'Test Graph Systems',
    });

    // Nothing wrote `exhibitors/{id}` here. If this passes only because of the
    // console's best-effort denormalisation, it would fail.
    await expect
      .poll(async () => (await listing(CONFIRMED))?.boothNumber, { timeout: 15_000, interval: 300 })
      .toBe('Z01');
  }, 25_000);

  it('publishes no number for a held booth — promised, not paid for', async () => {
    await db.collection(COLLECTIONS.booths).doc(BOOTH_ASSIGNED).update({
      status: 'held',
      updatedAt: new Date(),
    });

    await expect
      .poll(async () => (await listing(CONFIRMED))?.boothNumber, { timeout: 15_000, interval: 300 })
      .toBeUndefined();
  }, 25_000);

  it('drops the number when the booth is released', async () => {
    await db.collection(COLLECTIONS.booths).doc(BOOTH_ASSIGNED).update({
      status: 'assigned',
      updatedAt: new Date(),
    });
    await expect
      .poll(async () => (await listing(CONFIRMED))?.boothNumber, { timeout: 15_000, interval: 300 })
      .toBe('Z01');

    await db.collection(COLLECTIONS.booths).doc(BOOTH_ASSIGNED).delete();

    await expect
      .poll(async () => (await listing(CONFIRMED))?.boothNumber, { timeout: 15_000, interval: 300 })
      .toBeUndefined();
  }, 30_000);
});
