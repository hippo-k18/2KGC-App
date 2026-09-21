import 'server-only';

import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
} from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type RegistrationDoc, type SpeakerDoc, type UserDoc } from '@kgc/shared';
import { normaliseEmail } from '@kgc/scripts/src/lib/ids';
import { appendAudit } from './audit';
import { db } from './firestore';
import { recordError } from './errors';
import {
  confirmationMatches,
  erasureAuditBefore,
  erasureSummary,
  exportDocument,
  foldedFieldMatches,
  personKeys,
  placesFor,
  redaction,
  stampFields,
  type PersonKeys,
  type PersonPlace,
  type PlaceMatch,
  type PlaceOutcome,
} from './person-data-core';

/**
 * Running the walk in `person-data-core.ts` against Firestore.
 *
 * This module decides nothing. Which collections hold a person, what a subject
 * access file may carry and what erasure does where it lands are all in the
 * core file, where they are pure and tested; here is the Admin SDK that fetches
 * and writes. Adding a collection is an entry in `PLACES` and no change here.
 *
 * ── Why `listDocuments()` and not a collection-group query ──────────────────
 *
 * Half the walk is a subcollection under every session, every post or every
 * survey. A `collectionGroup` query would reach them in one call and would need
 * a composite index per nesting — and a missing index in production fails at
 * query time, which during an erasure means a half-deleted person and no way to
 * tell which half. Listing the ancestors needs no index at all, costs a
 * document listing rather than a read, and cannot fail on a deployment that was
 * never `firebase deploy --only firestore:indexes`ed.
 */

// ---------------------------------------------------------------------------
// Finding the person
// ---------------------------------------------------------------------------

/** How the screen names somebody: their ticket, or their app account. */
export interface PersonRef {
  registrationId?: string;
  uid?: string;
}

export interface PersonIdentity {
  keys: PersonKeys;
  /** For the heading and the download's filename. The address when unnamed. */
  name: string;
  email: string;
  /** True when a `users` document exists, i.e. they have opened the app. */
  signedIn: boolean;
  hasTicket: boolean;
}

/**
 * Turn a row's id into the five keys the walk needs.
 *
 * Both directions, because the attendee list is a union: a ticket holder who
 * never opened the app has no uid, and an account with no ticket has no
 * registration. The two are joined on the address, the same join
 * `listAttendees()` makes, because `claimedByUid` is not written by the seed or
 * by first sign-in and would disagree with the screen the button sits on.
 */
export async function resolvePerson(ref: PersonRef): Promise<PersonIdentity | null> {
  let reg: RegistrationDoc | undefined;
  let regId: string | undefined;
  let user: UserDoc | undefined;
  let uid: string | undefined;

  if (ref.registrationId) {
    const snap = await db().collection(COLLECTIONS.registrations).doc(ref.registrationId).get();
    if (!snap.exists) return null;
    reg = snap.data() as RegistrationDoc;
    regId = snap.id;
  }

  if (ref.uid) {
    const snap = await db().collection(COLLECTIONS.users).doc(ref.uid).get();
    if (!snap.exists && !reg) return null;
    if (snap.exists) {
      user = snap.data() as UserDoc;
      uid = snap.id;
    }
  }

  const email = normaliseEmail(reg?.email ?? user?.email ?? '');
  if (!email) return null;

  // The other half of the union, found by address.
  if (!user) {
    const found = await db()
      .collection(COLLECTIONS.users)
      .where('email', '==', email)
      .limit(1)
      .get();
    if (!found.empty) {
      user = found.docs[0].data() as UserDoc;
      uid = found.docs[0].id;
    }
  }
  if (!reg) {
    const found = await db()
      .collection(COLLECTIONS.registrations)
      .where('email', '==', email)
      .limit(1)
      .get();
    if (!found.empty) {
      reg = found.docs[0].data() as RegistrationDoc;
      regId = found.docs[0].id;
    }
  }

  return {
    keys: personKeys({
      email,
      uid,
      /*
       * The id and the address off the same document, which is what
       * `personKeys` checks against each other. A registration reached by a
       * `reg:` parameter that named somebody else's ticket is refused there
       * rather than walked.
       */
      ...(regId && reg ? { registration: { id: regId, email: reg.email ?? '' } } : {}),
      speakerId: await speakerIdFor(email, uid),
      qrSecret: reg?.qrSecret,
    }),
    name: reg?.name || user?.name || email,
    email,
    signedIn: Boolean(user),
    hasTicket: Boolean(reg),
  };
}

/**
 * Their `speakers/{id}`, if they are on the programme.
 *
 * Not derivable: a speaker id is built from a name and a company, so it cannot
 * be computed from an address the way a registration or a contact can. The
 * roster is a few hundred documents and is read whole rather than queried,
 * because `contactEmail` is stored as the programme committee typed it and
 * Firestore cannot compare two strings case-insensitively. Both joins are
 * tried: the address the committee corresponds with, and the app account the
 * speaker later claimed, which may be a different address on purpose.
 *
 * Returns undefined on any failure. A speaker lookup that throws must not stop
 * somebody's export or erasure — the walk would simply skip that one place, and
 * skipping is visible on the screen.
 */
async function speakerIdFor(email: string, uid?: string): Promise<string | undefined> {
  try {
    const snap = await db().collection(COLLECTIONS.speakers).where('eventId', '==', EVENT_ID).get();
    const hit = snap.docs.find((d) => {
      const s = d.data() as SpeakerDoc;
      return normaliseEmail(s.contactEmail ?? '') === email || (uid ? s.userId === uid : false);
    });
    return hit?.id;
  } catch (err) {
    recordError('person.speakerLookup', err);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Reading the walk
// ---------------------------------------------------------------------------

export interface FoundDocument {
  /** `orders/ord_123`. Shown nowhere; it is how the walk dedupes. */
  path: string;
  id: string;
  ref: DocumentReference;
  data: Record<string, unknown>;
}

export interface PlaceFindings {
  place: PersonPlace;
  docs: FoundDocument[];
}

/** Every ancestor document of an `each` place, listed rather than read. */
async function ancestors(parents: readonly string[]): Promise<DocumentReference[]> {
  let refs = await db().collection(parents[0]).listDocuments();
  for (const child of parents.slice(1)) {
    const next: DocumentReference[] = [];
    for (const ref of refs) next.push(...(await ref.collection(child).listDocuments()));
    refs = next;
  }
  return refs;
}

/**
 * ── The folded branch, and why it reads a whole collection ──────────────────
 *
 * Firestore has no case-insensitive comparison, and several collections store
 * an address exactly as somebody typed it: `emailLog.to` is whatever the
 * caller passed, a volunteer roster and a certificate carry the spelling on
 * the sheet they were imported from. An equality query on the lower-cased key
 * therefore returns nothing at all for `Ada.Okonkwo@Example.com` — and returns
 * it *silently*, so the erasure reports "0 found" and the organizer is told it
 * finished. That is the one failure this whole module exists to prevent.
 *
 * The alternatives were both worse. Writing a lower-cased copy of the address
 * beside every stored one changes how addresses are stored and leaves every
 * document written before today unmatched. Guessing at casings is guessing.
 * So a folded place lists its collection and compares in memory: a document
 * read per row of one collection, on an operation that happens a handful of
 * times per event, against an erasure that quietly misses documents.
 *
 * The exact query still runs first and its results are merged in, so the
 * common case — an address already stored in lower case — is answered by an
 * index even when the scan is refused or capped.
 */
async function matching(
  coll: CollectionReference,
  match: PlaceMatch,
  keys: PersonKeys,
  eventScoped: boolean,
): Promise<DocumentSnapshot[]> {
  if ('docId' in match) {
    const id = keys[match.docId];
    if (!id) return [];
    const snap = await coll.doc(id).get();
    return snap.exists ? [snap] : [];
  }
  const value = keys[match.key];
  if (!value) return [];

  if ('inArray' in match && match.inArray) {
    return (await coll.where(match.field, 'array-contains', value).get()).docs;
  }

  const exact = (await coll.where(match.field, '==', value).get()).docs;
  if (!('fold' in match && match.fold)) return exact;

  // Every collection reached this way carries `eventId`; the filter keeps a
  // scan inside this event rather than across the whole database. A
  // subcollection under one parent is small enough to read as it stands.
  const scan = eventScoped ? coll.where('eventId', '==', EVENT_ID) : coll;
  const seen = new Set(exact.map((d) => d.ref.path));
  const folded = (await scan.get()).docs.filter(
    (d) => !seen.has(d.ref.path) && foldedFieldMatches(value, d.get(match.field)),
  );

  return [...exact, ...folded];
}

async function documentsIn(place: PersonPlace, keys: PersonKeys): Promise<DocumentSnapshot[]> {
  const { where } = place;
  if (where.at === 'doc') {
    const id = keys[where.id];
    if (!id) return [];
    const snap = await db().collection(where.collection).doc(id).get();
    return snap.exists ? [snap] : [];
  }
  if (where.at === 'own') {
    const id = keys[where.id];
    if (!id) return [];
    return (await db().collection(where.parent).doc(id).collection(where.collection).get()).docs;
  }
  if (where.at === 'collection') {
    return matching(db().collection(where.collection), where.match, keys, true);
  }

  const out: DocumentSnapshot[] = [];
  for (const parent of await ancestors(where.parents)) {
    out.push(...(await matching(parent.collection(where.collection), where.match, keys, false)));
  }
  return out;
}

/**
 * Everywhere this person is, in walk order.
 *
 * ⚠️ Deduped by document path across the whole walk, not within a place. One
 * order can be caught twice — once as the address that bought it and once as a
 * seat on its lines — and writing it into the export twice, or anonymising it
 * twice, would be two different kinds of wrong. First place wins, so the order
 * appears under the entry that describes it best.
 */
export async function collectPerson(keys: PersonKeys): Promise<PlaceFindings[]> {
  const seen = new Set<string>();
  const findings: PlaceFindings[] = [];

  for (const place of placesFor(keys)) {
    const snaps = await documentsIn(place, keys);
    const docs: FoundDocument[] = [];
    for (const snap of snaps) {
      if (seen.has(snap.ref.path)) continue;
      seen.add(snap.ref.path);
      docs.push({
        path: snap.ref.path,
        id: snap.id,
        ref: snap.ref,
        data: (snap.data() ?? {}) as Record<string, unknown>,
      });
    }
    findings.push({ place, docs });
  }

  return findings;
}

/** What the screen shows before anybody presses anything. */
export interface HeldRow {
  key: string;
  label: string;
  count: number;
  /** What erasure would do here, in the words the panel prints. */
  fate: 'Deleted' | 'Name removed' | 'Kept';
  why?: string;
}

export function heldRows(findings: readonly PlaceFindings[]): HeldRow[] {
  return findings
    .filter((f) => f.docs.length > 0)
    .map((f) => ({
      key: f.place.key,
      label: f.place.label,
      count: f.docs.length,
      fate:
        f.place.erase.do === 'delete'
          ? ('Deleted' as const)
          : f.place.erase.do === 'anonymise'
            ? ('Name removed' as const)
            : ('Kept' as const),
      why: f.place.erase.why,
    }));
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

/**
 * Everything held about one person, as one JSON object.
 *
 * Grouped by place and labelled in plain words, because the person who reads
 * this is usually the subject of it rather than an engineer. `omittedFields`
 * names what was withheld from each group instead of dropping it silently — a
 * file that says "the badge secret is not in here" is answerable; one that just
 * lacks it invites a second request for the same data.
 */
export async function personExport(identity: PersonIdentity, on: Date = new Date()) {
  const findings = await collectPerson(identity.keys);

  const groups: Record<string, unknown> = {};
  for (const { place, docs } of findings) {
    if (docs.length === 0) continue;
    const omitted = new Set<string>();
    const records = docs.map((d) => {
      const { data, omitted: left } = exportDocument(d.data);
      for (const f of left) omitted.add(f);
      return { id: d.id, ...data };
    });
    groups[place.key] = {
      about: place.label,
      count: records.length,
      omittedFields: [...omitted].sort(),
      records,
    };
  }

  return {
    about: {
      event: EVENT_ID,
      person: { name: identity.name, email: identity.email },
      producedAt: on.toISOString(),
      note:
        'Everything this conference holds about one person, grouped by what it is. ' +
        'Badge codes, sign-in codes and internal lookup keys are left out, and each ' +
        'group names what was left out of it.',
    },
    data: groups,
  };
}

// ---------------------------------------------------------------------------
// Taking it away
// ---------------------------------------------------------------------------

export interface EraseResult {
  ok: boolean;
  error?: string;
  message?: string;
  outcomes?: PlaceOutcome[];
}

/**
 * Delete one person, and record that it happened.
 *
 * The typed confirmation is re-checked here and not only in the browser: a
 * disabled button is a courtesy, and this is the guard. It is checked against
 * the address the *server* resolved, so a tampered form field cannot point the
 * erasure at somebody else.
 *
 * ── What survives, and why it is not a compromise ───────────────────────────
 *
 * Six things, and every one of them is named on the screen before the button is
 * pressed, because an erasure that quietly keeps things is worse than one that
 * says what it keeps.
 *
 * A consent signature, with the signatory removed: it is the evidence that
 * wording was agreed, including wording the person may later dispute. An order,
 * with the buyer removed: a payment has to stay on the books. A row on the
 * mailing list, with the name and address removed and the unsubscribe stamped:
 * the row *is* the suppression, and deleting it is how somebody who asked to be
 * forgotten gets mailed by the next import. Their entry on the published
 * programme if they spoke, minus the contact address — the talk is a public
 * fact about the conference as well as a record about them. The scores they
 * gave as a reviewer, which name nobody. And the organizer log, which records
 * what organizers did rather than what the attendee did, and to which this
 * erasure is appended.
 */
export async function erasePerson(
  identity: PersonIdentity,
  typed: string,
  actor: string,
): Promise<EraseResult> {
  if (!confirmationMatches(typed, identity.email)) {
    return { ok: false, error: 'Type the email address exactly as it is shown to confirm.' };
  }

  const findings = await collectPerson(identity.keys);
  const outcomes: PlaceOutcome[] = [];

  for (const { place, docs } of findings) {
    const rule = place.erase;

    if (rule.do === 'keep') {
      outcomes.push({ key: place.key, label: place.label, found: docs.length, did: 'kept' });
      continue;
    }

    if (rule.do === 'delete') {
      for (const doc of docs) {
        if (rule.recursive) await db().recursiveDelete(doc.ref);
        else await doc.ref.delete();
      }
      outcomes.push({ key: place.key, label: place.label, found: docs.length, did: 'deleted' });
      continue;
    }

    let changed = 0;
    for (const doc of docs) {
      const update = redaction(rule, doc.data);
      // Fields the rule wants dated rather than cleared — today only the
      // mailing list's `unsubscribedAt`, which has to be set in the same write
      // that takes the address off the row, or a suppression is lost between
      // the two.
      for (const field of stampFields(rule, doc.data)) {
        update[field] = FieldValue.serverTimestamp();
      }
      if (Object.keys(update).length === 0) continue;
      // The stamp is here rather than in the pure function: a server timestamp
      // is not a value, and a second erasure of the same person writes nothing
      // rather than re-dating a record nobody touched.
      await doc.ref.update({ ...update, erasedAt: FieldValue.serverTimestamp() });
      changed += 1;
    }
    outcomes.push({ key: place.key, label: place.label, found: changed, did: 'anonymised' });
  }

  // The one thing that is not a document. Without it the account still signs
  // in, finds no profile, and is offered the onboarding form — which would
  // rebuild the person this just removed.
  const signIn = await deleteSignIn(identity.email);
  outcomes.push({
    key: 'signIn',
    label: 'Their sign-in account',
    found: signIn === 'deleted' ? 1 : 0,
    did: signIn === 'deleted' ? 'deleted' : 'skipped',
  });

  const places = placesFor(identity.keys).map((p) => p.key);
  await appendAudit({
    actor,
    action: 'attendee.erase',
    targetPath: identity.keys.registrationId
      ? `${COLLECTIONS.registrations}/${identity.keys.registrationId}`
      : `${COLLECTIONS.users}/${identity.keys.uid}`,
    targetId: identity.keys.registrationId ?? identity.keys.uid ?? identity.email,
    /*
      No name and no address. The log survives the erasure by design, and a
      display name falls back to the address for anybody who never filled in a
      profile — so a name here would put back, for ever, the one field the whole
      operation exists to remove. `erasureAuditBefore` has the argument.
    */
    before: erasureAuditBefore({
      walked: places.length,
      signedIn: identity.signedIn,
      hasTicket: identity.hasTicket,
    }),
    after: {
      summary: erasureSummary(outcomes),
      outcomes: outcomes.map((o) => `${o.key}:${o.did}:${o.found}`),
    },
  });

  return { ok: true, message: erasureSummary(outcomes), outcomes };
}

/**
 * Best effort, like the claim changes `attendee-admin.ts` makes on a cancel.
 * A person whose thousand documents are gone but whose Auth record outlived a
 * slow API call is a smaller problem than an erasure that refuses to finish.
 */
async function deleteSignIn(email: string): Promise<'deleted' | 'none'> {
  try {
    const auth = getAuth();
    const user = await auth.getUserByEmail(email).catch(() => null);
    if (!user) return 'none';
    await auth.deleteUser(user.uid);
    return 'deleted';
  } catch (err) {
    recordError('person.erase auth', err);
    return 'none';
  }
}

