import 'server-only';

import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
} from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type RegistrationDoc, type UserDoc } from '@kgc/shared';
import { normaliseEmail } from '@kgc/scripts/src/lib/ids';
import { appendAudit } from './audit';
import { db } from './firestore';
import { recordError } from './errors';
import {
  confirmationMatches,
  erasureSummary,
  exportDocument,
  personKeys,
  placesFor,
  redaction,
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
    keys: personKeys({ email, uid, registrationId: regId, qrSecret: reg?.qrSecret }),
    name: reg?.name || user?.name || email,
    email,
    signedIn: Boolean(user),
    hasTicket: Boolean(reg),
  };
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

async function matching(
  coll: CollectionReference,
  match: PlaceMatch,
  keys: PersonKeys,
): Promise<DocumentSnapshot[]> {
  if ('docId' in match) {
    const id = keys[match.docId];
    if (!id) return [];
    const snap = await coll.doc(id).get();
    return snap.exists ? [snap] : [];
  }
  const value = keys[match.key];
  if (!value) return [];
  const q =
    'inArray' in match && match.inArray
      ? coll.where(match.field, 'array-contains', value)
      : coll.where(match.field, '==', value);
  return (await q.get()).docs;
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
    return matching(db().collection(where.collection), where.match, keys);
  }

  const out: DocumentSnapshot[] = [];
  for (const parent of await ancestors(where.parents)) {
    out.push(...(await matching(parent.collection(where.collection), where.match, keys)));
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
 * Three things: a consent signature with the signatory removed, an order with
 * the buyer removed, and the organizer log. The first two are records that have
 * to exist — evidence that wording was agreed, and a payment on the books — and
 * the person is taken out of both. The third is a record of what organizers
 * did, not of what the attendee did, and this erasure is appended to it. All
 * three are named on the screen before the button is pressed, because an
 * erasure that quietly keeps things is worse than one that says what it keeps.
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
    // The address is deliberately not carried into the entry. The log survives
    // the erasure, so writing the address into it would put back the one field
    // the whole operation exists to remove.
    before: { name: identity.name, walked: places.length, signedIn: identity.signedIn },
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

