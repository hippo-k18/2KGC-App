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

import { contactId, registrationId, reviewerId } from '../../scripts/src/lib/ids';
import { memberIdFor } from '../../apps/organizer/src/lib/team-core';
import {
  NEVER_EXPORTED,
  PLACES,
  PersonKeyMismatch,
  confirmationMatches,
  erasureAuditBefore,
  erasureSummary,
  exportDocument,
  exportFilename,
  foldedFieldMatches,
  keyNameOf,
  parsePersonRef,
  personKeys,
  personRefParam,
  placesFor,
  redaction,
  skippedPlaces,
  stampFields,
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
    // computes. Deriving over it would walk the wrong document, or none. The
    // address off that same document comes with it — see below for why.
    const legacy = personKeys({
      email: 'ada.nakamura@example.com',
      registration: { id: 'reg-legacy-7', email: 'Ada.Nakamura@Example.com' },
    });
    expect(legacy.registrationId).toBe('reg-legacy-7');
  });

  /**
   * ⚠️ THE ONE WITH TEETH. The read id used to be taken on trust, so the
   * guarantee that these keys describe one person lived in whichever call site
   * happened to be careful rather than in the function. `parsePersonRef(
   * 'reg:<anything>')` puts whatever is in a URL on this path, and an id and an
   * address that disagree mean an erasure that takes one person's ticket and
   * another person's profile, messages and posts, and reports success.
   */
  it('refuses a ticket and an address that belong to different people', () => {
    expect(() =>
      personKeys({
        email: 'ada.nakamura@example.com',
        registration: { id: 'reg_whoever', email: 'somebody.else@example.com' },
      }),
    ).toThrow(PersonKeyMismatch);

    expect(() =>
      personKeys({
        email: 'ada.nakamura@example.com',
        registration: { id: 'reg_whoever', email: '' },
      }),
    ).toThrow(PersonKeyMismatch);
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

// ---------------------------------------------------------------------------
// The four holes the September 2026 review found in this walk
// ---------------------------------------------------------------------------

describe('a mixed-case address finds every place', () => {
  /**
   * The failure this pins.
   *
   * Every key is folded to lower case, and several collections store the
   * address exactly as it was typed: `emailLog.to` is whatever the caller
   * passed, a volunteer roster and a certificate carry the spelling on the
   * sheet they were imported from. An equality query on the lower-cased key
   * finds none of those documents — and finds them silently, so the erasure
   * reports "0 found, anonymised" and the organizer is told it finished while
   * the rows are still there with the name, the address and the template on
   * them. The subject access file misses exactly the same documents.
   *
   * Two halves, and both are needed. `foldedFieldMatches` is the comparison
   * `person-data.ts` actually runs in memory, so this is the real join and not
   * a description of it. The declaration test below is what stops the next
   * address-keyed place being added without `fold`, which would reopen the
   * hole one collection at a time.
   */
  const TYPED = 'Ada.Okonkwo@Example.com';
  const MIXED = personKeys({ email: TYPED, uid: 'uid_ada', qrSecret: 'qr_ada' });

  it('matches an address stored exactly as it was typed', () => {
    expect(foldedFieldMatches(MIXED.email, TYPED)).toBe(true);
    expect(foldedFieldMatches(MIXED.email, ' ADA.OKONKWO@EXAMPLE.COM ')).toBe(true);
    expect(foldedFieldMatches(MIXED.email, 'ada.okonkwo@example.com')).toBe(true);
  });

  it('does not match somebody else, or a field that is not an address', () => {
    expect(foldedFieldMatches(MIXED.email, 'ada.okonkwo@example.org')).toBe(false);
    expect(foldedFieldMatches(MIXED.email, undefined)).toBe(false);
    expect(foldedFieldMatches(MIXED.email, 42)).toBe(false);
    // An empty key would otherwise match every document with an empty field.
    expect(foldedFieldMatches('', '')).toBe(false);
  });

  it('folds every place that joins on an address, naming each one', () => {
    const folded = PLACES.filter((p) => {
      const { where } = p;
      if (where.at === 'doc' || where.at === 'own') return false;
      return 'fold' in where.match && where.match.fold === true;
    }).map((p) => p.key);

    // The four the review named, plus the two that were already correct by
    // accident because their writers happen to normalise.
    for (const key of [
      'emailsSent',
      'volunteerShifts',
      'certificates',
      'checkoutAnswers',
      'consentSignatures',
      'orders',
      'submissionAuthor',
    ]) {
      expect(folded, key).toContain(key);
    }
  });

  it('leaves no address-keyed place unfolded', () => {
    for (const place of PLACES) {
      const { where } = place;
      if (where.at === 'doc' || where.at === 'own') continue;
      if ('docId' in where.match) continue;
      if (where.match.key !== 'email') continue;
      expect('fold' in where.match && where.match.fold, place.key).toBe(true);
    }
  });

  it('reaches every place it would reach for a lower-case address', () => {
    const plain = personKeys({ email: 'ada.okonkwo@example.com', uid: 'uid_ada', qrSecret: 'qr_ada' });
    expect(placesFor(MIXED).map((p) => p.key)).toEqual(placesFor(plain).map((p) => p.key));
  });
});

describe('the erasure keeps the unsubscribe it used to destroy', () => {
  /**
   * `unsubscribedAt` lives on the contact row, an import never clears it, and
   * the row used to be deleted outright. Somebody who unsubscribed and then
   * asked to be forgotten was therefore mailable again by the next upload of an
   * older list — the worst recipient a conference can reach, because a
   * complaint from them takes the ticket receipts down with the newsletter.
   */
  const contacts = PLACES.find((p) => p.key === 'marketingContact');
  const rule = contacts?.erase as Extract<EraseRule, { do: 'anonymise' }>;

  it('keeps the row rather than deleting it', () => {
    expect(contacts?.erase.do).toBe('anonymise');
  });

  it('takes the name and address off it and leaves the suppression alone', () => {
    const update = redaction(rule, {
      email: 'ada.okonkwo@example.com',
      name: 'Ada Okonkwo',
      company: 'Example',
      lists: ['KGC 2026 attendees'],
      unsubscribedAt: { toDate: () => new Date('2026-03-01') },
    });
    expect(update.email).toBeNull();
    expect(update.name).toBeNull();
    expect(update.company).toBeNull();
    expect(update).not.toHaveProperty('unsubscribedAt');
    expect(update).not.toHaveProperty('lists');
  });

  it('marks somebody unsubscribed who had not asked, because asking to be erased is stronger', () => {
    expect(stampFields(rule, { email: 'ada@example.com' })).toEqual(['unsubscribedAt']);
  });

  it('does not re-date an unsubscribe already recorded', () => {
    const dated = { email: 'ada@example.com', unsubscribedAt: { toDate: () => new Date() } };
    expect(stampFields(rule, dated)).toEqual([]);
  });
});

describe('the audit entry proves the erasure without holding the address', () => {
  /**
   * The log survives the erasure by design, so anything written into it is
   * written for ever. The entry used to carry the display name, and a display
   * name falls back to the address for anybody who registered without one or
   * signed in with a code and never filled in a profile — so the erasure left,
   * permanently, the one field it exists to remove.
   */
  const NO_NAME = 'ada.okonkwo@example.com';

  it('carries no address, even for somebody whose name is their address', () => {
    const before = erasureAuditBefore({ walked: 24, signedIn: true, hasTicket: true });
    const written = JSON.stringify(before);
    expect(written).not.toContain(NO_NAME);
    expect(written).not.toContain('@');
  });

  it('still says enough to show the erasure happened and how wide it went', () => {
    expect(erasureAuditBefore({ walked: 24, signedIn: false, hasTicket: true })).toEqual({
      walked: 24,
      signedIn: false,
      hadTicket: true,
    });
  });
});

describe('the collections the walk used to miss entirely', () => {
  /**
   * A speaker who also bought a ticket asked to be erased, and their name, bio,
   * photo, company and social links stayed on the public page and in the app
   * while the screen told the organizer it was done. Same for the draft they
   * had sent through their own link, their place on the review committee, their
   * name under an abstract, and their sign-in to this dashboard.
   *
   * The decision for each is asserted here rather than only described, because
   * "delete or keep" on a published programme is the kind of choice that gets
   * quietly reversed by somebody tidying up.
   */
  const byKey = (key: string) => PLACES.find((p) => p.key === key);

  it('has an entry for each of the five', () => {
    for (const key of [
      'speakerProfile',
      'speakerDraft',
      'reviewerRecord',
      'submissionAuthor',
      'dashboardAccount',
    ]) {
      expect(byKey(key), key).toBeTruthy();
    }
  });

  it('keeps the published programme entry and takes the contact details off it', () => {
    const speaker = byKey('speakerProfile');
    expect(speaker?.erase.do).toBe('anonymise');
    const rule = speaker?.erase as Extract<EraseRule, { do: 'anonymise' }>;
    expect([...rule.clear].sort()).toEqual(['contactEmail', 'userId']);
    // The talk, the name and the bio are published facts about the conference
    // and are deliberately not in that list.
    expect(rule.clear).not.toContain('name');
    expect(rule.clear).not.toContain('bio');
    expect(rule.why).toBeTruthy();
  });

  it('deletes the unpublished draft, the committee record and the dashboard sign-in', () => {
    expect(byKey('speakerDraft')?.erase.do).toBe('delete');
    expect(byKey('reviewerRecord')?.erase.do).toBe('delete');
    expect(byKey('dashboardAccount')?.erase.do).toBe('delete');
  });

  it('deletes the author of an abstract and leaves the abstract anonymous', () => {
    const author = byKey('submissionAuthor');
    expect(author?.erase.do).toBe('delete');
    // The identity is already held apart from the work so that blind review is
    // a read decision. Deleting it leaves exactly what a blind reviewer sees.
    expect(author?.where.at).toBe('each');
  });

  it('derives the committee and dashboard ids from the address, so both are always reachable', () => {
    const keys = personKeys({ email: 'Ada.Okonkwo@Example.com' });
    expect(keys.reviewerId).toBe(reviewerId('ada.okonkwo@example.com'));
    expect(keys.teamMemberId).toBe(memberIdFor('ada.okonkwo@example.com'));
    const reachable = placesFor(keys).map((p) => p.key);
    expect(reachable).toContain('reviewerRecord');
    expect(reachable).toContain('dashboardAccount');
  });

  it('skips the two speaker places for somebody who is not on the programme', () => {
    // A speaker id is built from a name and a company and cannot be derived
    // from an address, so it is absent for everybody who is not a speaker — and
    // querying on an absent key is how an erasure deletes the wrong documents.
    const skipped = skippedPlaces(personKeys({ email: 'ada@example.com' })).map((s) => s.place.key);
    expect(skipped).toContain('speakerProfile');
    expect(skipped).toContain('speakerDraft');
  });
});
