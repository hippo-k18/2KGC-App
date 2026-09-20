import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import { contactId, normaliseEmail, registrationId } from '@kgc/scripts/src/lib/ids';

/**
 * Everywhere one person is held, as data — and the pure rules for reading it
 * out and taking it away.
 *
 * ── Why this is a list and not thirty queries in an action ──────────────────
 *
 * A subject access request and an erasure ask the same question: *where is this
 * person?* The expensive failure is not a slow walk, it is a collection nobody
 * remembered — an export that swears it is everything while a year of direct
 * messages sits untouched, or an erasure that leaves a name on a check-in row.
 * Both are only discoverable by reading every writer in the repo, which nobody
 * does twice.
 *
 * So the walk is declared once, here, as `PLACES`. Adding a collection is one
 * entry: it is exported, it is erased, and it is counted on the screen, in the
 * same commit that starts writing it. Nothing else in the feature knows a
 * collection name. `person-data.ts` runs these against Firestore and does not
 * decide anything; this file decides everything and touches no database, which
 * is why the decisions are testable.
 *
 * ⚠️ **Two things are deliberately not walked, and both are reasoned rather
 * than forgotten.**
 *
 * `gatherings.attendees` is a list of *names typed by an organizer*, not uids —
 * `GatheringDoc` says so and gives the reason: half the people at a sponsor
 * meeting hold no ticket. There is no join key, and matching a typed name
 * against a profile would erase the wrong Chen. The attendee's own projection
 * at `users/{uid}/gatherings` is walked, because that one is keyed.
 *
 * The call for abstracts (`submissions`, `reviewers`, and the identity document
 * under each submission) is a separate population reached by capability link
 * with no account, and its own screens own its retention. When it joins this
 * walk it joins as entries below, not as a second walk somewhere else.
 */

// ---------------------------------------------------------------------------
// Who the person is
// ---------------------------------------------------------------------------

/**
 * The five ways this database addresses one human being.
 *
 * They are not interchangeable and no two collections agree on which to use,
 * which is the whole reason a place has to name the one it is keyed by.
 */
export interface PersonKeys {
  /** Lower-cased. The only one that is always known. */
  email: string;
  /** `reg_…`. Present for anyone who holds or held a ticket. */
  registrationId?: string;
  /** Their Firebase account. Present once they have opened the app. */
  uid?: string;
  /** `contact_…`, the marketing list's own id. Derived, so always present. */
  contactId: string;
  /**
   * The value inside their badge QR. The raw scan log records the code that was
   * scanned and nothing else, so it is the only way to find their scans.
   */
  qrSecret?: string;
}

export type PersonKeyName = keyof PersonKeys;

/** Fill in everything derivable, so a caller supplies only what it read. */
export function personKeys(input: {
  email: string;
  uid?: string;
  registrationId?: string;
  qrSecret?: string;
}): PersonKeys {
  const email = normaliseEmail(input.email);
  return {
    email,
    uid: input.uid,
    // Derived rather than trusted: the id *is* the hash of the address, so a
    // caller passing a stale one would walk somebody else's ticket.
    registrationId: input.registrationId ?? (email ? registrationId(email) : undefined),
    contactId: contactId(email),
    qrSecret: input.qrSecret,
  };
}

// ---------------------------------------------------------------------------
// Where to look
// ---------------------------------------------------------------------------

/** How a place is matched to a person inside a collection. */
export type PlaceMatch =
  /** The document id is the key: `surveys/{id}/responses/{uid}`. */
  | { docId: PersonKeyName }
  /** A field equals the key: `communityPosts` where `authorId` is the uid. */
  | { field: string; key: PersonKeyName }
  /** An array field holds the key: `threads` where `participantIds` has the uid. */
  | { field: string; key: PersonKeyName; inArray: true };

export type PlaceQuery =
  /** One document at a derived id: `users/{uid}`. */
  | { at: 'doc'; collection: string; id: PersonKeyName }
  /** A top-level collection, filtered. */
  | { at: 'collection'; collection: string; match: PlaceMatch }
  /** A subcollection of the one document this person owns: `users/{uid}/fcmTokens`. */
  | { at: 'own'; parent: string; id: PersonKeyName; collection: string }
  /**
   * The same subcollection under every document of one or more ancestor
   * collections: `sessions/*​/questions/*​/upvotes/{uid}`.
   *
   * Costly by construction — it lists the ancestors — and that is accepted,
   * because the alternative is a collection-group index per nesting and an
   * index that is missing in production fails a *deletion*, which is the one
   * operation here that must not half-succeed.
   */
  | { at: 'each'; parents: readonly string[]; collection: string; match: PlaceMatch };

/** What erasure does where it arrives. */
export type EraseRule =
  /** Remove it. `recursive` also removes what is nested under it. */
  | { do: 'delete'; recursive?: true; why?: string }
  /**
   * Keep the document, take the person out of it. `clear` names top-level
   * fields; `clearIn` names fields inside the objects of an array field, which
   * a Firestore field path cannot reach.
   */
  | {
      do: 'anonymise';
      clear: readonly string[];
      clearIn?: { array: string; fields: readonly string[] };
      why: string;
    }
  /** Leave it exactly as it is. Only ever for a record about an organizer. */
  | { do: 'keep'; why: string };

export interface PersonPlace {
  /** Stable. It keys the JSON file, so renaming one breaks an old export. */
  key: string;
  /** What an organizer reads on the screen. Plain words, no collection names. */
  label: string;
  where: PlaceQuery;
  erase: EraseRule;
}

const C = COLLECTIONS;
const S = SUBCOLLECTIONS;

/**
 * The walk, in the order the file reads: who they are, what they kept, what
 * they wrote, where they went, and the records that outlive them.
 */
export const PLACES: readonly PersonPlace[] = [
  {
    key: 'registration',
    label: 'Their ticket',
    where: { at: 'doc', collection: C.registrations, id: 'registrationId' },
    erase: { do: 'delete' },
  },
  {
    key: 'profile',
    label: 'Their app profile',
    where: { at: 'doc', collection: C.users, id: 'uid' },
    erase: { do: 'delete' },
  },
  {
    key: 'directoryListing',
    label: 'Their entry in the attendee directory',
    where: { at: 'doc', collection: C.directory, id: 'uid' },
    erase: { do: 'delete' },
  },
  {
    key: 'savedSessions',
    label: 'Sessions they saved',
    where: { at: 'own', parent: C.users, id: 'uid', collection: S.savedSessions },
    erase: { do: 'delete' },
  },
  {
    key: 'savedContacts',
    label: 'People they saved',
    where: { at: 'own', parent: C.users, id: 'uid', collection: S.savedContacts },
    erase: { do: 'delete' },
  },
  {
    /**
     * The other direction, and the one that is always forgotten: everybody
     * else's saved-contacts list with this person's card in it. Leaving these
     * behind is how an erased person keeps appearing in somebody's app.
     */
    key: 'savedByOthers',
    label: 'Other people who saved their card',
    where: {
      at: 'each',
      parents: [C.users],
      collection: S.savedContacts,
      match: { field: 'contactUid', key: 'uid' },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'notifications',
    label: 'Notifications sent to them',
    where: { at: 'own', parent: C.users, id: 'uid', collection: S.notifications },
    erase: { do: 'delete' },
  },
  {
    key: 'devices',
    label: 'Devices registered for push',
    where: { at: 'own', parent: C.users, id: 'uid', collection: S.fcmTokens },
    erase: { do: 'delete' },
  },
  {
    key: 'entitlements',
    label: 'What their ticket unlocked',
    where: { at: 'own', parent: C.users, id: 'uid', collection: S.entitlements },
    erase: { do: 'delete' },
  },
  {
    key: 'gatheringSeats',
    label: 'Tables and meetings they were placed at',
    where: { at: 'own', parent: C.users, id: 'uid', collection: S.gatherings },
    erase: { do: 'delete' },
  },
  {
    key: 'messagesSent',
    label: 'Messages they wrote',
    where: {
      at: 'each',
      parents: [C.threads],
      collection: S.messages,
      match: { field: 'senderId', key: 'uid' },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'messageThreads',
    label: 'Conversations they were part of',
    where: {
      at: 'collection',
      collection: C.threads,
      match: { field: 'participantIds', key: 'uid', inArray: true },
    },
    erase: {
      do: 'delete',
      recursive: true,
      why: 'A conversation has two people in it. Once one side is gone the other side cannot be opened, so the whole thread goes.',
    },
  },
  {
    key: 'communityPosts',
    label: 'Posts on the community board',
    where: { at: 'collection', collection: C.communityPosts, match: { field: 'authorId', key: 'uid' } },
    erase: { do: 'delete', recursive: true },
  },
  {
    key: 'communityReplies',
    label: 'Replies on the community board',
    where: {
      at: 'each',
      parents: [C.communityPosts],
      collection: S.replies,
      match: { field: 'authorId', key: 'uid' },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'communityReactions',
    label: 'Reactions they left',
    where: {
      at: 'each',
      parents: [C.communityPosts],
      collection: S.reactions,
      match: { field: 'uid', key: 'uid' },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'sessionQuestions',
    label: 'Questions they asked in sessions',
    where: {
      at: 'each',
      parents: [C.sessions],
      collection: S.questions,
      match: { field: 'authorId', key: 'uid' },
    },
    erase: { do: 'delete', recursive: true },
  },
  {
    key: 'questionUpvotes',
    label: 'Questions they upvoted',
    where: {
      at: 'each',
      parents: [C.sessions, S.questions],
      collection: S.upvotes,
      match: { docId: 'uid' },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'pollVotes',
    label: 'Poll answers',
    where: {
      at: 'each',
      parents: [C.sessions, S.polls],
      collection: S.votes,
      match: { docId: 'uid' },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'surveyAnswers',
    label: 'Survey and feedback answers',
    where: { at: 'each', parents: [C.surveys], collection: S.responses, match: { docId: 'uid' } },
    erase: { do: 'delete' },
  },
  {
    key: 'sessionSeats',
    label: 'Seats they held in capped sessions',
    where: { at: 'each', parents: [C.sessionSeats], collection: S.seats, match: { docId: 'uid' } },
    erase: { do: 'delete' },
  },
  {
    key: 'sponsorLeads',
    label: 'Sponsor stands they left their details with',
    where: {
      at: 'each',
      parents: [C.sponsors],
      collection: S.leads,
      match: { field: 'uid', key: 'uid' },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'checkIns',
    label: 'Times they were checked in',
    where: {
      at: 'each',
      parents: [C.checkInLists],
      collection: S.checkIns,
      match: { docId: 'registrationId' },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'scans',
    label: 'Badge scans at the door',
    where: { at: 'collection', collection: C.scanEvents, match: { field: 'qrSecret', key: 'qrSecret' } },
    erase: { do: 'delete' },
  },
  {
    key: 'certificates',
    label: 'Attendance certificates issued to them',
    where: { at: 'collection', collection: C.certificates, match: { field: 'email', key: 'email' } },
    erase: { do: 'delete' },
  },
  {
    key: 'volunteerShifts',
    label: 'Volunteer shifts',
    where: { at: 'collection', collection: C.volunteers, match: { field: 'email', key: 'email' } },
    erase: { do: 'delete' },
  },
  {
    key: 'marketingContact',
    label: 'Their place on the mailing list',
    where: { at: 'doc', collection: C.contacts, id: 'contactId' },
    erase: { do: 'delete' },
  },
  {
    key: 'checkoutAnswers',
    label: 'Answers held between checkout and payment',
    where: { at: 'collection', collection: C.pendingAnswers, match: { field: 'email', key: 'email' } },
    erase: { do: 'delete' },
  },

  // -------------------------------------------------------------------------
  // Kept, with the person taken out
  // -------------------------------------------------------------------------

  {
    /**
     * A signature is the record that somebody agreed to wording on a date. It
     * is the one thing here that could be produced against us, and destroying
     * it on request would destroy the only evidence that consent was ever
     * given — including consent the person later disputes. So the signature
     * survives and the human being is removed from it.
     */
    key: 'consentSignatures',
    label: 'Consent and release forms they signed',
    where: {
      at: 'each',
      parents: [C.consentForms],
      collection: S.responses,
      match: { field: 'email', key: 'email' },
    },
    erase: {
      do: 'anonymise',
      clear: ['email', 'signedName', 'uid', 'ip', 'userAgent'],
      why: 'The record that a form was signed, and which wording, is kept. The name and address are removed from it.',
    },
  },
  {
    key: 'orders',
    label: 'What they bought',
    where: { at: 'collection', collection: C.orders, match: { field: 'email', key: 'email' } },
    erase: {
      do: 'anonymise',
      clear: ['email', 'buyerName', 'companyName'],
      clearIn: { array: 'items', fields: ['attendeeName', 'attendeeEmail'] },
      why: 'A payment has to stay on the books. The amounts are kept, the buyer is removed.',
    },
  },
  {
    /**
     * A second way an order names this person: a company bought four seats and
     * put four different addresses on the lines. The walk dedupes by document
     * path, so an order caught by both entries is written once.
     */
    key: 'orderSeats',
    label: 'Orders that bought their seat',
    where: {
      at: 'collection',
      collection: C.orders,
      match: { field: 'registrationIds', key: 'registrationId', inArray: true },
    },
    erase: {
      do: 'anonymise',
      clear: ['email', 'buyerName', 'companyName'],
      clearIn: { array: 'items', fields: ['attendeeName', 'attendeeEmail'] },
      why: 'A payment has to stay on the books. The amounts are kept, the buyer is removed.',
    },
  },
  {
    key: 'emailsSent',
    label: 'Emails we sent them',
    where: { at: 'collection', collection: C.emailLog, match: { field: 'to', key: 'email' } },
    erase: {
      do: 'anonymise',
      clear: ['to'],
      why: 'The log of what was sent is how a missing confirmation gets traced. The address is removed from it.',
    },
  },

  // -------------------------------------------------------------------------
  // Kept as written
  // -------------------------------------------------------------------------

  {
    /**
     * Not a record *about* the attendee: a record of what an organizer did, and
     * the only answer to "who cancelled that ticket?". It is staff-only, it is
     * never shown to an attendee, and the erasure itself is appended to it.
     */
    key: 'organizerActions',
    label: 'Organizer actions on their ticket',
    where: { at: 'collection', collection: C.auditLog, match: { field: 'targetId', key: 'registrationId' } },
    erase: {
      do: 'keep',
      why: 'This is the record of what organizers did, not what the attendee did. It is kept, and this deletion is added to it.',
    },
  },
];

/** The key a place is matched on, whichever shape it uses. */
export function keyNameOf(place: PersonPlace): PersonKeyName {
  const { where } = place;
  return where.at === 'doc' ? where.id : where.at === 'own' ? where.id : where.match.key ?? where.match.docId;
}

/**
 * The places that can be looked at for this person, in walk order.
 *
 * A person who never opened the app has no uid, so two thirds of the list is
 * unreachable — and reaching it anyway would mean querying on `undefined`,
 * which Firestore answers with every document in the collection. That is the
 * failure this function exists to prevent: an erasure that deletes the whole
 * community board because the subject never signed in.
 */
export function placesFor(keys: PersonKeys): PersonPlace[] {
  return PLACES.filter((p) => {
    const value = keys[keyNameOf(p)];
    return typeof value === 'string' && value.length > 0;
  });
}

/** The places skipped, and the one word that says why. */
export function skippedPlaces(keys: PersonKeys): { place: PersonPlace; missing: PersonKeyName }[] {
  return PLACES.filter((p) => !keys[keyNameOf(p)]).map((p) => ({ place: p, missing: keyNameOf(p) }));
}

// ---------------------------------------------------------------------------
// Reading it out
// ---------------------------------------------------------------------------

/**
 * Never written into an export file, even one going to the person themselves.
 *
 * `exports.ts` made this argument for the CSVs and it holds harder here: a QR
 * secret admits its holder at the door and a claim code signs them into the app
 * as that attendee. A subject access file is emailed, forwarded and left in a
 * downloads folder, so a working credential inside it is a ticket anybody can
 * use. The hashes are here for a different reason — they are lookup keys that
 * invite joining data that should not be joined, and they tell the reader
 * nothing about themselves.
 */
export const NEVER_EXPORTED = [
  'qrSecret',
  'claimCode',
  'tempPassword',
  'token',
  'emailHash',
  'inviteTokenHash',
  'submitterTokenHash',
  'bodyHash',
] as const;

/** A value Firestore can hold, flattened to something `JSON.stringify` keeps. */
export function jsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') {
    // Firestore Timestamp, and anything else that knows its own date.
    const asDate = (value as { toDate?: () => Date }).toDate;
    if (typeof asDate === 'function') return asDate.call(value).toISOString();
    if (value instanceof Date) return value.toISOString();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

/** One document as it appears in the file, with what was withheld named. */
export function exportDocument(data: Record<string, unknown>): {
  data: Record<string, unknown>;
  omitted: string[];
} {
  const out: Record<string, unknown> = {};
  const omitted: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if ((NEVER_EXPORTED as readonly string[]).includes(k)) {
      omitted.push(k);
      continue;
    }
    out[k] = jsonSafe(v);
  }
  return { data: out, omitted: omitted.sort() };
}

/** `kgc-2027-data-for-ada-nakamura-2026-09-20.json`, or the address if unnamed. */
export function exportFilename(name: string, email: string, on: Date): string {
  const who =
    (name || email.split('@')[0] || 'attendee')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'attendee';
  return `kgc-data-for-${who}-${on.toISOString().slice(0, 10)}.json`;
}

// ---------------------------------------------------------------------------
// Taking it away
// ---------------------------------------------------------------------------

/**
 * The fields to write over a document that is kept rather than deleted.
 *
 * Returns `{}` when there is nothing left to take out, so a second erasure of
 * the same person writes nothing and the audit trail does not fill with
 * no-op entries. `erasedAt` is deliberately *not* set here: the caller stamps
 * it, because a server timestamp is not a pure value.
 */
export function redaction(
  rule: Extract<EraseRule, { do: 'anonymise' }>,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  for (const field of rule.clear) {
    if (data[field] === undefined || data[field] === null || data[field] === '') continue;
    update[field] = null;
  }

  const nested = rule.clearIn;
  if (nested && Array.isArray(data[nested.array])) {
    const rows = data[nested.array] as Record<string, unknown>[];
    let touched = false;
    const next = rows.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const copy = { ...row };
      for (const field of nested.fields) {
        if (copy[field] === undefined || copy[field] === null || copy[field] === '') continue;
        delete copy[field];
        touched = true;
      }
      return copy;
    });
    if (touched) update[nested.array] = next;
  }

  return update;
}

/** What one place did, for the screen and for the audit entry. */
export interface PlaceOutcome {
  key: string;
  label: string;
  /** How many documents were found. */
  found: number;
  /** What happened to them. `skipped` is a place this person cannot reach. */
  did: 'deleted' | 'anonymised' | 'kept' | 'skipped';
}

/** `Deleted 14 documents, kept 3, removed the name from 2.` */
export function erasureSummary(outcomes: readonly PlaceOutcome[]): string {
  const total = (did: PlaceOutcome['did']) =>
    outcomes.filter((o) => o.did === did).reduce((n, o) => n + o.found, 0);
  const deleted = total('deleted');
  const anonymised = total('anonymised');
  const kept = total('kept');

  const parts = [`Deleted ${deleted} ${deleted === 1 ? 'record' : 'records'}.`];
  if (anonymised > 0) {
    parts.push(`Took their name off ${anonymised} ${anonymised === 1 ? 'record' : 'records'} that have to stay.`);
  }
  if (kept > 0) {
    parts.push(`Left ${kept} ${kept === 1 ? 'entry' : 'entries'} in the organizer log.`);
  }
  return parts.join(' ');
}

/**
 * Is the typed confirmation right?
 *
 * The address, not a fixed word: the point of typing is that you have to read
 * which row you are on, and `delete` can be typed without looking. Case and
 * surrounding space are forgiven because neither is what is being checked.
 *
 * ⚠️ The browser disables the button on the same test. This one is the guard —
 * the action calls it, because anything enforced only in the browser is
 * enforced only for people who did not think to look.
 */
export function confirmationMatches(typed: string, email: string): boolean {
  return normaliseEmail(typed) === normaliseEmail(email) && email.length > 0;
}
