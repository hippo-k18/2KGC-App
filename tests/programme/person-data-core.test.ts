/**
 * The walk behind a subject access request and an erasure.
 *
 * Both ask the same question — where is this person? — and both fail the same
 * way: a collection nobody remembered. That failure is invisible in a
 * screenshot, because an export that leaves a year of messages out looks
 * exactly like one that does not, so it is pinned here instead.
 *
 * What is worth testing is *not* the Firestore calls, which is why
 * `person-data-core.ts` exists apart from `person-data.ts`: the decisions are
 * which places are reachable for a given person, what may not leave in a file,
 * and what erasure overwrites rather than deletes. `person-data.ts` carries
 * `server-only` and cannot be loaded by Vitest at all.
 *
 * ── Why this lives in `tests/programme` ─────────────────────────────────────
 *
 * Because that is the runner. `consent-register.test.ts` and
 * `unsubscribe.test.ts` already sit here testing `apps/organizer/src/lib` for
 * the same reason: `npm test` includes this directory, and an unrun test is
 * worse than no test.
 *
 * Run with: npm run test:programme
 */
import { describe, expect, it } from 'vitest';

import { contactId, registrationId } from '../../scripts/src/lib/ids';
import {
  NEVER_EXPORTED,
  PLACES,
  confirmationMatches,
  erasureSummary,
  exportDocument,
  exportFilename,
  keyNameOf,
  parsePersonRef,
  personKeys,
  personRefParam,
  placesFor,
  redaction,
  skippedPlaces,
  type EraseRule,
  type PlaceOutcome,
} from '../../apps/organizer/src/lib/person-data-core';

const FULL = personKeys({
  email: 'Ada.Nakamura@Example.com',
  uid: 'uid_ada',
  qrSecret: 'qr_ada',
});

/** A ticket holder who has never opened the app: no uid, no badge scanned. */
const TICKET_ONLY = personKeys({ email: 'ada.nakamura@example.com' });

describe('who the person is', () => {
  it('lower-cases the address and derives the two ids from it', () => {
    expect(FULL.email).toBe('ada.nakamura@example.com');
    expect(FULL.registrationId).toBe(registrationId('ada.nakamura@example.com'));
    expect(FULL.contactId).toBe(contactId('ada.nakamura@example.com'));
  });

  it('keeps the registration id a caller actually read', () => {
    // A registration written before ids were derived sits at an id nothing
    // computes. Deriving over it would walk the wrong document, or none.
    const legacy = personKeys({ email: 'ada.nakamura@example.com', registrationId: 'reg-legacy-7' });
    expect(legacy.registrationId).toBe('reg-legacy-7');
  });
});

describe('the walk declares every place once', () => {
  it('has no duplicate keys, because the key names the export file section', () => {
    const keys = PLACES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('labels every place in plain words, with no collection name in it', () => {
    for (const place of PLACES) {
      expect(place.label.length).toBeGreaterThan(0);
      expect(place.label).not.toMatch(/[a-z][A-Z]/); // camelCase is a collection name
    }
  });

  it('gives a reason wherever a record is kept or only anonymised', () => {
    for (const place of PLACES) {
      if (place.erase.do === 'delete') continue;
      expect(place.erase.why, place.key).toBeTruthy();
    }
  });

  it('names the five places a deletion request is really about', () => {
    const keys = PLACES.map((p) => p.key);
    for (const expected of [
      'registration',
      'profile',
      'checkIns',
      'messagesSent',
      'communityPosts',
      'surveyAnswers',
    ]) {
      expect(keys).toContain(expected);
    }
  });

  it('anonymises the consent record rather than deleting it', () => {
    const consent = PLACES.find((p) => p.key === 'consentSignatures');
    expect(consent?.erase.do).toBe('anonymise');
  });

  it('leaves the organizer log alone', () => {
    const log = PLACES.find((p) => p.key === 'organizerActions');
    expect(log?.erase.do).toBe('keep');
  });
});

describe('which places are reachable', () => {
  /**
   * The test this module exists for.
   *
   * Firestore answers a query on `undefined` with *every* document in the
   * collection, so walking a uid-keyed place for somebody who has no uid is an
   * erasure that deletes the whole community board. Every place therefore
   * names the key it is matched on, and a place whose key is missing is
   * skipped rather than queried.
   */
  it('skips every uid-keyed place for a ticket holder who never signed in', () => {
    const reachable = placesFor(TICKET_ONLY);
    for (const place of reachable) {
      expect(TICKET_ONLY[keyNameOf(place)], place.key).toBeTruthy();
    }
    expect(reachable.some((p) => p.key === 'communityPosts')).toBe(false);
    expect(reachable.some((p) => p.key === 'registration')).toBe(true);
  });

  it('reaches more for somebody with an account and a badge', () => {
    expect(placesFor(FULL).length).toBeGreaterThan(placesFor(TICKET_ONLY).length);
  });

  it('accounts for every place it did not walk', () => {
    const walked = placesFor(TICKET_ONLY).length;
    const skipped = skippedPlaces(TICKET_ONLY).length;
    expect(walked + skipped).toBe(PLACES.length);
  });

  it('names the missing key for each skipped place, so the screen can say why', () => {
    const scans = skippedPlaces(TICKET_ONLY).find((s) => s.place.key === 'scans');
    expect(scans?.missing).toBe('qrSecret');
  });
});

describe('what may leave in a file', () => {
  it('withholds every working credential and names what it withheld', () => {
    const { data, omitted } = exportDocument({
      name: 'Ada Nakamura',
      qrSecret: 'qr_ada',
      claimCode: 'ABCD12',
      tempPassword: '019283',
      emailHash: 'deadbeef',
      ticketType: 'Main Conference',
    });
    expect(data).toEqual({ name: 'Ada Nakamura', ticketType: 'Main Conference' });
    expect(omitted).toEqual(['claimCode', 'emailHash', 'qrSecret', 'tempPassword']);
  });

  it('withholds every field the list names, so adding one takes effect everywhere', () => {
    const doc = Object.fromEntries(NEVER_EXPORTED.map((f) => [f, 'secret']));
    const { data } = exportDocument({ ...doc, keep: 'yes' });
    expect(data).toEqual({ keep: 'yes' });
  });

  it('turns a Firestore timestamp into something JSON keeps', () => {
    const at = new Date('2027-05-05T09:00:00.000Z');
    const { data } = exportDocument({ at: { toDate: () => at }, nested: { when: at } });
    expect(data.at).toBe('2027-05-05T09:00:00.000Z');
    expect(data.nested).toEqual({ when: '2027-05-05T09:00:00.000Z' });
  });

  it('names the file after the person and the day', () => {
    expect(exportFilename('Ada Nakamura', 'ada@example.com', new Date('2026-09-20T12:00:00Z'))).toBe(
      'kgc-data-for-ada-nakamura-2026-09-20.json',
    );
  });

  it('falls back to the address when nobody ever typed a name', () => {
    expect(exportFilename('', 'ada@example.com', new Date('2026-09-20T12:00:00Z'))).toBe(
      'kgc-data-for-ada-2026-09-20.json',
    );
  });
});

describe('what erasure writes over a record that is kept', () => {
  const orderRule: Extract<EraseRule, { do: 'anonymise' }> = {
    do: 'anonymise',
    clear: ['email', 'buyerName'],
    clearIn: { array: 'items', fields: ['attendeeName', 'attendeeEmail'] },
    why: 'A payment has to stay on the books.',
  };

  it('clears the named fields and the names inside the lines', () => {
    const update = redaction(orderRule, {
      email: 'ada@example.com',
      buyerName: 'Ada Nakamura',
      amountCents: 89900,
      items: [
        { ticketTypeId: 'main', attendeeName: 'Ada Nakamura', attendeeEmail: 'ada@example.com' },
        { ticketTypeId: 'main', attendeeName: 'Kai Ortiz', attendeeEmail: 'kai@example.com' },
      ],
    });

    expect(update.email).toBeNull();
    expect(update.buyerName).toBeNull();
    expect(update.amountCents).toBeUndefined();
    expect(update.items).toEqual([
      { ticketTypeId: 'main' },
      { ticketTypeId: 'main' },
    ]);
  });

  it('writes nothing at all when the person is already out of the record', () => {
    // A second erasure of the same person must not re-date a record nobody
    // touched, or the audit trail fills with entries that changed nothing.
    expect(redaction(orderRule, { amountCents: 89900, items: [{ ticketTypeId: 'main' }] })).toEqual(
      {},
    );
  });
});

describe('what the organizer is told afterwards', () => {
  const outcome = (did: PlaceOutcome['did'], found: number): PlaceOutcome => ({
    key: did + found,
    label: did,
    found,
    did,
  });

  it('counts the three fates separately', () => {
    expect(
      erasureSummary([outcome('deleted', 14), outcome('anonymised', 2), outcome('kept', 3)]),
    ).toBe(
      'Deleted 14 records. Took their name off 2 records that have to stay. Left 3 entries in the organizer log.',
    );
  });

  it('says nothing about what did not happen', () => {
    expect(erasureSummary([outcome('deleted', 1), outcome('skipped', 0)])).toBe('Deleted 1 record.');
  });
});

describe('the typed confirmation', () => {
  it('accepts the address whatever case and spacing it was typed in', () => {
    expect(confirmationMatches('  Ada.Nakamura@Example.com ', 'ada.nakamura@example.com')).toBe(true);
  });

  it('refuses a different address, and refuses the word delete', () => {
    expect(confirmationMatches('kai@example.com', 'ada@example.com')).toBe(false);
    expect(confirmationMatches('delete', 'ada@example.com')).toBe(false);
  });

  it('refuses everything when there is no address to confirm against', () => {
    expect(confirmationMatches('', '')).toBe(false);
  });
});

describe('the row parameter', () => {
  it('round-trips a ticket holder and an app account', () => {
    expect(parsePersonRef(personRefParam({ registrationId: 'reg_1' }))).toEqual({
      registrationId: 'reg_1',
    });
    expect(parsePersonRef(personRefParam({ uid: 'uid_1' }))).toEqual({ uid: 'uid_1' });
  });

  it('prefers the registration when a row has both, because it carries the badge secret', () => {
    expect(personRefParam({ registrationId: 'reg_1', uid: 'uid_1' })).toBe('reg:reg_1');
  });

  it('refuses anything it did not write', () => {
    expect(parsePersonRef('reg_1')).toBeNull();
    expect(parsePersonRef('user:uid_1')).toBeNull();
    expect(parsePersonRef('reg:')).toBeNull();
    expect(parsePersonRef('')).toBeNull();
  });
});
